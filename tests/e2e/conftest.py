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

"""E2E Test Suite Shared Fixtures and Utilities.

Provides fixtures for:
- Invoking the `a2ui` CLI in an opaque-box process manner
- Resolving project root, catalog schemas, and sample payloads
- Inspecting generated PNG images (headers, IHDR dimensions)
- Interfacing with FastMCP server tools and HostTargetProfile models
"""

import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

import pytest

# Determine project root path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@dataclass
class CLIResult:
    """Represents the execution outcome of an opaque-box CLI invocation."""

    exit_code: int
    stdout: str
    stderr: str

    def json(self) -> Any:
        """Parses stdout as JSON."""
        try:
            return json.loads(self.stdout)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Failed to parse stdout as JSON (exit code {self.exit_code}):\n"
                f"STDOUT:\n{self.stdout}\n"
                f"STDERR:\n{self.stderr}"
            ) from exc


def read_png_dimensions(data_or_path: bytes | str | Path) -> Tuple[int, int]:
    """Reads width and height from PNG IHDR chunk using standard library struct."""
    if isinstance(data_or_path, (str, Path)):
        with open(data_or_path, "rb") as f:
            data = f.read(32)
    else:
        data = data_or_path[:32]

    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Invalid PNG header or insufficient data")

    width, height = struct.unpack(">II", data[16:24])
    return width, height


def is_cli_available() -> bool:
    """Checks whether the a2ui CLI or CLI module is executable."""
    venv_bin = Path(sys.executable).parent / "a2ui"
    if venv_bin.exists() and os.access(venv_bin, os.X_OK):
        return True
    if shutil.which("a2ui") is not None:
        return True
    try:
        import a2ui.cli.main  # noqa: F401

        return True
    except Exception:
        return False


def is_render_available() -> bool:
    """Checks whether the a2ui render module is available."""
    try:
        import a2ui.render  # noqa: F401

        return True
    except Exception:
        return False


def is_targets_available() -> bool:
    """Checks whether the host target profiles module is available."""
    try:
        import a2ui.targets  # noqa: F401

        return True
    except Exception:
        return False


def is_mcp_available() -> bool:
    """Checks whether the a2ui-mcp server module is available."""
    try:
        import tools.a2ui_mcp.server  # noqa: F401

        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def project_root() -> Path:
    """Returns the absolute path to the project root directory."""
    return PROJECT_ROOT


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    """Returns the path to the E2E test fixtures directory."""
    return PROJECT_ROOT / "tests" / "e2e" / "fixtures"


@pytest.fixture(scope="session")
def ge_samples_dir() -> Path:
    """Returns the path to the Gemini Enterprise v0.9 example payloads."""
    return (
        PROJECT_ROOT
        / "samples"
        / "community"
        / "agent"
        / "adk"
        / "gemini_enterprise"
        / "v0_9"
        / "examples"
        / "0.9"
    )


@pytest.fixture(scope="session")
def basic_catalog_path() -> Path:
    """Returns the path to the Basic Catalog JSON schema."""
    return (
        PROJECT_ROOT / "specification" / "v0_9" / "catalogs" / "basic" / "catalog.json"
    )


@pytest.fixture(scope="session")
def composite_catalog_path() -> Path:
    """Returns the path to the Gemini Enterprise Composite Catalog JSON schema."""
    return (
        PROJECT_ROOT
        / "samples"
        / "community"
        / "agent"
        / "adk"
        / "gemini_enterprise"
        / "v0_9"
        / "gemini_enterprise_composite_catalog.json"
    )


@pytest.fixture
def cli_runner(project_root: Path) -> Callable[..., CLIResult]:
    """Provides an opaque-box CLI execution helper for `a2ui`."""

    def _run(
        *args: str, timeout: float = 30.0, input: Optional[str] = None
    ) -> CLIResult:
        venv_bin = Path(sys.executable).parent / "a2ui"
        which_bin = shutil.which("a2ui")

        if venv_bin.exists() and os.access(venv_bin, os.X_OK):
            cmd = [str(venv_bin), *args]
        elif which_bin and os.access(which_bin, os.X_OK):
            cmd = [which_bin, *args]
        else:
            cmd = [sys.executable, "-m", "a2ui.cli.main", *args]

        env = os.environ.copy()
        # Ensure workspace src and tools are on PYTHONPATH if running via module
        src_path = str(project_root / "agent_sdks" / "python" / "a2ui_agent" / "src")
        core_path = str(project_root / "agent_sdks" / "python" / "a2ui_core" / "src")
        tools_path = str(project_root / "tools")
        current_pythonpath = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = (
            f"{src_path}:{core_path}:{tools_path}:{project_root}:{current_pythonpath}"
        )

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            input=input,
            timeout=timeout,
            cwd=str(project_root),
            env=env,
        )
        return CLIResult(
            exit_code=proc.returncode, stdout=proc.stdout, stderr=proc.stderr
        )

    return _run


@pytest.fixture
def target_profile_loader():
    """Provides a helper to load HostTargetProfile instances."""

    def _load(target_name: str):
        from a2ui.targets import HostTargetProfile

        return HostTargetProfile.load(target_name)

    return _load


@pytest.fixture
def mcp_client():
    """Provides a test client for the FastMCP perception-action tools."""

    class MCPClientWrapper:

        def list_components(
            self, catalog: str = "basic", filter: Optional[str] = None
        ) -> Dict[str, Any]:
            from tools.a2ui_mcp.server import a2ui_list_components

            return a2ui_list_components(catalog=catalog, filter=filter)

        def validate(
            self,
            payload: Dict[str, Any] | List[Any],
            catalog: str = "basic",
            target: Optional[str] = None,
        ) -> Dict[str, Any]:
            from tools.a2ui_mcp.server import a2ui_validate

            return a2ui_validate(payload=payload, catalog=catalog, target=target)

        def render(
            self,
            payload: Dict[str, Any] | List[Any],
            catalog: str = "basic",
            width: int = 800,
        ) -> Any:
            from tools.a2ui_mcp.server import a2ui_render

            return a2ui_render(payload=payload, catalog=catalog, width=width)

        def simulate_action(
            self, payload: Dict[str, Any] | List[Any], component_id: str
        ) -> Dict[str, Any]:
            from tools.a2ui_mcp.server import a2ui_simulate_action

            return a2ui_simulate_action(payload=payload, component_id=component_id)

    return MCPClientWrapper()
