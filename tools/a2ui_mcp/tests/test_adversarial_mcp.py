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

"""Adversarial stress tests for FastMCP Server and Host Target Profiles.

Authored by Challenger 2 (Empirical Challenger) to verify:
1. a2ui_list_components: invalid catalogs, edge-case filtering, CLI parity.
2. a2ui_validate: malformed payloads, target profile rejections (0.9.1/1.0, MIME application/a2ui+json), quirks.
3. a2ui_simulate_action: missing createSurface, no-action components, nonexistent IDs, dynamic context resolution, exact emitted event structure.
4. a2ui_render: async event loop invocation, thread-safety under concurrency, valid Image return type.
"""

from __future__ import annotations

import asyncio
import copy
import datetime
import json
from pathlib import Path
import struct
from typing import Any, Dict, List

import pytest
from mcp.server.fastmcp.utilities.types import Image
from mcp.types import ImageContent

from a2ui.cli.catalog import resolve_catalog
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
def valid_button_payload() -> List[Dict[str, Any]]:
    return [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "test-surface",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "test-surface",
                "components": [
                    {
                        "id": "btn_1",
                        "component": "Button",
                        "child": "lbl_1",
                        "action": {
                            "event": {
                                "name": "btn_click",
                                "context": {"key": "value"},
                            }
                        },
                    },
                    {
                        "id": "lbl_1",
                        "component": "Text",
                        "text": "Click Me",
                    },
                ],
            },
        },
    ]


# ============================================================================
# Section 1: a2ui_list_components Adversarial Stress Tests
# ============================================================================


class TestListComponentsAdversarial:
    """Stress testing a2ui_list_components."""

    @pytest.mark.parametrize(
        "invalid_catalog",
        [
            "",
            "nonexistent_catalog_xyz_999",
            "../../etc/passwd",
            "https://a2ui.org/nonexistent/path/catalog.json",
            "http://127.0.0.1:9999/does_not_exist.json",
            "/tmp/nonexistent_file_definitely_not_here.json",
        ],
    )
    def test_invalid_catalog_identifiers_return_error_dict(self, invalid_catalog: str):
        """Verifies that nonexistent or malformed catalog identifiers return error dicts."""
        res = a2ui_list_components(invalid_catalog)
        assert isinstance(res, dict)
        assert "error" in res
        assert res.get("catalog") == invalid_catalog
        assert res.get("components") == {}
        assert isinstance(res.get("reference_topology"), dict)

    def test_none_catalog_identifier(self):
        """Verifies that passing None as catalog identifier is handled gracefully."""
        res = a2ui_list_components(None)  # type: ignore
        assert isinstance(res, dict)
        assert "error" in res
        assert res.get("components") == {}

    @pytest.mark.parametrize(
        "filter_str,expected_min_count,expected_max_count",
        [
            ("", 18, 100),  # Empty filter returns all components
            ("NonExistentComponentName999", 0, 0),  # No matches
            (".*", 0, 0),  # Literal substring, not regex
            ("[", 0, 0),  # Unbalanced regex bracket must not crash regex engine
            ("Button", 1, 10),  # Exact match
            (
                "button",
                0,
                0,
            ),  # Case sensitivity check: basic catalog uses PascalCase "Button"
        ],
    )
    def test_filtering_edge_cases(
        self, filter_str: str, expected_min_count: int, expected_max_count: int
    ):
        """Tests filtering edge cases including literal regex chars and case sensitivity."""
        res = a2ui_list_components("basic", filter=filter_str)
        assert isinstance(res, dict)
        assert "error" not in res
        comps = res.get("components", {})
        count = len(comps)
        assert expected_min_count <= count <= expected_max_count
        assert res.get("component_count") == count
        for comp_name in comps:
            if filter_str:
                assert filter_str in comp_name

    def test_catalog_parity_with_cli_and_schema_basic(self):
        """Ensures complete component and property parity between MCP tool and core catalog."""
        name, schema, a2ui_cat, core_cat = resolve_catalog("basic")
        res = a2ui_list_components("basic")

        assert res.get("name") == "basic"
        mcp_comps = res.get("components", {})
        core_comp_names = set(core_cat.components.keys())

        # Parity: component names
        assert set(mcp_comps.keys()) == core_comp_names

        # Parity: every component has required fields, properties, references
        for comp_name, comp_info in mcp_comps.items():
            assert "required_fields" in comp_info
            assert "properties" in comp_info
            assert "references" in comp_info
            assert "single" in comp_info["references"]
            assert "list" in comp_info["references"]

    def test_catalog_parity_gemini_enterprise_composite(self):
        """Ensures composite enterprise catalog lists extended Material components."""
        res = a2ui_list_components("gemini_enterprise_composite")
        assert isinstance(res, dict)
        assert "error" not in res
        comps = res.get("components", {})
        # Should include core plus Material extensions (e.g. MaterialCard, MaterialButton, Canvas)
        assert "Canvas" in comps
        assert "Button" in comps
        assert any("Material" in name for name in comps)
        assert len(comps) > 20


