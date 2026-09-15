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

"""Tier 2 E2E Tests: Boundary & Corner Cases.

Covers boundary conditions and error handling (>=5 tests per feature/category):
1. Unknown components with "did you mean" suggestions and exit code 1
2. Invalid properties with "did you mean" suggestions
3. Target profile rejection: incompatible version (0.9.1, 1.0) on gemini-enterprise
4. Target profile rejection: standard MIME application/a2ui+json on gemini-enterprise
5. Target profile rejection: quirk side-panel-requires-canvas-root when root is not Canvas
6. Render handling: malformed payload, missing surface, invalid JSON without hanging
7. MCP error handling: nonexistent component_id in a2ui_simulate_action, empty payload
"""

import json
from pathlib import Path
import pytest

from tests.e2e.conftest import (
    is_cli_available,
    is_render_available,
    is_targets_available,
    is_mcp_available,
)

skip_if_no_cli = pytest.mark.skipif(
    not is_cli_available(), reason="CLI not yet implemented"
)
skip_if_no_render = pytest.mark.skipif(
    not is_render_available(), reason="Render engine not yet implemented"
)
skip_if_no_targets = pytest.mark.skipif(
    not is_targets_available(), reason="Target profiles not yet implemented"
)
skip_if_no_mcp = pytest.mark.skipif(
    not is_mcp_available(), reason="MCP server not yet implemented"
)


# ============================================================================
# Category 1: Unknown Components with "Did You Mean" Suggestion (Exit Code 1)
# ============================================================================


@skip_if_no_cli
def test_unknown_component_bttn_suggests_button(cli_runner, fixtures_dir: Path):
    """Verifies that unknown component 'Bttn' suggests 'Button' with exit code 1."""
    payload_file = str(fixtures_dir / "unknown_component.json")
    result = cli_runner("check", payload_file)
    assert (
        result.exit_code == 1
    ), f"Expected exit code 1 for unknown component, got {result.exit_code}"
    output = result.stdout + " " + result.stderr
    assert "Button" in output, f"Expected suggestion 'Button' in output:\n{output}"


@skip_if_no_cli
def test_unknown_component_txt_suggests_text(cli_runner, fixtures_dir: Path):
    """Verifies that unknown component 'Txt' suggests 'Text' with exit code 1."""
    payload_file = str(fixtures_dir / "unknown_component_txt.json")
    result = cli_runner("check", payload_file)
    assert result.exit_code == 1
    output = result.stdout + " " + result.stderr
    assert "Text" in output, f"Expected suggestion 'Text' in output:\n{output}"


@skip_if_no_cli
def test_unknown_component_colum_suggests_column(cli_runner, tmp_path: Path):
    """Verifies that typo 'Colum' suggests 'Column'."""
    bad_payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Colum", "children": []}],
            },
        },
    ]
    f = tmp_path / "bad_colum.json"
    f.write_text(json.dumps(bad_payload))
    result = cli_runner("check", str(f))
    assert result.exit_code == 1
    output = result.stdout + " " + result.stderr
    assert "Column" in output


@skip_if_no_cli
def test_unknown_component_img_suggests_image(cli_runner, tmp_path: Path):
    """Verifies that typo 'Img' suggests 'Image'."""
    bad_payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [
                    {"id": "root", "component": "Img", "url": "http://example.com"}
                ],
            },
        },
    ]
    f = tmp_path / "bad_img.json"
    f.write_text(json.dumps(bad_payload))
    result = cli_runner("check", str(f))
    assert result.exit_code == 1
    output = result.stdout + " " + result.stderr
    assert "Image" in output


@skip_if_no_cli
def test_unknown_component_json_mode_structured_suggestion(
    cli_runner, fixtures_dir: Path
):
    """Verifies that in --json mode, error detail contains suggestion for unknown component."""
    payload_file = str(fixtures_dir / "unknown_component.json")
    result = cli_runner("check", payload_file, "--json")
    assert result.exit_code == 1
    data = result.json()
    assert isinstance(data, dict)
    assert data.get("valid") is False or "errors" in data
    err_str = json.dumps(data)
    assert "Button" in err_str


