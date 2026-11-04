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

"""Pytest configuration for the a2ui_core tests.

Exposes the `timing` fixture of `timing_harness.py`. Tests run with
`--import-mode=importlib`, which leaves this directory off `sys.path`, so the
module is loaded by path.
"""

from __future__ import annotations

from collections.abc import Generator, Sequence
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import ModuleType
from typing import Any

import pytest

# The name the harness module is registered under in `sys.modules`. Other test
# suites that load the harness use the same name, so it is loaded once.
_HARNESS_MODULE = "a2ui_core_tests_timing_harness"
_CONFORMANCE_TEST_NAMES = frozenset({
    "test_conformance_suite",
    "test_conformance_timing",
})


def _load_timing_harness() -> ModuleType:
    """Returns `timing_harness.py`, loading it on first use."""
    module = sys.modules.get(_HARNESS_MODULE)
    if module is None:
        path = Path(__file__).with_name("timing_harness.py")
        spec = importlib.util.spec_from_file_location(_HARNESS_MODULE, path)
        assert spec is not None and spec.loader is not None, path
        module = importlib.util.module_from_spec(spec)
        sys.modules[_HARNESS_MODULE] = module
        spec.loader.exec_module(module)
    return module


timing = _load_timing_harness().timing


def _extract_case_identity(item: pytest.Item) -> tuple[str, str] | None:
    """Returns `(suite, case_name)` for a parameterized conformance item."""
    if getattr(item, "originalname", None) not in _CONFORMANCE_TEST_NAMES:
        return None
    callspec = getattr(item, "callspec", None)
    params = getattr(callspec, "params", None)
    if not isinstance(params, dict):
        return None
    rel_path = params.get("rel_path")
    case = params.get("case")
    if not isinstance(rel_path, str) or not isinstance(case, dict):
        return None
    case_name = case.get("name")
    if not isinstance(case_name, str) or not case_name:
        return None
    return rel_path.replace("\\", "/"), case_name


def _append_manifest_record(
    suite: str, case_name: str, status: str, reason: str | None = None
) -> None:
    """Appends one executed-case record when `A2UI_CONFORMANCE_MANIFEST_DIR` is set."""
    manifest_dir = os.environ.get("A2UI_CONFORMANCE_MANIFEST_DIR")
    if not manifest_dir:
        return
    os.makedirs(manifest_dir, exist_ok=True)
    manifest_path = Path(manifest_dir) / f"python-core-{os.getpid()}.jsonl"
    record: dict[str, str] = {
        "harness": "python-core",
        "suite": suite,
        "case": case_name,
        "status": status,
    }
    if reason:
        record["reason"] = reason
    with manifest_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")


def _extract_skip_reason(report: pytest.TestReport) -> str:
    """Extracts a human-readable skip or xfail reason from a pytest TestReport."""
    wasxfail = getattr(report, "wasxfail", None)
    if isinstance(wasxfail, str) and wasxfail.strip():
        return wasxfail.strip()
    if wasxfail is not None:
        return "expected failure"
    longrepr = getattr(report, "longrepr", None)
    if isinstance(longrepr, tuple) and len(longrepr) >= 3:
        text = str(longrepr[2]).removeprefix("Skipped: ").strip()
        return text or "skipped"
    if longrepr:
        return str(longrepr).removeprefix("Skipped: ").strip() or "skipped"
    return "skipped"


def _report_status_and_reason(
    report: pytest.TestReport,
) -> tuple[str, str | None]:
    """Maps a pytest TestReport to `(status, reason)` for the manifest."""
    wasxfail = getattr(report, "wasxfail", None)
    if wasxfail is not None:
        if report.outcome == "skipped":
            return "xfailed", _extract_skip_reason(report)
        return "failed", None
    if report.outcome == "skipped":
        return "skipped", _extract_skip_reason(report)
    if report.outcome == "passed":
        return "passed", None
    return "failed", None


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(
    item: pytest.Item, call: pytest.CallInfo[Any]
) -> Generator[None, Any, None]:
    """Records executed conformance test outcomes to the manifest JSONL file."""
    del call
    outcome = yield
    report: pytest.TestReport = outcome.get_result()
    if report.when != "call" and not (
        report.when == "setup" and report.outcome != "passed"
    ):
        return
    identity = _extract_case_identity(item)
    if identity is None:
        return
    status, reason = _report_status_and_reason(report)
    _append_manifest_record(identity[0], identity[1], status, reason)


def pytest_deselected(items: Sequence[pytest.Item]) -> None:
    """Records deselected performance timing cases as skipped in the manifest."""
    for item in items:
        if getattr(item, "originalname", None) != "test_conformance_timing":
            continue
        identity = _extract_case_identity(item)
        if identity is None:
            continue
        _append_manifest_record(
            identity[0],
            identity[1],
            "skipped",
            "performance: runs in the performance job",
        )
