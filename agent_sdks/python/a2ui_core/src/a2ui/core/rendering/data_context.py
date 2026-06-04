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
import warnings
from typing import Any, Callable, Dict, List, Optional, Union
from ..state import DataModel
from ..common.events import Subscription, EventSource

EXPRESSION_PATTERN = re.compile(r"(\\)?\$\{(.*?)\}")


class MissingDataBindingWarning(UserWarning):
    """Triggered when resolving a DataBinding whose path does not physically exist in the DataModel yet."""

    pass


class DataContext:
    """Headless evaluation scope for resolving A2UI dynamic bindings and expressions."""

    def __init__(
        self,
        path: str = "/",
        data_model: Optional[DataModel] = None,
        catalog: Optional[Any] = None,
        surface: Optional[Any] = None,
    ):
        self.surface = surface
        self.path = path if path.endswith("/") else f"{path}/"
        if self.surface:
            self.data_model = getattr(
                self.surface, "data_model", data_model or DataModel()
            )
            self.catalog = getattr(self.surface, "catalog", catalog)
        else:
            self.data_model = data_model or DataModel()
            self.catalog = catalog

    @property
    def locale(self) -> Optional[str]:
        """Gets the locale for this context, inherited from the surface."""
        return getattr(self.surface, "locale", None) if self.surface else None

    def nested(self, relative_path: str) -> "DataContext":
        """Creates a nested child context scope (e.g. for template item bindings)."""
        norm_rel = relative_path[1:] if relative_path.startswith("/") else relative_path
        return DataContext(
            path=f"{self.path}{norm_rel}",
            data_model=self.data_model,
            catalog=self.catalog,
            surface=self.surface,
        )

    def resolve_path(self, absolute_or_relative: str) -> str:
        """Resolves a relative path string against this context scope path."""
        if absolute_or_relative.startswith("/"):
            return absolute_or_relative
        base_path = self.path.rstrip("/")
        if not absolute_or_relative:
            return base_path if base_path else "/"
        return f"{base_path}/{absolute_or_relative}"

    def resolve_dynamic_value(self, value: Any) -> Any:
        """Recursively evaluates Literals, Data Paths, and Function Calls against the active DataModel."""
        if value is None:
            return None

        # 1. Handle Data Path binding dictionaries: {"path": "/user/name"}
        if (
            isinstance(value, dict)
            and "path" in value
            and isinstance(value["path"], str)
            and "componentId" not in value
        ):
            resolved_path = self.resolve_path(value["path"])

            # Hybrid Preflight Warning Sniffer
            if hasattr(self.data_model, "has_path") and not self.data_model.has_path(
                resolved_path
            ):
                warnings.warn(
                    f"Preflight DataBinding Warning: The bound JSON Pointer '{resolved_path}' does not physically exist in the active DataModel. Evaluating to None.",
                    MissingDataBindingWarning,
                    stacklevel=2,
                )

            return self.data_model.get(resolved_path)

        # 2. Handle Function Call binding dictionaries: {"call": "formatString", "args": {...}}
        if (
            isinstance(value, dict)
            and "call" in value
            and isinstance(value["call"], str)
        ):
            func_name = value["call"]
            raw_args = value.get("args", {})

            # Recursively resolve function arguments first
            resolved_args = self.resolve_dynamic_value(raw_args)
            return self._execute_function(func_name, resolved_args)

        # 3. Recurse into lists/arrays
        if isinstance(value, list):
            return [self.resolve_dynamic_value(item) for item in value]

        # 4. Recurse into normal objects/dictionaries
        if isinstance(value, dict):
            return {k: self.resolve_dynamic_value(v) for k, v in value.items()}

        # 5. Return static literals directly
        return value

    def resolve_action(self, action: Dict[str, Any]) -> Any:
        """
        Resolves an action by evaluating its top-level dynamic values.
        For event actions, resolves each value in the context map.
        For function call actions, evaluates the call.
        """
        if isinstance(action, dict) and "event" in action:
            evt = copy.deepcopy(action["event"])
            resolved_context = {}
            if isinstance(evt.get("context"), dict):
                for k, v in evt["context"].items():
                    resolved_context[k] = self.resolve_dynamic_value(v)
            evt["context"] = resolved_context
            return {"event": evt}
        if isinstance(action, dict) and "functionCall" in action:
            return self.resolve_dynamic_value(action["functionCall"])
        return action

    def subscribe_dynamic_value(
        self, value: Any, on_change: Callable[[Any], None]
    ) -> Subscription:
        """Subscribes reactively to a dynamic path or function."""
        if (
            isinstance(value, dict)
            and "path" in value
            and isinstance(value["path"], str)
            and "componentId" not in value
        ):
            resolved_path = self.resolve_path(value["path"])

            # Hybrid Preflight Warning Sniffer
            if hasattr(self.data_model, "has_path") and not self.data_model.has_path(
                resolved_path
            ):
                warnings.warn(
                    f"Preflight DataBinding Warning: The bound JSON Pointer '{resolved_path}' does not physically exist in the active DataModel. Evaluating to None.",
                    MissingDataBindingWarning,
                    stacklevel=2,
                )

            return self.data_model.subscribe(resolved_path, on_change)

        # Headless server-side fallback: If complex function subscription, we run immediately
        initial = self.resolve_dynamic_value(value)
        on_change(initial)
        # Return a dummy subscription
        return Subscription(lambda: None, initial_value=initial)

    def _execute_function(self, name: str, resolved_args: Dict[str, Any]) -> Any:
        """Invokes standard or catalog functions (e.g., formatString)."""
        if self.catalog and getattr(self.catalog, "invoker", None) is not None:
            try:
                res = self.catalog.invoker(name, resolved_args, self)
                if res is not None:
                    return res
            except Exception as e:
                if self.surface and hasattr(self.surface, "dispatch_error"):
                    self.surface.dispatch_error(
                        {
                            "code": "EXPRESSION_ERROR",
                            "message": str(e),
                            "expression": name,
                        }
                    )
