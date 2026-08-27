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

"""Unit tests for CatalogAnalyzer."""

from pathlib import Path
import pytest
from a2ui.codegen.analyzer import CatalogAnalyzer
from a2ui.codegen.types import (
    ActionType,
    CheckRuleType,
    ComponentListType,
    ComponentRefType,
    DynamicType,
    EnumType,
    ListType,
    PrimitiveKind,
    PrimitiveType,
)


def test_analyze_minimal_catalog():
    catalog_schema = {
        "catalogId": "test-catalog",
        "components": {
            "Label": {
                "type": "object",
                "properties": {
                    "component": {"const": "Label"},
                    "title": {"type": "string", "description": "Label title."},
                    "level": {"type": "string", "enum": ["info", "warning", "error"]},
                },
                "required": ["component", "title"],
            }
        },
        "functions": {},
    }

    catalog = CatalogAnalyzer.from_dict(catalog_schema)
    assert "Label" in catalog.components
    label = catalog.components["Label"]
    assert label.name == "Label"
    assert "title" in label.properties
    assert label.properties["title"].required is True
    assert isinstance(label.properties["title"].type_desc, PrimitiveType)
    assert label.properties["title"].type_desc.kind == PrimitiveKind.STRING

    assert "level" in label.properties
    assert label.properties["level"].required is False
    assert isinstance(label.properties["level"].type_desc, EnumType)
    assert label.properties["level"].type_desc.values == ("info", "warning", "error")

    # id should automatically be present
    assert "id" in label.properties
    assert label.properties["id"].required is False


def test_analyze_basic_catalog_schema():
    repo_root = Path(__file__).resolve().parents[4]
    schema_path = repo_root / "specification" / "v0_9_1" / "catalogs" / "basic" / "catalog.json"
    assert schema_path.exists(), f"Path not found: {schema_path}"

    catalog = CatalogAnalyzer.from_file(schema_path)

    # Verify key components
    assert "Text" in catalog.components
    assert "Card" in catalog.components
    assert "Column" in catalog.components
    assert "Row" in catalog.components
    assert "Button" in catalog.components
    assert "TextField" in catalog.components

    # Text verification
    text_comp = catalog.components["Text"]
    assert isinstance(text_comp.properties["text"].type_desc, DynamicType)
    assert isinstance(text_comp.properties["variant"].type_desc, EnumType)
    assert "body" in text_comp.properties["variant"].type_desc.values

    # Card verification
    card_comp = catalog.components["Card"]
    assert isinstance(card_comp.properties["child"].type_desc, ComponentRefType)

    # Column verification
    col_comp = catalog.components["Column"]
    assert isinstance(col_comp.properties["children"].type_desc, ComponentListType)

    # Button verification
    btn_comp = catalog.components["Button"]
    assert isinstance(btn_comp.properties["child"].type_desc, ComponentRefType)
    assert isinstance(btn_comp.properties["action"].type_desc, ActionType)

    # TextField verification (checkable)
    tf_comp = catalog.components["TextField"]
    assert tf_comp.is_checkable is True
    assert "checks" in tf_comp.properties
    assert isinstance(tf_comp.properties["checks"].type_desc, ListType)
    assert isinstance(tf_comp.properties["checks"].type_desc.element_type, CheckRuleType)

    # Function verification
    assert "formatString" in catalog.functions
    fn = catalog.functions["formatString"]
    assert "value" in fn.parameters
    assert isinstance(fn.parameters["value"].type_desc, DynamicType)
