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
from typing import Any, Callable, Final
from ..catalog.catalog import CatalogApi
from ..state.data_model import DataModel
from ..state.surface_model import SurfaceModel
from ..validation.payload_validator import MAX_FUNCTION_CALL_ARGS, PayloadValidator
from ..common.events import Subscription, EventSource, Signal, AbortSignal
from ..schema import ProtocolVersion
from ..common.semver import is_at_least_version


class MissingDataBindingWarning(UserWarning):
    """Triggered when resolving a DataBinding whose path does not physically exist in the DataModel yet."""

    pass


def is_single_at_key(key: str) -> bool:
    """Checks whether a key starts with a single '@' (not doubled '@@')."""
    return key.startswith("@") and not key.startswith("@@")


def unescape_object_key(key: str) -> str:
    """Unescapes a doubled '@' prefix ('@@path' -> '@path') in v1.0."""
    return key[1:] if key.startswith("@@") else key


RESERVED_DIRECTIVES: Final[set[str]] = {"@path", "@call"}


def validate_reserved_directives(keys: Any, protocol_version: str | None) -> None:
    """Validates that single-@ keys in a dynamic object are recognized directives."""
    if not protocol_version or not is_at_least_version(
        protocol_version, ProtocolVersion.V1_0
    ):
        return
    for k in keys:
        if is_single_at_key(k) and k not in RESERVED_DIRECTIVES:
            from ..exceptions import A2uiErrorDetail, A2uiValidationError

            msg = (
                f"Unrecognized reserved protocol directive '{k}' in v1.0 dynamic"
                " object. Reserved keys must be in"
                f" {', '.join(sorted(RESERVED_DIRECTIVES))}, or escaped with prefix"
                f" doubling (e.g. '@{k}')."
            )
            raise A2uiValidationError(
                msg,
                details=[
                    A2uiErrorDetail(
                        path="",
                        code="INVALID_RESERVED_KEY",
                        message=msg,
                    )
                ],
            )


