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

"""Multi-turn `RendererState` conformance runner for `conformance/agent/renderer_state.yaml`."""

from __future__ import annotations

from typing import Any

import pytest

from a2ui.utils import RendererState

from .conformance_helpers import (
    assert_known_keys,
    case_params,
    load_conformance_yaml,
)
from .lowering import (
    SUITE_VERSIONS,
    first_catalog_id,
    lower_catalog_entry,
    lower_text,
    v09_skip_reason,
)
from .test_conformance import (
    DEFAULT_CATALOG,
    _CASE_METADATA_KEYS,
    _catalogs_for,
    _format_for,
    assert_raises,
)

SUITE = "agent/renderer_state.yaml"
CASES = load_conformance_yaml(SUITE)

_RENDERER_STATE_CASE_KEYS = _CASE_METADATA_KEYS | {
    "action",
    "catalogs",
    "turns",
}
_RENDERER_STATE_TURN_KEYS = frozenset({
    "format",
    "payload",
    "response",
    "expect_surfaces",
    "expectError",
    "expect_error",
})


def _assert_expected_surfaces(
    state: RendererState, expect_surfaces: dict[str, Any]
) -> None:
    assert set(state.surface_ids) == set(expect_surfaces.keys())
    for surface_id, expected_surface in expect_surfaces.items():
        surface = state.get_surface(surface_id)
        assert surface is not None, f"Missing surface {surface_id}"
        if "components" in expected_surface:
            expected_comps = expected_surface["components"]
            assert set(surface.components_model.keys) == set(expected_comps.keys())
            for comp_id, expected_comp in expected_comps.items():
                comp = surface.components_model.get(comp_id)
                assert comp is not None, f"Missing component {comp_id} on {surface_id}"
                actual_comp = {"component": comp.type, **comp.properties}
                assert actual_comp == expected_comp
        if "data" in expected_surface:
            actual_data = surface.data_model.get("/") or {}
            assert actual_data == expected_surface["data"]


@pytest.mark.parametrize("version", SUITE_VERSIONS)
@pytest.mark.parametrize("suite, test_case", case_params(SUITE, CASES))
def test_renderer_state_conformance(
    suite: str, test_case: dict[str, Any], version: str
) -> None:
    """Runs multi-turn `RendererState` conformance cases in both v1.0 and v0.9-lowered."""
    assert test_case.get("action") == "renderer_state_turns"
    assert_known_keys(test_case, _RENDERER_STATE_CASE_KEYS, "renderer_state_turns case")

    is_lowered = version == "v0.9-lowered"
    raw_catalogs = list(test_case.get("catalogs", [DEFAULT_CATALOG]))
    inj_id = None
    if is_lowered:
        skip_reason = v09_skip_reason(suite, test_case)
        if skip_reason:
            pytest.skip(skip_reason)
        inj_id = first_catalog_id({"catalogs": raw_catalogs}, DEFAULT_CATALOG)
        raw_catalogs = [lower_catalog_entry(c) for c in raw_catalogs]

    catalogs = _catalogs_for({"catalogs": raw_catalogs})
    state = RendererState(catalogs)

    for turn in test_case["turns"]:
        assert_known_keys(turn, _RENDERER_STATE_TURN_KEYS, "renderer_state_turns turn")
        fmt_name = turn.get("format", "direct_json")
        is_express = fmt_name == "express"
        parser = _format_for(fmt_name, catalogs).create_parser()

        raw_response = turn["response"]
        turn_input = (
            lower_text(raw_response, catalog_id=inj_id)
            if (is_lowered and not is_express)
            else raw_response
        )

        expect_err = turn.get("expect_error") or turn.get("expectError")
        if expect_err is not None:
            with assert_raises(expect_err):
                parser.parse_response(turn_input, state=state)
            continue

        parser.parse_response(turn_input, state=state)
        if "expect_surfaces" in turn:
            _assert_expected_surfaces(state, turn["expect_surfaces"])
