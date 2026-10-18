# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Dart Agent SDK bridge implementation.

The bridge compiles `dart_runner.dart` against `dart/a2ui_agent` and
`dart/a2ui_core` into a native executable once, then runs it per request with a
JSON payload on stdin.

The executable is cached per checkout under
`<repo>/.dart_tool/a2ui_eval/bridge_<hash>`, where the hash covers the runner,
both packages' `lib/` sources, the resolved package configuration and the Dart
SDK version. Any change to those inputs produces a new executable, and two
checkouts never share one.
"""

from __future__ import annotations

from collections.abc import Iterator
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
from typing import Any

from ..shared.utils import GIT_ROOT
from .base import (
    AgentSdkBridge,
    DEFAULT_PARSE_TIMEOUT_SEC,
    validate_sdk_format,
    validate_sdk_version,
)

try:
    import fcntl
except ImportError:  # pragma: no cover - fcntl is unavailable on Windows.
    fcntl = None  # type: ignore[assignment]

DART_RUNNER_PATH = Path(__file__).resolve().parent / "dart_runner.dart"
MIN_DART_VERSION: tuple[int, int] = (3, 10)

_VERSION_RE = re.compile(r"version:\s*(\d+)\.(\d+)\.(\d+)")
_DART_PACKAGES: tuple[str, ...] = ("a2ui_agent", "a2ui_core")
_VERSION_CHECK_TIMEOUT_SEC = 10.0
_PUB_GET_TIMEOUT_SEC = 900.0
_COMPILE_TIMEOUT_SEC = 600.0
_PROMPT_TIMEOUT_SEC = 15.0
_MAX_ERROR_OUTPUT_CHARS = 4000


def _tail(text: str, limit: int = _MAX_ERROR_OUTPUT_CHARS) -> str:
    """Returns the last `limit` characters of `text`, marking any truncation."""
    text = text.strip()
    if len(text) <= limit:
        return text
    return "[...truncated...]\n" + text[-limit:]


def _dart_version_output(dart_bin: str) -> str | None:
    """Returns the output of `dart --version`, or None if it cannot run."""
    try:
        proc = subprocess.run(
            [dart_bin, "--version"],
            capture_output=True,
            text=True,
            timeout=_VERSION_CHECK_TIMEOUT_SEC,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return f"{proc.stdout}\n{proc.stderr}".strip()


def _parse_dart_version(version_output: str | None) -> tuple[int, int] | None:
    """Extracts (major, minor) from `dart --version` output."""
    if not version_output:
        return None
    match = _VERSION_RE.search(version_output)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _is_supported_dart(dart_bin: str) -> bool:
    """Checks whether the Dart executable is at least `MIN_DART_VERSION`."""
    version = _parse_dart_version(_dart_version_output(dart_bin))
    return version is not None and version >= MIN_DART_VERSION


def _dart_candidates() -> list[str]:
    """Lists Dart executables on PATH and in standard SDK locations, in order."""
    candidates: list[str] = []
    which_dart = shutil.which("dart")
    if which_dart:
        candidates.append(which_dart)

    fallback_paths = [
        Path.home() / "development" / "flutter" / "bin" / "dart",
        Path("/usr/lib/google-dartlang/bin/dart"),
        Path.home() / "flutter" / "bin" / "dart",
        Path.home() / "tools" / "dart-sdk" / "bin" / "dart",
    ]
    for path in fallback_paths:
        if path.is_file() and str(path) not in candidates:
            candidates.append(str(path))
    return candidates


def _find_dart() -> tuple[str, str]:
    """Returns the first supported Dart executable and its `--version` output.

    Raises:
        RuntimeError: If no candidate is at least `MIN_DART_VERSION`.
    """
    candidates = _dart_candidates()
    rejected: list[str] = []
    for candidate in candidates:
        output = _dart_version_output(candidate)
        version = _parse_dart_version(output)
        if version is not None and version >= MIN_DART_VERSION:
            return candidate, output or ""
        found = f"{version[0]}.{version[1]}" if version else "unknown version"
        rejected.append(f"{candidate} ({found})")

    minimum = ".".join(str(part) for part in MIN_DART_VERSION)
    if rejected:
        raise RuntimeError(
            f"No supported Dart executable (>= {minimum}) found. Rejected: "
            + ", ".join(rejected)
            + ". Install a newer Flutter SDK and put its bin/ directory on PATH."
        )
    raise RuntimeError(
        f"Dart executable ('dart' >= {minimum}) not found on PATH or standard SDK"
        " locations. Install the Flutter SDK and put its bin/ directory on PATH."
    )


def find_dart_binary() -> str:
    """Locates a supported Dart executable on PATH or standard SDK locations.

    Raises:
        RuntimeError: If no Dart executable of at least `MIN_DART_VERSION` exists.
    """
    return _find_dart()[0]


def find_flutter_binary(dart_bin: str | None = None) -> str | None:
    """Locates the Flutter executable, preferring the one next to `dart_bin`."""
    if dart_bin:
        sibling = Path(dart_bin).parent / "flutter"
        if sibling.is_file():
            return str(sibling)
    return shutil.which("flutter")


def compute_bridge_hash(git_root: Path, dart_version: str, runner_path: Path) -> str:
    """Hashes every input that affects the compiled bridge executable.

    The inputs are the runner source, every `.dart` file under the `lib/`
    directories of `dart/a2ui_agent` and `dart/a2ui_core`, the root
    `.dart_tool/package_config.json` and `pubspec.lock` (when present), and the
    `dart --version` output.
    """
    digest = hashlib.sha256()

    def add(label: str, data: bytes) -> None:
        digest.update(label.encode("utf-8"))
        digest.update(b"\0")
        digest.update(len(data).to_bytes(8, "big"))
        digest.update(data)

    add("runner", runner_path.read_bytes())
    for package in _DART_PACKAGES:
        lib_dir = git_root / "dart" / package / "lib"
        if not lib_dir.is_dir():
            continue
        for dart_file in sorted(lib_dir.rglob("*.dart")):
            add(dart_file.relative_to(git_root).as_posix(), dart_file.read_bytes())
    for relative in (Path(".dart_tool") / "package_config.json", Path("pubspec.lock")):
        path = git_root / relative
        if path.is_file():
            add(relative.as_posix(), path.read_bytes())
    add("dart --version", dart_version.encode("utf-8"))
    return digest.hexdigest()[:32]


@contextlib.contextmanager
def _exclusive_file_lock(lock_path: Path) -> Iterator[None]:
    """Holds an exclusive advisory lock on `lock_path` across processes."""
    if fcntl is None:  # pragma: no cover - fcntl is unavailable on Windows.
        yield
        return
    with open(lock_path, "a", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


class DartSdkBridge(AgentSdkBridge):
    """Bridge for the Dart A2UI Agent SDK (dart/a2ui_agent)."""

    sdk_name = "dart"

    def __init__(
        self,
        git_root: Path | None = None,
        runner_path: Path | None = None,
    ) -> None:
        self._git_root = git_root if git_root is not None else GIT_ROOT
        self._runner_path = runner_path if runner_path is not None else DART_RUNNER_PATH
        self._compiled_exe: Path | None = None
        self._lock = threading.Lock()
        self._prompt_cache: dict[tuple[str, str, str, str], str] = {}

    @property
    def cache_dir(self) -> Path:
        """The per-checkout directory holding compiled bridge executables."""
        return self._git_root / ".dart_tool" / "a2ui_eval"

    def _ensure_package_config(self, dart_bin: str) -> Path:
        """Returns the root package config, resolving the workspace if needed.

        The root pubspec is a Flutter workspace, so it is resolved with
        `flutter pub get`; a standalone `dart pub get` cannot resolve it.

        Raises:
            RuntimeError: If Flutter is missing or `flutter pub get` fails.
        """
        pkg_config = self._git_root / ".dart_tool" / "package_config.json"
        if pkg_config.is_file():
            return pkg_config

        instruction = (
            f"Run `flutter pub get` in {self._git_root} with a Flutter SDK whose"
            " Dart version satisfies the workspace, then retry."
        )
        flutter_bin = find_flutter_binary(dart_bin)
        if flutter_bin is None:
            raise RuntimeError(
                f"The Dart bridge needs {pkg_config}, and Flutter was not found to"
                f" create it. {instruction}"
            )
        try:
            proc = subprocess.run(
                [flutter_bin, "pub", "get"],
                cwd=str(self._git_root),
                capture_output=True,
                text=True,
                timeout=_PUB_GET_TIMEOUT_SEC,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                f"`flutter pub get` timed out after {_PUB_GET_TIMEOUT_SEC:.0f}s."
                f" {instruction}"
            ) from exc
        if proc.returncode != 0 or not pkg_config.is_file():
            output = _tail(f"{proc.stdout}\n{proc.stderr}")
            raise RuntimeError(
                f"`flutter pub get` failed (exit code {proc.returncode})."
                f" {instruction}\n{output}"
            )
        return pkg_config

    def _compile(self, dart_bin: str, pkg_config: Path, exe_path: Path) -> None:
        """Compiles the runner to `exe_path` through a unique temporary file."""
        fd, tmp_name = tempfile.mkstemp(
            prefix=f".{exe_path.name}.", suffix=".tmp", dir=str(exe_path.parent)
        )
        os.close(fd)
        tmp_exe = Path(tmp_name)
        try:
            try:
                proc = subprocess.run(
                    [
                        dart_bin,
                        "compile",
                        "exe",
                        str(self._runner_path),
                        f"--packages={pkg_config}",
                        "-o",
                        str(tmp_exe),
                    ],
                    cwd=str(self._git_root),
                    capture_output=True,
                    text=True,
                    timeout=_COMPILE_TIMEOUT_SEC,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError(
                    f"Dart compilation timed out after {_COMPILE_TIMEOUT_SEC:.0f}s."
                ) from exc
            if proc.returncode != 0:
                raise RuntimeError(
                    f"Dart compilation failed (exit code {proc.returncode}):\n"
                    + _tail(f"{proc.stdout}\n{proc.stderr}")
                )
            os.chmod(tmp_exe, 0o700)
            os.replace(tmp_exe, exe_path)
        finally:
            tmp_exe.unlink(missing_ok=True)

    def prepare(self) -> None:
        """Resolves the compiled runner, building it if its inputs changed.

        The executable path is resolved once per bridge instance. Later calls
        return immediately, so source edits made during a run are picked up by
        the next run.
        """
        with self._lock:
            if self._compiled_exe is not None and self._compiled_exe.is_file():
                return

            dart_bin, dart_version = _find_dart()
            pkg_config = self._ensure_package_config(dart_bin)
            bridge_hash = compute_bridge_hash(
                self._git_root, dart_version, self._runner_path
            )
            cache_dir = self.cache_dir
            cache_dir.mkdir(parents=True, exist_ok=True)
            exe_path = cache_dir / f"bridge_{bridge_hash}"

            with _exclusive_file_lock(cache_dir / f"bridge_{bridge_hash}.lock"):
                if not exe_path.is_file():
                    self._compile(dart_bin, pkg_config, exe_path)
            self._compiled_exe = exe_path

    def _invoke_runner(
        self, payload: dict[str, Any], timeout_sec: float = _PROMPT_TIMEOUT_SEC
    ) -> Any:
        self.prepare()
        assert self._compiled_exe is not None
        input_bytes = json.dumps(payload).encode("utf-8")

        try:
            proc = subprocess.run(
                [str(self._compiled_exe)],
                input=input_bytes,
                capture_output=True,
                cwd=str(self._git_root),
                timeout=timeout_sec if timeout_sec > 0 else None,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise TimeoutError(
                f"Format compilation timed out after {timeout_sec}s and"
                " process was killed."
            ) from exc

        stdout_text = proc.stdout.decode("utf-8", errors="replace").strip()
        stderr_text = proc.stderr.decode("utf-8", errors="replace").strip()

        if not stdout_text:
            detail = _tail(stderr_text) or f"exit code {proc.returncode}"
            raise ValueError(f"Dart SDK runner produced no output ({detail}).")

        try:
            response = json.loads(stdout_text)
        except json.JSONDecodeError as exc:
            detail = _tail(stdout_text)
            if stderr_text:
                detail += f"\nStderr:\n{_tail(stderr_text)}"
            raise ValueError(f"Invalid JSON from Dart SDK runner: {detail}") from exc

        if not isinstance(response, dict):
            raise ValueError(
                f"Dart SDK runner returned {type(response).__name__}, expected an"
                " object."
            )
        if "error" in response:
            raise ValueError(str(response["error"]))
        if "result" not in response:
            raise ValueError("Dart SDK runner response has no 'result'.")
        return response["result"]

    def generate_prompt(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str = "main",
    ) -> str:
        validate_sdk_format(self.sdk_name, format_name)
        norm_version = validate_sdk_version(self.sdk_name, version)
        cache_key = (format_name, norm_version, resolved_catalog_path, surface_id)
        cached = self._prompt_cache.get(cache_key)
        if cached is not None:
            return cached

        result = self._invoke_runner(
            {
                "action": "generate_prompt",
                "format_name": format_name,
                "version": norm_version,
                "resolved_catalog_path": resolved_catalog_path,
                "surface_id": surface_id,
            },
            timeout_sec=_PROMPT_TIMEOUT_SEC,
        )
        prompt = str(result)
        self._prompt_cache[cache_key] = prompt
        return prompt

    def parse_and_validate(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str,
        completion: str,
        timeout_sec: float = DEFAULT_PARSE_TIMEOUT_SEC,
        require_complete_tags: bool = False,
        *,
        validate: bool = True,
    ) -> dict[str, Any]:
        validate_sdk_format(self.sdk_name, format_name)
        norm_version = validate_sdk_version(self.sdk_name, version)
        result = self._invoke_runner(
            {
                "action": "parse_and_validate",
                "format_name": format_name,
                "version": norm_version,
                "resolved_catalog_path": resolved_catalog_path,
                "surface_id": surface_id,
                "completion": completion,
                "require_complete_tags": require_complete_tags,
                "validate": validate,
            },
            timeout_sec=timeout_sec if timeout_sec > 0 else DEFAULT_PARSE_TIMEOUT_SEC,
        )
        return dict(result)
