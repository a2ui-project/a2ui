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

"""Tier 3 E2E Tests: Cross-Feature Combinations.

Validates multi-feature integration workflows:
1. `a2ui catalog diff` output piped/checked -> `a2ui check` with added component
2. `a2ui check --target gemini-enterprise` -> `a2ui render --png` of valid GE payload
3. `a2ui-mcp` validate -> simulate_action -> render full perception-action flow
4. Target profile validation gatekeeper: invalid payload fails check, preventing deployment
5. `a2ui catalog describe` introspection -> dynamic payload synthesis -> `a2ui check` clean pass
6. Tool parity: `a2ui-mcp` list components vs `a2ui catalog describe` inventory consistency
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


@skip_if_no_cli
def test_diff_discovered_component_used_in_payload_and_checked(
    cli_runner, tmp_path: Path
):
    """Verifies that components discovered via catalog diff can be used in a payload and pass check."""
    # Step 1: Run catalog diff to discover enterprise extensions
    diff_res = cli_runner(
        "catalog", "diff", "basic", "gemini_enterprise_composite", "--json"
    )
    assert diff_res.exit_code == 0
    diff_data = diff_res.json()
    added = diff_data.get("added", diff_data.get("added_components", []))
    added_names = [c if isinstance(c, str) else c.get("name") for c in added]
    assert "MaterialButton" in added_names

    # Step 2: Construct a payload using the discovered enterprise component
    payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "diff-test-surface",
                "catalogId": (
                    "https://www.gstatic.com/vertexaisearch/a2ui/v0_9/gemini_enterprise_composite_catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "diff-test-surface",
                "components": [{
                    "id": "root",
                    "component": "MaterialButton",
                    "label": "Discovered Enterprise Component",
                }],
            },
        },
    ]
    payload_file = tmp_path / "discovered_comp_payload.json"
    payload_file.write_text(json.dumps(payload))

    # Step 3: Verify the payload passes a2ui check
    check_res = cli_runner("check", str(payload_file))
    assert (
        check_res.exit_code == 0
    ), f"Expected discovered component payload to pass check: {check_res.stderr}"


@skip_if_no_cli
@skip_if_no_targets
@skip_if_no_render
def test_check_target_gemini_enterprise_then_render_png(
    cli_runner, fixtures_dir: Path, tmp_path: Path
):
    """Verifies workflow: a2ui check --target gemini-enterprise passes -> a2ui render outputs PNG."""
    payload_file = str(fixtures_dir / "valid_ge_payload.json")
    out_png = str(tmp_path / "ge_rendered.png")

    # Step 1: Validate payload against Gemini Enterprise target profile
    check_res = cli_runner("check", payload_file, "--target", "gemini-enterprise")
    assert check_res.exit_code == 0, f"Target check failed: {check_res.stderr}"

    # Step 2: Render validated payload to PNG
    render_res = cli_runner("render", payload_file, "--png", out_png)
    assert render_res.exit_code == 0, f"Render failed: {render_res.stderr}"

    out_path = Path(out_png)
    assert out_path.exists()
    assert out_path.stat().st_size > 0
    w, h = read_png_dimensions(out_path)
    assert w > 0 and h > 0


@skip_if_no_mcp
def test_mcp_validate_simulate_action_render_pipeline(mcp_client, project_root: Path):
    """Verifies complete MCP perception-action loop: validate -> simulate_action -> render."""
    sample_file = (
        project_root
        / "specification"
        / "v0_9"
        / "catalogs"
        / "basic"
        / "examples"
        / "00_interactive-button.json"
    )
    with open(sample_file) as f:
        payload = json.load(f)

    # Step 1: Perception/Validation
    val_res = mcp_client.validate(payload, "basic")
    assert val_res.get("valid") is True or val_res.get("status") == "ok"

    # Step 2: Action simulation
    action_res = mcp_client.simulate_action(payload, "action_button")
    assert action_res is not None
    assert (
        action_res.get("name") == "button_clicked"
        or action_res.get("event", {}).get("name") == "button_clicked"
    )

    # Step 3: Render visual output
    render_res = mcp_client.render(payload, "basic")
    assert render_res is not None


@skip_if_no_cli
@skip_if_no_targets
def test_target_profile_gatekeeper_blocks_render_on_incompatible_payload(
    cli_runner, fixtures_dir: Path
):
    """Verifies gatekeeping contract: target check failure prevents invalid payload progression."""
    bad_payload_file = str(fixtures_dir / "incompatible_version_091.json")

    # Step 1: Check against target
    check_res = cli_runner("check", bad_payload_file, "--target", "gemini-enterprise")
    assert (
        check_res.exit_code == 1
    ), "Expected target profile to reject incompatible payload"


@skip_if_no_cli
def test_catalog_describe_to_payload_synthesis_and_check(cli_runner, tmp_path: Path):
    """Introspects catalog describe to discover valid properties, authors payload, and validates."""
    desc_res = cli_runner("catalog", "describe", "basic", "--json")
    assert desc_res.exit_code == 0
    cat_meta = desc_res.json()
    comps = cat_meta.get("components", cat_meta)
    assert "Text" in comps

    # Dynamically build a valid payload using introspected component
    payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "synth-surface",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "synth-surface",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": (
                        "Dynamically synthesized text from catalog describe"
                        " introspection"
                    ),
                }],
            },
        },
    ]
    f = tmp_path / "synthesized_payload.json"
    f.write_text(json.dumps(payload))

    check_res = cli_runner("check", str(f))
    assert check_res.exit_code == 0


@skip_if_no_cli
@skip_if_no_mcp
def test_mcp_catalog_parity_with_cli_describe(cli_runner, mcp_client):
    """Verifies that MCP component listing is consistent with CLI catalog describe output."""
    cli_res = cli_runner("catalog", "describe", "basic", "--json")
    assert cli_res.exit_code == 0
    cli_comps = set(cli_res.json().get("components", cli_res.json()).keys())

    mcp_res = mcp_client.list_components("basic")
    mcp_comps = set(mcp_res.get("components", mcp_res).keys())

    assert cli_comps == mcp_comps, (
        "Parity mismatch between CLI describe and MCP list_components:"
        f" {cli_comps ^ mcp_comps}"
    )
