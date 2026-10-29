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

import asyncio
import copy
import inspect
from typing import Any, Callable, Final
import warnings

from ..catalog import is_system_function_name, system_functions_for
from ..common.events import AbortSignal, EventSource, Signal, Subscription
from ..common.semver import is_at_least_version
from ..exceptions import (
    A2uiCatalogError,
    A2uiErrorDetail,
    A2uiExpressionError,
    A2uiValidationError,
)
from ..schema import ProtocolVersion
from ..state.data_model import DataModel
from ..state.surface_model import AgentFunctionCall, SurfaceModel
from ..validation.payload_validator import (
    MAX_FUNCTION_CALL_ARGS,
    PayloadValidator,
    ValidationConfig,
    validate_system_function,
)
from .validation_result_coercion import coerce_validation_results


class MissingDataBindingWarning(UserWarning):
    """Triggered when resolving a DataBinding whose path does not physically exist in the DataModel yet."""

    pass


# Validates the arguments of a call to a function the resolved catalog does not
# declare, which is routed to the agent: their shape and identifiers are
# checked, but the function itself is not looked up.
_UNDECLARED_FUNCTION_VALIDATION: Final[ValidationConfig] = ValidationConfig(
    allow_unknown_elements=True
)


class _PendingResult(Signal[Any]):
    """A function result that arrives later, such as an agent function's.

    Its value is None until the result settles. A result that fails settles
    without a value; the failure has been reported as a surface error by then.
    """

    def __init__(self) -> None:
        super().__init__(None)
        self.settled = False
        self.failed = False
        self._on_settled = EventSource()

    def settle(self, value: Any) -> None:
        """Sets the result's value and marks it settled."""
        if self.settled:
            return
        self.settled = True
        self.value = value
        self._on_settled.emit(None)
        self._on_settled.dispose()

    def fail(self) -> None:
        """Marks the result settled without a value."""
        if self.settled:
            return
        self.settled = True
        self.failed = True
        self._on_settled.emit(None)
        self._on_settled.dispose()

    def when_settled(self, callback: Callable[[], None]) -> None:
        """Runs `callback` once the result settles, or now if it has."""
        if self.settled:
            callback()
        else:
            self._on_settled.subscribe(lambda _: callback())


def _collect_pending(value: Any, pending: list[_PendingResult]) -> None:
    """Appends every unsettled `_PendingResult` nested in `value` to `pending`."""
    if isinstance(value, _PendingResult):
        if not value.settled:
            pending.append(value)
    elif isinstance(value, dict):
        for item in value.values():
            _collect_pending(item, pending)
    elif isinstance(value, list):
        for item in value:
            _collect_pending(item, pending)


