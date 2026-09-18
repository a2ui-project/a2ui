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

"""Tier 4 E2E Tests: Real-World Application Scenarios.

Exercises end-to-end, realistic multi-step developer and runtime workflows:
1. Validating and rendering `canvas_side_panel.json` from Gemini Enterprise samples
2. Validating and rendering `material_card_flight_status.json` rich card
3. Simulating interactive button click on `00_interactive-button.json` and verifying action event
4. Full CLI developer toolchain workflow: describe -> check -> diff -> upgrade -> render
5. Multi-message streaming lifecycle: createSurface -> updateComponents -> updateDataModel settling
6. Gemini Enterprise interactive booking form validation and snapshot rendering
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
@skip_if_no_targets
@skip_if_no_render
def test_scenario_canvas_side_panel_validation_and_render(
    cli_runner, ge_samples_dir: Path, tmp_path: Path
):
    """Scenario 1: Validating and rendering Gemini Enterprise `canvas_side_panel.json`."""
    sample_file = str(ge_samples_dir / "canvas_side_panel.json")
    out_png = str(tmp_path / "canvas_side_panel.png")

    # Step 1: Validate payload against Gemini Enterprise profile
    check_res = cli_runner("check", sample_file, "--target", "gemini-enterprise")
    assert (
        check_res.exit_code == 0
    ), f"Target check failed for canvas_side_panel.json: {check_res.stderr}"

    # Step 2: Render payload to PNG
    render_res = cli_runner("render", sample_file, "--png", out_png)
    assert (
        render_res.exit_code == 0
    ), f"Render failed for canvas_side_panel.json: {render_res.stderr}"

    # Step 3: Verify output fidelity
    out_path = Path(out_png)
    assert out_path.exists()
    assert out_path.stat().st_size > 0
    w, h = read_png_dimensions(out_path)
    assert w > 0 and h > 0


@skip_if_no_cli
@skip_if_no_render
def test_scenario_material_card_flight_status_validation_and_render(
    cli_runner, ge_samples_dir: Path, tmp_path: Path
):
    """Scenario 2: Validating and rendering rich Material flight status card."""
    sample_file = str(ge_samples_dir / "material_card_flight_status.json")
    out_png = str(tmp_path / "flight_status.png")

    # Step 1: Validate payload
    check_res = cli_runner("check", sample_file, "--target", "gemini-enterprise")
    assert (
        check_res.exit_code == 0
    ), f"Check failed for flight status: {check_res.stderr}"

    # Step 2: Render to PNG
    render_res = cli_runner("render", sample_file, "--png", out_png)
    assert (
        render_res.exit_code == 0
    ), f"Render failed for flight status: {render_res.stderr}"

    # Step 3: Verify PNG dimensions
    out_path = Path(out_png)
    assert out_path.exists()
    assert out_path.stat().st_size > 0
    w, h = read_png_dimensions(out_path)
    assert w > 0 and h > 0


@skip_if_no_mcp
def test_scenario_interactive_button_click_simulation(mcp_client, project_root: Path):
    """Scenario 3: Simulating interactive button click on 00_interactive-button.json."""
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

    # Simulate button click action
    action_event = mcp_client.simulate_action(payload, "action_button")
    assert isinstance(action_event, dict)

    # Verify structured event details
    event_name = action_event.get("name") or action_event.get("event", {}).get("name")
    assert (
        event_name == "button_clicked"
    ), f"Expected action name 'button_clicked', got: {action_event}"

    source_id = action_event.get("sourceComponentId") or action_event.get(
        "source_component_id"
    )
    assert (
        source_id == "action_button"
    ), f"Expected sourceComponentId 'action_button', got: {action_event}"


@skip_if_no_cli
@skip_if_no_render
def test_scenario_full_cli_developer_workflow(cli_runner, tmp_path: Path):
    """Scenario 4: Full CLI workflow: describe -> check -> diff -> upgrade -> render."""
    # Step 1: Describe basic catalog
    desc_res = cli_runner("catalog", "describe", "basic", "--json")
    assert desc_res.exit_code == 0
    basic_cat = desc_res.json()
    assert "Button" in basic_cat.get("components", basic_cat)

    # Step 2: Author basic payload and check
    basic_payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "wf-s1",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "wf-s1",
                "components": [
                    {"id": "root", "component": "Column", "children": ["btn"]},
                    {
                        "id": "btn",
                        "component": "Button",
                        "child": "lbl",
                        "action": {"event": {"name": "btn_click"}},
                    },
                    {"id": "lbl", "component": "Text", "text": "Basic Button"},
                ],
            },
        },
    ]
    basic_file = tmp_path / "wf_basic.json"
    basic_file.write_text(json.dumps(basic_payload))

    check_basic = cli_runner("check", str(basic_file))
    assert check_basic.exit_code == 0

    # Step 3: Diff catalogs to find Enterprise upgrades
    diff_res = cli_runner(
        "catalog", "diff", "basic", "gemini_enterprise_composite", "--json"
    )
    assert diff_res.exit_code == 0
    added = diff_res.json().get("added", diff_res.json().get("added_components", []))
    assert len(added) == 34

    # Step 4: Upgrade payload with Material Card and Button
    upgraded_payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "wf-s2",
                "catalogId": (
                    "https://www.gstatic.com/vertexaisearch/a2ui/v0_9/gemini_enterprise_composite_catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "wf-s2",
                "components": [
                    {"id": "root", "component": "MaterialCard", "children": ["col"]},
                    {
                        "id": "col",
                        "component": "MaterialColumn",
                        "children": ["txt", "btn"],
                    },
                    {
                        "id": "txt",
                        "component": "MaterialText",
                        "text": "Upgraded Material Card",
                    },
                    {
                        "id": "btn",
                        "component": "MaterialButton",
                        "label": "Enterprise Submit",
                    },
                ],
            },
        },
    ]
    upgraded_file = tmp_path / "wf_upgraded.json"
    upgraded_file.write_text(json.dumps(upgraded_payload))

    check_upgraded = cli_runner(
        "check", str(upgraded_file), "--target", "gemini-enterprise"
    )
    assert check_upgraded.exit_code == 0

    # Step 5: Render final snapshot
    out_png = str(tmp_path / "wf_snapshot.png")
    render_res = cli_runner("render", str(upgraded_file), "--png", out_png)
    assert render_res.exit_code == 0
    assert Path(out_png).exists()


@skip_if_no_cli
@skip_if_no_render
def test_scenario_multi_message_lifecycle_settling(
    cli_runner, ge_samples_dir: Path, tmp_path: Path
):
    """Scenario 5: Multi-message streaming lifecycle: createSurface -> updateComponents -> updateDataModel."""
    sample_file = str(ge_samples_dir / "canvas_side_panel.json")
    out_png = str(tmp_path / "lifecycle_settled.png")

    # Render multi-message payload with data model bindings
    render_res = cli_runner("render", sample_file, "--png", out_png)
    assert render_res.exit_code == 0

    out_path = Path(out_png)
    assert out_path.exists()
    assert out_path.stat().st_size > 0


@skip_if_no_cli
@skip_if_no_targets
@skip_if_no_render
def test_scenario_gemini_enterprise_booking_form(
    cli_runner, ge_samples_dir: Path, tmp_path: Path
):
    """Scenario 6: Validating and rendering the Gemini Enterprise booking form."""
    sample_file = str(ge_samples_dir / "booking_form.json")
    out_png = str(tmp_path / "booking_form.png")

    # Step 1: Validate against target profile
    check_res = cli_runner("check", sample_file, "--target", "gemini-enterprise")
    assert check_res.exit_code == 0

    # Step 2: Render snapshot
    render_res = cli_runner("render", sample_file, "--png", out_png)
    assert render_res.exit_code == 0
    assert Path(out_png).exists()
