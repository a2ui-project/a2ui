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

"""Resolved dynamic value binding abstractions."""

from typing import Any, Callable, Generic, TypeGuard, TypeVar, overload

T = TypeVar("T")


class ResolvedBinding(Generic[T]):
    """Resolved dynamic value snapshot in a node's properties.

    Captures the current value pinned at the time of emission. A new binding instance
    is emitted through the node's properties whenever the underlying value changes.

    Literal and function-call values resolve to a read-only ResolvedBinding, preventing
    accidental writes without explicitly narrowing to WritableBinding.
    """

    __slots__ = ("value",)

    def __init__(self, value: T) -> None:
        self.value: T = value

    def __repr__(self) -> str:
        return f"ResolvedBinding(value={self.value!r})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ResolvedBinding):
            return NotImplemented
        if isinstance(other, WritableBinding):
            return False
        return bool(self.value == other.value)


class WritableBinding(ResolvedBinding[T]):
    """Writable resolved dynamic binding backed by a mutable data model path."""

    __slots__ = ("set", "path")

    def __init__(
        self,
        value: T,
        setter: Callable[[T], None],
        path: str,
    ) -> None:
        super().__init__(value)
        self.set: Callable[[T], None] = setter
        self.path: str = path

    def __repr__(self) -> str:
        return f"WritableBinding(value={self.value!r}, path={self.path!r})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, WritableBinding):
            return NotImplemented
        return bool(self.value == other.value and self.path == other.path)


@overload
def is_writable(binding: ResolvedBinding[T]) -> TypeGuard[WritableBinding[T]]:
    ...


@overload
def is_writable(binding: Any) -> TypeGuard[WritableBinding[Any]]:
    ...


def is_writable(binding: Any) -> TypeGuard[WritableBinding[Any]]:
    """Returns True if the binding is an instance of WritableBinding."""
    return isinstance(binding, WritableBinding)
