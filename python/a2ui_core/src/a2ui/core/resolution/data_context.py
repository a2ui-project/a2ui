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

from __future__ import annotations

import copy
import inspect
import warnings
from typing import Any, Callable, Generic
from ..catalog.catalog import Catalog, TComponent, TFunction
from ..state import DataModel
from ..state.surface_model import SurfaceModel
from ..validation.payload_validator import MAX_FUNCTION_CALL_ARGS, PayloadValidator
from ..common.events import Subscription, EventSource, Signal, AbortSignal


class MissingDataBindingWarning(UserWarning):
    """Triggered when resolving a DataBinding whose path does not physically exist in the DataModel yet."""

    pass


class DataContext(Generic[TComponent, TFunction]):
    """Headless evaluation scope for resolving A2UI dynamic bindings and expressions."""

    def __init__(
        self,
        surface: SurfaceModel[TComponent, TFunction],
        path: str = "/",
        index: int | None = None,
        parent: DataContext[TComponent, TFunction] | None = None,
    ):
        self.surface = surface
        self.path = path if path.endswith("/") else f"{path}/"
        self.data_model = surface.data_model
        self._index = index
        self.parent = parent

    @property
    def locale(self) -> str | None:
        """Gets the locale for this context, inherited from the surface."""
        return getattr(self.surface, "locale", None)

    @property
    def index(self) -> int | None:
        """Returns active iteration index if inside a collection template scope, or None."""
        ctx: DataContext | None = self
        while ctx is not None:
            if ctx._index is not None:
                return ctx._index
            parts = [p for p in ctx.path.strip("/").split("/") if p]
            if parts and parts[-1].isdigit():
                return int(parts[-1])
            ctx = ctx.parent
        return None

    def nested(
        self, relative_path: str, index: int | None = None
    ) -> DataContext[TComponent, TFunction]:
        """Creates a nested child context scope (e.g. for template item bindings)."""
        norm_rel = relative_path[1:] if relative_path.startswith("/") else relative_path
        return DataContext(
            surface=self.surface,
            path=f"{self.path}{norm_rel}",
            index=index,
            parent=self,
        )

    def resolve_path(self, absolute_or_relative: str) -> str:
        """Resolves a relative path string against this context scope path."""
        if absolute_or_relative.startswith("/"):
            return absolute_or_relative
        base_path = self.path.rstrip("/")
        if not absolute_or_relative:
            return base_path if base_path else "/"
        return f"{base_path}/{absolute_or_relative}"

    def set(self, path: str, value: Any) -> None:
        """Sets a value in the DataModel relative to this DataContext path."""
        absolute_path = self.resolve_path(path)
        self.data_model.set(absolute_path, value)

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
        self, value: Any, peek: bool = True, abort_signal: AbortSignal | None = None
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
                    "Preflight DataBinding Warning: The bound JSON Pointer"
                    f" '{resolved_path}' does not physically exist in the active"
                    " DataModel. Evaluating to None.",
                    MissingDataBindingWarning,
                    stacklevel=2,
                )

            return self.data_model.get(resolved_path)

        # 2. Handle Function Call binding dictionaries: {"call": "formatString", "args": {...}, "catalogId": "..."}
        if (
            isinstance(value, dict)
            and "call" in value
            and isinstance(value["call"], str)
        ):
            func_name = value["call"]
            raw_args = value.get("args", {})
            cat_id = value.get("catalogId") or value.get("catalog_id")

            # Recursively resolve function arguments first
            resolved_args = self.resolve_dynamic_value(
                raw_args, peek=True, abort_signal=abort_signal
            )
            res = self._execute_function(
                func_name, resolved_args, catalog_id=cat_id, abort_signal=abort_signal
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

    def resolve_action(self, action: dict[str, Any]) -> Any:
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
            if "userMessage" in evt and evt["userMessage"] is not None:
                evt["userMessage"] = self.resolve_dynamic_value(evt["userMessage"])
            return {"event": evt}
        if isinstance(action, dict) and "functionCall" in action:
            return self.resolve_dynamic_value(action["functionCall"])
        return action

    def subscribe_dynamic_value(
        self, value: Any, on_change: Callable[[Any], None]
    ) -> Subscription:
        """Subscribes reactively to dynamic paths, chained function expressions, or active streaming functions."""
        paths: set[str] = set()

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
                        f"Preflight DataBinding Warning: The bound JSON Pointer '{p}'"
                        " does not physically exist in the active DataModel."
                        " Evaluating to None.",
                        MissingDataBindingWarning,
                        stacklevel=2,
                    )

        path_subs: list[Subscription] = []
        stream_sub: list[Any] = []  # Holds subscription to returned EventSource stream
        abort_controller: list[AbortSignal] = []
        UNSET = object()
        current_val: list[Any] = [UNSET]
        is_sync: list[bool] = [True]

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
        resolved_args: dict[str, Any],
        catalog_id: str | None = None,
        abort_signal: AbortSignal | None = None,
    ) -> Any:
        from ..exceptions import A2uiCatalogError, A2uiExpressionError

        try:
            if (
                isinstance(resolved_args, dict)
                and len(resolved_args) > MAX_FUNCTION_CALL_ARGS
            ):
                raise A2uiExpressionError(
                    f"Function call '{name}' exceeds maximum allowed arguments count"
                    f" ({MAX_FUNCTION_CALL_ARGS})"
                )

            target_catalog: Catalog[TComponent, TFunction] | None = None
            if catalog_id is not None:
                target_catalog = self.surface.available_catalogs.get(catalog_id)
                if not target_catalog:
                    raise A2uiCatalogError(f"Catalog not found: {catalog_id}")
            else:
                target_catalog = self.surface.default_catalog

            val_args = PayloadValidator(catalog=target_catalog).validate_function(
                name, resolved_args
            )
            if isinstance(val_args, dict):
                resolved_args = val_args

            fn = (
                target_catalog.get_function(name)
                if hasattr(target_catalog, "get_function")
                else None
            )
            if fn is None:
                catalog_desc = (
                    f"catalog '{target_catalog.catalog_id}'"
                    if hasattr(target_catalog, "catalog_id")
                    else "catalog"
                )
                raise A2uiCatalogError(
                    f"Function '{name}' not found in {catalog_desc}."
                )

            if hasattr(fn, "execute") and callable(fn.execute):
                return fn.execute(resolved_args, self, abort_signal)
            if hasattr(fn, "execute_func") and callable(fn.execute_func):
                return fn.execute_func(resolved_args, self, abort_signal)
            if callable(fn):
                return fn(resolved_args, self, abort_signal)
            return None
        except Exception as e:
            if self.surface and hasattr(self.surface, "dispatch_error"):
                error_payload: dict[str, Any] = {
                    "code": "EXPRESSION_ERROR",
                    "message": str(e),
                    "expression": name,
                }
                if hasattr(e, "details") and getattr(e, "details"):
                    error_payload["details"] = getattr(e, "details")
                self.surface.dispatch_error(error_payload)
                return None
            raise
