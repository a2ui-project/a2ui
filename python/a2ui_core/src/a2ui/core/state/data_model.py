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

import copy
import re
from typing import Any, Callable
from ..common.events import Subscription
from ..exceptions import A2uiDataError

# Regex to check if path segment is numeric (representing array index)
NUMERIC_PATTERN = re.compile(r"^(?:0|[1-9][0-9]*)$")


class DataModel:
    """An atomic RFC 6901 JSON Pointer reactive store."""

    def __init__(self, initial_data: dict[str, Any] | None = None):
        self._data = copy.deepcopy(initial_data if initial_data is not None else {})
        self._listeners: dict[str, list[Callable[[Any], None]]] = {}

    @staticmethod
    def _parse_pointer(path: str) -> list[str]:
        """Splits a JSON Pointer path into individual unescaped tokens."""
        if not path or path == "/":
            return []
        if len(path) > 1 and path.endswith("/"):
            path = path[:-1]
        if not path.startswith("/"):
            tokens = path.split("/")
        else:
            tokens = path[1:].split("/")
        return [t.replace("~1", "/").replace("~0", "~") for t in tokens]

    @staticmethod
    def _build_pointer(tokens: list[str]) -> str:
        """Assembles unescaped tokens back into an absolute JSON Pointer."""
        if not tokens:
            return "/"
        escaped = [t.replace("~", "~0").replace("/", "~1") for t in tokens]
        return "/" + "/".join(escaped)

    @staticmethod
    def resolve_path(path: str, context_path: str | None = None) -> str:
        """Resolves a relative path against a base context path."""
        if path.startswith("/"):
            return path
        if context_path:
            base = context_path if context_path.endswith("/") else f"{context_path}/"
            return f"{base}{path}"
        return f"/{path}"

    def get(self, path: str) -> Any:
        """Resolves the JSON Pointer path to its current value."""
        if path is None:
            raise A2uiDataError("Path cannot be null or undefined.")
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
        if path is None:
            raise A2uiDataError("Path cannot be null or undefined.")

        tokens = self._parse_pointer(path)

        # Snapshot old values for all currently watched paths before mutation
        old_values = {p: copy.deepcopy(self.get(p)) for p in self._listeners.keys()}

        if not tokens:
            self._data = copy.deepcopy(value) if value is not None else {}
            self._trigger_cascade(tokens, old_values)
            return

        if self._data is None or not isinstance(self._data, (dict, list)):
            self._data = {}

        # Auto-vivification: traverse and construct intermediate dicts/lists
        current = self._data
        for i, token in enumerate(tokens[:-1]):
            next_token = tokens[i + 1]
            is_next_numeric = bool(NUMERIC_PATTERN.match(next_token))

            if isinstance(current, dict):
                if token in current:
                    val = current[token]
                    if val is not None and not isinstance(val, (dict, list)):
                        raise A2uiDataError(
                            f"Cannot set path '{path}': segment '{token}' is a"
                            " primitive value."
                        )
                else:
                    current[token] = [] if is_next_numeric else {}
                if current[token] is None:
                    current[token] = [] if is_next_numeric else {}
                current = current[token]
            elif isinstance(current, list):
                if not NUMERIC_PATTERN.match(token):
                    raise A2uiDataError(
                        f"Cannot use non-numeric segment '{token}' on an array in path"
                        f" '{path}'."
                    )
                idx = int(token)
                while len(current) <= idx:
                    current.append(None)
                val = current[idx]
                if val is not None and not isinstance(val, (dict, list)):
                    raise A2uiDataError(
                        f"Cannot set path '{path}': segment '{token}' is a primitive"
                        " value."
                    )
                if current[idx] is None:
                    current[idx] = [] if is_next_numeric else {}
                current = current[idx]
            else:
                raise A2uiDataError(
                    f"Cannot set path '{path}': segment '{token}' is a primitive value."
                )

        # Set final leaf value
        last_token = tokens[-1]
        if isinstance(current, dict):
            if value is None:
                current.pop(last_token, None)
            else:
                current[last_token] = copy.deepcopy(value)
        elif isinstance(current, list):
            if not NUMERIC_PATTERN.match(last_token):
                raise A2uiDataError(
                    f"Cannot use non-numeric segment '{last_token}' on an array in path"
                    f" '{path}'."
                )
            idx = int(last_token)
            while len(current) <= idx:
                current.append(None)
            current[idx] = copy.deepcopy(value)
        else:
            raise A2uiDataError(
                f"Cannot set path '{path}': segment '{last_token}' is a primitive"
                " value."
            )

        # Trigger notification cascade
        self._trigger_cascade(tokens, old_values)

    def delete(self, path: str) -> "DataModel":
        """Deletes the value at the specified JSON pointer path."""
        self.set(path, None)
        return self

    def subscribe(self, path: str, on_change: Callable[[Any], None]) -> Subscription:
        """Registers a listener to monitor changes reactive to this path."""
        norm_path = self._build_pointer(self._parse_pointer(path))
        self._listeners.setdefault(norm_path, []).append(on_change)

        initial = self.get(norm_path)
        return Subscription(
            lambda: self._remove_listener(norm_path, on_change),
            initial_value=initial,
        )

    def _remove_listener(
        self, norm_path: str, on_change: Callable[[Any], None]
    ) -> None:
        if norm_path in self._listeners:
            try:
                self._listeners[norm_path].remove(on_change)
            except ValueError:
                pass
            if not self._listeners[norm_path]:
                del self._listeners[norm_path]

    def _trigger_cascade(self, tokens: list[str], old_values: dict[str, Any]) -> None:
        """Notifies listeners cascading both bubble-up (parents) and cascade-down (children)."""
        for registered_path, listener_list in list(self._listeners.items()):
            p_tokens = self._parse_pointer(registered_path)
            is_relevant = (
                p_tokens == tokens
                or (len(p_tokens) < len(tokens) and tokens[: len(p_tokens)] == p_tokens)
                or (len(p_tokens) > len(tokens) and p_tokens[: len(tokens)] == tokens)
            )
            if is_relevant:
                new_val = self.get(registered_path)
                old_val = old_values.get(registered_path)
                if old_val != new_val:
                    for listener in list(listener_list):
                        try:
                            listener(new_val)
                        except Exception:
                            pass

    def dispose(self) -> None:
        """Disposes of the data model and all its listeners."""
        self._listeners.clear()
