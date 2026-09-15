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

"""Tests for `a2ui catalog describe` and `a2ui catalog diff` commands."""

import json
import pytest

from a2ui.cli.catalog import (
    describe_catalog,
    diff_catalogs,
    extract_component_required_fields,
    resolve_catalog,
)


def test_resolve_catalog_basic():
    name, schema, a2ui_cat, core_cat = resolve_catalog("basic")
    assert name == "basic"
    assert "components" in schema
    assert len(schema["components"]) == 18
    assert len(core_cat.components) == 18


def test_resolve_catalog_gemini_enterprise():
    name, schema, a2ui_cat, core_cat = resolve_catalog("gemini_enterprise_composite")
    assert name == "gemini_enterprise_composite"
    assert len(schema["components"]) == 52
    assert len(core_cat.components) == 52
    assert "Canvas" in core_cat.components
    assert "MaterialButton" in core_cat.components
    assert "VegaChart" in core_cat.components


def test_extract_component_required_fields_recursive():
    _, schema, _, _ = resolve_catalog("basic")
    reqs = extract_component_required_fields(schema)

    assert "Button" in reqs
    assert reqs["Button"] == {"action", "child"}
    assert reqs["Text"] == {"text"}
    assert reqs["Image"] == {"url"}
    assert reqs["Column"] == {"children"}
    assert reqs["Row"] == {"children"}
    assert reqs["Modal"] == {"content", "trigger"}


def test_catalog_describe_basic(capsys):
    code = describe_catalog("basic")
    captured = capsys.readouterr()

    assert code == 0
    assert "Catalog: basic" in captured.out
    assert "Button" in captured.out
    assert "action, child" in captured.out
    assert "Reference Topology" in captured.out
    assert "Described 18 components with 7 referencing containers." in captured.out


def test_catalog_describe_basic_json(capsys):
    code = describe_catalog("basic", as_json=True)
    captured = capsys.readouterr()

    assert code == 0
    data = json.loads(captured.out)
    assert data["name"] == "basic"
    assert data["component_count"] == 18
    assert "Button" in data["components"]
    assert data["components"]["Button"]["required_fields"] == ["action", "child"]
    assert "child" in data["components"]["Button"]["references"]["single"]

    topology = data["reference_topology"]
    assert topology["components_with_refs"] == 7
    assert "Tabs" in topology["references"]
    assert topology["references"]["Tabs"]["nested"]["tabs"] == ["child"]


def test_catalog_describe_gemini_enterprise_json(capsys):
    code = describe_catalog("gemini_enterprise_composite", as_json=True)
    captured = capsys.readouterr()

    assert code == 0
    data = json.loads(captured.out)
    assert data["component_count"] == 52
    assert "Canvas" in data["components"]
    assert "VegaChart" in data["components"]
    assert "children" in data["components"]["Canvas"]["references"]["list"]
    assert data["reference_topology"]["components_with_refs"] == 16


def test_catalog_diff_basic_to_gemini_enterprise_reports_34_added(capsys):
    code = diff_catalogs("basic", "gemini_enterprise_composite")
    captured = capsys.readouterr()

    assert code == 0
    assert "34 added, 0 removed" in captured.out
    assert "Canvas" in captured.out
    assert "MaterialButton" in captured.out
    assert "VegaChart" in captured.out


def test_catalog_diff_basic_to_gemini_enterprise_json(capsys):
    code = diff_catalogs("basic", "gemini_enterprise_composite", as_json=True)
    captured = capsys.readouterr()

    assert code == 0
    data = json.loads(captured.out)
    assert data["summary"]["added_count"] == 34
    assert data["summary"]["removed_count"] == 0
    assert len(data["added_components"]) == 34
    assert "Canvas" in data["added_components"]
    assert "MaterialButton" in data["added_components"]
    assert "VegaChart" in data["added_components"]
    assert data["removed_components"] == []


def test_catalog_diff_identical_catalogs(capsys):
    code = diff_catalogs("basic", "basic")
    captured = capsys.readouterr()

    assert code == 0
    assert "Catalogs are identical" in captured.out


def test_catalog_diff_identical_json(capsys):
    code = diff_catalogs("basic", "basic", as_json=True)
    captured = capsys.readouterr()

    assert code == 0
    data = json.loads(captured.out)
    assert data["summary"]["added_count"] == 0
    assert data["summary"]["removed_count"] == 0
    assert data["summary"]["modified_count"] == 0


def test_resolve_invalid_catalog_id_raises_error():
    with pytest.raises(ValueError, match="Could not resolve catalog"):
        resolve_catalog("nonexistent_catalog_id")
