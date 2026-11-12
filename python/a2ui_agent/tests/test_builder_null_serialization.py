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

"""Required nullable catalog fields must survive builder flattening."""

from typing import Any, Literal

from jsonschema import Draft202012Validator
from pydantic import ConfigDict, Field, RootModel
import pytest

from a2ui.builder.core import (
    BuilderBaseModel,
    Child,
    ComponentBuilderNode,
    flatten_component_tree,
)
from a2ui.builder.v0_9 import Column as ColumnV0_9
from a2ui.builder.v1_0 import Column, DataBinding, DynamicChildList


class NullableValue(ComponentBuilderNode):
    component: Literal["NullableValue"] = "NullableValue"
    value: str | None
    optional_value: str | None = None
    default_value: str = "default"


@pytest.mark.parametrize("optional", [{}, {"optional_value": None}])
def test_required_null_survives_while_optional_null_is_omitted(
    optional: dict[str, Any],
) -> None:
    node = NullableValue(id="value", value=None, **optional)

    flattened = flatten_component_tree(node)

    assert flattened == [{
        "component": "NullableValue",
        "id": "value",
        "value": None,
        "default_value": "default",
    }]
    # Validate against the catalog requirement, not just the authoring model.
    Draft202012Validator({
        "type": "object",
        "properties": {"value": {"type": ["string", "null"]}},
        "required": ["value"],
    }).validate(flattened[0])


def test_required_null_uses_serialization_alias_and_honors_field_exclusion() -> None:
    class AliasedValue(ComponentBuilderNode):
        component: Literal["AliasedValue"] = "AliasedValue"
        value: str | None = Field(alias="inputValue", serialization_alias="wireValue")
        hidden: str | None = Field(exclude=True)

    node = AliasedValue.model_validate({
        "id": "alias",
        "inputValue": None,
        "hidden": None,
    })

    assert flatten_component_tree(node) == [{
        "component": "AliasedValue",
        "id": "alias",
        "wireValue": None,
    }]
    # An explicit Pydantic dump keeps its existing exclude_none semantics.
    assert node.model_dump(by_alias=True, exclude_none=True) == {
        "component": "AliasedValue",
        "id": "alias",
    }


def test_nested_builder_models_preserve_required_nulls() -> None:
    class Details(BuilderBaseModel):
        label: str | None = Field(serialization_alias="displayLabel")
        optional_label: str | None = None

    class Item(BuilderBaseModel):
        details: Details
        child: Child | None

    class Collection(ComponentBuilderNode):
        component: Literal["Collection"] = "Collection"
        items: list[Item]
        by_name: dict[str, Details]
        values: list[str | None]
        metadata: dict[str, str | None]

    node = Collection(
        id="collection",
        items=[Item(details=Details(label=None), child=None)],
        by_name={"first": Details(label=None, optional_label=None)},
        values=[None, "present"],
        metadata={"empty": None},
    )

    assert flatten_component_tree(node) == [{
        "component": "Collection",
        "id": "collection",
        "items": [{"details": {"displayLabel": None}, "child": None}],
        "by_name": {"first": {"displayLabel": None}},
        "values": [None, "present"],
        "metadata": {"empty": None},
    }]


@pytest.mark.parametrize("column_type", [ColumnV0_9, Column])
def test_child_nulls_survive_post_order_flattening(
    column_type: type[ComponentBuilderNode],
) -> None:
    shared = NullableValue(id="leaf", value=None)
    tree = column_type.model_validate({
        "id": "root",
        "children": [shared, shared],
    })

    flattened = flatten_component_tree(tree)

    assert flattened[0] == {
        "component": "NullableValue",
        "id": "root__leaf",
        "value": None,
        "default_value": "default",
    }
    assert len(flattened) == 2
    assert flattened[1]["id"] == "root"
    assert flattened[1]["children"] == ["root__leaf", "root__leaf"]


def test_template_nulls_preserve_binding_aliases_and_child_references() -> None:
    class BoundValue(ComponentBuilderNode):
        component: Literal["BoundValue"] = "BoundValue"
        value: str | DataBinding | None
        label: str | None

    tree = Column(
        id="list",
        children=DynamicChildList(
            path="/items",
            template=BoundValue(
                id="item",
                value=DataBinding.model_validate({"@path": "name"}),
                label=None,
            ),
        ),
    )

    flattened = flatten_component_tree(tree)

    assert flattened[0] == {
        "component": "BoundValue",
        "id": "list__item",
        "value": {"@path": "name"},
        "label": None,
    }
    assert len(flattened) == 2
    assert flattened[1]["children"] == {
        "path": "/items",
        "componentId": "list__item",
    }


