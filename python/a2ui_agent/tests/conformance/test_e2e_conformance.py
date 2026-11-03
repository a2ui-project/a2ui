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

"""End-to-end golden-transcript conformance runner for the Python Agent SDK."""

from __future__ import annotations

from collections.abc import Mapping
import json
import os
from pathlib import Path
import traceback
from typing import Any

import pytest

from a2ui.core import A2uiCatalogError
from a2ui.core import A2uiError
from a2ui.core import A2uiIntegrityError
from a2ui.core import A2uiParseError
from a2ui.core import A2uiRecursionError
from a2ui.core import A2uiValidationError
from a2ui.core.common import to_protocol_version
from a2ui.inbound import format_inbound_for_model
from a2ui.inbound import get_inbound_message_kind
from a2ui.inbound import parse_inbound_message
from a2ui.inference_formats import DirectJsonFormat
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.express import ExpressFormat
from a2ui.parser import A2uiCompilationError
from a2ui.parser import A2uiPart
from a2ui.parser import ErrorPart
from a2ui.parser import Parser
from a2ui.parser import TextPart
from a2ui.processor import CatalogConfig
from a2ui.utils import RendererState

from .conformance_helpers import assert_known_keys
from .conformance_helpers import case_params
from .conformance_helpers import get_conformance_path
from .conformance_helpers import load_conformance_yaml

_CATEGORY_TO_EXCEPTION = {
    "ParseError": A2uiParseError,
    "ValidationError": A2uiValidationError,
    "CatalogError": A2uiCatalogError,
    "IntegrityError": A2uiIntegrityError,
    "RecursionError": A2uiRecursionError,
    "CompilationError": A2uiCompilationError,
}

_SCENARIO_KEYS = frozenset({
    "name",
    "action",
    "description",
    "features",
    "protocolVersion",
    "catalogPaths",
    "formats",
    "source",
    "turns",
})

_SOURCE_KEYS = frozenset({
    "kind",
    "from",
    "model",
    "recordedAt",
})

_TURN_KEYS = frozenset({
    "userText",
    "modelChunks",
    "expectWire",
    "expectViewTree",
    "expectErrors",
    "uiOps",
    "expectDataModel",
    "expectOutbound",
})

_UI_OP_KEYS = frozenset({
    "op",
    "surfaceId",
    "targetNode",
    "inputValue",
    "userActivation",
})

_DEFAULT_SURFACE_ID = "default_surface"

SKIP_SCENARIOS: dict[str, str] = {}
KNOWN_GAPS: dict[str, str] = {}


def load_e2e_scenarios() -> list[tuple[str, dict[str, Any]]]:
    """Globs `conformance/e2e/**/*.yaml` and returns `(suite, scenario)` pairs."""
    e2e_dir = Path(get_conformance_path("e2e"))
    yaml_files = sorted(e2e_dir.rglob("*.yaml"))
    scenarios: list[tuple[str, dict[str, Any]]] = []
    for yaml_file in yaml_files:
        rel_suite = f"e2e/{yaml_file.relative_to(e2e_dir).as_posix()}"
        loaded = load_conformance_yaml(rel_suite)
        if not isinstance(loaded, list):
            raise ValueError(f"Expected list of scenarios in {rel_suite}")
        for item in loaded:
            scenarios.append((rel_suite, item))
    assert scenarios, "No E2E conformance scenarios found under conformance/e2e/"
    return scenarios


def _build_parametrized_cases() -> list[Any]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for suite, scenario in load_e2e_scenarios():
        grouped.setdefault(suite, []).append(scenario)
    params: list[Any] = []
    for suite, cases in grouped.items():
        params.extend(case_params(suite, cases, skip=SKIP_SCENARIOS, xfail=KNOWN_GAPS))
    return params


def _resolve_catalog_path(cat_path: str) -> str:
    candidate = get_conformance_path(cat_path)
    if os.path.exists(candidate):
        return candidate
    return os.path.normpath(get_conformance_path(os.path.join("..", cat_path)))


