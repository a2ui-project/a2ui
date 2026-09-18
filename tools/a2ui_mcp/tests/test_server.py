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

"""Unit and contract tests for the FastMCP a2ui-mcp server."""

from __future__ import annotations

import json
from pathlib import Path
import struct
from typing import Any, Dict

import pytest
from mcp.server.fastmcp.utilities.types import Image
from mcp.types import ImageContent, TextContent

from a2ui.render.engine import A2uiRenderError
from tools.a2ui_mcp.server import (
    a2ui_list_components,
    a2ui_render,
    a2ui_simulate_action,
    a2ui_validate,
    mcp,
)


@pytest.fixture
def project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent.parent


@pytest.fixture
def fixtures_dir(project_root: Path) -> Path:
    return project_root / "tests" / "e2e" / "fixtures"


@pytest.fixture
def valid_button_payload(fixtures_dir: Path) -> Dict[str, Any]:
    with open(fixtures_dir / "basic_button.json") as f:
        return json.load(f)


@pytest.fixture
def interactive_button_payload(project_root: Path) -> Dict[str, Any]:
    path = (
        project_root
        / "specification"
        / "v0_9"
        / "catalogs"
        / "basic"
        / "examples"
        / "00_interactive-button.json"
    )
    with open(path) as f:
        return json.load(f)


# ============================================================================
# FastMCP Server Registration & Metadata
# ============================================================================


def test_mcp_server_initialization():
    """Verifies that the FastMCP server is initialized with name 'a2ui-mcp'."""
    assert mcp.name == "a2ui-mcp"


@pytest.mark.asyncio
async def test_mcp_server_lists_all_four_tools():
    """Verifies that all 4 required perception-action tools are registered."""
    tools = await mcp.list_tools()
    tool_names = {t.name for t in tools}
    expected_tools = {
        "a2ui_list_components",
        "a2ui_validate",
        "a2ui_render",
        "a2ui_simulate_action",
    }
    assert expected_tools.issubset(
        tool_names
    ), f"Missing tools in FastMCP registration: {expected_tools - tool_names}"


# ============================================================================
# Tool 1: a2ui_list_components
# ============================================================================


def test_list_components_basic():
    """Verifies that a2ui_list_components returns components from basic catalog."""
    res = a2ui_list_components("basic")
    assert isinstance(res, dict)
    assert res.get("name") == "basic"
    assert "components" in res
    comps = res["components"]
    assert "Button" in comps
    assert "Text" in comps
    assert "Card" in comps
    assert len(comps) >= 18

    button_info = comps["Button"]
    assert "properties" in button_info
    assert "child" in button_info["properties"]
    assert "action" in button_info["properties"]
    assert "references" in button_info
    assert "child" in button_info["references"]["single"]

    assert "reference_topology" in res
    assert res["reference_topology"]["components_with_refs"] > 0


def test_list_components_filtering():
    """Verifies filtering components by substring."""
    res = a2ui_list_components("gemini_enterprise_composite", filter="Material")
    assert isinstance(res, dict)
    comps = res.get("components", {})
    assert len(comps) > 0
    for name in comps:
        assert "Material" in name


def test_list_components_invalid_catalog_handling():
    """Verifies graceful error handling on unknown catalog."""
    res = a2ui_list_components("nonexistent_catalog_12345")
    assert isinstance(res, dict)
    assert "error" in res or len(res.get("components", [])) == 0


# ============================================================================
# Tool 2: a2ui_validate
# ============================================================================


def test_validate_clean_payload(valid_button_payload):
    """Verifies validation on clean valid payload returns valid=True."""
    res = a2ui_validate(valid_button_payload, "basic")
    assert res.get("valid") is True
    assert res.get("status") == "ok"
    assert len(res.get("errors", [])) == 0


def test_validate_empty_payload():
    """Verifies validation on empty payload returns valid=False."""
    res = a2ui_validate({}, "basic")
    assert res.get("valid") is False
    assert res.get("status") == "error"
    assert len(res.get("errors", [])) > 0