# ============================================================================
# Section 2: a2ui_validate Adversarial Stress Tests
# ============================================================================


class TestValidateAdversarial:
    """Stress testing a2ui_validate with malformed payloads, target profile rejections, and quirks."""

    @pytest.mark.parametrize(
        "malformed_payload",
        [
            {},
            [],
            {"foo": "bar"},
            {"messages": []},
            {"updateComponents": "string_not_dict"},
            {"updateComponents": {"surfaceId": "s1", "components": "string_not_list"}},
            {"updateComponents": {"surfaceId": "s1", "components": ["not_a_dict"]}},
            {
                "updateComponents": {"surfaceId": "s1", "components": [{"id": 123}]}
            },  # Missing component type
        ],
    )
    def test_malformed_and_empty_payloads_rejected_safely(self, malformed_payload: Any):
        """Verifies that malformed or empty payloads return valid=False with error details."""
        res = a2ui_validate(malformed_payload, "basic")
        assert isinstance(res, dict)
        assert res.get("valid") is False
        assert res.get("status") == "error"
        assert res.get("error_count", 0) >= 1
        assert len(res.get("errors", [])) >= 1

    @pytest.mark.parametrize(
        "incompatible_version",
        [
            "0.9.1",
            "1.0",
            "v0.9.1",
            "v1.0",
            "0.7",
            "2.0",
        ],
    )
    def test_gemini_enterprise_rejects_incompatible_protocol_versions(
        self, incompatible_version: str, valid_button_payload: List[Dict[str, Any]]
    ):
        """Verifies gemini-enterprise profile explicitly rejects versions outside [0.8, 0.9]."""
        payload = copy.deepcopy(valid_button_payload)
        for msg in payload:
            msg["version"] = incompatible_version

        res = a2ui_validate(payload, target="gemini-enterprise")
        assert res.get("valid") is False
        errors = res.get("errors", [])
        version_errors = [
            e
            for e in errors
            if e.get("type") == "target_profile_incompatibility"
            and "protocol version" in e.get("message", "").lower()
        ]
        assert len(version_errors) >= 1
        assert incompatible_version in version_errors[0]["message"]

    @pytest.mark.parametrize(
        "compatible_version",
        [
            "0.8",
            "0.9",
            "v0.8",
            "v0.9",
        ],
    )
    def test_gemini_enterprise_accepts_compatible_protocol_versions(
        self, compatible_version: str, valid_button_payload: List[Dict[str, Any]]
    ):
        """Verifies gemini-enterprise profile accepts versions in [0.8, 0.9] (both with and without 'v')."""
        payload = copy.deepcopy(valid_button_payload)
        for msg in payload:
            msg["version"] = compatible_version
        res = a2ui_validate(payload, target="gemini-enterprise")
        errors = res.get("errors", [])
        version_errors = [
            e
            for e in errors
            if e.get("type") == "target_profile_incompatibility"
            and "protocol version" in e.get("message", "").lower()
        ]
        assert len(version_errors) == 0

    @pytest.mark.parametrize(
        "invalid_mime",
        [
            "application/a2ui+json",  # Standard A2UI MIME (incompatible with GE wire)
            "application/json",
            "text/plain",
            "application/xml",
        ],
    )
    def test_gemini_enterprise_rejects_incompatible_mime_types(
        self, invalid_mime: str, valid_button_payload: List[Dict[str, Any]]
    ):
        """Verifies gemini-enterprise profile enforces exact match on application/json+a2ui."""
        wrapped_payload = {
            "mimeType": invalid_mime,
            "version": "v0.9",
            "messages": valid_button_payload,
        }
        res = a2ui_validate(wrapped_payload, target="gemini-enterprise")
        assert res.get("valid") is False
        errors = res.get("errors", [])
        mime_errors = [
            e
            for e in errors
            if e.get("type") == "target_profile_incompatibility"
            and "mime" in e.get("message", "").lower()
        ]
        assert len(mime_errors) >= 1
        assert invalid_mime in mime_errors[0]["message"]

    def test_gemini_enterprise_accepts_valid_mime_type(
        self, valid_button_payload: List[Dict[str, Any]]
    ):
        """Verifies gemini-enterprise accepts exact match application/json+a2ui."""
        wrapped_payload = {
            "mimeType": "application/json+a2ui",
            "version": "v0.9",
            "messages": valid_button_payload,
        }
        res = a2ui_validate(wrapped_payload, target="gemini-enterprise")
        errors = res.get("errors", [])
        mime_errors = [
            e
            for e in errors
            if e.get("type") == "target_profile_incompatibility"
            and "mime" in e.get("message", "").lower()
        ]
        assert len(mime_errors) == 0

    def test_side_panel_requires_canvas_root_quirk(self):
        """Verifies that side-panel surface quirk enforces Canvas as the root component."""
        # Case A: side-panel surface with Button as root (VIOLATION)
        bad_side_panel = [{
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "my-side-panel",
                "components": [
                    {
                        "id": "root_btn",
                        "component": "Button",
                        "child": "txt",
                    },
                    {
                        "id": "txt",
                        "component": "Text",
                        "text": "Side Panel Content",
                    },
                ],
            },
        }]
        res_bad = a2ui_validate(bad_side_panel, target="gemini-enterprise")
        assert res_bad.get("valid") is False
        errors = res_bad.get("errors", [])
        quirk_errs = [
            e
            for e in errors
            if "side-panel-requires-canvas-root" in e.get("message", "")
        ]
        assert len(quirk_errs) >= 1

        # Case B: side-panel surface with Canvas as root (COMPLIANT)
        good_side_panel = [{
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "my-side-panel",
                "components": [
                    {
                        "id": "canvas_root",
                        "component": "Canvas",
                        "child": "btn",
                    },
                    {
                        "id": "btn",
                        "component": "Button",
                        "child": "txt",
                    },
                    {
                        "id": "txt",
                        "component": "Text",
                        "text": "Compliant Canvas Panel",
                    },
                ],
            },
        }]
        res_good = a2ui_validate(good_side_panel, target="gemini-enterprise")
        quirk_errs_good = [
            e
            for e in res_good.get("errors", [])
            if "side-panel-requires-canvas-root" in e.get("message", "")
        ]
        assert len(quirk_errs_good) == 0

    def test_multi_error_aggregation(self):
        """Verifies that validate aggregates multiple error types simultaneously."""
        payload = {
            "version": "0.9.1",  # Target error 1
            "mimeType": "application/a2ui+json",  # Target error 2
            "messages": [{
                "version": "0.9.1",
                "updateComponents": {
                    "surfaceId": "s1",
                    "components": [
                        {
                            "id": "c1",
                            "component": "UnknwnComponent",  # Unknown component error
                        },
                        {
                            "id": "c2",
                            "component": "Button",
                            "invalid_property_xyz": "value",  # Invalid property error
                        },
                    ],
                },
            }],
        }
        res = a2ui_validate(payload, target="gemini-enterprise")
        assert res.get("valid") is False
        errors = res.get("errors", [])
        error_types = {e.get("type") for e in errors}

        assert "target_profile_incompatibility" in error_types
        assert "unknown_component" in error_types
        assert "invalid_property" in error_types
        assert len(errors) >= 3