def _load_scenario_catalogs(scenario: Mapping[str, Any]) -> list[Any]:
    protocol_version = str(scenario.get("protocolVersion", "1.0"))
    if protocol_version.startswith("0."):
        protocol_version = f"v{protocol_version}"
    elif protocol_version == "v1.0":
        protocol_version = "1.0"

    catalogs = []
    for rel_path in scenario["catalogPaths"]:
        full_path = _resolve_catalog_path(str(rel_path))
        with open(full_path, "r", encoding="utf-8") as handle:
            doc = json.load(handle)
        config = CatalogConfig.from_path(
            catalog_path=full_path,
            protocol_version=(None if "protocolVersion" in doc else protocol_version),
            catalog_id=(
                None
                if "catalogId" in doc
                else os.path.basename(str(rel_path)).removesuffix(".json")
            ),
        )
        catalogs.append(config.transformed_catalog)
    return catalogs


def _make_parser(format_name: str, catalogs: list[Any]) -> Parser:
    if format_name == "direct_json":
        return DirectJsonFormat(catalogs=catalogs).create_parser()
    if format_name == "express":
        version = to_protocol_version(catalogs[0].protocol_version).value
        return ExpressFormat(
            catalogs=catalogs,
            surface_id=_DEFAULT_SURFACE_ID,
            version=version,
        ).create_parser()
    raise ValueError(f"Unsupported inference format: {format_name!r}")


def _category_of(error: BaseException) -> str:
    for category, cls in _CATEGORY_TO_EXCEPTION.items():
        if isinstance(error, cls):
            return category
    if isinstance(error, A2uiError):
        return type(error).__name__
    return type(error).__name__


def _part_to_dict(part: Any) -> dict[str, Any]:
    if isinstance(part, TextPart):
        return {"text": part.text}
    if isinstance(part, A2uiPart):
        return {"a2ui": to_message_dicts(part.a2ui)}
    if isinstance(part, ErrorPart):
        return {"error": {"category": _category_of(part.error)}}
    raise TypeError(f"Unexpected response part type: {type(part)}")


