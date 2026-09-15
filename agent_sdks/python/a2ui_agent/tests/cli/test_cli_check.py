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

"""Tests for `a2ui check` command and difflib suggestions."""

import json
from unittest.mock import patch
import pytest

from a2ui.cli.check import check_payload


@pytest.fixture
def valid_basic_payload():
    return [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "main",
                "components": [
                    {
                        "id": "root",
                        "component": "Column",
                        "children": ["btn1", "txt1"],
                    },
                    {
                        "id": "btn1",
                        "component": "Button",
                        "child": "txt2",
                        "action": {"event": {"name": "click"}},
                    },
                    {
                        "id": "txt1",
                        "component": "Text",
                        "text": "Hello World",
                    },
                    {
                        "id": "txt2",
                        "component": "Text",
                        "text": "Click me",
                    },
                ],
            },
        },
    ]


def test_check_valid_basic_payload_exits_zero(tmp_path, valid_basic_payload, capsys):
    payload_file = tmp_path / "valid.json"
    payload_file.write_text(json.dumps(valid_basic_payload))

    code = check_payload(str(payload_file))
    captured = capsys.readouterr()

    assert code == 0
    assert "is valid" in captured.out


def test_check_valid_payload_json_output(tmp_path, valid_basic_payload, capsys):
    payload_file = tmp_path / "valid.json"
    payload_file.write_text(json.dumps(valid_basic_payload))

    code = check_payload(str(payload_file), as_json=True)
    captured = capsys.readouterr()

    assert code == 0
    data = json.loads(captured.out)
    assert data["valid"] is True
    assert data["status"] == "ok"
    assert data["error_count"] == 0
    assert data["errors"] == []


def test_check_unknown_component_suggests_did_you_mean(tmp_path, capsys):
    payload = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "main",
            "components": [{
                "id": "b1",
                "component": "Bttn",
                "child": "t1",
            }],
        },
    }]
    payload_file = tmp_path / "unknown_comp.json"
    payload_file.write_text(json.dumps(payload))

    code = check_payload(str(payload_file))
    captured = capsys.readouterr()

    assert code == 1
    assert "Unknown component type 'Bttn'" in captured.out
    assert "Did you mean 'Button'?" in captured.out


def test_check_unknown_component_json_output(tmp_path, capsys):
    payload = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "main",
            "components": [{
                "id": "txt_test",
                "component": "Txt",
                "text": "Test",
            }],
        },
    }]
    payload_file = tmp_path / "unknown_comp.json"
    payload_file.write_text(json.dumps(payload))

    code = check_payload(str(payload_file), as_json=True)
    captured = capsys.readouterr()

    assert code == 1
    data = json.loads(captured.out)
    assert data["valid"] is False
    assert data["error_count"] >= 1
    comp_err = next(e for e in data["errors"] if e["type"] == "unknown_component")
    assert comp_err["component"] == "Txt"
    assert comp_err["suggestion"] in ("Text", "TextField")


def test_check_invalid_property_suggests_did_you_mean(tmp_path, capsys):
    payload = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "main",
            "components": [{
                "id": "btn1",
                "component": "Button",
                "chld": "t1",
                "action": {"event": {"name": "click"}},
            }],
        },
    }]
    payload_file = tmp_path / "bad_prop.json"
    payload_file.write_text(json.dumps(payload))

    code = check_payload(str(payload_file))
    captured = capsys.readouterr()

    assert code == 1
    assert "Invalid property 'chld' on component 'Button'" in captured.out
    assert "Did you mean 'child'?" in captured.out


def test_check_invalid_property_json_output(tmp_path, capsys):
    payload = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "main",
            "components": [{
                "id": "btn1",
                "component": "Button",
                "actn": {"name": "click"},
                "child": "t1",
            }],
        },
    }]
    payload_file = tmp_path / "bad_prop.json"
    payload_file.write_text(json.dumps(payload))

    code = check_payload(str(payload_file), as_json=True)
    captured = capsys.readouterr()

    assert code == 1
    data = json.loads(captured.out)
    assert data["valid"] is False
    prop_err = next(e for e in data["errors"] if e["type"] == "invalid_property")
    assert prop_err["property"] == "actn"
    assert prop_err["suggestion"] == "action"


def test_check_missing_file_returns_error(capsys):
    code = check_payload("/nonexistent/file/path.json")
    captured = capsys.readouterr()

    assert code == 1
    assert "File not found" in captured.out


def test_check_missing_file_json_output(capsys):
    code = check_payload("/nonexistent/file/path.json", as_json=True)
    captured = capsys.readouterr()

    assert code == 1
    data = json.loads(captured.out)
    assert data["valid"] is False
    assert data["errors"][0]["type"] == "file_not_found"


def test_check_malformed_json_returns_error(tmp_path, capsys):
    bad_json = tmp_path / "bad.json"
    bad_json.write_text("{ unquoted_key: 123 ")

    code = check_payload(str(bad_json))
    captured = capsys.readouterr()

    assert code == 1
    assert "Invalid JSON syntax" in captured.out


def test_check_stdin_input(capsys):
    valid_payload = [{
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": (
                "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
            ),
        },
    }]
    with patch("sys.stdin.read", return_value=json.dumps(valid_payload)):
        code = check_payload("-")
        captured = capsys.readouterr()

        assert code == 0
        assert "is valid" in captured.out
