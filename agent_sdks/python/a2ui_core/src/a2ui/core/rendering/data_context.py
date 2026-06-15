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
import inspect
import re
import warnings
from typing import Any, Callable, Dict, List, Optional, Set, Union
from ..state import DataModel
from ..state.surface_model import SurfaceModel
from ..validating import CatalogSchemaValidator
from ..common.events import Subscription, EventSource, Signal, AbortSignal

EXPRESSION_PATTERN = re.compile(r"(\\)?\$\{(.*?)\}")


class MissingDataBindingWarning(UserWarning):
    """Triggered when resolving a DataBinding whose path does not physically exist in the DataModel yet."""

    pass


class DataContext:
    """Headless evaluation scope for resolving A2UI dynamic bindings and expressions."""

    def __init__(
        self,
        surface: SurfaceModel,
        path: str = "/",
    ):
        self.surface = surface
        self.path = path if path.endswith("/") else f"{path}/"
        self.data_model = surface.data_model

    @property
    def locale(self) -> Optional[str]:
        """Gets the locale for this context, inherited from the surface."""
        return getattr(self.surface, "locale", None)

    def nested(self, relative_path: str) -> "DataContext":
        """Creates a nested child context scope (e.g. for template item bindings)."""
        norm_rel = relative_path[1:] if relative_path.startswith("/") else relative_path
        return DataContext(
            surface=self.surface,
            path=f"{self.path}{norm_rel}",
        )

    def resolve_path(self, absolute_or_relative: str) -> str:
        """Resolves a relative path string against this context scope path."""
        if absolute_or_relative.startswith("/"):
            return absolute_or_relative
        base_path = self.path.rstrip("/")
        if not absolute_or_relative:
            return base_path if base_path else "/"
        return f"{base_path}/{absolute_or_relative}"

    @staticmethod
    def _peek_value(obj: Any) -> Any:
        if hasattr(obj, "peek") and callable(obj.peek):
            return obj.peek()
        if hasattr(obj, "value"):
            return obj.value
        if hasattr(obj, "get_value") and callable(obj.get_value):
            return obj.get_value()
        return obj

    def resolve_dynamic_value(
        self, value: Any, peek: bool = True, abort_signal: Optional[AbortSignal] = None
    ) -> Any:
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
            resolved_args = self.resolve_dynamic_value(
                raw_args, peek=True, abort_signal=abort_signal
            )
            res = self._execute_function(
                func_name, resolved_args, abort_signal=abort_signal
            )
            return self._peek_value(res) if peek else res

        # 3. Recurse into lists/arrays
        if isinstance(value, list):
            return [
                self.resolve_dynamic_value(item, peek=peek, abort_signal=abort_signal)
                for item in value
            ]

        # 4. Recurse into normal objects/dictionaries
        if isinstance(value, dict):
            return {
                k: self.resolve_dynamic_value(v, peek=peek, abort_signal=abort_signal)
                for k, v in value.items()
            }

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
        """Subscribes reactively to dynamic paths, chained function expressions, or active streaming functions."""
        paths: Set[str] = set()

        def _extract_paths(val: Any) -> None:
            if (
                isinstance(val, dict)
                and "path" in val
                and isinstance(val["path"], str)
                and "componentId" not in val
            ):
                paths.add(self.resolve_path(val["path"]))
            elif isinstance(val, dict):
                for v in val.values():
                    _extract_paths(v)
            elif isinstance(val, list):
                for item in val:
                    _extract_paths(item)

        _extract_paths(value)

        # Check preflight warnings for all extracted paths
        if paths and hasattr(self.data_model, "has_path"):
            for p in paths:
                if not self.data_model.has_path(p):
                    warnings.warn(
                        f"Preflight DataBinding Warning: The bound JSON Pointer '{p}' does not physically exist in the active DataModel. Evaluating to None.",
                        MissingDataBindingWarning,
                        stacklevel=2,
                    )

        path_subs: List[Subscription] = []
        stream_sub: List[Any] = []  # Holds subscription to returned EventSource stream
        abort_controller: List[AbortSignal] = []
        UNSET = object()
        current_val: List[Any] = [UNSET]
        is_sync: List[bool] = [True]

        def _update_output(new_val: Any) -> None:
            current_val[0] = new_val
            if not is_sync[0]:
                on_change(new_val)

        def _run_evaluation(dummy: Any = None) -> None:
            if abort_controller:
                abort_controller[0].abort()
                abort_controller.clear()
            if stream_sub:
                for s in stream_sub:
                    if hasattr(s, "unsubscribe") and callable(s.unsubscribe):
                        s.unsubscribe()
                stream_sub.clear()

            sig = AbortSignal()
            abort_controller.append(sig)

            raw_res = self.resolve_dynamic_value(value, peek=False, abort_signal=sig)

            if hasattr(raw_res, "subscribe") and callable(raw_res.subscribe):
                # Arm the active stream subscription
                sub = raw_res.subscribe(_update_output)
                stream_sub.append(sub)

                # Initialize concrete output if not already emitted by BehaviorSubject/Signal
                if current_val[0] is UNSET:
                    init_val = self._peek_value(raw_res)
                    current_val[0] = init_val
                    if not is_sync[0]:
                        on_change(init_val)
            else:
                current_val[0] = raw_res
                if not is_sync[0]:
                    on_change(raw_res)

        if paths:
            for p in paths:
                path_subs.append(self.data_model.subscribe(p, _run_evaluation))

        def _unsubscribe_all() -> None:
            if abort_controller:
                abort_controller[0].abort()
                abort_controller.clear()
            for s in path_subs:
                s.unsubscribe()
            for s in stream_sub:
                if hasattr(s, "unsubscribe") and callable(s.unsubscribe):
                    s.unsubscribe()
            stream_sub.clear()

        # Run evaluation once initially to execute function and arm active streams
        _run_evaluation()
        is_sync[0] = False

        return Subscription(_unsubscribe_all, initial_value=current_val[0])

    def _execute_function(
        self,
        name: str,
        resolved_args: Dict[str, Any],
        abort_signal: Optional[AbortSignal] = None,
    ) -> Any:
        """Invokes standard or catalog functions (e.g., formatString)."""
        if self.surface.catalog:
            if self.surface.catalog.catalog_schema:
                try:
                    CatalogSchemaValidator.from_catalog(
                        self.surface.catalog
                    ).validate_function(name, resolved_args)
                except Exception as e:
                    if self.surface and hasattr(self.surface, "dispatch_error"):
                        self.surface.dispatch_error(
                            {
                                "code": "EXPRESSION_ERROR",
                                "message": str(e),
                                "expression": name,
                            }
                        )
                        return None
                    else:
                        raise

            fn = self.surface.catalog.get_function(name)

            if fn is not None:
                try:
                    if hasattr(fn, "execute") and callable(fn.execute):
                        res = fn.execute(resolved_args, self, abort_signal)
                    elif hasattr(fn, "execute_func") and callable(fn.execute_func):
                        res = fn.execute_func(resolved_args, self, abort_signal)
                    elif callable(fn):
                        res = fn(resolved_args, self, abort_signal)
                    else:
                        res = None

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
                    else:
                        raise

        return None
