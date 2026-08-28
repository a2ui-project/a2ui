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

"""A2UI Macros (Programmatic Components and Typesafe Builders)."""

from a2ui.inference_formats.experimental.macros.builder import (
    Action,
    CheckRule,
    ComponentBuilderNode,
    ComponentRef,
    DataBinding,
    DynamicChildList,
    ExternalComponentBuilderNode,
    FunctionCall,
    IdAllocator,
    Surface,
    bind,
    flatten_component_tree,
)
from a2ui.inference_formats.experimental.macros.format import (
    MacroInferenceFormat,
    MacroParser,
)
from a2ui.inference_formats.experimental.macros.macro import (
    MacroMetadata,
    MacroParameter,
    clear_macros,
    dynamic_template,
    get_macro,
    list_macros,
    macro,
    macro_component,
    register_macro,
)
from a2ui.inference_formats.experimental.macros.processor import MacroProcessor

__all__ = [
    "macro",
    "macro_component",
    "dynamic_template",
    "register_macro",
    "get_macro",
    "list_macros",
    "get_all_macros",
    "clear_macros",
    "MacroMetadata",
    "MacroParameter",
    "MacroProcessor",
    "MacroInferenceFormat",
    "MacroParser",
    "ComponentBuilderNode",
    "ExternalComponentBuilderNode",
    "ComponentRef",
    "DataBinding",
    "bind",
    "FunctionCall",
    "Action",
    "CheckRule",
    "DynamicChildList",
    "IdAllocator",
    "Surface",
    "flatten_component_tree",
]
