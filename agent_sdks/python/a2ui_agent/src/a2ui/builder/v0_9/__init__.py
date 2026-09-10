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

"""A2UI Protocol v0.9 typesafe builder models and wire packaging helpers."""

from ..core import (
    ComponentBuilderNode,
    ComponentRef,
    ComponentTree,
    ExternalComponentBuilderNode,
    IdAllocator,
    flatten_component_tree,
)
from .envelopes import (
    create_surface,
    to_surface_messages,
    to_update_message,
    update_components,
)
from .models import (
    AccessibilityAttributes,
    Action,
    CheckRule,
    Child,
    ChildList,
    DataBinding,
    DynamicBoolean,
    DynamicChildList,
    DynamicNumber,
    DynamicString,
    DynamicStringList,
    DynamicValue,
    FunctionCall,
    Slot,
    SlotList,
    bind,
)

__all__ = [
    "AccessibilityAttributes",
    "Action",
    "CheckRule",
    "Child",
    "ChildList",
    "ComponentBuilderNode",
    "ComponentRef",
    "ComponentTree",
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
    "Slot",
    "SlotList",
    "bind",
    "create_surface",
    "flatten_component_tree",
    "to_surface_messages",
    "to_update_message",
    "update_components",
]
