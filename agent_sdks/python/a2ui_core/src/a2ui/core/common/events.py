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

from typing import Any, Callable, Set, Generic, TypeVar

T = TypeVar("T")


class Subscription:
    """Represents an active subscription that can be unsubscribed."""

    def __init__(
        self, unsubscribe_callback: Callable[[], None], initial_value: Any = None
    ) -> None:
        self._unsubscribe = unsubscribe_callback
        self.value = initial_value

    def unsubscribe(self) -> None:
        self._unsubscribe()


class EventSource:
    """A simple, lightweight multi-cast event source matching EventEmitter style."""

    def __init__(self) -> None:
        self._listeners: Set[Callable[[Any], None]] = set()

    def subscribe(self, handler: Callable[[Any], None]) -> Subscription:
        self._listeners.add(handler)
        return Subscription(lambda: self._listeners.discard(handler))

    def emit(self, payload: Any) -> None:
        # Iterate over a copy to prevent issues if a listener unsubscribes during emit
        for listener in list(self._listeners):
            try:
                listener(payload)
            except Exception:
                pass

    def dispose(self) -> None:
        self._listeners.clear()


class Signal(EventSource, Generic[T]):
    """An observable stream that persists its current value and immediately emits it upon subscription (matches BehaviorSubject and Preact Signal)."""

    def __init__(self, initial_value: T) -> None:
        super().__init__()
        self._value: T = initial_value

    @property
    def value(self) -> T:
        return self._value

    @value.setter
    def value(self, new_val: T) -> None:
        if self._value != new_val:
            self._value = new_val
            self.emit(new_val)

    def peek(self) -> T:
        """Returns the current value without creating any active subscription."""
        return self._value

    def subscribe(self, handler: Callable[[T], None]) -> Subscription:
        sub = super().subscribe(handler)
        sub.value = self._value
        handler(self._value)
        return sub

    def __repr__(self) -> str:
        return f"Signal({self._value!r})"


class AbortSignal(EventSource):
    """A simple cancellation token that emits when an operation is aborted."""

    def __init__(self) -> None:
        super().__init__()
        self._aborted = False

    @property
    def aborted(self) -> bool:
        return self._aborted

    def abort(self) -> None:
        """Triggers the abort cascade and notifies all listening background tasks."""
        if not self._aborted:
            self._aborted = True
            self.emit(None)

    def add_event_listener(
        self, event_type: str, handler: Callable[..., Any]
    ) -> Subscription:
        """Friendly compatibility method matching JS/TS AbortSignal style."""
        if event_type == "abort":
            if self._aborted:
                handler()
                return Subscription(lambda: None)
            return self.subscribe(lambda dummy: handler())
        raise ValueError(f"Unsupported event type: {event_type}")
