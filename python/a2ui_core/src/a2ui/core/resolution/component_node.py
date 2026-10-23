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

"""Resolved component node and binding types produced by NodeResolver."""

from __future__ import annotations

from dataclasses import dataclass
import itertools
from typing import Any, Callable, Final, Generic, Literal, TypeGuard, TypeVar

from ..common.events import EventSource
from .component_context import ComponentContext
from .data_context import DataContext

T = TypeVar("T")

PLACEHOLDER_TYPE: Final[str] = "Placeholder"

NodeState = Literal["resolved", "pending", "unknown-type", "cyclic"]
SlotKey = tuple[str, int]

_node_id_counter = itertools.count(1)


def _next_node_id() -> str:
    return f"node-{next(_node_id_counter)}"


@dataclass
class ResolvedBinding(Generic[T]):
    """Read-only resolved property binding on a ComponentNode."""

    value: T
    writable: bool = False


@dataclass
class WritableBinding(ResolvedBinding[T]):
    """Two-way resolved property binding with a data-model setter."""

    set: Callable[[T], None] = lambda _: None
    path: str = ""
    writable: bool = True


def is_writable(binding: Any) -> TypeGuard[WritableBinding[Any]]:
    """Returns True when binding is a WritableBinding with writable=True."""
    return isinstance(binding, WritableBinding) and bool(binding.writable)


def _shallow_equal_props(a: dict[str, Any], b: dict[str, Any]) -> bool:
    if a is b:
        return True
    if len(a) != len(b):
        return False
    for key, a_val in a.items():
        if key not in b or b[key] is not a_val:
            return False
    return True


class ComponentNode:
    """Resolved node in a SurfaceModel's component hierarchy."""

    def __init__(
        self,
        *,
        instance_id: str,
        component_id: str,
        type: str,
        data_path: str = "/",
        props: dict[str, Any] | None = None,
        impl: Any = None,
        context: ComponentContext | None = None,
        state: NodeState = "resolved",
        data_context: DataContext | None = None,
        weight: int | float | None = None,
        parent: ComponentNode | None = None,
        slot_key: SlotKey | None = None,
        is_valid: bool = True,
        validation_errors: list[str] | None = None,
        validation_results: list[dict[str, Any]] | None = None,
    ) -> None:
        self.id = _next_node_id()
        self.instance_id = instance_id
        self.component_id = component_id
        self.type = type
        self.data_path = data_path.rstrip("/") or "/"
        self.props: dict[str, Any] = props if props is not None else {}
        self.impl = impl
        self.context = context
        self.state: NodeState = state
        self.data_context = data_context or (
            context.data_context if context is not None else None
        )
        self.weight = weight
        self.parent = parent
        self.slot_key = slot_key
        self.is_valid = is_valid
        self.validation_errors: list[str] = (
            validation_errors if validation_errors is not None else []
        )
        self.validation_results: list[dict[str, Any]] = (
            validation_results if validation_results is not None else []
        )
        self.on_updated: EventSource[dict[str, Any]] = EventSource()
        self.on_destroyed: EventSource[None] = EventSource()
        self._cleanups: list[Callable[[], None]] = []
        self._disposed = False

    @property
    def disposed(self) -> bool:
        """Whether this node has been disposed."""
        return self._disposed

    @property
    def is_placeholder(self) -> bool:
        """Whether this node is an unresolved placeholder."""
        return self.state != "resolved"

    def add_cleanup(self, cleanup: Callable[[], None]) -> None:
        """Registers a cleanup callback to run when the node is disposed."""
        self._cleanups.append(cleanup)


class MutableComponentNode(ComponentNode):
    """Internal mutable view of a ComponentNode managed by NodeResolver."""

    def set_props(self, next_props: dict[str, Any]) -> None:
        """Replaces resolved properties and notifies listeners when changed."""
        if self._disposed:
            return
        if not _shallow_equal_props(self.props, next_props):
            self.props = next_props
            self.on_updated.emit(self.props)

    def dispose(self) -> None:
        """Tears down the node idempotently and fires on_destroyed once."""
        if self._disposed:
            return
        self._disposed = True
        for cleanup in self._cleanups:
            cleanup()
        self._cleanups.clear()
        self.on_destroyed.emit(None)
        self.on_destroyed.dispose()
        self.on_updated.dispose()


def is_component_node(value: Any) -> TypeGuard[ComponentNode]:
    """Returns True when value is a ComponentNode instance."""
    return isinstance(value, ComponentNode)


def _same_list(a: list[Any], b: list[Any]) -> bool:
    if len(a) != len(b):
        return False
    return all(same_value(x, y) for x, y in zip(a, b))


def _same_dict(a: dict[str, Any], b: dict[str, Any]) -> bool:
    if set(a.keys()) != set(b.keys()):
        return False
    return all(same_value(a[k], b[k]) for k in a)


def same_value(a: Any, b: Any) -> bool:
    """Compares two resolved binding values structurally."""
    if a is b:
        return True
    if is_component_node(a) or is_component_node(b):
        return False
    if callable(a) and callable(b):
        return a is b
    if type(a) is not type(b):
        return False
    if isinstance(a, list):
        return _same_list(a, b)
    if isinstance(a, dict):
        return _same_dict(a, b)
    return bool(a == b)


def same_binding(
    a: ResolvedBinding[Any] | None, b: ResolvedBinding[Any] | None
) -> bool:
    """Returns True if two ResolvedBindings have the same writability, path, and value."""
    if a is b:
        return True
    if a is None or b is None:
        return False
    if is_writable(a) != is_writable(b):
        return False
    if is_writable(a) and is_writable(b) and a.path != b.path:
        return False
    return same_value(a.value, b.value)
