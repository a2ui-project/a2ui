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

"""Algebraic type descriptor system for A2UI schema analysis."""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Sequence, Union


class PrimitiveKind(Enum):
    """Supported primitive data types."""

    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    ANY = "any"


@dataclass(frozen=True)
class PrimitiveType:
    """A scalar primitive value."""

    kind: PrimitiveKind


@dataclass(frozen=True)
class EnumType:
    """A closed string enumeration."""

    name: str
    values: tuple[str, ...]


@dataclass(frozen=True)
class ComponentRefType:
    """Single child component slot reference."""

    pass


@dataclass(frozen=True)
class ComponentListType:
    """Sequence of child components or dynamic list."""

    pass


@dataclass(frozen=True)
class DynamicType:
    """A dynamic value accepting literal, DataBinding, or FunctionCall."""

    inner: "TypeDescriptor"


@dataclass(frozen=True)
class ActionType:
    """Interactive client action or server event."""

    pass


@dataclass(frozen=True)
class DataBindingType:
    """Client data model JSON Pointer path binding."""

    pass


@dataclass(frozen=True)
class CheckRuleType:
    """Input validation rule (condition + message)."""

    pass


@dataclass(frozen=True)
class ListType:
    """Homogeneous list of elements."""

    element_type: "TypeDescriptor"


@dataclass(frozen=True)
class MapType:
    """Key-value mapping with string keys."""

    value_type: "TypeDescriptor"


@dataclass(frozen=True)
class UnionType:
    """Union of multiple valid type descriptors."""

    options: tuple["TypeDescriptor", ...]


TypeDescriptor = Union[
    PrimitiveType,
    EnumType,
    ComponentRefType,
    ComponentListType,
    DynamicType,
    ActionType,
    DataBindingType,
    CheckRuleType,
    ListType,
    MapType,
    UnionType,
]


@dataclass(frozen=True)
class PropertyDescriptor:
    """Describes a single property of an A2UI component or function."""

    name: str
    type_desc: TypeDescriptor
    required: bool = False
    description: Optional[str] = None
    default_value: Optional[str] = None
