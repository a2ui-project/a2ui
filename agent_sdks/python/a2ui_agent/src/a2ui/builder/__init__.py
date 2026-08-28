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

"""A2UI Typesafe Fluent Builder package."""

from .base import (
    AccessibilityAttributes,
    Action,
    CheckRule,
    Child,
    ChildList,
    ComponentBuilderNode,
    ComponentRef,
    DataBinding,
    DynamicBoolean,
    DynamicChildList,
    DynamicNumber,
    DynamicString,
    DynamicStringList,
    DynamicValue,
    ExternalComponentBuilderNode,
    FunctionCall,
    IdAllocator,
    Surface,
    bind,
    flatten_component_tree,
)

__all__ = [
    "AccessibilityAttributes",
    "Action",
    "CheckRule",
    "Child",
    "ChildList",
    "ComponentBuilderNode",
    "ComponentRef",
    "DataBinding",
    "DynamicBoolean",
    "DynamicChildList",
    "DynamicNumber",
    "DynamicString",
    "DynamicStringList",
    "DynamicValue",
    "ExternalComponentBuilderNode",
    "FunctionCall",
    "IdAllocator",
    "Surface",
    "bind",
    "flatten_component_tree",
]