def test_nested_declared_model_does_not_emit_subclass_only_nulls() -> None:
    class Details(BuilderBaseModel):
        caption: str

    class ExtendedDetails(Details):
        internal_note: str | None

    class Panel(ComponentBuilderNode):
        details: Details
        items: list[Details]
        by_name: dict[str, Details]

    details = ExtendedDetails(caption="hello", internal_note=None)
    node = Panel(
        id="panel", details=details, items=[details], by_name={"first": details}
    )

    flattened = flatten_component_tree(node)[0]

    assert flattened["details"] == {"caption": "hello"}
    assert flattened["items"] == [{"caption": "hello"}]
    assert flattened["by_name"] == {"first": {"caption": "hello"}}
    Draft202012Validator({
        "type": "object",
        "properties": {"caption": {"type": "string"}},
        "required": ["caption"],
        "additionalProperties": False,
    }).validate(flattened["details"])


@pytest.mark.parametrize("value", [None, "hello"])
def test_nested_declared_model_controls_nullable_field_alias(value: str | None) -> None:
    class Details(BuilderBaseModel):
        value: str | None = Field(serialization_alias="baseValue")

    class ExtendedDetails(Details):
        value: str | None = Field(serialization_alias="derivedValue")

    class Panel(ComponentBuilderNode):
        details: Details

    node = Panel(id="panel", details=ExtendedDetails(value=value))

    assert flatten_component_tree(node)[0]["details"] == {"baseValue": value}


@pytest.mark.parametrize("value", [None, "hello"])
def test_nested_declared_model_controls_nullable_field_exclusion(
    value: str | None,
) -> None:
    class Details(BuilderBaseModel):
        caption: str
        internal_note: str | None = Field(exclude=True)

    class ExtendedDetails(Details):
        internal_note: str | None

    class Panel(ComponentBuilderNode):
        details: Details

    node = Panel(
        id="panel",
        details=ExtendedDetails(caption="hello", internal_note=value),
    )

    assert flatten_component_tree(node)[0]["details"] == {"caption": "hello"}


def test_nested_declared_model_controls_nullable_field_requiredness() -> None:
    class Details(BuilderBaseModel):
        required_value: str | None
        optional_value: str | None = None

    class ExtendedDetails(Details):
        required_value: str | None = None
        optional_value: str | None = Field()

    class Panel(ComponentBuilderNode):
        details: Details

    node = Panel(id="panel", details=ExtendedDetails(optional_value=None))

    assert flatten_component_tree(node)[0]["details"] == {"required_value": None}


@pytest.mark.parametrize("value", [None, "hello"])
def test_nullable_root_model_preserves_its_scalar_output(value: str | None) -> None:
    class NullableRoot(RootModel[str | None], BuilderBaseModel):
        model_config = ConfigDict(extra=None)

    class Panel(ComponentBuilderNode):
        details: NullableRoot

    node = Panel(id="panel", details=NullableRoot(value))

    assert flatten_component_tree(node)[0]["details"] == value


def test_root_model_preserves_nested_builder_and_child_traversal() -> None:
    class Details(BuilderBaseModel):
        label: str | None
        child: Child

    class DetailsRoot(RootModel[Details], BuilderBaseModel):
        model_config = ConfigDict(extra=None)

    class Panel(ComponentBuilderNode):
        details: DetailsRoot

    node = Panel(
        id="panel",
        details=DetailsRoot(
            Details(label=None, child=NullableValue(id="leaf", value=None))
        ),
    )

    flattened = flatten_component_tree(node)

    assert flattened == [
        {
            "component": "NullableValue",
            "id": "panel__leaf",
            "value": None,
            "default_value": "default",
        },
        {
            "component": "",
            "id": "panel",
            "details": {"label": None, "child": "panel__leaf"},
        },
    ]


@pytest.mark.parametrize("value", [None, "hello"])
def test_required_nullable_field_preserves_an_empty_alias(value: str | None) -> None:
    class EmptyAlias(ComponentBuilderNode):
        value: str | None = Field(serialization_alias="")

    node = EmptyAlias(id="alias", value=value)

    assert flatten_component_tree(node) == [{
        "component": "",
        "id": "alias",
        "": value,
    }]