# ============================================================================
# Category 2: Invalid Properties with "Did You Mean" Suggestion
# ============================================================================


@skip_if_no_cli
def test_invalid_property_button_chld_suggests_child(cli_runner, fixtures_dir: Path):
    """Verifies that invalid property 'chld' on Button suggests 'child'."""
    payload_file = str(fixtures_dir / "invalid_property.json")
    result = cli_runner("check", payload_file)
    assert result.exit_code == 1
    output = result.stdout + " " + result.stderr
    assert "child" in output, f"Expected suggestion 'child' in output:\n{output}"


@skip_if_no_cli
def test_invalid_property_text_txt_suggests_text(cli_runner, fixtures_dir: Path):
    """Verifies that invalid property 'txt' on Text suggests 'text'."""
    payload_file = str(fixtures_dir / "invalid_property_txt.json")
    result = cli_runner("check", payload_file)
    assert result.exit_code == 1
    output = result.stdout + " " + result.stderr
    assert "text" in output, f"Expected suggestion 'text' in output:\n{output}"


@skip_if_no_cli
def test_invalid_property_column_childrn_suggests_children(cli_runner, tmp_path: Path):
    """Verifies that typo 'childrn' on Column suggests 'children'."""
    bad_payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Column", "childrn": []}],
            },
        },
    ]
    f = tmp_path / "bad_childrn.json"
    f.write_text(json.dumps(bad_payload))
    result = cli_runner("check", str(f))
    assert result.exit_code == 1
    output = result.stdout + " " + result.stderr
    assert "children" in output


@skip_if_no_cli
def test_invalid_property_row_alignmnt_suggests_alignment(cli_runner, tmp_path: Path):
    """Verifies that typo 'alignmnt' on Row suggests 'alignment'."""
    bad_payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Row",
                    "children": [],
                    "alignmnt": "center",
                }],
            },
        },
    ]
    f = tmp_path / "bad_alignmnt.json"
    f.write_text(json.dumps(bad_payload))
    result = cli_runner("check", str(f))
    assert result.exit_code == 1
    output = result.stdout + " " + result.stderr
    assert "alignment" in output or "align" in output


@skip_if_no_cli
def test_invalid_property_image_srcc_suggests_url(cli_runner, tmp_path: Path):
    """Verifies that typo 'srcc' or 'uri' on Image suggests 'url'."""
    bad_payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Image",
                    "srcc": "http://example.com/pic.png",
                }],
            },
        },
    ]
    f = tmp_path / "bad_srcc.json"
    f.write_text(json.dumps(bad_payload))
    result = cli_runner("check", str(f))
    assert result.exit_code == 1
    output = result.stdout + " " + result.stderr
    assert "url" in output


# ============================================================================
# Category 3: Target Profile Rejection: Incompatible Versions
# ============================================================================


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_incompatible_version_091(cli_runner, fixtures_dir: Path):
    """Verifies that version '0.9.1' is rejected under --target gemini-enterprise."""
    payload_file = str(fixtures_dir / "incompatible_version_091.json")
    result = cli_runner("check", payload_file, "--target", "gemini-enterprise")
    assert (
        result.exit_code == 1
    ), f"Expected exit code 1 for version 0.9.1, got {result.exit_code}"
    output = result.stdout + " " + result.stderr
    assert "0.9.1" in output or "version" in output.lower()


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_incompatible_version_10(cli_runner, fixtures_dir: Path):
    """Verifies that version '1.0' is rejected under --target gemini-enterprise."""
    payload_file = str(fixtures_dir / "incompatible_version_10.json")
    result = cli_runner("check", payload_file, "--target", "gemini-enterprise")
    assert (
        result.exit_code == 1
    ), f"Expected exit code 1 for version 1.0, got {result.exit_code}"
    output = result.stdout + " " + result.stderr
    assert "1.0" in output or "version" in output.lower()


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_unsupported_version_20(cli_runner, tmp_path: Path):
    """Verifies that unsupported future version '2.0' is rejected."""
    payload = [{"version": "2.0", "createSurface": {"surfaceId": "s1"}}]
    f = tmp_path / "v20.json"
    f.write_text(json.dumps(payload))
    result = cli_runner("check", str(f), "--target", "gemini-enterprise")
    assert result.exit_code == 1


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_version_in_json_mode(cli_runner, fixtures_dir: Path):
    """Verifies that version incompatibility error is returned in JSON mode."""
    payload_file = str(fixtures_dir / "incompatible_version_091.json")
    result = cli_runner(
        "check", payload_file, "--target", "gemini-enterprise", "--json"
    )
    assert result.exit_code == 1
    data = result.json()
    err_str = json.dumps(data)
    assert "0.9.1" in err_str or "version" in err_str.lower()


