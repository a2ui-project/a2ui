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

import copy
import re
from typing import Any, Callable, Dict, List, Optional, Set
from ..common.events import Subscription

# Regex to check if path segment is numeric (representing array index)
NUMERIC_PATTERN = re.compile(r"^(?:0|[1-9][0-9]*)$")


class DataModel:
    """An atomic RFC 6901 JSON Pointer reactive store."""

    def __init__(self, initial_data: Optional[Dict[str, Any]] = None):
        self._data = copy.deepcopy(initial_data or {})
        self._listeners: Dict[str, Set[Callable[[Any], None]]] = {}

    @staticmethod
    def _parse_pointer(path: str) -> List[str]:
        """Splits a JSON Pointer path into individual unescaped tokens."""
        if not path or path == "/":
            return []
        if not path.startswith("/"):
            # Support relative scope path resolution
            return [t.replace("~1", "/").replace("~0", "~") for t in path.split("/")]

        tokens = path[1:].split("/")
        return [t.replace("~1", "/").replace("~0", "~") for t in tokens]

    @staticmethod
    def _build_pointer(tokens: List[str]) -> str:
        """Assembles unescaped tokens back into an absolute JSON Pointer."""
        if not tokens:
            return "/"
        escaped = [t.replace("~", "~0").replace("/", "~1") for t in tokens]
        return "/" + "/".join(escaped)

    def get(self, path: str) -> Any:
        """Resolves the JSON Pointer path to its current value."""
        tokens = self._parse_pointer(path)
        if not tokens:
            return self._data

        current = self._data
        for token in tokens:
            if isinstance(current, dict) and token in current:
                current = current[token]
            elif isinstance(current, list) and NUMERIC_PATTERN.match(token):
                idx = int(token)
                if 0 <= idx < len(current):
                    current = current[idx]
                else:
                    return None
            else:
                return None
        return current

    def has_path(self, path: str) -> bool:
        """Checks if a JSON Pointer path physically exists in the data model."""
        tokens = self._parse_pointer(path)
        if not tokens:
            return True

        current = self._data
        for token in tokens:
            if isinstance(current, dict) and token in current:
                current = current[token]
            elif isinstance(current, list) and NUMERIC_PATTERN.match(token):
                idx = int(token)
                if 0 <= idx < len(current):
                    current = current[idx]
                else:
                    return False
            else:
                return False
        return True

    def set(self, path: str, value: Any) -> None:
        """Sets a value atomically at a JSON Pointer path with auto-vivification."""
        tokens = self._parse_pointer(path)
        if not tokens:
            self._data = copy.deepcopy(value)
            self._trigger_listeners("/", value)
            return

        # Auto-vivification: traverse and construct intermediate dicts/lists
        current = self._data
        for i, token in enumerate(tokens[:-1]):
            next_token = tokens[i + 1]
            is_next_numeric = bool(NUMERIC_PATTERN.match(next_token))

            if isinstance(current, dict):
                if token not in current or not isinstance(current[token], (dict, list)):
                    current[token] = [] if is_next_numeric else {}
                current = current[token]
            elif isinstance(current, list) and NUMERIC_PATTERN.match(token):
                idx = int(token)
                # Expand array if index exceeds size
                while len(current) <= idx:
                    current.append(None)
                if current[idx] is None or not isinstance(current[idx], (dict, list)):
                    current[idx] = [] if is_next_numeric else {}
                current = current[idx]
            else:
                raise ValueError(f"Cannot traverse path segment: {token} in {path}")

        # Set final leaf value
        last_token = tokens[-1]
        if isinstance(current, dict):
            if value is None:
                current.pop(last_token, None)
            else:
                current[last_token] = copy.deepcopy(value)
        elif isinstance(current, list) and NUMERIC_PATTERN.match(last_token):
            idx = int(last_token)
            while len(current) <= idx:
                current.append(None)
            current[idx] = copy.deepcopy(value)
        else:
            raise ValueError(f"Leaf segment is not a container: {last_token}")

        # Trigger notification cascade
        self._trigger_cascade(tokens)

    def subscribe(self, path: str, on_change: Callable[[Any], None]) -> Subscription:
        """Registers a listener to monitor changes reactive to this path."""
        # Normalize path pointer
        norm_path = self._build_pointer(self._parse_pointer(path))
        self._listeners.setdefault(norm_path, set()).add(on_change)

        # Return subscription armed with unsubscription and initial value
        initial = self.get(norm_path)
        return Subscription(
            lambda: self._listeners.get(norm_path, set()).discard(on_change),
            initial_value=initial,
        )

    def _trigger_listeners(self, path: str, value: Any) -> None:
        if path in self._listeners:
            for listener in list(self._listeners[path]):
                try:
                    listener(value)
                except Exception:
                    pass

    def _trigger_cascade(self, tokens: List[str]) -> None:
        """Notifies listeners cascading both bubble-up (parents) and cascade-down (children)."""
        # 1. Bubble Up: Notify all parent paths
        for length in range(len(tokens) + 1):
            parent_tokens = tokens[:length]
            parent_path = self._build_pointer(parent_tokens)
            self._trigger_listeners(parent_path, self.get(parent_path))

        # 2. Cascade Down: Find and notify all nested descendants
        for registered_path in list(self._listeners.keys()):
            reg_tokens = self._parse_pointer(registered_path)
            if len(reg_tokens) > len(tokens) and reg_tokens[: len(tokens)] == tokens:
                self._trigger_listeners(registered_path, self.get(registered_path))

    def dispose(self) -> None:
        """Disposes of the data model and all its listeners."""
        self._listeners.clear()
