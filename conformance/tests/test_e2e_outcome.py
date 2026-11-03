# Copyright 2026 Google LLC
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

from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import pytest
import yaml

CONFORMANCE_DIR = Path(__file__).resolve().parent.parent
if str(CONFORMANCE_DIR) not in sys.path:
    sys.path.insert(0, str(CONFORMANCE_DIR))

from scripts.compare_e2e_outcome import main as compare_main
from scripts.e2e_outcome import normalize_ids, outcome_of

CONFORMANCE_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture
def base_scenario() -> dict:
    scenario_path = CONFORMANCE_DIR / "e2e" / "newsletter_signup.yaml"
    data = yaml.safe_load(scenario_path.read_text(encoding="utf-8"))
    return copy.deepcopy(data[0])


def test_normalize_ids_ordinals_and_timestamp():
    ordinals: dict[str, dict[str, str]] = {}
    obj1 = {
        "timestamp": "2026-11-03T00:00:00Z",
        "surfaceId": "my-surface",
        "id": "btn-1",
        "nested": {"targetNode": "btn-1", "sourceComponentId": "btn-1"},
    }
    normalized = normalize_ids(obj1, ordinals)
    assert "timestamp" not in normalized
    assert normalized["surfaceId"] == "surfaceId_0"
    assert normalized["id"] == "id_0"
    assert normalized["nested"]["targetNode"] == "id_0"
    assert normalized["nested"]["sourceComponentId"] == "id_0"

    # Second surfaceId gets surfaceId_1
    obj2 = {"surfaceId": "another-surface"}
    assert normalize_ids(obj2, ordinals)["surfaceId"] == "surfaceId_1"


def test_same_outcome_different_model_ids_and_text_wording(base_scenario):
    golden_outcome = outcome_of(base_scenario)

    recorded_scenario = copy.deepcopy(base_scenario)
    # 1. Change text wording in conversational messages
    recorded_scenario["turns"][0]["userText"] = "Different user prompt entirely."
    recorded_scenario["turns"][0]["expectWire"][0][
        "text"
    ] = "Different assistant intro wording."
    recorded_scenario["turns"][1]["expectWire"][0]["text"] = "Different thank you text."

    # 2. Change model-chosen IDs
    def rename_ids(obj):
        if isinstance(obj, dict):
            res = {}
            for k, v in obj.items():
                if k == "surfaceId" and v == "newsletter-signup":
                    res[k] = "custom-surface-999"
                elif k == "id" and isinstance(v, str):
                    res[k] = "root" if v == "root" else f"custom-{v}"
                elif k == "child" and isinstance(v, str):
                    res[k] = "root" if v == "root" else f"custom-{v}"
                elif k == "children" and isinstance(v, list):
                    res[k] = [
                        f"custom-{x}" if isinstance(x, str) else rename_ids(x)
                        for x in v
                    ]
                elif k == "sourceComponentId":
                    res[k] = f"custom-{v}"
                elif k == "targetNode":
                    res[k] = f"custom-{v}"
                else:
                    res[k] = rename_ids(v)
            return res
        if isinstance(obj, list):
            return [rename_ids(x) for x in obj]
        return obj

    recorded_scenario = rename_ids(recorded_scenario)

    recorded_outcome = outcome_of(recorded_scenario)
    assert golden_outcome == recorded_outcome


def test_changed_outcome_missing_button(base_scenario):
    golden_outcome = outcome_of(base_scenario)

    modified = copy.deepcopy(base_scenario)
    # Remove the Button from components in turn 0
    t0_wire = modified["turns"][0]["expectWire"]
    comps = t0_wire[1]["a2ui"][0]["createSurface"]["components"]
    # Filter out subscribeBtn and subscribeText
    t0_wire[1]["a2ui"][0]["createSurface"]["components"] = [
        c for c in comps if c["id"] not in ("subscribeBtn", "subscribeText")
    ]
    # Remove subscribeBtn from Column children
    for c in t0_wire[1]["a2ui"][0]["createSurface"]["components"]:
        if c["id"] == "container":
            c["children"] = [x for x in c["children"] if x != "subscribeBtn"]

    modified_outcome = outcome_of(modified)
    assert golden_outcome != modified_outcome


