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

from typing import Any, Callable
from ..common.events import EventSource, Signal


def _is_setter_callback(key: str, val: Any) -> bool:
    """Checks if a key-value pair is a generated setter closure (e.g., setValue)."""
    return key.startswith("set") and len(key) > 3 and key[3].isupper() and callable(val)


def _serialize_prop_value(v: Any) -> Any:
    """Recursively serializes a resolved property value for ComponentNode.to_dict."""
    if isinstance(v, ComponentNode):
        return v.to_dict()
    if isinstance(v, list):
        return [_serialize_prop_value(item) for item in v]
    if isinstance(v, dict):
        return {
            dk: _serialize_prop_value(dv)
            for dk, dv in v.items()
            if not _is_setter_callback(dk, dv)
        }
    if isinstance(v, Signal):
        return _serialize_prop_value(v.value)
    if callable(v):
        return "<Action>"
    return v


class ComponentNode:
    """Represents a living, fully resolved component instance in the view hierarchy."""

    def __init__(
        self,
        instance_id: str,
        component_id: str,
        node_type: str,
        data_path: str,
        props: Signal[dict[str, Any]],
    ):
        self.instance_id: str = instance_id
        self.component_id: str = component_id
        self.type: str = node_type
        self.data_path: str = data_path
        self.props: Signal[dict[str, Any]] = props
        self.on_destroyed: EventSource = EventSource()
        self._cleanup_callbacks: list[Callable[[], None]] = []
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

    @property
    def disposed(self) -> bool:
        """Indicates whether this node has been disposed."""
        return self._disposed

    @property
    def is_placeholder(self) -> bool:
        """Indicates whether this node is an unresolved placeholder."""
        return self.type == "Placeholder"

    def __str__(self) -> str:
        return self.component_id

    def __repr__(self) -> str:
        return (
            f"ComponentNode(instance_id={self.instance_id!r},"
            f" component_id={self.component_id!r}, type={self.type!r})"
        )

    def to_dict(self) -> dict[str, Any]:
        """Serializes this node and its children recursively to a standard dict layout."""
        if self.type == "Placeholder":
            return {
                "instance_id": self.instance_id,
                "component_id": self.component_id,
                "type": "Placeholder",
            }

        resolved_props = {
            k: _serialize_prop_value(val)
            for k, val in self.props.value.items()
            if not _is_setter_callback(k, val)
        }

        return {
            "instance_id": self.instance_id,
            "component_id": self.component_id,
            "type": self.type,
            "props": resolved_props,
        }

    def to_debug_tree(self) -> dict[str, Any]:
        """Serializes this node and its children recursively to a standard dict layout."""
        return self.to_dict()
