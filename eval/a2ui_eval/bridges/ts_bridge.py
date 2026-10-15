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
from typing import Any

from ..shared.utils import GIT_ROOT
from .base import AgentSdkBridge, validate_sdk_format

TS_RUNNER_PATH = Path(__file__).resolve().parent / "ts_runner.mjs"


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


class TypeScriptSdkBridge(AgentSdkBridge):
    """Bridge for the TypeScript A2UI Agent SDK (typescript/a2ui_agent)."""

    sdk_name = "ts"

    def __init__(self) -> None:
        self._prepared = False

    def prepare(self) -> None:
        """Ensures @a2ui/web_core and @a2ui/agent are compiled before running evals."""
        if self._prepared:
            return

        agent_dist = (
            GIT_ROOT / "typescript" / "a2ui_agent" / "dist" / "src" / "index.js"
        )
        core_dist = (
            GIT_ROOT / "typescript" / "core" / "web_core" / "dist" / "src" / "index.js"
        )
        web_core_link = GIT_ROOT / "node_modules" / "@a2ui" / "web_core"

        if (
            not agent_dist.is_file()
            or not core_dist.is_file()
            or not web_core_link.exists()
        ):
            node_bin = find_node_binary()
            yarn_bin = find_yarn_binary(node_bin)
            env = os.environ.copy()
            node_dir = str(Path(node_bin).parent)
            env["PATH"] = f"{node_dir}:{env.get('PATH', '')}"

            if not web_core_link.exists():
                subprocess.run(
                    [yarn_bin, "install"],
                    cwd=str(GIT_ROOT),
                    env=env,
                    check=True,
                )

            subprocess.run(
                [yarn_bin, "workspace", "@a2ui/agent", "build"],
                cwd=str(GIT_ROOT),
                env=env,
                check=True,
            )

        self._prepared = True

    def _invoke_runner(self, payload: dict[str, Any], timeout_sec: float = 10.0) -> Any:
        self.prepare()
        node_bin = find_node_binary()
        input_bytes = json.dumps(payload).encode("utf-8")

        try:
            proc = subprocess.run(
                [node_bin, str(TS_RUNNER_PATH)],
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
