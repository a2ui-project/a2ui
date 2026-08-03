# Copyright 2026 Google LLC
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

from typing import Any
from ..common.events import EventSource, Signal
from .component_model import ComponentModel
from .component_node import ComponentNode
from .data_model import DataModel
from .surface_components_model import SurfaceComponentsModel


def __getattr__(name: str) -> Any:
    if name == "SurfaceGroupModel":
        from .surface_group_model import SurfaceGroupModel
        return SurfaceGroupModel
    if name == "SurfaceModel":
        from .surface_model import SurfaceModel
        return SurfaceModel
    if name == "NodeGraph":
        from .node_graph import NodeGraph
        return NodeGraph
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")

__all__ = [
    "ComponentModel",
    "ComponentNode",
    "DataModel",
    "EventSource",
    "Signal",
    "SurfaceComponentsModel",
    "SurfaceGroupModel",
    "SurfaceModel",
    "NodeGraph",
]
