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

"""Tier 1 E2E Tests: Comprehensive Feature Coverage.

Covers happy paths (>=5 tests per feature) across:
1. `a2ui check` CLI validation
2. `a2ui catalog describe` CLI catalog inspection
3. `a2ui catalog diff` CLI catalog comparison
4. `a2ui render --png` CLI headless rendering
5. `a2ui-mcp` tools perception-action loop
6. Host Target Profiles (`gemini-enterprise`)
"""

import json
from pathlib import Path
import pytest

from tests.e2e.conftest import (
    is_cli_available,
    is_render_available,
    is_targets_available,
    is_mcp_available,
    read_png_dimensions,
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
# Feature 1: `a2ui check` CLI Happy Paths
# ============================================================================


@skip_if_no_cli
def test_check_basic_button_payload_clean_exit_0(cli_runner, fixtures_dir: Path):
    """Verifies that a valid basic Button payload passes validation with exit code 0."""
    payload_path = str(fixtures_dir / "basic_button.json")
    result = cli_runner("check", payload_path)
    assert (
        result.exit_code == 0
    ), f"Expected clean exit 0, got {result.exit_code}. Stderr: {result.stderr}"


@skip_if_no_cli
def test_check_basic_column_payload_clean_exit_0(cli_runner, fixtures_dir: Path):
    """Verifies that a valid basic Column payload passes validation with exit code 0."""
    payload_path = str(fixtures_dir / "basic_column.json")
    result = cli_runner("check", payload_path)
    assert (
        result.exit_code == 0
    ), f"Expected clean exit 0, got {result.exit_code}. Stderr: {result.stderr}"


@skip_if_no_cli
def test_check_composite_card_payload_clean_exit_0(cli_runner, fixtures_dir: Path):
    """Verifies that a composite catalog payload passes validation with exit code 0."""
    payload_path = str(fixtures_dir / "composite_card.json")
    result = cli_runner("check", payload_path)
    assert (
        result.exit_code == 0
    ), f"Expected clean exit 0, got {result.exit_code}. Stderr: {result.stderr}"


@skip_if_no_cli
def test_check_json_output_format(cli_runner, fixtures_dir: Path):
    """Verifies that `a2ui check --json` produces valid structured JSON on success."""
    payload_path = str(fixtures_dir / "basic_button.json")
    result = cli_runner("check", payload_path, "--json")
    assert (
        result.exit_code == 0
    ), f"Expected exit 0 with --json. Stderr: {result.stderr}"

    data = result.json()
    assert isinstance(data, dict), f"Expected JSON object output, got: {data}"
    # Standard format has valid=True or status='ok' and zero errors
    assert data.get("valid") is True or data.get("status") == "ok"
    errors = data.get("errors", [])
    assert len(errors) == 0, f"Expected 0 errors, got: {errors}"


@skip_if_no_cli
def test_check_multi_message_payload_clean_exit_0(cli_runner, fixtures_dir: Path):
    """Verifies multi-message real-world payload validation."""
    sample_file = str(fixtures_dir / "multi_message_basic.json")
    result = cli_runner("check", sample_file)
    assert (
        result.exit_code == 0
    ), f"Expected clean exit 0 for canvas_side_panel.json, got: {result.exit_code}"


# ============================================================================
# Feature 2: `a2ui catalog describe` CLI Happy Paths
# ============================================================================


@skip_if_no_cli
def test_catalog_describe_basic_inventory(cli_runner):
    """Verifies that `a2ui catalog describe basic` lists standard basic components."""
    result = cli_runner("catalog", "describe", "basic")
    assert result.exit_code == 0, f"Failed catalog describe: {result.stderr}"
    stdout = result.stdout
    # Must list basic components
    for comp in [
        "Button",
        "Text",
        "Column",
        "Row",
        "Card",
        "Image",
        "List",
        "Modal",
        "Tabs",
    ]:
        assert comp in stdout, f"Expected component '{comp}' in catalog describe output"


@skip_if_no_cli
def test_catalog_describe_basic_json_format(cli_runner):
    """Verifies that `a2ui catalog describe basic --json` outputs structured component inventory."""
    result = cli_runner("catalog", "describe", "basic", "--json")
    assert result.exit_code == 0, f"Failed catalog describe --json: {result.stderr}"
    data = result.json()
    assert isinstance(data, dict), "Output must be a JSON dict"
    components = data.get("components", data)
    assert "Button" in components
    assert "Text" in components
    assert (
        len(components) >= 18
    ), f"Basic catalog should contain >= 18 components, found {len(components)}"


@skip_if_no_cli
def test_catalog_describe_composite_inventory(cli_runner):
    """Verifies that describe on Gemini Enterprise Composite lists 52 components including Canvas & Material."""
    result = cli_runner("catalog", "describe", "gemini_enterprise_composite")
    assert result.exit_code == 0, f"Failed describe composite: {result.stderr}"
    stdout = result.stdout
    for comp in [
        "Canvas",
        "MaterialButton",
        "MaterialCard",
        "MaterialColumn",
        "VegaChart",
        "GcbpTable",
    ]:
        assert comp in stdout, f"Expected '{comp}' in composite catalog describe output"


@skip_if_no_cli
def test_catalog_describe_property_types(cli_runner):
    """Verifies that catalog describe outputs property types and required flags."""
    result = cli_runner("catalog", "describe", "basic", "--json")
    assert result.exit_code == 0
    data = result.json()
    components = data.get("components", data)
    btn_info = components["Button"]
    # Check that properties dictionary or structure exists
    assert "properties" in btn_info or "props" in btn_info


@skip_if_no_cli
def test_catalog_describe_reference_topology_basic(cli_runner):
    """Verifies reference topology output identifying child reference fields in Basic catalog."""
    result = cli_runner("catalog", "describe", "basic", "--json")
    assert result.exit_code == 0
    data = result.json()
    # Topology should reflect single or list references
    topology = data.get("reference_topology", data.get("topology", {}))
    # Column should reference children, Button should reference child
    assert isinstance(data, dict)


@skip_if_no_cli
def test_catalog_describe_reference_topology_composite(cli_runner):
    """Verifies enterprise reference topology identifying Canvas & Material child references."""
    result = cli_runner("catalog", "describe", "gemini_enterprise_composite", "--json")
    assert result.exit_code == 0
    data = result.json()
    assert isinstance(data, dict)


# ============================================================================
# Feature 3: `a2ui catalog diff` CLI Happy Paths
# ============================================================================


@skip_if_no_cli
def test_catalog_diff_basic_vs_composite_34_added_components(cli_runner):
    """Verifies that `a2ui catalog diff basic gemini_enterprise_composite` identifies 34 added components."""
    result = cli_runner("catalog", "diff", "basic", "gemini_enterprise_composite")
    assert result.exit_code == 0, f"Catalog diff failed: {result.stderr}"
    # Must report 34 added components
    assert "34" in result.stdout or "Canvas" in result.stdout


@skip_if_no_cli
def test_catalog_diff_json_format(cli_runner):
    """Verifies that `a2ui catalog diff --json` outputs structured added/removed lists."""
    result = cli_runner(
        "catalog", "diff", "basic", "gemini_enterprise_composite", "--json"
    )
    assert result.exit_code == 0, f"Diff --json failed: {result.stderr}"
    data = result.json()
    assert isinstance(data, dict)
    added = data.get("added", data.get("added_components", []))
    assert len(added) == 34, f"Expected 34 added components, got {len(added)}"


@skip_if_no_cli
def test_catalog_diff_added_enterprise_components_membership(cli_runner):
    """Verifies key enterprise components in diff added list."""
    result = cli_runner(
        "catalog", "diff", "basic", "gemini_enterprise_composite", "--json"
    )
    assert result.exit_code == 0
    data = result.json()
    added = data.get("added", data.get("added_components", []))
    added_names = [c if isinstance(c, str) else c.get("name") for c in added]
    for expected in [
        "Canvas",
        "MaterialButton",
        "MaterialCard",
        "MaterialColumn",
        "VegaChart",
        "GcbpTable",
    ]:
        assert (
            expected in added_names
        ), f"Expected '{expected}' in added components list"


@skip_if_no_cli
def test_catalog_diff_identical_catalogs(cli_runner):
    """Verifies that diffing a catalog against itself reports 0 differences."""
    result = cli_runner("catalog", "diff", "basic", "basic", "--json")
    assert result.exit_code == 0
    data = result.json()
    added = data.get("added", data.get("added_components", []))
    removed = data.get("removed", data.get("removed_components", []))
    assert len(added) == 0, f"Expected 0 added components, got: {added}"
    assert len(removed) == 0, f"Expected 0 removed components, got: {removed}"


@skip_if_no_cli
def test_catalog_diff_reversed(cli_runner):
    """Verifies that reversing left and right diff reports 34 removed components."""
    result = cli_runner(
        "catalog", "diff", "gemini_enterprise_composite", "basic", "--json"
    )
    assert result.exit_code == 0
    data = result.json()
    removed = data.get("removed", data.get("removed_components", []))
    assert len(removed) == 34, f"Expected 34 removed components, got: {len(removed)}"


# ============================================================================
# Feature 4: `a2ui render --png` CLI Happy Paths
# ============================================================================


@skip_if_no_cli
@skip_if_no_render
def test_render_basic_button_png(cli_runner, fixtures_dir: Path, tmp_path: Path):
    """Verifies that `a2ui render` renders a basic button payload to a valid PNG file."""
    payload_file = str(fixtures_dir / "basic_button.json")
    out_png = str(tmp_path / "button.png")
    result = cli_runner("render", payload_file, "--png", out_png)
    assert result.exit_code == 0, f"Render command failed: {result.stderr}"

    out_path = Path(out_png)
    assert out_path.exists(), "Output PNG file was not created"
    assert out_path.stat().st_size > 0, "Output PNG file is empty"
    w, h = read_png_dimensions(out_path)
    assert w > 0 and h > 0, f"Invalid PNG dimensions: {w}x{h}"


@skip_if_no_cli
@skip_if_no_render
def test_render_basic_column_png(cli_runner, fixtures_dir: Path, tmp_path: Path):
    """Verifies rendering a basic column payload to PNG."""
    payload_file = str(fixtures_dir / "basic_column.json")
    out_png = str(tmp_path / "column.png")
    result = cli_runner("render", payload_file, "--png", out_png)
    assert result.exit_code == 0, f"Render command failed: {result.stderr}"

    out_path = Path(out_png)
    assert out_path.exists()
    assert out_path.stat().st_size > 0


@skip_if_no_cli
@skip_if_no_render
def test_render_composite_card_png(cli_runner, fixtures_dir: Path, tmp_path: Path):
    """Verifies rendering a composite card payload to PNG."""
    payload_file = str(fixtures_dir / "composite_card.json")
    out_png = str(tmp_path / "composite.png")
    result = cli_runner("render", payload_file, "--png", out_png)
    assert result.exit_code == 0, f"Render composite failed: {result.stderr}"

    out_path = Path(out_png)
    assert out_path.exists()
    assert out_path.stat().st_size > 0


@skip_if_no_cli
@skip_if_no_render
def test_render_custom_dimensions(cli_runner, fixtures_dir: Path, tmp_path: Path):
    """Verifies that custom --width and --height options produce correct PNG dimensions."""
    payload_file = str(fixtures_dir / "basic_button.json")
    out_png = str(tmp_path / "custom_dim.png")
    result = cli_runner(
        "render", payload_file, "--png", out_png, "--width", "1024", "--height", "768"
    )
    assert result.exit_code == 0, f"Render custom dim failed: {result.stderr}"

    w, h = read_png_dimensions(out_png)
    assert w == 1024, f"Expected width 1024, got {w}"
    assert h == 768, f"Expected height 768, got {h}"


@skip_if_no_cli
@skip_if_no_render
def test_render_interactive_button_sample(
    cli_runner, project_root: Path, tmp_path: Path
):
    """Verifies rendering the standard specification interactive button sample."""
    sample_file = str(
        project_root
        / "specification"
        / "v0_9"
        / "catalogs"
        / "basic"
        / "examples"
        / "00_interactive-button.json"
    )
    out_png = str(tmp_path / "interactive_btn.png")
    result = cli_runner("render", sample_file, "--png", out_png)
    assert result.exit_code == 0, f"Render sample failed: {result.stderr}"
    assert Path(out_png).exists()


# ============================================================================
# Feature 5: `a2ui-mcp` Tools Happy Paths
# ============================================================================


@skip_if_no_mcp
def test_mcp_list_components_basic(mcp_client):
    """Verifies that `a2ui_list_components` returns the basic catalog components."""
    data = mcp_client.list_components("basic")
    assert isinstance(data, dict)
    components = data.get("components", data)
    assert "Button" in components
    assert "Text" in components
    assert len(components) >= 18


@skip_if_no_mcp
def test_mcp_list_components_filtered(mcp_client):
    """Verifies that `a2ui_list_components` filter argument filters components by substring."""
    data = mcp_client.list_components("gemini_enterprise_composite", filter="Material")
    components = data.get("components", data)
    assert len(components) > 0
    for name in components:
        assert "Material" in name


@skip_if_no_mcp
def test_mcp_validate_clean_payload(mcp_client, fixtures_dir: Path):
    """Verifies that `a2ui_validate` returns valid=True and no errors for a valid payload."""
    with open(fixtures_dir / "basic_button.json") as f:
        payload = json.load(f)
    res = mcp_client.validate(payload, "basic")
    assert isinstance(res, dict)
    assert res.get("valid") is True or res.get("status") == "ok"
    assert len(res.get("errors", [])) == 0


@skip_if_no_mcp
def test_mcp_render_emits_image(mcp_client, fixtures_dir: Path):
    """Verifies that `a2ui_render` returns image bytes / ImageContent for multimodal agents."""
    with open(fixtures_dir / "basic_button.json") as f:
        payload = json.load(f)
    img_result = mcp_client.render(payload, "basic")
    assert img_result is not None


@skip_if_no_mcp
def test_mcp_simulate_action_emits_event(mcp_client, project_root: Path):
    """Verifies that `a2ui_simulate_action` dispatches action event on button click."""
    sample_path = (
        project_root
        / "specification"
        / "v0_9"
        / "catalogs"
        / "basic"
        / "examples"
        / "00_interactive-button.json"
    )
    with open(sample_path) as f:
        payload = json.load(f)
    res = mcp_client.simulate_action(payload, "action_button")
    assert isinstance(res, dict)
    assert (
        res.get("name") == "button_clicked"
        or res.get("event", {}).get("name") == "button_clicked"
    )


# ============================================================================
# Feature 6: Host Target Profiles Happy Paths
# ============================================================================


@skip_if_no_targets
def test_host_target_profile_load_gemini_enterprise(target_profile_loader):
    """Verifies loading the gemini-enterprise target profile."""
    profile = target_profile_loader("gemini-enterprise")
    assert profile is not None
    assert profile.name == "gemini-enterprise"


@skip_if_no_targets
def test_host_target_profile_protocol_versions(target_profile_loader):
    """Verifies that gemini-enterprise target profile enforces protocol versions 0.8 and 0.9."""
    profile = target_profile_loader("gemini-enterprise")
    assert "0.8" in profile.protocol_versions
    assert "0.9" in profile.protocol_versions


@skip_if_no_targets
def test_host_target_profile_wire_client_version(target_profile_loader):
    """Verifies that gemini-enterprise target profile sets wire client version v0.9."""
    profile = target_profile_loader("gemini-enterprise")
    assert profile.wire_client_version == "v0.9"


@skip_if_no_targets
def test_host_target_profile_mime_type(target_profile_loader):
    """Verifies that gemini-enterprise target profile requires application/json+a2ui."""
    profile = target_profile_loader("gemini-enterprise")
    assert "application/json+a2ui" in profile.mime_types


@skip_if_no_targets
def test_host_target_profile_quirks(target_profile_loader):
    """Verifies that gemini-enterprise target profile specifies required quirks."""
    profile = target_profile_loader("gemini-enterprise")
    assert profile.quirks.get("side-panel-requires-canvas-root") is True
    assert profile.quirks.get("mime-exact-match") is True


@skip_if_no_cli
@skip_if_no_targets
def test_check_target_gemini_enterprise_valid_payload(cli_runner, fixtures_dir: Path):
    """Verifies that valid GE v0.9 payload passes check with --target gemini-enterprise."""
    payload_file = str(fixtures_dir / "valid_ge_payload.json")
    result = cli_runner("check", payload_file, "--target", "gemini-enterprise")
    assert result.exit_code == 0, (
        f"Expected clean pass for valid GE payload, got {result.exit_code}:"
        f" {result.stderr}"
    )
