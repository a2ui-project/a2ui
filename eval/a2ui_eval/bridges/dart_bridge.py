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

"""Dart Agent SDK bridge implementation."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Any

from ..shared.utils import GIT_ROOT
from .base import AgentSdkBridge, validate_sdk_format

DART_RUNNER_PATH = Path(__file__).resolve().parent / "dart_runner.dart"
_VERSION_RE = re.compile(r"version:\s*(\d+)\.(\d+)\.(\d+)")


def _is_supported_dart(dart_bin: str) -> bool:
    """Checks whether the Dart executable is version >= 3.10.0."""
    try:
        proc = subprocess.run(
            [dart_bin, "--version"],
            capture_output=True,
            text=True,
            timeout=5.0,
            check=False,
        )
        output = f"{proc.stdout}\n{proc.stderr}"
        match = _VERSION_RE.search(output)
        if not match:
            return False
        major, minor = int(match.group(1)), int(match.group(2))
        return (major, minor) >= (3, 10)
    except OSError:
        return False


def find_dart_binary() -> str:
    """Locates a Dart executable (>= 3.10.0) on PATH or standard SDK locations."""
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
    for p in fallback_paths:
        if p.is_file() and str(p) not in candidates:
            candidates.append(str(p))

    for candidate in candidates:
        if _is_supported_dart(candidate):
            return candidate

    if candidates:
        return candidates[0]

    raise RuntimeError(
        "Dart executable ('dart' >= 3.10.0) not found on PATH or standard SDK"
        " locations."
    )


def _latest_dart_source_mtime() -> float:
    """Returns the latest modification timestamp of dart_runner.dart and dart/a2ui_agent."""
    latest = DART_RUNNER_PATH.stat().st_mtime
    for pkg_dir in (
        GIT_ROOT / "dart" / "a2ui_agent" / "lib",
        GIT_ROOT / "dart" / "a2ui_core" / "lib",
    ):
        if pkg_dir.is_dir():
            for dart_file in pkg_dir.rglob("*.dart"):
                mtime = dart_file.stat().st_mtime
                if mtime > latest:
                    latest = mtime
    return latest


class DartSdkBridge(AgentSdkBridge):
    """Bridge for the Dart A2UI Agent SDK (dart/a2ui_agent)."""

    sdk_name = "dart"

    def __init__(self) -> None:
        self._compiled_exe: Path | None = None

    def _get_exe_path(self) -> Path:
        uid = getattr(os, "getuid", lambda: 0)()
        temp_dir = Path(tempfile.gettempdir()) / f"a2ui_dart_eval_{uid}"
        temp_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        return temp_dir / "bridge_exe"

    def prepare(self) -> None:
        """Compiles dart_runner.dart to a native executable for fast parallel invocation."""
        exe_path = self._get_exe_path()
        latest_mtime = _latest_dart_source_mtime()

        if (
            self._compiled_exe is not None
            and self._compiled_exe.is_file()
            and self._compiled_exe.stat().st_mtime >= latest_mtime
        ):
            return

        if exe_path.is_file() and exe_path.stat().st_mtime >= latest_mtime:
            self._compiled_exe = exe_path
            return

        dart_bin = find_dart_binary()
        pkg_config = GIT_ROOT / ".dart_tool" / "package_config.json"
        if not pkg_config.is_file():
            subprocess.run(
                [dart_bin, "pub", "get"],
                cwd=str(GIT_ROOT),
                check=True,
            )

        tmp_exe = exe_path.with_suffix(f".tmp.{os.getpid()}")
        try:
            subprocess.run(
                [
                    dart_bin,
                    "compile",
                    "exe",
                    str(DART_RUNNER_PATH),
                    f"--packages={pkg_config}",
                    "-o",
                    str(tmp_exe),
                ],
                cwd=str(GIT_ROOT),
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(
                "Dart compilation"
                f" failed:\nStdout:\n{exc.stdout}\nStderr:\n{exc.stderr}"
            ) from exc
        os.replace(tmp_exe, exe_path)
        self._compiled_exe = exe_path

    def _invoke_runner(self, payload: dict[str, Any], timeout_sec: float = 10.0) -> Any:
        self.prepare()
        assert self._compiled_exe is not None
        input_bytes = json.dumps(payload).encode("utf-8")

        try:
            proc = subprocess.run(
                [str(self._compiled_exe)],
                input=input_bytes,
                capture_output=True,
                cwd=str(GIT_ROOT),
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
            detail = stderr_text or f"exit code {proc.returncode}"
            raise ValueError(f"Dart SDK runner produced no output ({detail}).")

        try:
            response = json.loads(stdout_text)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Invalid JSON from Dart SDK runner: {stdout_text}\n{stderr_text}"
            ) from exc

        if "error" in response:
            raise ValueError(str(response["error"]))
        if "result" not in response:
            raise ValueError("Compilation produced no output.")
        return response["result"]

    def generate_prompt(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str = "main",
    ) -> str:
        validate_sdk_format(self.sdk_name, format_name)
        result = self._invoke_runner(
            {
                "action": "generate_prompt",
                "format_name": format_name,
                "version": version,
                "resolved_catalog_path": resolved_catalog_path,
                "surface_id": surface_id,
            },
            timeout_sec=15.0,
        )
        return str(result)

    def parse_and_validate(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str,
        completion: str,
        timeout_sec: float = 5.0,
        require_complete_tags: bool = False,
    ) -> dict[str, Any]:
        validate_sdk_format(self.sdk_name, format_name)
        result = self._invoke_runner(
            {
                "action": "parse_and_validate",
                "format_name": format_name,
                "version": version,
                "resolved_catalog_path": resolved_catalog_path,
                "surface_id": surface_id,
                "completion": completion,
                "require_complete_tags": require_complete_tags,
            },
            timeout_sec=timeout_sec if timeout_sec > 0 else 15.0,
        )
        return dict(result)
