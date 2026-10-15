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

"""Unit tests for Python, TypeScript, and Dart Agent SDK bridges."""

from __future__ import annotations

import pytest

from a2ui_eval.bridges import (
    SUPPORTED_SDKS,
    get_sdk_bridge,
    normalize_sdk_name,
    validate_sdk_format,
    validate_sdk_strategy,
)
from a2ui_eval.shared.utils import GIT_ROOT

V091_CATALOG = str(
    GIT_ROOT / "specification" / "v0_9_1" / "catalogs" / "basic" / "catalog.json"
)
V10_CATALOG = str(GIT_ROOT / "catalogs" / "basic" / "v1" / "catalog.json")


def test_normalize_sdk_name() -> None:
    assert normalize_sdk_name("python") == "python"
    assert normalize_sdk_name("py") == "python"
    assert normalize_sdk_name("ts") == "ts"
    assert normalize_sdk_name("TypeScript") == "ts"
    assert normalize_sdk_name("dart") == "dart"

    with pytest.raises(ValueError, match="Unknown SDK"):
        normalize_sdk_name("rust")


def test_validate_sdk_strategy_and_format() -> None:
    for sdk in SUPPORTED_SDKS:
        validate_sdk_strategy(sdk, "direct")
        validate_sdk_strategy(sdk, "express")
        validate_sdk_strategy(sdk, "subagent_tool")
        validate_sdk_format(sdk, "direct_json")
        validate_sdk_format(sdk, "express")

    validate_sdk_strategy("python", "elemental")
    validate_sdk_strategy("python", "atom")

    for sdk in ("ts", "dart"):
        with pytest.raises(ValueError, match="not supported by SDK"):
            validate_sdk_strategy(sdk, "elemental")
        with pytest.raises(ValueError, match="not supported by SDK"):
            validate_sdk_format(sdk, "atom")


@pytest.mark.parametrize("sdk", SUPPORTED_SDKS)
def test_bridge_generate_prompt_direct_json_v091(sdk: str) -> None:
    bridge = get_sdk_bridge(sdk)
    prompt = bridge.generate_prompt("direct_json", "0.9.1", V091_CATALOG)
    assert "<a2ui-json>" in prompt
    assert "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json" in prompt


@pytest.mark.parametrize("sdk", SUPPORTED_SDKS)
def test_bridge_generate_prompt_express_v091(sdk: str) -> None:
    bridge = get_sdk_bridge(sdk)
    prompt = bridge.generate_prompt("express", "0.9.1", V091_CATALOG)
    assert "<a2ui>" in prompt
    assert "Text" in prompt


@pytest.mark.parametrize("sdk", ("python", "ts"))
def test_bridge_generate_prompt_v10(sdk: str) -> None:
    bridge = get_sdk_bridge(sdk)
    direct_prompt = bridge.generate_prompt("direct_json", "1.0", V10_CATALOG)
    assert (
        "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
        in direct_prompt
    )
    express_prompt = bridge.generate_prompt("express", "1.0", V10_CATALOG)
    assert "<a2ui>" in express_prompt


@pytest.mark.parametrize("sdk", SUPPORTED_SDKS)
def test_bridge_parse_and_validate_direct_json_v091(sdk: str) -> None:
    bridge = get_sdk_bridge(sdk)
    valid_completion = """
    Here is your requested UI:
    <a2ui-json>
    [
      {
        "version": "v0.9",
        "createSurface": {
          "surfaceId": "main",
          "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
        }
      },
      {
        "version": "v0.9",
        "updateComponents": {
          "surfaceId": "main",
          "components": [
            {
              "id": "root",
              "component": "Text",
              "text": "Hello from SDK bridge"
            }
          ]
        }
      }
    ]
    </a2ui-json>
    Let me know if you need changes.
    """
    res = bridge.parse_and_validate(
        format_name="direct_json",
        version="0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="main",
        completion=valid_completion,
        require_complete_tags=True,
    )
    assert len(res["compiled_jsons"]) == 2
    assert len(res["parts"]) == 3
    assert "Here is your requested UI:" in res["parts"][0]["text"]


@pytest.mark.parametrize("sdk", SUPPORTED_SDKS)
def test_bridge_parse_and_validate_express_v091(sdk: str) -> None:
    bridge = get_sdk_bridge(sdk)
    express_completion = (
        'Intro text\n<a2ui>\nroot = Text("Hello Express")\n</a2ui>\nOutro text'
    )
    res = bridge.parse_and_validate(
        format_name="express",
        version="0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="main",
        completion=express_completion,
    )
    assert len(res["compiled_jsons"]) >= 2
    assert len(res["parts"]) == 3
    assert res["parts"][0]["text"] == "Intro text"
    assert res["parts"][2]["text"] == "Outro text"


@pytest.mark.parametrize("sdk", SUPPORTED_SDKS)
def test_bridge_parse_and_validate_rejects_missing_root(sdk: str) -> None:
    bridge = get_sdk_bridge(sdk)
    invalid_completion = """
    <a2ui-json>
    [
      {
        "version": "v0.9",
        "createSurface": {
          "surfaceId": "main",
          "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
        }
      },
      {
        "version": "v0.9",
        "updateComponents": {
          "surfaceId": "main",
          "components": [
            {
              "id": "not-root",
              "component": "Text",
              "text": "Missing root component"
            }
          ]
        }
      }
    ]
    </a2ui-json>
    """
    with pytest.raises(ValueError):
        bridge.parse_and_validate(
            format_name="direct_json",
            version="0.9.1",
            resolved_catalog_path=V091_CATALOG,
            surface_id="main",
            completion=invalid_completion,
            require_complete_tags=True,
        )