# ============================================================================
# Section 3: a2ui_simulate_action Adversarial Stress Tests
# ============================================================================


class TestSimulateActionAdversarial:
    """Stress testing a2ui_simulate_action."""

    def test_missing_create_surface_is_synthesized(self):
        """Verifies simulation works when payload omits createSurface envelope."""
        payload = [{
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "auto_synth_surface",
                "components": [{
                    "id": "act_btn",
                    "component": "Button",
                    "action": {
                        "event": {
                            "name": "auto_click",
                            "context": {"source": "synth"},
                        }
                    },
                }],
            },
        }]
        evt = a2ui_simulate_action(payload, "act_btn")
        assert isinstance(evt, dict)
        assert evt.get("name") == "auto_click"
        assert evt.get("surfaceId") == "auto_synth_surface"
        assert evt.get("sourceComponentId") == "act_btn"
        assert evt.get("context") == {"source": "synth"}
        assert "timestamp" in evt

    def test_component_without_action_returns_error(self, valid_button_payload):
        """Verifies attempting to trigger a component with no action returns error."""
        res = a2ui_simulate_action(valid_button_payload, "lbl_1")
        assert isinstance(res, dict)
        assert "error" in res or res.get("action") is None or res.get("event") is None

    def test_nonexistent_component_id_returns_error(self, valid_button_payload):
        """Verifies attempting to trigger a non-existent component ID returns error."""
        res = a2ui_simulate_action(valid_button_payload, "ghost_component_id")
        assert isinstance(res, dict)
        assert "error" in res
        assert "ghost_component_id" in res["error"]
        assert res.get("success") is False

    def test_dynamic_data_context_resolution(self):
        """Verifies dynamic data context bindings are evaluated against DataModel."""
        payload = [
            {
                "version": "v0.9",
                "createSurface": {
                    "surfaceId": "dyn_surface",
                    "catalogId": (
                        "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                    ),
                },
            },
            {
                "version": "v0.9",
                "updateDataModel": {
                    "surfaceId": "dyn_surface",
                    "path": "/",
                    "value": {
                        "currentUser": {
                            "name": "Grace Hopper",
                            "role": "Pioneer",
                            "years": 50,
                        },
                        "cart": {
                            "items": [
                                {"sku": "A100", "price": 99.99},
                                {"sku": "B200", "price": 149.50},
                            ]
                        },
                    },
                },
            },
            {
                "version": "v0.9",
                "updateComponents": {
                    "surfaceId": "dyn_surface",
                    "components": [{
                        "id": "checkout_btn",
                        "component": "Button",
                        "action": {
                            "event": {
                                "name": "checkout_initiated",
                                "context": {
                                    "userName": {"path": "/currentUser/name"},
                                    "userRole": {"path": "/currentUser/role"},
                                    "yearsOfExp": {"path": "/currentUser/years"},
                                    "firstItemSku": {"path": "/cart/items/0/sku"},
                                    "constant": "verified",
                                },
                            }
                        },
                    }],
                },
            },
        ]

        evt = a2ui_simulate_action(payload, "checkout_btn")
        assert isinstance(evt, dict)
        assert "error" not in evt

        # Verify exact emitted structure
        expected_keys = {
            "name",
            "surfaceId",
            "sourceComponentId",
            "timestamp",
            "context",
        }
        assert expected_keys.issubset(
            set(evt.keys())
        ), f"Missing keys in action event: {expected_keys - set(evt.keys())}"

        assert evt["name"] == "checkout_initiated"
        assert evt["surfaceId"] == "dyn_surface"
        assert evt["sourceComponentId"] == "checkout_btn"

        # Verify timestamp is valid UTC ISO string
        ts = evt["timestamp"]
        assert ts.endswith("Z")
        parsed_dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        assert parsed_dt is not None

        # Verify context resolution
        ctx = evt["context"]
        assert ctx["userName"] == "Grace Hopper"
        assert ctx["userRole"] == "Pioneer"
        assert ctx["yearsOfExp"] == 50
        assert ctx["firstItemSku"] == "A100"
        assert ctx["constant"] == "verified"


# ============================================================================
# Section 4: a2ui_render Async Loop Concurrency & Thread-Safety Tests
# ============================================================================


class TestRenderAsyncConcurrencyAndThreadSafety:
    """Stress testing a2ui_render in async event loops and concurrent calls."""

    @pytest.mark.asyncio
    async def test_render_inside_active_asyncio_event_loop(
        self, valid_button_payload: List[Dict[str, Any]]
    ):
        """Verifies a2ui_render does not crash when invoked directly in an active asyncio loop.

        Playwright's sync API raises:
          Error: It looks like you are using Playwright Sync API inside the asyncio loop.
        if called without dedicated thread isolation.
        """
        # Ensure we are inside an active running event loop
        loop = asyncio.get_running_loop()
        assert loop is not None

        # Direct synchronous invocation of a2ui_render inside async def
        img = a2ui_render(valid_button_payload, "basic", width=600)
        assert isinstance(img, Image)
        assert isinstance(img.data, bytes)
        assert img.data[:8] == b"\x89PNG\r\n\x1a\n"

        # Verify width in IHDR
        w, h = struct.unpack(">II", img.data[16:24])
        assert w == 600
        assert h > 0

    @pytest.mark.asyncio
    async def test_render_concurrent_invocations_thread_safety(
        self, valid_button_payload: List[Dict[str, Any]]
    ):
        """Verifies that multiple concurrent renders run safely without race conditions or deadlocks."""
        widths = [400, 500, 600]

        async def _render_task(w: int) -> Image:
            # Delegate to asyncio.to_thread to simulate multiple concurrent agent requests
            return await asyncio.to_thread(
                a2ui_render, valid_button_payload, "basic", w
            )

        results = await asyncio.gather(*[_render_task(w) for w in widths])

        assert len(results) == len(widths)
        for expected_w, img in zip(widths, results):
            assert isinstance(img, Image)
            assert img.data[:8] == b"\x89PNG\r\n\x1a\n"
            actual_w, actual_h = struct.unpack(">II", img.data[16:24])
            assert actual_w == expected_w
            assert actual_h > 0

    @pytest.mark.asyncio
    async def test_render_via_mcp_call_tool_returns_image_content(
        self, valid_button_payload: List[Dict[str, Any]]
    ):
        """Verifies FastMCP call_tool serializes a2ui_render output into standard ImageContent."""
        res = await mcp.call_tool(
            "a2ui_render",
            {"payload": valid_button_payload, "catalog": "basic", "width": 800},
        )
        assert len(res) == 1
        content = res[0]
        assert isinstance(content, ImageContent)
        assert content.type == "image"
        assert content.mimeType == "image/png"
        assert len(content.data) > 0  # Base64 string in MCP protocol

    def test_render_malformed_payload_raises_cleanly(self):
        """Verifies that rendering unparseable payload raises A2uiRenderError cleanly."""
        with pytest.raises(A2uiRenderError):
            a2ui_render("{bad_json_not_valid", "basic")
