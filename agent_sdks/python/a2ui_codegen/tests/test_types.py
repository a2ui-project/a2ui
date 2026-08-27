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

"""Unit tests for TypeDescriptor and type conversion."""

import pytest
from a2ui.codegen.emitter.python import type_to_python
from a2ui.codegen.types import (
    ActionType,
    CheckRuleType,
    ComponentListType,
    ComponentRefType,
    DataBindingType,
    DynamicType,
    EnumType,
    ListType,
    MapType,
    PrimitiveKind,
    PrimitiveType,
    UnionType,
)


def test_primitive_types():
    assert type_to_python(PrimitiveType(PrimitiveKind.STRING)) == "str"
    assert type_to_python(PrimitiveType(PrimitiveKind.INTEGER)) == "int"
    assert type_to_python(PrimitiveType(PrimitiveKind.FLOAT)) == "float"
    assert type_to_python(PrimitiveType(PrimitiveKind.BOOLEAN)) == "bool"
    assert type_to_python(PrimitiveType(PrimitiveKind.ANY)) == "Any"


def test_enum_type():
    enum_type = EnumType(name="TextVariant", values=("h1", "h2", "body"))
    assert type_to_python(enum_type) == "TextVariant"


def test_component_slots():
    assert type_to_python(ComponentRefType()) == "ComponentBuilderNode"
    assert (
        type_to_python(ComponentListType())
        == "Sequence[ComponentBuilderNode] | DynamicChildList"
    )


def test_dynamic_types():
    dyn_str = DynamicType(PrimitiveType(PrimitiveKind.STRING))
    assert type_to_python(dyn_str) == "str | DataBinding | FunctionCall"

    dyn_num = DynamicType(PrimitiveType(PrimitiveKind.FLOAT))
    assert type_to_python(dyn_num) == "float | DataBinding | FunctionCall"

    dyn_list = DynamicType(ListType(PrimitiveType(PrimitiveKind.STRING)))
    assert (
        type_to_python(dyn_list)
        == "Sequence[str] | DataBinding | FunctionCall"
    )


def test_action_and_binding():
    assert type_to_python(ActionType()) == "Action"
    assert type_to_python(DataBindingType()) == "DataBinding"
    assert type_to_python(CheckRuleType()) == "CheckRule"


def test_collections_and_unions():
    list_type = ListType(PrimitiveType(PrimitiveKind.INTEGER))
    assert type_to_python(list_type) == "Sequence[int]"

    map_type = MapType(PrimitiveType(PrimitiveKind.STRING))
    assert type_to_python(map_type) == "Mapping[str, str]"

    union_type = UnionType((PrimitiveType(PrimitiveKind.STRING), PrimitiveType(PrimitiveKind.INTEGER)))
    assert type_to_python(union_type) == "str | int"