def _merge_text_parts(parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for part in parts:
        if merged and "text" in merged[-1] and "text" in part:
            merged[-1] = {"text": merged[-1]["text"] + part["text"]}
        else:
            merged.append(part)
    return merged


def _assert_scenario_keys(scenario: Mapping[str, Any]) -> None:
    assert scenario.get("action") == "e2e_scenario"
    assert_known_keys(scenario, _SCENARIO_KEYS, "e2e_scenario case")
    source = scenario.get("source")
    if isinstance(source, Mapping):
        assert_known_keys(source, _SOURCE_KEYS, "e2e_scenario.source")
    turns = scenario.get("turns")
    assert isinstance(turns, list) and turns, "Scenario must contain turns"
    for turn_idx, turn in enumerate(turns):
        assert isinstance(turn, Mapping)
        assert_known_keys(turn, _TURN_KEYS, f"turns[{turn_idx}]")
        for op_idx, ui_op in enumerate(turn.get("uiOps", [])):
            if isinstance(ui_op, Mapping):
                assert_known_keys(
                    ui_op, _UI_OP_KEYS, f"turns[{turn_idx}].uiOps[{op_idx}]"
                )


def _run_format(
    scenario: Mapping[str, Any], format_name: str, catalogs: list[Any]
) -> None:
    parser = _make_parser(format_name, catalogs)
    stream_state = RendererState(catalogs)
    single_shot_state = RendererState(catalogs)

    for turn_idx, turn in enumerate(scenario["turns"]):
        model_chunks = turn["modelChunks"]
        assert (
            format_name in model_chunks
        ), f"Turn {turn_idx} missing chunks for format {format_name!r}"
        chunks: list[str] = model_chunks[format_name]
        expected_wire: list[dict[str, Any]] = turn["expectWire"]

        version = str(scenario.get("protocolVersion", "1.0"))
        for wire_part in expected_wire:
            for msg in wire_part.get("a2ui", []):
                if "updateComponents" in msg:
                    sid = msg["updateComponents"]["surfaceId"]
                    create_msg = {
                        "version": version,
                        "createSurface": {
                            "surfaceId": sid,
                            "catalogId": catalogs[0].catalog_id,
                        },
                    }
                    if stream_state.get_surface(sid) is None:
                        stream_state.apply([create_msg])
                    if single_shot_state.get_surface(sid) is None:
                        single_shot_state.apply([create_msg])

        stream = parser.open_stream(state=stream_state)
        streamed_parts: list[dict[str, Any]] = []
        for chunk in chunks:
            for part in stream.feed(chunk):
                streamed_parts.append(_part_to_dict(part))
        for part in stream.close():
            streamed_parts.append(_part_to_dict(part))

        merged_streamed = _merge_text_parts(streamed_parts)
        assert merged_streamed == expected_wire, (
            f"Format {format_name!r} turn {turn_idx} streaming mismatch:\n"
            f"actual={merged_streamed}\nexpected={expected_wire}"
        )

        single_shot_raw = parser.parse_response(
            "".join(chunks), state=single_shot_state
        )
        merged_single_shot = _merge_text_parts(
            [_part_to_dict(part) for part in single_shot_raw]
        )
        assert merged_single_shot == expected_wire, (
            f"Format {format_name!r} turn {turn_idx} single-shot mismatch:\n"
            f"actual={merged_single_shot}\nexpected={expected_wire}"
        )


def _materialize_outbound(value: Any, key: str = "") -> Any:
    if isinstance(value, Mapping):
        if "$match" in value and len(value) == 1:
            kind = value["$match"]
            if kind == "iso8601" or key == "timestamp":
                return "2026-01-01T00:00:00Z"
            if key == "functionCallId":
                return "call-1"
            return "match-str"
        return {k: _materialize_outbound(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [_materialize_outbound(item, key) for item in value]
    return value


def _verify_outbound_roundtrip(scenario: Mapping[str, Any]) -> None:
    version = str(scenario.get("protocolVersion", "1.0"))
    for turn_idx, turn in enumerate(scenario["turns"]):
        for out_idx, raw_envelope in enumerate(turn.get("expectOutbound", [])):
            concrete = _materialize_outbound(raw_envelope)
            parsed = parse_inbound_message(concrete, version)
            expected_kind = "action" if "action" in concrete else "error"
            assert (
                get_inbound_message_kind(parsed) == expected_kind
            ), f"Turn {turn_idx} expectOutbound[{out_idx}] kind mismatch"
            formatted = format_inbound_for_model(parsed)
            assert (
                formatted is not None and formatted.strip()
            ), f"Turn {turn_idx} expectOutbound[{out_idx}] produced empty model input"
            if expected_kind == "action":
                action = concrete["action"]
                assert action["name"] in formatted
                assert action["surfaceId"] in formatted
                for ctx_key, ctx_val in action.get("context", {}).items():
                    assert str(ctx_key) in formatted
                    assert str(ctx_val) in formatted
            else:
                error = concrete["error"]
                assert error["code"] in formatted


@pytest.mark.parametrize("suite, case", _build_parametrized_cases())
def test_e2e_conformance(suite: str, case: dict[str, Any]) -> None:
    del suite
    _assert_scenario_keys(case)
    _verify_outbound_roundtrip(case)
    catalogs = _load_scenario_catalogs(case)
    failures: list[str] = []
    for format_name in case["formats"]:
        try:
            _run_format(case, str(format_name), catalogs)
        except Exception as exc:  # pylint: disable=broad-except
            failures.append(f"[{format_name}] {exc}\n{traceback.format_exc()}")
    if failures:
        pytest.fail("\n".join(failures))