@skip_if_no_targets
def test_target_profile_validate_payload_rejects_bad_version(
    target_profile_loader, fixtures_dir: Path
):
    """Verifies that HostTargetProfile.validate_payload rejects version 0.9.1 programmatically."""
    profile = target_profile_loader("gemini-enterprise")
    with open(fixtures_dir / "incompatible_version_091.json") as f:
        payload = json.load(f)
    errors = profile.validate_payload(payload)
    assert len(errors) > 0
    assert any("version" in e.lower() or "0.9.1" in e for e in errors)


# ============================================================================
# Category 4: Target Profile Rejection: Standard MIME Type
# ============================================================================


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_standard_mime(cli_runner, fixtures_dir: Path):
    """Verifies that standard MIME application/a2ui+json is rejected for gemini-enterprise."""
    payload_file = str(fixtures_dir / "standard_mime.json")
    result = cli_runner("check", payload_file, "--target", "gemini-enterprise")
    assert result.exit_code == 1
    output = result.stdout + " " + result.stderr
    assert "application/a2ui+json" in output or "mime" in output.lower()


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_unsupported_mime_text_plain(cli_runner, tmp_path: Path):
    """Verifies that mimeType 'text/plain' is rejected for gemini-enterprise."""
    payload = [{
        "version": "v0.9",
        "mimeType": "text/plain",
        "createSurface": {"surfaceId": "s1"},
    }]
    f = tmp_path / "bad_mime.json"
    f.write_text(json.dumps(payload))
    result = cli_runner("check", str(f), "--target", "gemini-enterprise")
    assert result.exit_code == 1


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_generic_application_json_mime(cli_runner, tmp_path: Path):
    """Verifies that generic application/json is rejected when application/json+a2ui is required."""
    payload = [{
        "version": "v0.9",
        "mimeType": "application/json",
        "createSurface": {"surfaceId": "s1"},
    }]
    f = tmp_path / "generic_json_mime.json"
    f.write_text(json.dumps(payload))
    result = cli_runner("check", str(f), "--target", "gemini-enterprise")
    assert result.exit_code == 1


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_mime_in_json_mode(cli_runner, fixtures_dir: Path):
    """Verifies that MIME error is reported in structured JSON format."""
    payload_file = str(fixtures_dir / "standard_mime.json")
    result = cli_runner(
        "check", payload_file, "--target", "gemini-enterprise", "--json"
    )
    assert result.exit_code == 1
    data = result.json()
    err_str = json.dumps(data)
    assert "mime" in err_str.lower() or "application/a2ui+json" in err_str


@skip_if_no_targets
def test_target_profile_validate_payload_rejects_bad_mime(
    target_profile_loader, fixtures_dir: Path
):
    """Verifies programmatically that HostTargetProfile.validate_payload rejects invalid MIME."""
    profile = target_profile_loader("gemini-enterprise")
    with open(fixtures_dir / "standard_mime.json") as f:
        payload = json.load(f)
    errors = profile.validate_payload(payload)
    assert len(errors) > 0
    assert any("mime" in e.lower() or "application/a2ui+json" in e for e in errors)


