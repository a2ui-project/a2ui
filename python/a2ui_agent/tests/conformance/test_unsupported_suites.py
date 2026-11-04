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

"""Records reasoned skips for `conformance/agent/**/*.yaml` suites not run by Python."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from .conformance_helpers import (
    case_params,
    get_conformance_path,
    load_conformance_yaml,
)

ACTIVE_SUITES: frozenset[str] = frozenset({
    "agent/atom/compiler.yaml",
    "agent/builder/builder.yaml",
    "agent/catalog_provider.yaml",
    "agent/catalog_resolution.yaml",
    "agent/catalog_transformer.yaml",
    "agent/direct_json/compiler.yaml",
    "agent/direct_json/decompiler.yaml",
    "agent/direct_json/prompt_generator.yaml",
    "agent/direct_json/response_parser.yaml",
    "agent/direct_json/response_streaming.yaml",
    "agent/direct_json/scaling.yaml",
    "agent/elemental/compiler.yaml",
    "agent/express/compiler.yaml",
    "agent/express/decompiler.yaml",
    "agent/express/prompt_generator.yaml",
    "agent/express/response_parser.yaml",
    "agent/express/response_streaming.yaml",
    "agent/express/scaling.yaml",
    "agent/macros/macros.yaml",
    "agent/multi_catalog_formats.yaml",
    "agent/renderer_state.yaml",
    "agent/request_processor.yaml",
    "agent/skill.yaml",
})

UNSUPPORTED_SUITES: dict[str, str] = {
    "agent/streamed_answer.yaml": (
        "streamed_answer covers the optional agent_renderer_app feature; the"
        " Python Agent SDK has no renderer and does not implement"
        " StreamedAnswer."
    ),
    "agent/legacy/inference_format.yaml": (
        "Pre-blueprint legacy suite superseded by the current agent suites."
    ),
    "agent/legacy/parser.yaml": (
        "Pre-blueprint legacy suite superseded by the current agent suites."
    ),
    "agent/legacy/streaming_parser.yaml": (
        "Pre-blueprint legacy suite superseded by"
        " agent/direct_json/response_streaming.yaml and"
        " agent/express/response_streaming.yaml."
    ),
}


def _build_unsupported_params() -> list[Any]:
    params: list[Any] = []
    for suite, reason in UNSUPPORTED_SUITES.items():
        raw = load_conformance_yaml(suite)
        cases = raw["tests"] if isinstance(raw, dict) and "tests" in raw else raw
        skip_map = {
            str(item.get("id") or item.get("name")): reason
            for item in cases
            if isinstance(item, dict) and (item.get("id") or item.get("name"))
        }
        params.extend(case_params(suite, cases, skip=skip_map))
    return params


_UNSUPPORTED_CASES = _build_unsupported_params()


def test_all_agent_suites_are_accounted_for() -> None:
    """Every `conformance/agent/**/*.yaml` file is in ACTIVE_SUITES or UNSUPPORTED_SUITES."""
    conformance_root = Path(get_conformance_path(""))
    on_disk = {
        path.relative_to(conformance_root).as_posix()
        for path in (conformance_root / "agent").rglob("*.yaml")
        if path.is_file()
    }
    unsupported = set(UNSUPPORTED_SUITES)
    assert not (ACTIVE_SUITES & unsupported)
    assert ACTIVE_SUITES | unsupported == on_disk


@pytest.mark.parametrize("suite, case", _UNSUPPORTED_CASES)
def test_unsupported_agent_suite_case(suite: str, case: dict[str, Any]) -> None:
    """Placeholder reached only if a skip marker was omitted."""
    pytest.fail(f"Expected {suite}#{case.get('name')} to be skipped")
