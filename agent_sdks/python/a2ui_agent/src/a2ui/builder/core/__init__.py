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

"""Core, protocol-agnostic runtime foundation for A2UI fluent builders."""

from .base_node import (
    ComponentBuilderNode,
    ComponentRef,
    ExternalComponentBuilderNode,
)
from .flattener import flatten_component_tree
from .id_allocator import IdAllocator
from .tree import ComponentTree

__all__ = [
    "ComponentBuilderNode",
    "ComponentRef",
    "ComponentTree",
    "ExternalComponentBuilderNode",
    "IdAllocator",
    "flatten_component_tree",
]
