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

from typing import Any, Callable, Dict, List, Optional
from ..common.events import EventSource, Signal


class ComponentNode:
    """Represents a living, fully resolved component instance in the view hierarchy."""

    def __init__(
        self,
        instance_id: str,
        component_id: str,
        node_type: str,
        data_path: str,
        props: Signal[Dict[str, Any]],
    ):
        self.instance_id: str = instance_id
        self.component_id: str = component_id
        self.type: str = node_type
        self.data_path: str = data_path
        self.props: Signal[Dict[str, Any]] = props
        self.on_destroyed: EventSource = EventSource()
        self._cleanup_callbacks: List[Callable[[], None]] = []
        self._disposed: bool = False

    def add_cleanup(self, callback: Callable[[], None]) -> None:
        """Registers a cleanup callback to be executed when this node is disposed."""
        self._cleanup_callbacks.append(callback)

    def dispose(self) -> None:
        """Disposes of the node, running all registered cleanups and triggering on_destroyed."""
        if self._disposed:
            return
        self._disposed = True
        for callback in self._cleanup_callbacks:
            try:
                callback()
            except Exception:
                pass
        self._cleanup_callbacks.clear()
        self.on_destroyed.emit(None)

    def __str__(self) -> str:
        return self.component_id

    def __repr__(self) -> str:
        return f"ComponentNode(instance_id={self.instance_id!r}, component_id={self.component_id!r}, type={self.type!r})"

    def to_dict(self) -> Dict[str, Any]:
        """Serializes this node and its children recursively to a standard dict layout."""
        if self.type == "Placeholder":
            return {
                "instance_id": self.instance_id,
                "component_id": self.component_id,
                "type": "Placeholder",
            }

        def serialize_value(v: Any) -> Any:
            if isinstance(v, ComponentNode):
                return v.to_dict()
            elif isinstance(v, list):
                return [serialize_value(item) for item in v]
            elif isinstance(v, dict):
                return {dk: serialize_value(dv) for dk, dv in v.items()}
            elif isinstance(v, Signal):
                return serialize_value(v.value)
            elif callable(v):
                return "<Action>"
            else:
                return v

        resolved_props = {}
        for k, val in self.props.value.items():
            resolved_props[k] = serialize_value(val)

        return {
            "instance_id": self.instance_id,
            "component_id": self.component_id,
            "type": self.type,
            "props": resolved_props,
        }