def test_validate_unknown_component_did_you_mean(fixtures_dir: Path):
    """Verifies that unknown component triggers difflib suggestion."""
    with open(fixtures_dir / "unknown_component.json") as f:
        payload = json.load(f)
    res = a2ui_validate(payload, "basic")
    assert res.get("valid") is False
    errors = res.get("errors", [])
    unknown_errs = [e for e in errors if e.get("type") == "unknown_component"]
    assert len(unknown_errs) > 0
    assert unknown_errs[0].get("suggestion") == "Button"
    assert "Did you mean 'Button'?" in unknown_errs[0].get("message", "")


def test_validate_invalid_property_did_you_mean(fixtures_dir: Path):
    """Verifies that invalid property triggers difflib suggestion."""
    with open(fixtures_dir / "invalid_property.json") as f:
        payload = json.load(f)
    res = a2ui_validate(payload, "basic")
    assert res.get("valid") is False
    errors = res.get("errors", [])
    prop_errs = [e for e in errors if e.get("type") == "invalid_property"]
    assert len(prop_errs) > 0
    assert prop_errs[0].get("suggestion") == "child"
    assert "Did you mean 'child'?" in prop_errs[0].get("message", "")


def test_validate_target_profile_enforcement(fixtures_dir: Path):
    """Verifies host target profile validation for gemini-enterprise."""
    # 1. Incompatible version
    with open(fixtures_dir / "incompatible_version_091.json") as f:
        bad_version = json.load(f)
    res_v = a2ui_validate(bad_version, target="gemini-enterprise")
    assert res_v.get("valid") is False
    assert any(
        e.get("type") == "target_profile_incompatibility"
        for e in res_v.get("errors", [])
    )

    # 2. Standard MIME rejection
    with open(fixtures_dir / "standard_mime.json") as f:
        bad_mime = json.load(f)
    res_m = a2ui_validate(bad_mime, target="gemini-enterprise")
    assert res_m.get("valid") is False
    assert any(
        e.get("type") == "target_profile_incompatibility"
        for e in res_m.get("errors", [])
    )

    # 3. Valid GE payload passes
    with open(fixtures_dir / "valid_ge_payload.json") as f:
        good_ge = json.load(f)
    res_g = a2ui_validate(good_ge, target="gemini-enterprise")
    assert res_g.get("valid") is True


# ============================================================================
# Tool 3: a2ui_render
# ============================================================================


def test_render_returns_image_instance(valid_button_payload):
    """Verifies that a2ui_render returns an Image instance containing valid PNG bytes."""
    img = a2ui_render(valid_button_payload, "basic", width=640)
    assert isinstance(img, Image)
    assert isinstance(img.data, bytes)
    assert len(img.data) > 0

    # Verify PNG header
    assert img.data[:8] == b"\x89PNG\r\n\x1a\n"

    # Verify width from IHDR
    width, height = struct.unpack(">II", img.data[16:24])
    assert width == 640
    assert height > 0


def test_render_malformed_payload_raises(fixtures_dir: Path):
    """Verifies that rendering malformed payload raises A2uiRenderError."""
    # Read unparseable file content directly as string or invalid payload
    malformed_raw = (fixtures_dir / "malformed_syntax.json").read_text()
    with pytest.raises(A2uiRenderError):
        a2ui_render(malformed_raw, "basic")


# ============================================================================
# Tool 4: a2ui_simulate_action
# ============================================================================


def test_simulate_action_interactive_button(interactive_button_payload):
    """Verifies action simulation on interactive button sample."""
    evt = a2ui_simulate_action(interactive_button_payload, "action_button")
    assert isinstance(evt, dict)
    assert evt.get("name") == "button_clicked"
    assert evt.get("sourceComponentId") == "action_button"
    assert evt.get("surfaceId") == "gallery-interactive-button"
    assert "timestamp" in evt
    assert "context" in evt


