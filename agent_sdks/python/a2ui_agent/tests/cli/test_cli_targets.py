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

"""Tests for Host Target Profiles and `a2ui check --target` enforcement."""

import json
import os
import pytest

from a2ui.cli.check import check_payload
from a2ui.targets import HostTargetProfile, TargetProfileError


def test_load_gemini_enterprise_profile():
    profile = HostTargetProfile.load("gemini-enterprise")
    assert profile.name == "gemini-enterprise"
    assert profile.protocol_versions == ["0.8", "0.9"]
    assert profile.wire_client_version == "v0.9"
    assert profile.mime_types == ["application/json+a2ui"]
    assert profile.catalog == "gemini_enterprise_composite"
    assert profile.quirks.get("side-panel-requires-canvas-root") is True
    assert profile.quirks.get("mime-exact-match") is True


def test_list_available_profiles():
    profiles = HostTargetProfile.list_available_profiles()
    assert "gemini-enterprise" in profiles


def test_load_nonexistent_profile_raises_error():
    with pytest.raises(TargetProfileError, match="not found"):
        HostTargetProfile.load("nonexistent-host-profile-xyz")


def test_target_check_valid_ge_canvas_side_panel(capsys):
    ge_file = "samples/community/agent/adk/gemini_enterprise/v0_9/examples/0.9/canvas_side_panel.json"
    if not os.path.isfile(ge_file):
        pytest.skip(f"GE sample file {ge_file} not found")

    code = check_payload(ge_file, target="gemini-enterprise")
    captured = capsys.readouterr()

    assert code == 0
    assert "is valid" in captured.out


def test_target_check_valid_ge_booking_form(capsys):
    ge_file = "samples/community/agent/adk/gemini_enterprise/v0_9/examples/0.9/booking_form.json"
    if not os.path.isfile(ge_file):
        pytest.skip(f"GE sample file {ge_file} not found")

    code = check_payload(ge_file, target="gemini-enterprise")
    captured = capsys.readouterr()

    assert code == 0
    assert "is valid" in captured.out


def test_target_check_rejects_incompatible_version_0_9_1(tmp_path, capsys):
    bad_payload = [{
        "version": "0.9.1",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": (
                "https://www.gstatic.com/vertexaisearch/a2ui/v0_9/gemini_enterprise_composite_catalog.json"
            ),
        },
    }]
    f = tmp_path / "bad_ver.json"
    f.write_text(json.dumps(bad_payload))

    code = check_payload(str(f), target="gemini-enterprise")
    captured = capsys.readouterr()

    assert code == 1
    assert "Incompatible protocol version '0.9.1'" in captured.out


def test_target_check_rejects_incompatible_version_1_0(tmp_path, capsys):
    bad_payload = [{
        "version": "1.0",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": (
                "https://www.gstatic.com/vertexaisearch/a2ui/v0_9/gemini_enterprise_composite_catalog.json"
            ),
        },
    }]
    f = tmp_path / "bad_ver10.json"
    f.write_text(json.dumps(bad_payload))

    code = check_payload(str(f), target="gemini-enterprise")
    captured = capsys.readouterr()

    assert code == 1
    assert "Incompatible protocol version '1.0'" in captured.out


def test_target_check_rejects_standard_mime_type(tmp_path, capsys):
    bad_mime_payload = {
        "mimeType": "application/a2ui+json",
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": (
                "https://www.gstatic.com/vertexaisearch/a2ui/v0_9/gemini_enterprise_composite_catalog.json"
            ),
        },
    }
    f = tmp_path / "bad_mime.json"
    f.write_text(json.dumps(bad_mime_payload))

    code = check_payload(str(f), target="gemini-enterprise")
    captured = capsys.readouterr()

    assert code == 1
    assert "Incompatible MIME type 'application/a2ui+json'" in captured.out
    assert "application/json+a2ui" in captured.out


def test_target_check_quirk_side_panel_without_canvas_root(tmp_path, capsys):
    bad_side_panel = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "side-panel-demo",
            "components": [
                {
                    "id": "root",
                    "component": "MaterialCard",
                    "children": ["btn1"],
                },
                {
                    "id": "btn1",
                    "component": "MaterialButton",
                    "text": "Submit",
                },
            ],
        },
    }]
    f = tmp_path / "bad_side_panel.json"
    f.write_text(json.dumps(bad_side_panel))

    code = check_payload(str(f), target="gemini-enterprise")
    captured = capsys.readouterr()

    assert code == 1
    assert "Quirk 'side-panel-requires-canvas-root' violated" in captured.out


def test_target_check_quirk_canvas_nested_as_child(tmp_path, capsys):
    bad_nested_canvas = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "main-surface",
            "components": [
                {
                    "id": "root",
                    "component": "MaterialColumn",
                    "children": ["c1"],
                },
                {
                    "id": "c1",
                    "component": "Canvas",
                    "children": [],
                },
            ],
        },
    }]
    f = tmp_path / "bad_nested.json"
    f.write_text(json.dumps(bad_nested_canvas))

    code = check_payload(str(f), target="gemini-enterprise")
    captured = capsys.readouterr()

    assert code == 1
    assert "Quirk 'side-panel-requires-canvas-root' violated" in captured.out
    assert "Canvas" in captured.out
