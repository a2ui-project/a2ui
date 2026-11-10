# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""A stream can expose a valid tree without changing its accumulated graph."""

import copy

import pytest

from a2ui.core import A2uiIntegrityError, A2uiValidationError, Catalog, ComponentModel
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.state import SurfaceComponentsModel


def model_with(*components):
    catalog = BasicCatalog("0.9")
    model = SurfaceComponentsModel(catalog)
    for component in components:
        model.add_component(
            ComponentModel(
                component["id"],
                component["component"],
                catalog,
                {
                    key: value
                    for key, value in component.items()
                    if key not in ("id", "component")
                },
            )
        )
    return model


def test_partial_tree_prunes_forward_references_without_losing_canonical_state():
    model = model_with(
        {"id": "root", "component": "Column", "children": ["ready", "later"]},
        {"id": "ready", "component": "Text", "text": "Hello"},
    )
    before = copy.deepcopy([c.component_tree for c in model.values])
    view = model.get_partial_components()
    assert view == [
        {"id": "root", "component": "Column", "children": ["ready"]},
        {"id": "ready", "component": "Text", "text": "Hello"},
    ]
    assert [c.component_tree for c in model.values] == before
    with pytest.raises(A2uiIntegrityError):
        model.validate_topology()
    view[0]["children"].clear()
    assert model.get("root").properties["children"] == ["ready", "later"]


def test_excluded_required_child_holds_its_parent_but_keeps_ready_siblings():
    model = model_with(
        {"id": "root", "component": "Column", "children": ["ready", "card"]},
        {"id": "ready", "component": "Text", "text": "Hello"},
        {"id": "card", "component": "Card", "child": "pending"},
        {"id": "pending", "component": "Text", "text": {"path": "/title"}},
    )
    assert [c["id"] for c in model.get_partial_components(exclude_ids={"pending"})] == [
        "root",
        "ready",
    ]
    assert [c["id"] for c in model.get_partial_components()] == [
        "root",
        "ready",
        "card",
        "pending",
    ]
    model.validate_topology()


def test_partial_view_needs_root_and_retains_only_reachable_components():
    model = model_with({"id": "ready", "component": "Text", "text": "Hello"})
    assert model.get_partial_components() == []
    model.add_component(
        ComponentModel("root", "Column", model.default_catalog, {"children": []})
    )
    assert model.get_partial_components() == [
        {"id": "root", "component": "Column", "children": []}
    ]


def test_partial_view_does_not_weaken_catalog_constraints():
    model = model_with({"id": "root", "component": "Text", "text": 42})
    assert model.get_partial_components() == []


def test_catalog_marked_nested_children_and_large_list_indices():
    catalog = Catalog.from_json({
        "catalogId": "test://custom",
        "components": {
            "Deck": {
                "type": "object",
                "properties": {
                    "panels": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "body": {
                                    "$ref": (
                                        "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentId"
                                    )
                                },
                            },
                            "required": ["label", "body"],
                        },
                    },
                },
                "required": ["panels"],
            },
            "Note": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        },
    })
    model = SurfaceComponentsModel(catalog)
    model.add_component(
        ComponentModel(
            "root",
            "Deck",
            catalog,
            {"panels": [{"label": str(i), "body": f"n{i}"} for i in range(14)]},
        )
    )
    model.add_component(ComponentModel("n3", "Note", catalog, {"text": "n12"}))
    view = model.get_partial_components()
    assert view[0]["panels"] == [{"label": "3", "body": "n3"}]
    assert view[1]["text"] == "n12"  # Ordinary strings are never pruned.
    assert len(model.get("root").properties["panels"]) == 14


def test_excluded_root_and_cycles_cannot_escape_as_invalid_views():
    model = model_with(
        {"id": "root", "component": "Column", "children": ["root"]},
    )
    assert model.get_partial_components(exclude_ids={"root"}) == []
    for component in model.get_partial_components():
        assert component["children"] == []
    with pytest.raises(A2uiValidationError, match="[Cc]ycl|[Cc]ircular|Self-reference"):
        model.validate_topology()


@pytest.mark.parametrize("property_name", ["slots.with.dots", "slots[2]"])
def test_catalog_child_property_names_are_not_interpreted_as_path_syntax(property_name):
    catalog = Catalog.from_json({
        "catalogId": "test://punctuated-slots",
        "components": {
            "Layout": {
                "type": "object",
                "properties": {
                    property_name: {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ChildList"
                        )
                    },
                },
                "required": [property_name],
            },
            "Note": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        },
    })
    model = SurfaceComponentsModel(catalog)
    model.add_component(
        ComponentModel("root", "Layout", catalog, {property_name: ["ready", "later"]})
    )
    model.add_component(ComponentModel("ready", "Note", catalog, {"text": "Ready"}))
    view = model.get_partial_components()
    assert view[0][property_name] == ["ready"]
    assert model.get("root").properties[property_name] == ["ready", "later"]
    # Display paths do not escape separators, so two actual property keys can
    # spell the same prefix. Defer this component instead of pruning a guess.
    model.get("root").properties["slots"] = {}
    assert model.get_partial_components() == []


def test_partial_view_keeps_metadata_detached():
    catalog = BasicCatalog("1.0")
    model = SurfaceComponentsModel(catalog)
    model.add_component(ComponentModel("root", "Text", catalog, {"text": "Hello"}))
    model.get("root").metadata = {"extensions": {"example": {"tags": ["original"]}}}
    view = model.get_partial_components()
    assert view[0]["metadata"] == model.get("root").metadata
    view[0]["metadata"]["extensions"]["example"]["tags"].append("changed")
    assert model.get("root").metadata["extensions"]["example"]["tags"] == ["original"]


def test_missing_child_cannot_bypass_minimum_list_size():
    catalog = Catalog.from_json({
        "catalogId": "test://minimum-list",
        "components": {
            "Layout": {
                "type": "object",
                "properties": {
                    "children": {
                        "allOf": [
                            {
                                "$ref": (
                                    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ChildList"
                                )
                            },
                            {"type": "array", "minItems": 1},
                        ]
                    }
                },
                "required": ["children"],
            },
        },
    })
    model = SurfaceComponentsModel(catalog)
    model.add_component(
        ComponentModel("root", "Layout", catalog, {"children": ["missing"]})
    )
    assert model.get_partial_components() == []
    assert model.get("root").properties["children"] == ["missing"]


def test_partial_view_retains_non_default_component_catalog():
    catalog = BasicCatalog("1.0")
    other = Catalog.from_json({
        "catalogId": "test://other",
        "protocolVersion": "1.0",
        "components": {
            "Note": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            }
        },
    })
    model = SurfaceComponentsModel(catalog)
    model.add_component(
        ComponentModel("root", "Column", catalog, {"children": ["note"]})
    )
    model.add_component(ComponentModel("note", "Note", other, {"text": "Hello"}))
    view = model.get_partial_components()
    assert view[1]["catalogId"] == "test://other"
    assert "catalogId" not in view[0]