# ============================================================================
# Category 5: Target Profile Rejection: Quirk `side-panel-requires-canvas-root`
# ============================================================================


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_sidepanel_non_canvas_root(cli_runner, fixtures_dir: Path):
    """Verifies rejection of side-panel payload when root component is MaterialCard instead of Canvas."""
    payload_file = str(fixtures_dir / "non_canvas_sidepanel.json")
    result = cli_runner("check", payload_file, "--target", "gemini-enterprise")
    assert result.exit_code == 1
    output = result.stdout + " " + result.stderr
    assert "Canvas" in output or "side-panel" in output or "root" in output.lower()


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_sidepanel_with_column_root(cli_runner, tmp_path: Path):
    """Verifies rejection when side-panel root is Column."""
    payload = [
        {
            "version": "v0.9",
            "mimeType": "application/json+a2ui",
            "targetSurface": "side-panel",
            "createSurface": {"surfaceId": "s1"},
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Column", "children": []}],
            },
        },
    ]
    f = tmp_path / "sidepanel_column.json"
    f.write_text(json.dumps(payload))
    result = cli_runner("check", str(f), "--target", "gemini-enterprise")
    assert result.exit_code == 1


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_sidepanel_with_text_root(cli_runner, tmp_path: Path):
    """Verifies rejection when side-panel root is Text."""
    payload = [
        {
            "version": "v0.9",
            "mimeType": "application/json+a2ui",
            "targetSurface": "side-panel",
            "createSurface": {"surfaceId": "s1"},
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Text", "text": "Hello"}],
            },
        },
    ]
    f = tmp_path / "sidepanel_text.json"
    f.write_text(json.dumps(payload))
    result = cli_runner("check", str(f), "--target", "gemini-enterprise")
    assert result.exit_code == 1


@skip_if_no_cli
@skip_if_no_targets
def test_target_rejection_sidepanel_json_mode(cli_runner, fixtures_dir: Path):
    """Verifies quirk error output in JSON format."""
    payload_file = str(fixtures_dir / "non_canvas_sidepanel.json")
    result = cli_runner(
        "check", payload_file, "--target", "gemini-enterprise", "--json"
    )
    assert result.exit_code == 1
    data = result.json()
    err_str = json.dumps(data)
    assert "Canvas" in err_str or "side-panel" in err_str or "root" in err_str.lower()


@skip_if_no_targets
def test_target_profile_quirk_canvas_root_passes_when_canvas(
    target_profile_loader, fixtures_dir: Path
):
    """Verifies that side-panel with root Canvas passes quirk validation."""
    profile = target_profile_loader("gemini-enterprise")
    with open(fixtures_dir / "valid_ge_payload.json") as f:
        payload = json.load(f)
    errors = profile.validate_payload(payload)
    assert len(errors) == 0


# ============================================================================
# Category 6: Render Handling: Malformed, Missing Surface, Invalid JSON
# ============================================================================


@skip_if_no_cli
@skip_if_no_render
def test_render_empty_payload_graceful_exit(
    cli_runner, fixtures_dir: Path, tmp_path: Path
):
    """Verifies that rendering empty payload {} exits non-zero without crashing or hanging."""
    empty_file = str(fixtures_dir / "empty_payload.json")
    out_png = str(tmp_path / "empty.png")
    result = cli_runner("render", empty_file, "--png", out_png, timeout=10.0)
    assert result.exit_code != 0


@skip_if_no_cli
@skip_if_no_render
def test_render_invalid_json_syntax_graceful_exit(
    cli_runner, fixtures_dir: Path, tmp_path: Path
):
    """Verifies that invalid JSON syntax is reported cleanly without hanging."""
    malformed_file = str(fixtures_dir / "malformed_syntax.json")
    out_png = str(tmp_path / "malformed.png")
    result = cli_runner("render", malformed_file, "--png", out_png, timeout=10.0)
    assert result.exit_code != 0


@skip_if_no_cli
@skip_if_no_render
def test_render_missing_surface_id_graceful_exit(cli_runner, tmp_path: Path):
    """Verifies rendering payload with updateComponents but no createSurface handles cleanly."""
    payload = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "nonexistent",
            "components": [{"id": "root", "component": "Text", "text": "Hi"}],
        },
    }]
    f = tmp_path / "no_surface.json"
    f.write_text(json.dumps(payload))
    out_png = str(tmp_path / "no_surface.png")
    result = cli_runner("render", str(f), "--png", out_png, timeout=10.0)
    # Must exit without hanging; either exits with error or creates default surface
    assert result.exit_code in [0, 1, 2]