def test_simulate_action_missing_create_surface_synthesizes_default():
    """Verifies action simulation synthesizes default surface when createSurface is missing."""
    partial_payload = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "auto-surf",
            "components": [{
                "id": "clicker",
                "component": "Button",
                "action": {
                    "event": {
                        "name": "synthesized_click",
                        "context": {"k": "v"},
                    }
                },
            }],
        },
    }]
    evt = a2ui_simulate_action(partial_payload, "clicker")
    assert isinstance(evt, dict)
    assert evt.get("name") == "synthesized_click"
    assert evt.get("sourceComponentId") == "clicker"
    assert evt.get("surfaceId") == "auto-surf"
    assert evt.get("context") == {"k": "v"}


def test_simulate_action_nonexistent_component(valid_button_payload):
    """Verifies error result when component does not exist."""
    res = a2ui_simulate_action(valid_button_payload, "nonexistent_comp_id")
    assert isinstance(res, dict)
    assert "error" in res or res.get("success") is False or res.get("status") == "error"


def test_simulate_action_component_without_action(valid_button_payload):
    """Verifies error result when component has no action defined."""
    res = a2ui_simulate_action(valid_button_payload, "btn-label")
    assert isinstance(res, dict)
    assert "error" in res or res.get("action") is None or res.get("event") is None


def test_simulate_action_empty_payload():
    """Verifies error result when payload is empty."""
    res = a2ui_simulate_action({}, "btn")
    assert isinstance(res, dict)
    assert "error" in res or res.get("success") is False or res.get("status") == "error"


# ============================================================================
# MCP Protocol Invocation via call_tool
# ============================================================================


@pytest.mark.asyncio
async def test_mcp_call_tool_perception_action_protocol(
    interactive_button_payload,
):
    """Verifies async call_tool invocations adhering to standard MCP protocol."""
    # 1. Perception: list components
    list_res = await mcp.call_tool("a2ui_list_components", {"catalog": "basic"})
    assert len(list_res) > 0
    assert isinstance(list_res[0], TextContent)
    list_data = json.loads(list_res[0].text)
    assert "Button" in list_data.get("components", {})

    # 2. Validation
    val_res = await mcp.call_tool(
        "a2ui_validate",
        {"payload": interactive_button_payload, "catalog": "basic"},
    )
    assert len(val_res) > 0
    assert isinstance(val_res[0], TextContent)
    val_data = json.loads(val_res[0].text)
    assert val_data.get("valid") is True

    # 3. Action simulation
    act_res = await mcp.call_tool(
        "a2ui_simulate_action",
        {
            "payload": interactive_button_payload,
            "component_id": "action_button",
        },
    )
    assert len(act_res) > 0
    assert isinstance(act_res[0], TextContent)
    act_data = json.loads(act_res[0].text)
    assert act_data.get("name") == "button_clicked"

    # 4. Perception: render to ImageContent
    render_res = await mcp.call_tool(
        "a2ui_render",
        {"payload": interactive_button_payload, "catalog": "basic"},
    )
    assert len(render_res) > 0
    img_content = render_res[0]
    assert isinstance(img_content, ImageContent)
    assert img_content.type == "image"
    assert img_content.mimeType == "image/png"
    assert len(img_content.data) > 0


def test_validate_non_string_property_key():
    """Verifies a2ui_validate handles non-string property keys without crashing."""
    payload = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "s",
            "components": [{"id": "b", "component": "Button", 123: "val"}],
        },
    }]
    res = a2ui_validate(payload, "basic")
    assert res["valid"] is False
    assert any(e["type"] == "invalid_property" for e in res["errors"])


def test_validate_target_profile_errors_retained_on_empty_messages():
    """Verifies target profile incompatibility errors are retained when messages is empty."""
    payload = {"version": "0.9.1", "mimeType": "application/a2ui+json"}
    res = a2ui_validate(payload, target="gemini-enterprise")
    assert res["valid"] is False
    err_types = [e["type"] for e in res["errors"]]
    assert "target_profile_incompatibility" in err_types
    assert "empty_payload" in err_types


def test_list_components_non_string_filter():
    """Verifies a2ui_list_components handles non-string filter without crashing."""
    res = a2ui_list_components("basic", filter=123)
    assert isinstance(res, dict)
    assert "components" in res
    assert len(res["components"]) == 0