class DataContext:
    """Headless evaluation scope for resolving A2UI dynamic bindings and expressions."""

    def __init__(
        self,
        surface: SurfaceModel,
        path: str = "/",
        index: int | None = None,
        parent: DataContext | None = None,
    ):
        self.surface = surface
        self.path = path if path.endswith("/") else f"{path}/"
        self.data_model = surface.data_model
        self._index = index
        self.parent = parent
        if parent is not None:
            self._warned_paths: set[str] = parent._warned_paths
        elif surface is not None:
            surface_warned = getattr(surface, "_warned_paths", None)
            if not isinstance(surface_warned, set):
                surface_warned = set()
                setattr(surface, "_warned_paths", surface_warned)
            self._warned_paths = surface_warned
        else:
            self._warned_paths = set()
        self._cached_is_v10: bool | None = None

    @property
    def is_v10(self) -> bool:
        """Whether this context targets A2UI protocol v1.0 or newer."""
        if self._cached_is_v10 is None:
            proto_ver = getattr(
                getattr(self.surface, "default_catalog", None),
                "protocol_version",
                None,
            )
            self._cached_is_v10 = bool(
                proto_ver and is_at_least_version(proto_ver, ProtocolVersion.V1_0)
            )
        return self._cached_is_v10

    def _emit_missing_data_binding_warning(self, resolved_path: str) -> None:
        """Emits MissingDataBindingWarning and dispatches deduplicated surface warning."""
        msg = (
            "Preflight DataBinding Warning: The bound JSON Pointer"
            f" '{resolved_path}' does not physically exist in the active"
            " DataModel. Evaluating to None."
        )
        warnings.warn(msg, MissingDataBindingWarning, stacklevel=3)
        if resolved_path not in self._warned_paths:
            self._warned_paths.add(resolved_path)
            if self.surface and hasattr(self.surface, "dispatch_warning"):
                self.surface.dispatch_warning({
                    "code": "MISSING_DATA_BINDING",
                    "path": resolved_path,
                    "message": msg,
                })

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

    def nested(self, relative_path: str, index: int | None = None) -> DataContext:
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
        if not absolute_or_relative or absolute_or_relative == ".":
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

        is_v10 = self.is_v10
        proto_ver = getattr(
            getattr(self.surface, "default_catalog", None),
            "protocol_version",
            None,
        )

        # 1. Handle Data Path binding dictionaries:
        # In v1.0: {"@path": "/user/name"}
        # In v0.9: {"path": "/user/name"}
        if isinstance(value, dict) and "componentId" not in value:
            has_path = (
                ("@path" in value and isinstance(value["@path"], str))
                if is_v10
                else ("path" in value and isinstance(value["path"], str))
            )
            if has_path:
                binding_path = value["@path"] if is_v10 else value["path"]
                resolved_path = self.resolve_path(binding_path)

                # Hybrid Preflight Warning Sniffer
                if hasattr(
                    self.data_model, "has_path"
                ) and not self.data_model.has_path(resolved_path):
                    self._emit_missing_data_binding_warning(resolved_path)

                return self.data_model.get(resolved_path)

        # 2. Handle Function Call binding dictionaries:
        # In v1.0: {"@call": "formatString", "args": {...}, "catalogId": "..."}
        # In v0.9: {"call": "formatString", "args": {...}, "catalogId": "..."}
        if isinstance(value, dict):
            has_call = (
                ("@call" in value and isinstance(value["@call"], str))
                if is_v10
                else ("call" in value and isinstance(value["call"], str))
            )
            if has_call:
                from ..validation.payload_validator import MAX_FUNCTION_CALL_ARGS

                func_name = value["@call"] if is_v10 else value["call"]
                raw_args = value.get("args", {})
                cat_id = value.get("catalogId") or value.get("catalog_id")

                # Check argument count limit before recursively resolving arguments
                if (
                    isinstance(raw_args, dict)
                    and len(raw_args) > MAX_FUNCTION_CALL_ARGS
                ):
                    resolved_args = raw_args
                else:
                    resolved_args = self.resolve_dynamic_value(
                        raw_args, peek=True, abort_signal=abort_signal
                    )
                res = self._execute_function(
                    func_name,
                    resolved_args,
                    catalog_id=cat_id,
                    abort_signal=abort_signal,
                )
                return self._peek_value(res) if peek else res

        # 3. Recurse into lists/arrays
        if isinstance(value, list):
            return [
                self.resolve_dynamic_value(item, peek=peek, abort_signal=abort_signal)
                for item in value
            ]

        # 4. Recurse into normal objects/dictionaries (with v1.0 escaping and validation)
        if isinstance(value, dict):
            if is_v10:
                validate_reserved_directives(value.keys(), proto_ver or "v1.0")
                return {
                    unescape_object_key(k): self.resolve_dynamic_value(
                        v, peek=peek, abort_signal=abort_signal
                    )
                    for k, v in value.items()
                }
            return {
                k: self.resolve_dynamic_value(v, peek=peek, abort_signal=abort_signal)
                for k, v in value.items()
            }

        # 5. Return static literals directly
        return value

    def _resolve_action_context(self, context: Any) -> dict[str, Any]:
        if not isinstance(context, dict):
            return {}
        return {k: self.resolve_dynamic_value(v) for k, v in context.items()}

    def resolve_action(self, action: dict[str, Any]) -> Any:
        """Resolves an action by evaluating its top-level dynamic values."""
        if not isinstance(action, dict):
            return action

        if isinstance(action.get("event"), dict):
            evt = dict(action["event"])
            if "context" in evt:
                evt["context"] = self._resolve_action_context(evt["context"])
            if evt.get("userMessage") is not None:
                evt["userMessage"] = self.resolve_dynamic_value(evt["userMessage"])
            return {**action, "event": evt}

        if "name" in action:
            resolved = dict(action)
            if "context" in action:
                resolved["context"] = self._resolve_action_context(action["context"])
            if action.get("userMessage") is not None:
                resolved["userMessage"] = self.resolve_dynamic_value(
                    action["userMessage"]
                )
            return resolved

        if "functionCall" in action:
            return self.resolve_dynamic_value(action["functionCall"])
        if isinstance(action.get("@call"), str) or isinstance(action.get("call"), str):
            return self.resolve_dynamic_value(action)

        return action

    def subscribe_dynamic_value(
        self, value: Any, on_change: Callable[[Any], None]
    ) -> Subscription:
        """Subscribes reactively to dynamic paths, chained function expressions, or active streaming functions."""
        paths: set[str] = set()

        def _extract_paths(val: Any) -> None:
            if isinstance(val, dict) and "componentId" not in val:
                has_path = (
                    ("@path" in val and isinstance(val["@path"], str))
                    if self.is_v10
                    else ("path" in val and isinstance(val["path"], str))
                )
                if has_path:
                    binding_path = val["@path"] if self.is_v10 else val["path"]
                    paths.add(self.resolve_path(binding_path))
                    return
            if isinstance(val, dict):
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
                    self._emit_missing_data_binding_warning(p)

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

            target_catalog: CatalogApi | None = None
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
