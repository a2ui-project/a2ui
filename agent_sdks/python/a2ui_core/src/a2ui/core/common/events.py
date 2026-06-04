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

from typing import Any, Callable, Set


class Subscription:
    """Represents an active subscription that can be unsubscribed."""

    def __init__(
        self, unsubscribe_callback: Callable[[], None], initial_value: Any = None
    ):
        self._unsubscribe = unsubscribe_callback
        self.value = initial_value

    def unsubscribe(self) -> None:
        self._unsubscribe()


class EventSource:
    """A simple, lightweight multi-cast event source matching EventEmitter style."""

    def __init__(self):
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
