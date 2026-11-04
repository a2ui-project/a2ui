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

from __future__ import annotations

import json
from pathlib import Path
import sys

import pytest
import yaml

CONFORMANCE_DIR = Path(__file__).resolve().parent.parent
if str(CONFORMANCE_DIR) not in sys.path:
    sys.path.insert(0, str(CONFORMANCE_DIR))

from scripts.compare_e2e_outcome import main as compare_main  # noqa: E402
from scripts.e2e_outcome import outcome_of  # noqa: E402
from scripts.import_recording import (  # noqa: E402
    RecordingError,
    import_chunk_recording,
    import_wire_recording,
    main as import_main,
)

REPO_ROOT = CONFORMANCE_DIR.parent
GOLDEN_PATH = CONFORMANCE_DIR / "e2e" / "newsletter_signup.yaml"
RECORDING_PATH = (
    REPO_ROOT
    / "dart"
    / "a2ui_flutter"
    / "example"
    / "test"
    / "fixtures"
    / "newsletter_replies.json"
)


@pytest.fixture
def golden() -> dict:
    return yaml.safe_load(GOLDEN_PATH.read_text(encoding="utf-8"))[0]


@pytest.fixture
def recording_with_action(golden: dict, tmp_path: Path) -> Path:
    """The seed recording, with the action turn the renderer sent after the
    typed email, which the fixture predates, and the metadata the recording
    client writes."""
    recording = json.loads(RECORDING_PATH.read_text(encoding="utf-8"))
    action = json.loads(json.dumps(golden["turns"][0]["expectOutbound"][0]))
    action["action"]["timestamp"] = "2026-01-01T00:00:00Z"
    action_turn = json.dumps({
        "a2ui": {"messages": [action]},
        "metadata": {"a2uiRendererDataModel": {"version": "1.0", "surfaces": {}}},
    })
    recording["requests"] = [recording["request"], action_turn]
    recording["format"] = "direct_json"
    recording["protocolVersion"] = "1.0"
    recording["model"] = "test-model"
    path = tmp_path / "newsletter_signup.json"
    path.write_text(json.dumps(recording), encoding="utf-8")
    return path


def test_seed_recording_renders_the_golden_surfaces(golden: dict):
    """The newsletter seed was written from this recording, so importing the
    recording must render the seed's surfaces. The fixture holds the model's
    replies only, so it carries no outbound messages."""
    scenario = import_chunk_recording(RECORDING_PATH, name=golden["name"])

    assert scenario["name"] == golden["name"]
    assert scenario["protocolVersion"] == "1.0"
    assert scenario["catalogPaths"] == golden["catalogPaths"]
    assert scenario["formats"] == ["direct_json"]
    assert scenario["source"]["kind"] == "recorded"
    assert len(scenario["turns"]) == len(golden["turns"])
    assert scenario["turns"][0]["userText"] == golden["turns"][0]["userText"]
    assert scenario["turns"][1]["userText"] is None

    recorded_outcome = outcome_of(scenario)
    golden_outcome = outcome_of(golden)
    assert [turn["surfaces"] for turn in recorded_outcome] == [
        turn["surfaces"] for turn in golden_outcome
    ]
    assert all(turn["outbound"] == [] for turn in recorded_outcome)


def test_recording_with_action_turn_has_the_golden_outcome(
    golden: dict, recording_with_action: Path
):
    scenario = import_chunk_recording(recording_with_action, name=golden["name"])

    assert scenario["source"]["model"] == "test-model"
    assert scenario["turns"][1]["userText"] is None
    assert (
        scenario["turns"][0]["expectOutbound"] == golden["turns"][0]["expectOutbound"]
    )
    assert outcome_of(scenario) == outcome_of(golden)


def test_chunk_recording_splits_data_model_metadata_from_typed_text(
    tmp_path: Path,
):
    recording = json.loads(RECORDING_PATH.read_text(encoding="utf-8"))
    typed_turn = "Make it blue.\n\n" + json.dumps(
        {"metadata": {"a2uiRendererDataModel": {"version": "1.0"}}}
    )
    recording["requests"] = [recording["request"], typed_turn]
    path = tmp_path / "typed.json"
    path.write_text(json.dumps(recording), encoding="utf-8")

    scenario = import_chunk_recording(path)

    assert scenario["turns"][1]["userText"] == "Make it blue."
    assert "expectOutbound" not in scenario["turns"][0]


def test_wire_recording_has_the_golden_outcome(golden: dict, tmp_path: Path):
    wire = {
        "turns": [
            {
                "userText": turn["userText"],
                "messages": [
                    message
                    for part in turn["expectWire"]
                    if "a2ui" in part
                    for message in part["a2ui"]
                ],
            }
            for turn in golden["turns"]
        ]
    }
    path = tmp_path / "newsletter_signup.wire.json"
    path.write_text(json.dumps(wire), encoding="utf-8")

    scenario = import_wire_recording(path, name=golden["name"])

    assert scenario["protocolVersion"] == "1.0"
    assert scenario["formats"] == []
    assert [turn["expectWire"] for turn in scenario["turns"]] == [
        [part for part in turn["expectWire"] if "a2ui" in part]
        for turn in golden["turns"]
    ]
    golden_surfaces = [turn["surfaces"] for turn in outcome_of(golden)]
    assert [turn["surfaces"] for turn in outcome_of(scenario)] == golden_surfaces


def test_empty_recordings_are_rejected(tmp_path: Path):
    chunks = tmp_path / "empty.json"
    chunks.write_text(json.dumps({"request": "Hi", "replies": []}), encoding="utf-8")
    with pytest.raises(RecordingError):
        import_chunk_recording(chunks)

    wire = tmp_path / "empty.wire.json"
    wire.write_text(json.dumps({"turns": []}), encoding="utf-8")
    with pytest.raises(RecordingError):
        import_wire_recording(wire)


def test_cli_output_feeds_the_outcome_comparer(
    golden: dict, recording_with_action: Path, tmp_path: Path
):
    output = tmp_path / "newsletter_signup.yaml"
    assert (
        import_main([
            "--input",
            str(recording_with_action),
            "--output",
            str(output),
            "--name",
            golden["name"],
        ])
        == 0
    )
    written = yaml.safe_load(output.read_text(encoding="utf-8"))
    assert written[0]["name"] == golden["name"]

    report = tmp_path / "report.md"
    assert (
        compare_main([
            "--golden",
            str(GOLDEN_PATH),
            "--recorded",
            str(output),
            "--report",
            str(report),
        ])
        == 0
    )
    assert "All scenario outcomes match." in report.read_text(encoding="utf-8")


def test_cli_reports_an_unreadable_recording(tmp_path: Path):
    output = tmp_path / "out.yaml"
    assert (
        import_main(
            ["--input", str(tmp_path / "missing.json"), "--output", str(output)]
        )
        == 1
    )
    assert not output.exists()