def _has_failed_result(value: Any) -> bool:
    """Returns whether a `_PendingResult` nested in `value` failed."""
    if isinstance(value, _PendingResult):
        return value.failed
    if isinstance(value, dict):
        return any(_has_failed_result(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_failed_result(item) for item in value)
    return False


_MISSING: Final = object()


def _has_local_implementation(fn: Any) -> bool:
    """Returns whether the renderer can run `fn`.

    A function declared without an implementation (schema-only) cannot be
    run, nor can a `FunctionImplementation` built without logic.
    """
    if fn is None:
        return False
    execute_func = getattr(fn, "execute_func", _MISSING)
    if execute_func is not _MISSING and execute_func is None:
        return False
    return (
        callable(getattr(fn, "execute", None)) or callable(execute_func) or callable(fn)
    )


def _schema_defaults(schema: Any) -> dict[str, Any]:
    """Returns the `default` of each top-level property of a JSON schema."""
    if not isinstance(schema, dict):
        return {}
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        args = schema.get("args") or schema.get("parameters")
        if isinstance(args, dict):
            return _schema_defaults(args)
        return {}
    return {
        key: copy.deepcopy(prop["default"])
        for key, prop in properties.items()
        if isinstance(prop, dict) and "default" in prop
    }


def is_single_at_key(key: str) -> bool:
    """Checks whether a key starts with a single '@' (not doubled '@@')."""
    return key.startswith("@") and not key.startswith("@@")


def _function_args_schema(catalog: Any, fn: Any) -> Any:
    """Returns the argument schema of ``fn`` in ``catalog``.

    A function defined in code carries its Pydantic model; a function read
    from a catalog document carries a JSON schema, which the catalog resolves
    so the catalog's own ``$defs`` are inlined and references to the common
    types become local ``#/$defs/...`` pointers.
    """
    schema = getattr(fn, "schema", None)
    if not isinstance(schema, dict):
        return schema
    resolve = getattr(catalog, "resolved_function_schema", None)
    name = getattr(fn, "name", None)
    if callable(resolve) and isinstance(name, str):
        resolved = resolve(name)
        if isinstance(resolved, dict):
            return resolved
    return schema


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
        self._cached_at_least_v10: bool | None = None
        self._user_activated = False
        self._is_action_execution = False

    @property
    def is_user_activated(self) -> bool:
        """Whether this context evaluates in response to a user gesture.

        It is set while `resolve_action` evaluates an action's function call.
        A function declared with `requires_user_activation` that is routed to
        the agent is sent only then.
        """
        return self._user_activated or bool(
            self.parent is not None and self.parent.is_user_activated
        )

    @property
    def _in_action_execution(self) -> bool:
        """Whether this context is currently evaluating an imperative action."""
        return self._is_action_execution or bool(
            self.parent is not None and self.parent._in_action_execution
        )

    def _surface_protocol_version(self) -> Any:
        """Returns the surface's protocol version, which outlives its default catalog."""
        return getattr(self.surface, "protocol_version", None) or getattr(
            getattr(self.surface, "default_catalog", None),
            "protocol_version",
            None,
        )

    @property
    def at_least_v10(self) -> bool:
        """Whether this context targets A2UI protocol v1.0 or newer."""
        if self._cached_at_least_v10 is None:
            proto_ver = self._surface_protocol_version()
            self._cached_at_least_v10 = bool(
                proto_ver and is_at_least_version(proto_ver, ProtocolVersion.V1_0)
            )
        return self._cached_at_least_v10

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
        self,
        value: Any,
        peek: bool = True,
        abort_signal: AbortSignal | None = None,
        _keep_failed: bool = False,
    ) -> Any:
        """Recursively evaluates Literals, Data Paths, and Function Calls against the active DataModel."""
        if value is None:
            return None

        at_least_v10 = self.at_least_v10
        proto_ver = self._surface_protocol_version()

        # 1. Handle Data Path binding dictionaries:
        # In v1.0: {"@path": "/user/name"}
        # In v0.9: {"path": "/user/name"}
        if isinstance(value, dict) and "componentId" not in value:
            has_path = (
                ("@path" in value and isinstance(value["@path"], str))
                if at_least_v10
                else ("path" in value and isinstance(value["path"], str))
            )
            if has_path:
                binding_path = value["@path"] if at_least_v10 else value["path"]
                resolved_path = self.resolve_path(binding_path)

                # Hybrid Preflight Warning Sniffer
                if hasattr(
                    self.data_model, "has_path"
                ) and not self.data_model.has_path(resolved_path):
                    self._emit_missing_data_binding_warning(resolved_path)

                return self.data_model.get(resolved_path)

        # 2. Handle Function Call binding dictionaries:
        # In v1.0: {"@call": "formatString", "args": {...}, "catalogId": "..."}
        # In v0.9: {"call": "formatString", "args": {...}}
        if isinstance(value, dict):
            has_call = (
                ("@call" in value and isinstance(value["@call"], str))
                if at_least_v10
                else ("call" in value and isinstance(value["call"], str))
            )
            if has_call:
                func_name = value["@call"] if at_least_v10 else value["call"]
                raw_args = value.get("args", {})
                # A call names its own catalog only from v1.0. Before that it
                # runs in the surface catalog, whatever catalogId it carries.
                # An empty catalogId names a catalog too (one that never
                # exists), so it does not fall back to the surface default.
                names_catalog = at_least_v10 and (
                    "catalogId" in value or "catalog_id" in value
                )
                cat_id = (
                    (
                        value["catalogId"]
                        if "catalogId" in value
                        else value.get("catalog_id")
                    )
                    if at_least_v10
                    else None
                )

                res = self._execute_function(
                    func_name,
                    raw_args,
                    catalog_id=cat_id,
                    abort_signal=abort_signal,
                    names_catalog=names_catalog,
                    _keep_failed=_keep_failed,
                )
                if (
                    not peek
                    or _keep_failed
                    and isinstance(res, _PendingResult)
                    and (not res.settled or res.failed)
                ):
                    return res
                return self._peek_value(res)

        # 3. Recurse into lists/arrays
        if isinstance(value, list):
            return [
                self.resolve_dynamic_value(
                    item,
                    peek=peek,
                    abort_signal=abort_signal,
                    _keep_failed=_keep_failed,
                )
                for item in value
            ]

        # 4. Recurse into normal objects/dictionaries (with v1.0 escaping and validation)
        if isinstance(value, dict):
            if at_least_v10:
                validate_reserved_directives(value.keys(), proto_ver or "1.0")
                return {
                    unescape_object_key(k): self.resolve_dynamic_value(
                        v,
                        peek=peek,
                        abort_signal=abort_signal,
                        _keep_failed=_keep_failed,
                    )
                    for k, v in value.items()
                }
            return {
                k: self.resolve_dynamic_value(
                    v,
                    peek=peek,
                    abort_signal=abort_signal,
                    _keep_failed=_keep_failed,
                )
                for k, v in value.items()
            }

        # 5. Return static literals directly
        return value

    def _resolve_action_context(self, context: Any) -> dict[str, Any]:
        if not isinstance(context, dict):
            return {}
        return {
            k: self.resolve_dynamic_value(v, _keep_failed=True)
            for k, v in context.items()
        }

    def _emit_invalid_action_error(self, message: str) -> None:
        if self.surface and hasattr(self.surface, "dispatch_error"):
            self.surface.dispatch_error({
                "code": "INVALID_ACTION",
                "message": message,
            })

    def _resolve_event_action(self, action: dict[str, Any]) -> Any:
        evt = dict(action["event"])
        if not isinstance(evt.get("name"), str) or not evt.get("name"):
            self._emit_invalid_action_error(
                "Action event is missing required string 'name'."
            )
            return None
        if "context" in evt:
            evt["context"] = self._resolve_action_context(evt["context"])
        if evt.get("userMessage") is not None:
            resolved_um = self.resolve_dynamic_value(
                evt["userMessage"], _keep_failed=True
            )
            if resolved_um is not None and not isinstance(
                resolved_um, (str, _PendingResult)
            ):
                self._emit_invalid_action_error(
                    "Action event 'userMessage' must be a string."
                )
                return None
            evt["userMessage"] = resolved_um
        return {**action, "event": evt}

    def _resolve_function_call_action(
        self, action: dict[str, Any], fc: dict[str, Any], is_user_activated: bool
    ) -> Any:
        fn_name = fc.get("@call") or fc.get("call")
        if isinstance(fn_name, str):
            cat_id = (
                (fc["catalogId"] if "catalogId" in fc else fc.get("catalog_id"))
                if self.at_least_v10
                else None
            )
            names_cat = self.at_least_v10 and ("catalogId" in fc or "catalog_id" in fc)
            return self._execute_function(
                fn_name,
                fc.get("args", {}),
                catalog_id=cat_id,
                names_catalog=names_cat,
                is_action=True,
                is_user_activated=is_user_activated,
            )
        if "functionCall" in action:
            return self.resolve_dynamic_value(action["functionCall"])
        return action

    def resolve_action(
        self, action: dict[str, Any], is_user_activated: bool = True
    ) -> Any:
        """Resolves an action by evaluating its top-level dynamic values."""
        if not isinstance(action, dict):
            return action

        prev_user_activated = self._user_activated
        prev_action_execution = self._is_action_execution
        self._user_activated = is_user_activated
        self._is_action_execution = True
        try:
            if isinstance(action.get("event"), dict):
                return self._resolve_event_action(action)

            if "name" in action:
                resolved = dict(action)
                if "context" in action:
                    resolved["context"] = self._resolve_action_context(
                        action["context"]
                    )
                if action.get("userMessage") is not None:
                    resolved["userMessage"] = self.resolve_dynamic_value(
                        action["userMessage"], _keep_failed=True
                    )
                return resolved

            if isinstance(action.get("functionCall"), dict):
                return self._resolve_function_call_action(
                    action, action["functionCall"], is_user_activated
                )
            if "functionCall" in action:
                return self.resolve_dynamic_value(action["functionCall"])
            if isinstance(action.get("@call"), str) or isinstance(
                action.get("call"), str
            ):
                return self._resolve_function_call_action(
                    action, action, is_user_activated
                )

            return action
        finally:
            self._user_activated = prev_user_activated
            self._is_action_execution = prev_action_execution

    def subscribe_dynamic_value(
        self, value: Any, on_change: Callable[[Any], None]
    ) -> Subscription:
        """Subscribes reactively to dynamic paths, chained function expressions, or active streaming functions."""
        paths: set[str] = set()

        def _extract_paths(val: Any) -> None:
            if isinstance(val, dict) and "componentId" not in val:
                has_path = (
                    ("@path" in val and isinstance(val["@path"], str))
                    if self.at_least_v10
                    else ("path" in val and isinstance(val["path"], str))
                )
                if has_path:
                    binding_path = val["@path"] if self.at_least_v10 else val["path"]
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

    @staticmethod
    def _check_action_user_activation(
        fn: Any, name: str, is_action: bool, is_user_activated: bool
    ) -> None:
        if not is_action or is_user_activated:
            return
        if getattr(fn, "requires_user_activation", False) or name == "openUrl":
            raise RuntimeError(f"Function '{name}' requires user activation.")

    @staticmethod
    def _resolve_function_error_code(
        err: BaseException, is_action: bool, in_body: bool
    ) -> str:
        if isinstance(err, A2uiCatalogError):
            return "CATALOG_ERROR"
        if is_action and in_body:
            return "EXECUTION_ERROR"
        return "EXPRESSION_ERROR"

    def _execute_function(
        self,
        name: str,
        raw_args: Any,
        catalog_id: str | None = None,
        abort_signal: AbortSignal | None = None,
        names_catalog: bool = False,
        _keep_failed: bool = False,
        is_action: bool = False,
        is_user_activated: bool | None = None,
    ) -> Any:
        """Validates, resolves and runs a function call.

        The catalog's argument schema describes the arguments as written,
        before nested bindings and calls are resolved: a ``DynamicBoolean``
        admits ``{"@call": ...}`` as well as a boolean. So ``raw_args`` are
        validated against it first, then resolved. From v1.0 a resolved
        argument that is the ``ValidationResult`` of a validation function
        is read by its ``valid`` boolean where the schema asks for a
        ``DynamicBoolean`` (see ``coerce_validation_results``); every other
        resolved value is handed to the function body as it is.

        ``names_catalog`` says whether the call carries a ``catalogId`` key,
        whatever its value. From v1.0 a reserved ``@`` system function belongs
        to no catalog, so a call to one that names a catalog is a malformed
        expression: it is reported as an ``EXPRESSION_ERROR`` and not run.

        From v1.0, when the surface has an ``agent_function_caller``, a call
        to a function that the resolved catalog does not implement
        (undeclared, or declared schema-only) is routed to the agent; see
        ``_call_agent_function``. A call whose catalog cannot be resolved
        is a ``CATALOG_ERROR`` and is never routed.

        A nested call whose result arrives later (an agent function) leaves
        an argument pending. The call then runs once every such argument has
        settled, and its result is pending until then.
        """
        in_body = False
        effective_user_activated = (
            self.is_user_activated if is_user_activated is None else is_user_activated
        )
        try:
            if isinstance(raw_args, dict) and len(raw_args) > MAX_FUNCTION_CALL_ARGS:
                raise A2uiExpressionError(
                    f"Function call '{name}' exceeds maximum allowed arguments count"
                    f" ({MAX_FUNCTION_CALL_ARGS})"
                )

            fn: Any
            target_catalog: Any = None
            if self.at_least_v10 and is_system_function_name(name):
                # A system function belongs to no catalog, so it skips catalog
                # resolution and works on a surface without a default catalog.
                if names_catalog:
                    raise A2uiExpressionError(
                        f"System function '{name}' belongs to no catalog and must"
                        " not name a catalogId"
                    )
                proto_ver = self._surface_protocol_version()
                validate_system_function(name, raw_args, proto_ver)
                fn = system_functions_for(proto_ver).get(name)
                if fn is None:
                    raise A2uiExpressionError(f"System function '{name}' not found.")
            else:
                target_catalog = self.surface.resolve_catalog(
                    catalog_id, subject=f"Function call '{name}'"
                )
                fn = (
                    target_catalog.get_function(name)
                    if hasattr(target_catalog, "get_function")
                    else None
                )
                if self._routes_to_agent(fn):
                    return self._call_agent_function(
                        name,
                        raw_args,
                        target_catalog,
                        fn,
                        abort_signal,
                        is_action=is_action or self._in_action_execution,
                        is_user_activated=effective_user_activated,
                    )

                PayloadValidator(catalog=target_catalog).validate_function(
                    name, raw_args
                )

                if fn is None:
                    catalog_desc = (
                        f"catalog '{target_catalog.catalog_id}'"
                        if hasattr(target_catalog, "catalog_id")
                        else "catalog"
                    )
                    raise A2uiExpressionError(
                        f"Function '{name}' not found in {catalog_desc}."
                    )

            in_body = True
            self._check_action_user_activation(
                fn, name, is_action, effective_user_activated
            )
            local_fn = fn
            local_catalog = target_catalog
            return self._run_when_args_settled(
                name,
                self.resolve_dynamic_value(
                    raw_args,
                    peek=False,
                    abort_signal=abort_signal,
                    _keep_failed=True,
                ),
                lambda args: self._run_local_function(
                    local_fn, local_catalog, args, abort_signal
                ),
                abort_signal,
                is_action=is_action,
            )
        except Exception as e:
            err_code = self._resolve_function_error_code(e, is_action, in_body)
            if self._dispatch_function_error(e, name, code_override=err_code):
                if _keep_failed:
                    failed = _PendingResult()
                    failed.fail()
                    return failed
                return None
            raise

    def _dispatch_function_error(
        self,
        error: BaseException,
        name: str,
        *,
        code_override: str | None = None,
    ) -> bool:
        """Reports a failed function call as a surface error.

        Returns:
            Whether the error was dispatched; False if the surface cannot
            dispatch errors.
        """
        if not (self.surface and hasattr(self.surface, "dispatch_error")):
            return False
        if getattr(self.surface, "disposed", False):
            return True
        # A call whose catalog can't be resolved is a catalog fault, not a
        # broken expression: the function may exist in a catalog this surface
        # doesn't have.
        error_payload: dict[str, Any] = {
            "code": (
                code_override
                if code_override is not None
                else (
                    "CATALOG_ERROR"
                    if isinstance(error, A2uiCatalogError)
                    else "EXPRESSION_ERROR"
                )
            ),
            "surfaceId": getattr(self.surface, "id", ""),
            "message": str(error),
            "expression": name,
        }
        if hasattr(error, "details") and getattr(error, "details"):
            error_payload["details"] = getattr(error, "details")
        self.surface.dispatch_error(error_payload)
        return True

    def _run_local_function(
        self,
        fn: Any,
        target_catalog: Any,
        resolved_args: Any,
        abort_signal: AbortSignal | None,
    ) -> Any:
        """Runs a function on the renderer with its resolved arguments."""
        if resolved_args is None:
            resolved_args = {}
        elif self.at_least_v10 and isinstance(resolved_args, dict):
            # From v1.0 a `DynamicBoolean` argument may resolve to the
            # `ValidationResult` a validation function returns; it is read
            # by its validity, as the specification defines the type.
            resolved_args = coerce_validation_results(
                _function_args_schema(target_catalog, fn), resolved_args
            )

        if hasattr(fn, "execute") and callable(fn.execute):
            return fn.execute(resolved_args, self, abort_signal)
        if hasattr(fn, "execute_func") and callable(fn.execute_func):
            return fn.execute_func(resolved_args, self, abort_signal)
        if callable(fn):
            return fn(resolved_args, self, abort_signal)
        return None

    def _settled_value(self, value: Any) -> Any:
        """Replaces every function result nested in `value` by its current value."""
        if isinstance(value, dict):
            return {k: self._settled_value(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._settled_value(item) for item in value]
        return self._peek_value(value)

    def _run_when_args_settled(
        self,
        name: str,
        resolved_args: Any,
        run: Callable[[Any], Any],
        abort_signal: AbortSignal | None,
        *,
        is_action: bool = False,
    ) -> Any:
        """Runs a call once its arguments have settled.

        `resolved_args` holds the results of nested calls as they were
        returned. If none of them is pending, `run` gets their current
        values right away and its result is returned. Otherwise a pending
        result is returned, and `run` gets the values once every pending
        argument has settled, unless `abort_signal` has fired by then or a
        pending argument failed. The failure of a pending argument has been
        reported already, so the call is not run and its result fails too.
        """
        pending: list[_PendingResult] = []
        _collect_pending(resolved_args, pending)
        if not pending:
            if _has_failed_result(resolved_args):
                failed = _PendingResult()
                failed.fail()
                return failed
            return run(self._settled_value(resolved_args))

        deferred = _PendingResult()
        remaining = [len(pending)]

        def _on_arg_settled() -> None:
            remaining[0] -= 1
            if remaining[0] > 0:
                return
            if (abort_signal is not None and abort_signal.aborted) or getattr(
                self.surface, "disposed", False
            ):
                return
            if _has_failed_result(resolved_args):
                deferred.fail()
                return
            try:
                result = run(self._settled_value(resolved_args))
            except Exception as e:
                err_code = self._resolve_function_error_code(e, is_action, True)
                self._dispatch_function_error(e, name, code_override=err_code)
                deferred.fail()
                return
            self._forward_result(result, deferred)

        for result in pending:
            result.when_settled(_on_arg_settled)
        return deferred

    def _forward_result(self, result: Any, target: _PendingResult) -> None:
        """Settles `target` with `result`, once `result` has settled if pending."""
        if isinstance(result, _PendingResult):

            def _on_settled() -> None:
                if result.failed:
                    target.fail()
                else:
                    target.settle(result.peek())

            result.when_settled(_on_settled)
        else:
            target.settle(self._peek_value(result))

    def _routes_to_agent(self, fn: Any) -> bool:
        """Returns whether a call to `fn` in its resolved catalog runs on the agent.

        From v1.0 a function the renderer does not implement (undeclared, so
        `fn` is None, or declared schema-only) runs on the agent when the
        surface can call it.
        """
        return (
            self.at_least_v10
            and getattr(self.surface, "agent_function_caller", None) is not None
            and not _has_local_implementation(fn)
        )

    def _call_agent_function(
        self,
        name: str,
        raw_args: Any,
        target_catalog: Any,
        fn: Any,
        abort_signal: AbortSignal | None,
        *,
        is_action: bool = False,
        is_user_activated: bool | None = None,
    ) -> Any:
        """Routes a call to the agent: the v1.0 fallback routing.

        A declared (schema-only) function's `requires_user_activation` is
        enforced and its arguments are validated against its schema before
        anything is sent; the arguments sent are those a local implementation
        would receive, with the schema's defaults filled in. An undeclared
        function's arguments are sent as they resolve. Pending arguments
        settle first. The call always names the catalog it resolved to.

        Returns:
            The call's result, pending (None) until the agent responds. An
            agent error or a timeout is reported as an `EXPRESSION_ERROR`,
            and the result fails, keeping the value None.

        Raises:
            A2uiExpressionError: If the function requires user activation and
                this context has none, or its arguments fail validation.
        """
        catalog_id = str(
            getattr(target_catalog, "catalog_id", None)
            or getattr(target_catalog, "id", "")
        )
        effective_user_activated = (
            self.is_user_activated if is_user_activated is None else is_user_activated
        )
        defaults: dict[str, Any] = {}
        args_schema: Any = None
        if fn is None:
            PayloadValidator(
                catalog=target_catalog, config=_UNDECLARED_FUNCTION_VALIDATION
            ).validate_function(name, raw_args)
        else:
            if getattr(fn, "requires_user_activation", False) and (
                not effective_user_activated
            ):
                raise A2uiExpressionError(
                    f"Function '{name}' requires user activation and cannot be"
                    " evaluated without an active user gesture."
                )
            try:
                validated = PayloadValidator(catalog=target_catalog).validate_function(
                    name, raw_args
                )
            except A2uiValidationError as e:
                raise A2uiExpressionError(
                    f"Validation failed for function '{name}': {e}",
                    details=e.details,
                ) from e
            args_schema = _function_args_schema(target_catalog, fn)
            written = raw_args if isinstance(raw_args, dict) else {}
            defaults = _schema_defaults(args_schema)
            # Validating against a Pydantic model fills in its defaults.
            defaults.update({
                k: v
                for k, v in (validated or {}).items()
                if v is not None and k not in written
            })

        bypass_cache = is_action or self._in_action_execution

        def _send(resolved_args: Any) -> _PendingResult:
            args: dict[str, Any] = (
                dict(resolved_args) if isinstance(resolved_args, dict) else {}
            )
            if fn is not None:
                args = coerce_validation_results(args_schema, args)
                for key, value in defaults.items():
                    args.setdefault(key, copy.deepcopy(value))
            future = self.surface.call_agent_function(
                AgentFunctionCall(call=name, catalog_id=catalog_id, args=args),
                abort_signal=abort_signal,
                bypass_cache=bypass_cache,
            )
            result = _PendingResult()
            if future.done() and not future.cancelled() and future.exception() is None:
                result.settle(future.result())
                return result

            def _on_response(done: asyncio.Future[Any]) -> None:
                if done.cancelled():
                    error: BaseException | None = A2uiExpressionError(
                        f"Agent function call '{name}' was cancelled."
                    )
                else:
                    error = done.exception()
                if (abort_signal is not None and abort_signal.aborted) or getattr(
                    self.surface, "disposed", False
                ):
                    # A newer evaluation replaced this one, or the surface was disposed.
                    return
                if error is None:
                    result.settle(done.result())
                    return
                self._dispatch_function_error(error, name)
                result.fail()

            future.add_done_callback(_on_response)
            return result

        return self._run_when_args_settled(
            name,
            self.resolve_dynamic_value(
                raw_args,
                peek=False,
                abort_signal=abort_signal,
                _keep_failed=True,
            ),
            _send,
            abort_signal,
            is_action=is_action,
        )
