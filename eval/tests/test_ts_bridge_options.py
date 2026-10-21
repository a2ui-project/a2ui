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

"""Tests for `BridgeOptions` handling in the TypeScript SDK bridge.

The mocked tests check the exact JSON payload the bridge sends to the Node
runner and the prompt cache's behavior. The `sdk_toolchain` tests run the real
runner and are skipped when `@a2ui/agent` is not built.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from a2ui_eval.bridges import TypeScriptSdkBridge, get_sdk_bridge
from a2ui_eval.bridges.base import BridgeOptions, CatalogSpec
from a2ui_eval.shared.utils import GIT_ROOT

V091_CATALOG = str(
    GIT_ROOT / "specification" / "v0_9_1" / "catalogs" / "basic" / "catalog.json"
)
V09_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"

_PRUNED_SPEC = CatalogSpec(
    path=V091_CATALOG,
    catalog_id=V09_CATALOG_ID,
    allowed_components=("Text", "Column"),
    allowed_functions=("required",),
    examples=("/tmp/example.json",),
)


def _wire(request: dict[str, Any]) -> dict[str, Any]:
    """The request as the Node runner sees it after the JSON pipe."""
    return json.loads(json.dumps(request))


def _capturing_bridge(
    monkeypatch: pytest.MonkeyPatch, result: Any = "prompt"
) -> tuple[TypeScriptSdkBridge, list[dict[str, Any]]]:
    bridge = TypeScriptSdkBridge()
    requests: list[dict[str, Any]] = []

    def fake_invoke(request: dict[str, Any], timeout_sec: float) -> Any:
        requests.append(request)
        return result

    monkeypatch.setattr(bridge, "_invoke_runner", fake_invoke)
    return bridge, requests


def test_generate_prompt_serializes_options_with_snake_case_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bridge, requests = _capturing_bridge(monkeypatch)
    options = BridgeOptions(
        catalogs=(_PRUNED_SPEC,),
        allowed_messages=("createSurface", "updateComponents"),
        initial_renderer_state=({"version": "v0.9", "deleteSurface": {}},),
        stream_chunk_size=7,
    )

    bridge.generate_prompt("express", "0.9.1", V091_CATALOG, options=options)

    assert len(requests) == 1
    # Compare what node receives: the JSON form of the payload.
    assert _wire(requests[0])["options"] == {
        "catalogs": [{
            "path": V091_CATALOG,
            "catalog_id": V09_CATALOG_ID,
            "allowed_components": ["Text", "Column"],
            "allowed_functions": ["required"],
            "examples": ["/tmp/example.json"],
        }],
        "allowed_messages": ["createSurface", "updateComponents"],
        "initial_renderer_state": [{"version": "v0.9", "deleteSurface": {}}],
        "stream_chunk_size": 7,
    }


def test_parse_and_validate_serializes_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bridge, requests = _capturing_bridge(
        monkeypatch, result={"compiled_jsons": [], "parts": []}
    )
    options = BridgeOptions(stream_chunk_size=3)

    bridge.parse_and_validate(
        format_name="direct_json",
        version="v0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="main",
        completion="<a2ui-json>[]</a2ui-json>",
        options=options,
    )

    assert requests[0]["action"] == "parse_and_validate"
    assert requests[0]["options"] == options.to_dict()
    assert _wire(requests[0])["options"] == {
        "catalogs": [],
        "allowed_messages": None,
        "initial_renderer_state": None,
        "stream_chunk_size": 3,
    }


@pytest.mark.parametrize("action", ["generate_prompt", "parse_and_validate"])
def test_options_none_sends_null(monkeypatch: pytest.MonkeyPatch, action: str) -> None:
    bridge, requests = _capturing_bridge(
        monkeypatch, result={"compiled_jsons": [], "parts": []}
    )
    if action == "generate_prompt":
        bridge.generate_prompt("express", "0.9.1", V091_CATALOG)
    else:
        bridge.parse_and_validate(
            format_name="express",
            version="0.9.1",
            resolved_catalog_path=V091_CATALOG,
            surface_id="main",
            completion="",
        )

    assert "options" in requests[0]
    assert requests[0]["options"] is None
    assert json.dumps(requests[0]["options"]) == "null"


def test_prompt_cache_differentiates_options(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge, requests = _capturing_bridge(monkeypatch)
    pruned = BridgeOptions(catalogs=(_PRUNED_SPEC,))
    unpruned = BridgeOptions(catalogs=(CatalogSpec(path=V091_CATALOG),))

    bridge.generate_prompt("express", "0.9.1", V091_CATALOG)
    bridge.generate_prompt("express", "0.9.1", V091_CATALOG, options=pruned)
    bridge.generate_prompt("express", "0.9.1", V091_CATALOG, options=unpruned)
    # Repeats, including an equal-but-distinct options object, hit the cache.
    bridge.generate_prompt("express", "v0.9.1", V091_CATALOG)
    bridge.generate_prompt(
        "express",
        "0.9.1",
        V091_CATALOG,
        options=BridgeOptions(catalogs=(_PRUNED_SPEC,)),
    )

    assert len(requests) == 3
    assert [r["options"] for r in requests] == [
        None,
        pruned.to_dict(),
        unpruned.to_dict(),
    ]
    assert len(bridge._prompt_cache) == 3  # pylint: disable=protected-access


# --- Real toolchain tests -----------------------------------------------------

_SURFACE_TURN = [
    {
        "version": "v0.9",
        "createSurface": {"surfaceId": "main", "catalogId": V09_CATALOG_ID},
    },
    {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "main",
            "components": [
                {"id": "root", "component": "Text", "text": "Hello"},
            ],
        },
    },
]


@pytest.mark.sdk_toolchain
@pytest.mark.parametrize("sdk", ["ts"])
@pytest.mark.parametrize("format_name", ["direct_json", "express"])
def test_pruning_removes_component_from_prompt(sdk: str, format_name: str) -> None:
    bridge = get_sdk_bridge(sdk)
    full = bridge.generate_prompt(format_name, "0.9.1", V091_CATALOG)
    pruned = bridge.generate_prompt(
        format_name,
        "0.9.1",
        V091_CATALOG,
        options=BridgeOptions(
            catalogs=(
                CatalogSpec(path=V091_CATALOG, allowed_components=("Text", "Column")),
            )
        ),
    )

    assert "CheckBox" in full
    assert "CheckBox" not in pruned
    assert "Text" in pruned


@pytest.mark.sdk_toolchain
@pytest.mark.parametrize("sdk", ["ts"])
@pytest.mark.parametrize("format_name", ["direct_json", "express"])
def test_example_appears_in_prompt(sdk: str, format_name: str, tmp_path: Path) -> None:
    bridge = get_sdk_bridge(sdk)
    marker = "Example marker text ZQX"
    example = [
        _SURFACE_TURN[0],
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "main",
                "components": [{"id": "root", "component": "Text", "text": marker}],
            },
        },
    ]
    example_path = tmp_path / "example.json"
    example_path.write_text(json.dumps({"messages": example}), encoding="utf-8")

    without = bridge.generate_prompt(format_name, "0.9.1", V091_CATALOG)
    with_example = bridge.generate_prompt(
        format_name,
        "0.9.1",
        V091_CATALOG,
        options=BridgeOptions(
            catalogs=(CatalogSpec(path=V091_CATALOG, examples=(str(example_path),)),)
        ),
    )

    assert marker not in without
    assert marker in with_example


@pytest.mark.sdk_toolchain
@pytest.mark.parametrize("sdk", ["ts"])
def test_initial_renderer_state_lets_bare_update_data_model_validate(sdk: str) -> None:
    bridge = get_sdk_bridge(sdk)
    update = [{
        "version": "v0.9",
        "updateDataModel": {"surfaceId": "main", "path": "/", "value": {"n": 1}},
    }]
    completion = f"<a2ui-json>{json.dumps(update)}</a2ui-json>"

    with pytest.raises(ValueError):
        bridge.parse_and_validate(
            format_name="direct_json",
            version="0.9.1",
            resolved_catalog_path=V091_CATALOG,
            surface_id="main",
            completion=completion,
        )

    res = bridge.parse_and_validate(
        format_name="direct_json",
        version="0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="main",
        completion=completion,
        options=BridgeOptions(initial_renderer_state=tuple(_SURFACE_TURN)),
    )
    assert [list(m)[1] for m in res["compiled_jsons"]] == ["updateDataModel"]


@pytest.mark.sdk_toolchain
@pytest.mark.parametrize("sdk", ["ts"])
def test_stream_chunk_size_checks_streamed_parse(sdk: str) -> None:
    bridge = get_sdk_bridge(sdk)
    completion = (
        f"Here you go: <a2ui-json>{json.dumps(_SURFACE_TURN)}</a2ui-json> done."
    )

    res = bridge.parse_and_validate(
        format_name="direct_json",
        version="0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="main",
        completion=completion,
        options=BridgeOptions(stream_chunk_size=5),
    )
    assert len(res["compiled_jsons"]) == 2