@skip_if_no_cli
@skip_if_no_render
def test_render_missing_referenced_child_graceful_exit(cli_runner, tmp_path: Path):
    """Verifies rendering payload with unresolvable child reference does not cause an infinite loop."""
    payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Column",
                    "children": ["missing-child-id"],
                }],
            },
        },
    ]
    f = tmp_path / "missing_child.json"
    f.write_text(json.dumps(payload))
    out_png = str(tmp_path / "missing_child.png")
    result = cli_runner("render", str(f), "--png", out_png, timeout=15.0)
    # Must complete execution within timeout without hanging
    assert result.exit_code in [0, 1, 2]


@skip_if_no_cli
@skip_if_no_render
def test_render_bounded_execution_timeout(
    cli_runner, fixtures_dir: Path, tmp_path: Path
):
    """Verifies that render engine terminates within reasonable timeout."""
    payload_file = str(fixtures_dir / "basic_button.json")
    out_png = str(tmp_path / "timeout_test.png")
    # A standard render should complete well within 30 seconds
    result = cli_runner("render", payload_file, "--png", out_png, timeout=30.0)
    assert result.exit_code == 0


# ============================================================================
# Category 7: MCP Error Handling
# ============================================================================


@skip_if_no_mcp
def test_mcp_simulate_action_nonexistent_component_id(mcp_client, fixtures_dir: Path):
    """Verifies that simulating action on a nonexistent component returns an error or raises cleanly."""
    with open(fixtures_dir / "basic_button.json") as f:
        payload = json.load(f)
    try:
        res = mcp_client.simulate_action(payload, "nonexistent_comp_id")
        # If dict is returned, must indicate error or failure
        if isinstance(res, dict):
            assert (
                "error" in res
                or res.get("success") is False
                or res.get("status") == "error"
            )
    except Exception as exc:
        # Raising an exception is also valid opaque-box error handling
        assert (
            "nonexistent_comp_id" in str(exc)
            or "not found" in str(exc).lower()
            or "error" in str(exc).lower()
        )


@skip_if_no_mcp
def test_mcp_simulate_action_empty_payload(mcp_client, fixtures_dir: Path):
    """Verifies that simulating action on an empty payload handles gracefully."""
    try:
        res = mcp_client.simulate_action({}, "action_button")
        if isinstance(res, dict):
            assert (
                "error" in res
                or res.get("success") is False
                or res.get("status") == "error"
            )
    except Exception as exc:
        assert len(str(exc)) > 0


@skip_if_no_mcp
def test_mcp_simulate_action_component_without_action(mcp_client, fixtures_dir: Path):
    """Verifies that simulating action on a component with no action defined behaves gracefully."""
    with open(fixtures_dir / "basic_button.json") as f:
        payload = json.load(f)
    try:
        res = mcp_client.simulate_action(
            payload, "btn-label"
        )  # Text component has no action
        if isinstance(res, dict):
            assert (
                "error" in res or res.get("action") is None or res.get("event") is None
            )
    except Exception as exc:
        assert (
            "action" in str(exc).lower()
            or "no action" in str(exc).lower()
            or "error" in str(exc).lower()
        )


@skip_if_no_mcp
def test_mcp_validate_empty_payload_fails(mcp_client):
    """Verifies that a2ui_validate returns valid=False on an empty payload."""
    res = mcp_client.validate({}, "basic")
    assert isinstance(res, dict)
    assert res.get("valid") is False or len(res.get("errors", [])) > 0


@skip_if_no_mcp
def test_mcp_list_components_invalid_catalog_id(mcp_client):
    """Verifies that a2ui_list_components with invalid catalog returns error or raises cleanly."""
    try:
        res = mcp_client.list_components("nonexistent_catalog_id_xyz")
        if isinstance(res, dict):
            assert "error" in res or len(res.get("components", [])) == 0
    except Exception as exc:
        assert len(str(exc)) > 0
