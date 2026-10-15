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

"""TypeScript Agent SDK bridge implementation."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
from typing import Any

from ..shared.utils import GIT_ROOT
from .base import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    AgentSdkBridge,
    validate_sdk_format,
    validate_sdk_version,
)

TS_RUNNER_PATH = Path(__file__).resolve().parent / "ts_runner.mjs"

_PROMPT_TIMEOUT_SEC = 30.0
_YARN_INSTALL_TIMEOUT_SEC = 1800.0
_YARN_BUILD_TIMEOUT_SEC = 900.0
_OUTPUT_TAIL_CHARS = 8000


def find_node_binary() -> str:
    """Locates the Node.js executable on PATH or under ~/.nvm."""
    found = shutil.which("node")
    if found:
        return found

    nvm_versions_dir = Path.home() / ".nvm" / "versions" / "node"
    if nvm_versions_dir.is_dir():
        candidates = sorted(
            nvm_versions_dir.glob("*/bin/node"),
            key=lambda p: [
                int(x)
                for x in p.parent.parent.name.lstrip("v").split(".")
                if x.isdigit()
            ],
        )
        if candidates:
            return str(candidates[-1])

    raise RuntimeError("Node.js executable ('node') not found on PATH or under ~/.nvm.")


def find_yarn_binary(node_bin: str) -> str:
    """Locates the Yarn executable on PATH or adjacent to the Node binary."""
    found = shutil.which("yarn")
    if found:
        return found

    adjacent_yarn = Path(node_bin).parent / "yarn"
    if adjacent_yarn.is_file():
        return str(adjacent_yarn)

    raise RuntimeError("Yarn executable ('yarn') not found on PATH.")


def _run_yarn_step(cmd: list[str], env: dict[str, str], timeout_sec: float) -> None:
    """Runs one Yarn step at the repository root, capturing its output."""
    step = " ".join(cmd[1:])
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(GIT_ROOT),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout_sec,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        output = _tail(exc.output)
        raise RuntimeError(
            f"'yarn {step}' timed out after {timeout_sec}s.\n{output}"
        ) from exc
    if proc.returncode != 0:
        raise RuntimeError(
            f"'yarn {step}' failed with exit code {proc.returncode}.\n"
            f"{_tail(proc.stdout)}"
        )


def _tail(output: bytes | str | None) -> str:
    if not output:
        return ""
    text = (
        output.decode("utf-8", errors="replace")
        if isinstance(output, bytes)
        else output
    )
    return text[-_OUTPUT_TAIL_CHARS:].strip()


class TypeScriptSdkBridge(AgentSdkBridge):
    """Bridge for the TypeScript A2UI Agent SDK (typescript/a2ui_agent)."""

    sdk_name = "ts"

    def __init__(self) -> None:
        self._prepared = False
        self._lock = threading.Lock()
        self._prompt_cache: dict[tuple[str, str, str, str], str] = {}

    def prepare(self) -> None:
        """Builds @a2ui/web_core and @a2ui/agent once per process.

        `yarn install` runs only when the workspace links are missing. The build
        always runs: wireit skips it when nothing changed, and running it picks
        up local edits to the TypeScript sources that a stale `dist` would hide.
        Yarn output is captured and included in the error if a step fails.
        """
        with self._lock:
            if self._prepared:
                return

            node_bin = find_node_binary()
            yarn_bin = find_yarn_binary(node_bin)
            env = os.environ.copy()
            node_dir = str(Path(node_bin).parent)
            env["PATH"] = f"{node_dir}{os.pathsep}{env.get('PATH', '')}"

            web_core_link = GIT_ROOT / "node_modules" / "@a2ui" / "web_core"
            if not web_core_link.exists():
                _run_yarn_step(
                    [yarn_bin, "install"], env, timeout_sec=_YARN_INSTALL_TIMEOUT_SEC
                )
            _run_yarn_step(
                [yarn_bin, "workspace", "@a2ui/agent", "build"],
                env,
                timeout_sec=_YARN_BUILD_TIMEOUT_SEC,
            )
            self._prepared = True

    def _invoke_runner(self, payload: dict[str, Any], timeout_sec: float) -> Any:
        self.prepare()
        node_bin = find_node_binary()
        input_bytes = json.dumps(payload).encode("utf-8")

        try:
            proc = subprocess.run(
                [node_bin, str(TS_RUNNER_PATH)],
                input=input_bytes,
                capture_output=True,
                cwd=str(GIT_ROOT),
                timeout=timeout_sec,
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
            raise ValueError(f"TypeScript SDK runner produced no output ({detail}).")

        try:
            response = json.loads(stdout_text)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Invalid JSON from TypeScript SDK runner: {stdout_text}\n{stderr_text}"
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
        norm_version = validate_sdk_version(self.sdk_name, version)
        key = (format_name, norm_version, resolved_catalog_path, surface_id)
        cached = self._prompt_cache.get(key)
        if cached is not None:
            return cached
        result = str(
            self._invoke_runner(
                {
                    "action": "generate_prompt",
                    "format_name": format_name,
                    "version": norm_version,
                    "resolved_catalog_path": resolved_catalog_path,
                    "surface_id": surface_id,
                },
                timeout_sec=_PROMPT_TIMEOUT_SEC,
            )
        )
        self._prompt_cache[key] = result
        return result

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
        """Parses, and optionally validates, in a Node process killed on timeout.

        A `timeout_sec` of zero or less selects `DEFAULT_PARSE_TIMEOUT_SEC`.
        """
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
            timeout_sec=(timeout_sec if timeout_sec > 0 else DEFAULT_PARSE_TIMEOUT_SEC),
        )
        return dict(result)