def test_changed_outcome_changed_label(base_scenario):
    golden_outcome = outcome_of(base_scenario)

    modified = copy.deepcopy(base_scenario)
    # Change TextField label in turn 0
    t0_wire = modified["turns"][0]["expectWire"]
    for c in t0_wire[1]["a2ui"][0]["createSurface"]["components"]:
        if c["id"] == "emailInput":
            c["label"] = "Your Work Email Address"

    modified_outcome = outcome_of(modified)
    assert golden_outcome != modified_outcome


def test_changed_outcome_different_action_name(base_scenario):
    golden_outcome = outcome_of(base_scenario)

    modified = copy.deepcopy(base_scenario)
    # Change button action event name
    t0_wire = modified["turns"][0]["expectWire"]
    for c in t0_wire[1]["a2ui"][0]["createSurface"]["components"]:
        if c["id"] == "subscribeBtn":
            c["action"]["event"]["name"] = "register_for_newsletter"

    modified_outcome = outcome_of(modified)
    assert golden_outcome != modified_outcome


def test_changed_outcome_extra_outbound_envelope(base_scenario):
    golden_outcome = outcome_of(base_scenario)

    modified = copy.deepcopy(base_scenario)
    # Add an extra outbound envelope to turn 0
    modified["turns"][0]["expectOutbound"].append({
        "version": "1.0",
        "action": {
            "name": "secondary_action",
            "surfaceId": "newsletter-signup",
            "sourceComponentId": "subscribeBtn",
            "timestamp": "2026-11-03T00:00:00Z",
        },
    })

    modified_outcome = outcome_of(modified)
    assert golden_outcome != modified_outcome


def test_compare_cli_exit_codes_and_report(tmp_path, base_scenario):
    golden_file = tmp_path / "golden.yaml"
    golden_file.write_text(yaml.dump([base_scenario]), encoding="utf-8")

    # 1. Matching recorded file -> exit code 0
    recorded_file = tmp_path / "recorded_match.yaml"
    recorded_file.write_text(yaml.dump([base_scenario]), encoding="utf-8")
    report_file = tmp_path / "report_match.md"

    code_match = compare_main([
        "--golden",
        str(golden_file),
        "--recorded",
        str(recorded_file),
        "--report",
        str(report_file),
    ])
    assert code_match == 0
    assert "All scenario outcomes match." in report_file.read_text(encoding="utf-8")

    # 2. Differing recorded file -> exit code 1
    diff_scenario = copy.deepcopy(base_scenario)
    diff_scenario["turns"][0]["expectOutbound"].append({
        "version": "1.0",
        "action": {
            "name": "extra_outbound",
            "surfaceId": "newsletter-signup",
            "sourceComponentId": "subscribeBtn",
        },
    })
    recorded_diff = tmp_path / "recorded_diff.yaml"
    recorded_diff.write_text(yaml.dump([diff_scenario]), encoding="utf-8")
    report_diff = tmp_path / "report_diff.md"

    code_diff = compare_main([
        "--golden",
        str(golden_file),
        "--recorded",
        str(recorded_diff),
        "--report",
        str(report_diff),
    ])
    assert code_diff == 1
    assert "Outcome Mismatch" in report_diff.read_text(encoding="utf-8")

    # 3. Input error: non-existent file -> exit code 2
    code_err = compare_main([
        "--golden",
        str(tmp_path / "non_existent.yaml"),
        "--recorded",
        str(recorded_file),
    ])
    assert code_err == 2

    # 4. Input error: missing required flag -> exit code 2
    code_bad_args = compare_main(["--golden", str(golden_file)])
    assert code_bad_args == 2
