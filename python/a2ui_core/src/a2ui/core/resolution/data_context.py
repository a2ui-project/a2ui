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
from dataclasses import dataclass
import inspect
from typing import Any, Callable, Final, NamedTuple, TypeVar
import warnings

from ..catalog import is_system_function_name, system_functions_for
from ..common.events import AbortSignal, EventSource, Signal, Subscription
from ..common.semver import is_at_least_version
from ..exceptions import (
    A2uiCatalogError,
    A2uiErrorDetail,
    A2uiExpressionError,
    A2uiRpcError,
    A2uiValidationError,
    RpcErrorCode,
)
from ..schema import ProtocolVersion
from ..state.data_model import DataModel
from ..state.surface_model import AgentFunctionCall, SurfaceModel, agent_call_key
from ..validation.payload_validator import (
    MAX_FUNCTION_CALL_ARGS,
    PayloadValidator,
    ValidationConfig,
    validate_system_function,
)
from .validation_result_coercion import (
    json_schema_properties,
    coerce_validation_results,
)


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


def _collect_subscribables(value: Any, subscribables: list[Any]) -> None:
    """Appends every object with `.subscribe` nested in `value` to `subscribables`."""
    if hasattr(value, "subscribe") and callable(value.subscribe):
        subscribables.append(value)
    elif isinstance(value, dict):
        for item in value.values():
            _collect_subscribables(item, subscribables)
    elif isinstance(value, list):
        for item in value:
            _collect_subscribables(item, subscribables)


def _has_failed_result(value: Any) -> bool:
    """Returns whether a `_PendingResult` nested in `value` failed."""
    if isinstance(value, _PendingResult):
        return value.failed
    if isinstance(value, dict):
        return any(_has_failed_result(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_failed_result(item) for item in value)
    return False


def _is_pending(value: Any) -> bool:
    """Returns whether a `_PendingResult` nested in `value` has not settled."""
    pending: list[_PendingResult] = []
    _collect_pending(value, pending)
    return bool(pending)


def _failed_result() -> _PendingResult:
    """Returns a result that has failed already."""
    failed = _PendingResult()
    failed.fail()
    return failed


def _when_all_settled(
    pending: list[_PendingResult], callback: Callable[[], None]
) -> None:
    """Runs `callback` once every result in `pending` has settled."""
    if not pending:
        callback()
        return
    remaining = [len(pending)]

    def _on_settled() -> None:
        remaining[0] -= 1
        if remaining[0] == 0:
            callback()

    for result in pending:
        result.when_settled(_on_settled)


def _is_cancellation(error: BaseException | None) -> bool:
    """Returns whether `error` cancelled a call rather than failing it.

    Calls are cancelled when their surface is deleted or disposed. That is
    not an error in the expression, so it is not reported.
    """
    if isinstance(error, asyncio.CancelledError):
        return True
    return isinstance(error, A2uiRpcError) and (
        error.code == RpcErrorCode.CANCELLED.value
    )


class DynamicValueState(NamedTuple):
    """A subscribed dynamic value and whether it still waits for a result.

    Internal: not part of the package's public API.
    """

    value: Any
    pending: bool


class _AgentCallMemory:
    """The agent calls that one subscription's evaluations make.

    A failed call is remembered for as long as each new evaluation makes it
    again, so re-evaluating after a change to an unrelated path doesn't send
    it again. A call whose key (catalog, name or arguments) changes is a new
    call, and is sent.
    """

    def __init__(self) -> None:
        self._failed: set[str] = set()
        self._made: set[str] = set()

    def start_evaluation(self) -> None:
        """Forgets the failures of calls the last evaluation did not make."""
        self._failed &= self._made
        self._made = set()

    def make(self, key: str) -> bool:
        """Records that the current evaluation makes the call `key`.

        Returns:
            Whether an earlier evaluation made the call and it failed.
        """
        self._made.add(key)
        return key in self._failed

    def record(self, key: str, *, failed: bool) -> None:
        """Records whether the call `key` failed."""
        if failed:
            self._failed.add(key)
        else:
            self._failed.discard(key)


@dataclass(frozen=True)
class _EvaluationScope:
    """The state of an evaluation that outlives its synchronous part.

    A call whose arguments are pending finishes after the method that
    started it has returned and reset its flags. It runs in the scope
    captured when it started.
    """

    user_activated: bool
    in_action: bool
    agent_calls: _AgentCallMemory | None


_T = TypeVar("_T")

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


def _deref_schema(schema: Any, defs: dict[str, Any]) -> Any:
    """Follows a local `#/$defs/...` reference, if `schema` is one."""
    seen: set[str] = set()
    while isinstance(schema, dict):
        ref = schema.get("$ref")
        if not (isinstance(ref, str) and ref.startswith("#/$defs/")):
            break
        if ref in seen:
            break
        seen.add(ref)
        schema = defs.get(ref[len("#/$defs/") :], schema)
    return schema


def _fill_object_defaults(
    properties: dict[str, Any], value: dict[str, Any], defs: dict[str, Any]
) -> dict[str, Any]:
    """Fills the defaults of `properties` into `value`, at every object level."""
    filled = dict(value)
    for key, prop in properties.items():
        prop = _deref_schema(prop, defs)
        if not isinstance(prop, dict):
            continue
        if key not in filled and "default" in prop:
            filled[key] = copy.deepcopy(prop["default"])
        nested = prop.get("properties")
        if isinstance(nested, dict) and isinstance(filled.get(key), dict):
            filled[key] = _fill_object_defaults(nested, filled[key], defs)
    return filled


def _with_schema_defaults(schema: Any, args: dict[str, Any]) -> dict[str, Any]:
    """Returns `args` with the defaults of a function's JSON schema filled in.

    A missing argument gets its property's `default`, and so does a missing
    property of an object argument, at any depth, as a schema parse fills
    nested model defaults.
    """
    if not isinstance(schema, dict):
        return args
    properties = json_schema_properties(schema)
    if not isinstance(properties, dict):
        return args
    defs = schema.get("$defs")
    return _fill_object_defaults(
        properties, args, defs if isinstance(defs, dict) else {}
    )


def _merge_parsed_defaults(args: dict[str, Any], parsed: Any) -> dict[str, Any]:
    """Adds the values a model parse filled in to `args`, at every level.

    Values that `args` holds are kept as they are; only missing keys, such
    as defaults of nested models, are taken from `parsed`.
    """
    if not isinstance(parsed, dict):
        return args
    merged = dict(args)
    for key, value in parsed.items():
        if key not in merged:
            if value is not None:
                merged[key] = copy.deepcopy(value)
        elif isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _merge_parsed_defaults(merged[key], value)
    return merged


def _child_signal(parent: AbortSignal | None) -> AbortSignal:
    """Returns a signal that aborts when `parent` does, or on its own."""
    child = AbortSignal()
    if parent is not None:
        parent.add_event_listener("abort", child.abort)
    return child


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
    """Headless evaluation scope for resolving A2UI dynamic bindings and expressions.

    Evaluation is single-threaded: resolve values, subscribe and run actions
    on the event loop that owns the surface, the thread its agent function
    answers arrive on. Calls whose arguments were pending resume on that
    loop, with the state captured when they started.
    """

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
        # The agent calls of the subscription being evaluated, if any.
        self._agent_calls: _AgentCallMemory | None = None
        # Set while resolving an agent's callRendererFunction arguments.
        self._agent_disabled = False

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

    def _capture_scope(
        self, *, user_activated: bool | None = None, in_action: bool = False
    ) -> _EvaluationScope:
        """Captures the state that a later part of this evaluation runs in."""
        return _EvaluationScope(
            user_activated=(
                self.is_user_activated if user_activated is None else user_activated
            ),
            in_action=in_action or self._in_action_execution,
            agent_calls=self._agent_calls,
        )

    def _run_in_scope(self, scope: _EvaluationScope, run: Callable[[], _T]) -> _T:
        """Runs `run` in `scope`, then restores the current state."""
        previous = (self._user_activated, self._is_action_execution, self._agent_calls)
        self._user_activated = scope.user_activated
        self._is_action_execution = scope.in_action
        self._agent_calls = scope.agent_calls
        try:
            return run()
        finally:
            (
                self._user_activated,
                self._is_action_execution,
                self._agent_calls,
            ) = previous

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
    ) -> Any:
        """Recursively evaluates Literals, Data Paths, and Function Calls against the active DataModel.

        A call whose result arrives later, such as an agent function call,
        evaluates to None, or with `peek=False` to a signal whose value is
        None until the result arrives. A call that fails evaluates to None.
        """
        return self._resolve_value(value, peek, abort_signal, keep_failed=False)

    def resolve_without_agent(self, value: Any) -> Any:
        """Resolves `value` like `resolve_dynamic_value`, never using the agent.

        A function the renderer does not implement fails as it did before
        fallback routing existed: nothing is sent, and the surface's cached
        agent answers are not read either. `RpcHandler` resolves the
        arguments of an agent's `callRendererFunction` this way, and
        `formatString` its template parts.

        Internal: not part of the package's public API.
        """
        previous = self._agent_disabled
        self._agent_disabled = True
        try:
            return self.resolve_dynamic_value(value)
        finally:
            self._agent_disabled = previous

    def _resolve_value(
        self,
        value: Any,
        peek: bool,
        abort_signal: AbortSignal | None,
        *,
        keep_failed: bool,
    ) -> Any:
        """Evaluates `value` like `resolve_dynamic_value`.

        With `keep_failed`, a call that failed, or whose result is pending,
        evaluates to its `_PendingResult`, so the caller can tell a failure
        from a None value and wait for a pending result.
        """
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
                    _keep_failed=keep_failed,
                    can_wait=not peek or keep_failed,
                )
                if isinstance(res, _PendingResult) and res.failed and not keep_failed:
                    return None
                if (
                    not peek
                    or keep_failed
                    and isinstance(res, _PendingResult)
                    and (not res.settled or res.failed)
                ):
                    return res
                return self._peek_value(res)

        # 3. Recurse into lists/arrays
        if isinstance(value, list):
            return [
                self._resolve_value(item, peek, abort_signal, keep_failed=keep_failed)
                for item in value
            ]

        # 4. Recurse into normal objects/dictionaries (with v1.0 escaping and validation)
        if isinstance(value, dict):
            if at_least_v10:
                validate_reserved_directives(value.keys(), proto_ver or "1.0")
                return {
                    unescape_object_key(k): self._resolve_value(
                        v, peek, abort_signal, keep_failed=keep_failed
                    )
                    for k, v in value.items()
                }
            return {
                k: self._resolve_value(v, peek, abort_signal, keep_failed=keep_failed)
                for k, v in value.items()
            }

        # 5. Return static literals directly
        return value

    def _resolve_action_values(
        self, items: list[Any], labels: list[str]
    ) -> list[Any] | None:
        """Resolves the context values and user message of an event action.

        From v1.0 they are resolved in order, see `_resolve_in_order`.
        Before v1.0 a value that fails resolves to None, as it always has.

        Returns:
            The resolved values, or None if one failed synchronously.
        """
        if not self.at_least_v10:
            return [self.resolve_dynamic_value(item) for item in items]
        return self._resolve_in_order(items, labels, self._capture_scope())

    def _resolve_in_order(
        self, items: list[Any], labels: list[str], scope: _EvaluationScope
    ) -> list[Any] | None:
        """Resolves imperative action values one after another.

        A value whose result is pending, such as an agent function call, is
        awaited before the next value is evaluated, so a value that fails
        stops the values after it from being evaluated at all: they send no
        `callAgentFunction`. Values after a pending one are returned as
        pending results that settle once they have been evaluated, or fail
        without being evaluated if an earlier value fails.

        A malformed value, such as an object with an unknown `@` key, is
        reported as an `EXPRESSION_ERROR` ("Action event context entry '<key>'
        is invalid: ..."), and stops the values after it, whether it is
        evaluated now or after a pending one.

        Returns:
            The resolved values, which may be pending results, or None if a
            value failed synchronously. A failed value has been reported.
        """
        results: list[Any] = []
        for index, item in enumerate(items):
            try:
                value = self._resolve_value(item, True, None, keep_failed=True)
            except Exception as e:
                label = labels[index]
                subject = (
                    f"Action event context entry '{label.rsplit('.', 1)[-1]}'"
                    if "context." in label
                    else "Action event userMessage"
                )
                invalid = A2uiExpressionError(f"{subject} is invalid: {e}")
                if self._dispatch_function_error(invalid, label):
                    return None
                raise
            if _has_failed_result(value):
                return None
            results.append(value)
            pending: list[_PendingResult] = []
            _collect_pending(value, pending)
            rest_items = items[index + 1 :]
            if pending and rest_items:
                rest = [_PendingResult() for _ in rest_items]
                results.extend(rest)

                def _resume(
                    value: Any = value,
                    rest_items: list[Any] = rest_items,
                    rest_labels: list[str] = labels[index + 1 :],
                    rest: list[_PendingResult] = rest,
                ) -> None:
                    self._resume_in_order(value, rest_items, rest_labels, rest, scope)

                _when_all_settled(pending, _resume)
                return results
        return results

    def _resume_in_order(
        self,
        settled: Any,
        items: list[Any],
        labels: list[str],
        placeholders: list[_PendingResult],
        scope: _EvaluationScope,
    ) -> None:
        """Evaluates the action values after `settled`, once it has settled."""
        if getattr(self.surface, "disposed", False) or _has_failed_result(settled):
            for placeholder in placeholders:
                placeholder.fail()
            return
        values: list[Any] | None
        try:
            values = self._run_in_scope(
                scope, lambda: self._resolve_in_order(items, labels, scope)
            )
        except Exception as e:
            # Only reached when the surface can't report errors.
            values = None
        if values is None:
            for placeholder in placeholders:
                placeholder.fail()
            return
        for placeholder, value in zip(placeholders, values):
            self._settle_when_ready(value, placeholder)

    def _settle_when_ready(self, value: Any, target: _PendingResult) -> None:
        """Settles `target` with `value` once its pending results have settled."""
        pending: list[_PendingResult] = []
        _collect_pending(value, pending)

        def _done() -> None:
            if _has_failed_result(value):
                target.fail()
            else:
                target.settle(self._settled_value(value))

        _when_all_settled(pending, _done)

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
        context = evt.get("context")
        keys = list(context) if isinstance(context, dict) else []
        has_user_message = evt.get("userMessage") is not None
        items = [context[k] for k in keys] if isinstance(context, dict) else []
        labels = [f"event.context.{k}" for k in keys]
        if has_user_message:
            items.append(evt["userMessage"])
            labels.append("event.userMessage")
        values = self._resolve_action_values(items, labels)
        if values is None:
            return None
        if "context" in evt:
            evt["context"] = dict(zip(keys, values))
        if has_user_message:
            resolved_um = values[-1]
            if resolved_um is not None and not isinstance(
                resolved_um, (str, _PendingResult)
            ):
                self._emit_invalid_action_error(
                    "Action event 'userMessage' must resolve to a string."
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
            result = self._execute_function(
                fn_name,
                fc.get("args", {}),
                catalog_id=cat_id,
                names_catalog=names_cat,
                is_action=True,
                is_user_activated=is_user_activated,
            )
            if isinstance(result, _PendingResult) and result.failed:
                return None
            return result
        if "functionCall" in action:
            return self.resolve_dynamic_value(action["functionCall"])
        return action

    def resolve_action(
        self, action: dict[str, Any], is_user_activated: bool = True
    ) -> Any:
        """Resolves an action by evaluating its top-level dynamic values.

        Returns:
            For a function call action, the function's result. When it waits
            for an agent function's answer, that is a `Signal` whose value is
            None until the answer arrives; a call that fails returns None.
            For an event action, the action with its `context` and
            `userMessage` resolved, which `SurfaceModel.dispatch_action`
            accepts. Values still waiting for an agent answer are signals
            that `dispatch_action` waits for. None if the action failed
            and was reported.
        """
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
                context = action.get("context")
                keys = list(context) if isinstance(context, dict) else []
                has_user_message = action.get("userMessage") is not None
                items = [context[k] for k in keys] if isinstance(context, dict) else []
                labels = [f"context.{k}" for k in keys]
                if has_user_message:
                    items.append(action["userMessage"])
                    labels.append("userMessage")
                values = self._resolve_action_values(items, labels)
                if values is None:
                    return None
                if "context" in action:
                    resolved["context"] = dict(zip(keys, values))
                if has_user_message:
                    resolved["userMessage"] = values[-1]
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
        """Subscribes reactively to dynamic paths, chained function expressions, or active streaming functions.

        The returned subscription's `value` is the initial value. A call whose
        result arrives later, such as an agent function call, leaves it None
        until `on_change` delivers the result.
        """

        def _on_state(state: DynamicValueState, value_changed: bool) -> None:
            if value_changed:
                on_change(state.value)

        sub = self.subscribe_dynamic_state(value, _on_state)
        return Subscription(sub.unsubscribe, initial_value=sub.value.value)

    def subscribe_dynamic_state(
        self,
        value: Any,
        on_state: Callable[[DynamicValueState, bool], None],
    ) -> Subscription:
        """Subscribes to a dynamic value and to whether it is pending.

        Like `subscribe_dynamic_value`, but the subscription's `value` is the
        initial `DynamicValueState`, and `on_state` gets each later state together
        with whether its value changed. A pending result that fails, or
        settles to the value it already had, changes only the state.

        A call that failed is not sent again when the value is re-evaluated
        because a path it does not depend on changed; see `_AgentCallMemory`.

        Internal: `GenericBinder` uses it for check rules. It is not part of
        the package's public API.
        """
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
        agent_calls = _AgentCallMemory()
        current_raw: list[Any] = [None]
        state: list[DynamicValueState] = [DynamicValueState(None, False)]
        has_value: list[bool] = [False]
        is_sync: list[bool] = [True]

        def _publish(new_val: Any, value_changed: bool = True) -> None:
            new_state = DynamicValueState(new_val, _is_pending(current_raw[0]))
            if not value_changed and new_state.pending == state[0].pending:
                return
            state[0] = new_state
            has_value[0] = True
            if not is_sync[0]:
                on_state(new_state, value_changed)

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

            agent_calls.start_evaluation()
            previous_calls = self._agent_calls
            self._agent_calls = agent_calls
            try:
                raw_res = self._resolve_value(value, False, sig, keep_failed=False)
            finally:
                self._agent_calls = previous_calls
            current_raw[0] = raw_res

            if hasattr(raw_res, "subscribe") and callable(raw_res.subscribe):
                # Arm the active stream subscription
                sub = raw_res.subscribe(_publish)
                stream_sub.append(sub)

                # Initialize concrete output if not already emitted by BehaviorSubject/Signal
                if not has_value[0]:
                    _publish(self._peek_value(raw_res))
            else:
                nested_streams: list[Any] = []
                _collect_subscribables(raw_res, nested_streams)
                if nested_streams:
                    _publish(self._settled_value(raw_res))
                    initializing = [True]

                    def _on_nested(_: Any = None) -> None:
                        if initializing[0]:
                            return
                        _publish(self._settled_value(raw_res))

                    for ns in nested_streams:
                        stream_sub.append(ns.subscribe(_on_nested))
                    initializing[0] = False
                else:
                    _publish(raw_res)

            # A pending result that fails, or settles without changing the
            # value, emits nothing, so its settling is watched separately.
            def _on_pending_settled() -> None:
                if not sig.aborted:
                    _publish(state[0].value, value_changed=False)

            pending: list[_PendingResult] = []
            _collect_pending(raw_res, pending)
            for result in pending:
                result.when_settled(_on_pending_settled)

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

        return Subscription(_unsubscribe_all, initial_value=state[0])

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
        can_wait: bool = True,
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
        A function whose ``allowedCallers`` is ``agentOnly`` is reported the
        same way and not run, nor routed to the agent.

        From v1.0, when the surface has an ``agent_function_caller``, a call
        to a function that the resolved catalog does not implement
        (undeclared, or declared schema-only) is routed to the agent; see
        ``_call_agent_function``. A call whose catalog cannot be resolved
        is a ``CATALOG_ERROR`` and is never routed. Neither is a call whose
        caller can't wait for the answer (``can_wait`` is False), such as a
        one-shot ``resolve_dynamic_value`` read, a ``formatString`` template
        part or an argument of an agent's ``callRendererFunction``: nothing
        is sent, it reads the answer the surface already holds for the same
        call, and without one it is an ``EXPRESSION_ERROR``.

        A local function that ran and raised while an action runs (its
        ``functionCall``, or an event's ``context`` or ``userMessage``) is an
        ``EXECUTION_ERROR``. A refused call (``agentOnly``, missing user
        activation, invalid arguments, unknown function) is an
        ``EXPRESSION_ERROR`` everywhere.

        A nested call whose result arrives later (an agent function) leaves
        an argument pending. The call then runs once every such argument has
        settled, and its result is pending until then. It runs with the user
        activation and action state it started with.

        A call that is cancelled (its surface was deleted) fails without
        reporting an error.
        """
        in_body = False
        effective_user_activated = (
            self.is_user_activated if is_user_activated is None else is_user_activated
        )
        in_action = is_action or self._in_action_execution
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
                # Bindings, checks and actions are renderer calls. An agentOnly
                # function runs only for an agent's callRendererFunction, which
                # RpcHandler executes without going through this method, so it
                # is neither run locally nor routed back to the agent.
                if getattr(fn, "allowed_callers", None) == "agentOnly":
                    raise A2uiExpressionError(
                        f"Function '{name}' cannot be called by renderer"
                        " (allowedCallers is agentOnly)."
                    )
                if self._agent_disabled and self._routes_to_agent(fn):
                    raise A2uiExpressionError(
                        f"Function '{name}' is not implemented by the renderer."
                    )
                if self._routes_to_agent(fn):
                    # A read that can't wait sends nothing; it gets the answer
                    # the surface already holds for the same call, if any.
                    return self._call_agent_function(
                        name,
                        raw_args,
                        target_catalog,
                        fn,
                        abort_signal,
                        is_action=is_action or self._in_action_execution,
                        is_user_activated=effective_user_activated,
                        settled_only=not can_wait,
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

            # An event action's context and user message are imperative too,
            # so a function in them needs the action's user activation. A
            # refusal is not an execution failure.
            self._check_action_user_activation(
                fn, name, in_action, effective_user_activated
            )
            in_body = True
            local_fn = fn
            local_catalog = target_catalog
            scope = self._capture_scope(
                user_activated=effective_user_activated, in_action=is_action
            )

            def _run_local(args: Any) -> Any:
                return self._run_in_scope(
                    scope,
                    lambda: self._run_local_function(
                        local_fn, local_catalog, args, abort_signal
                    ),
                )

            args_signal = _child_signal(abort_signal)
            return self._run_when_args_settled(
                name,
                self._resolve_value(raw_args, False, args_signal, keep_failed=True),
                _run_local,
                abort_signal,
                is_action=in_action,
                args_signal=args_signal,
            )
        except Exception as e:
            if _is_cancellation(e):
                return _failed_result() if _keep_failed else None
            err_code = self._resolve_function_error_code(e, in_action, in_body)
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
        elif isinstance(resolved_args, dict):
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
        in_body: bool = True,
        args_signal: AbortSignal | None = None,
    ) -> Any:
        """Runs a call once its arguments have settled.

        `resolved_args` holds the results of nested calls as they were
        returned. If none of them is pending, `run` gets their current
        values right away and its result is returned. Otherwise a pending
        result is returned, and `run` gets the values once every pending
        argument has settled, unless `abort_signal` has fired by then or a
        pending argument failed. The failure of a pending argument has been
        reported already, so the call is not run and its result fails too.

        Sibling arguments are resolved together. As soon as one fails, the
        call fails and `args_signal`, the signal its arguments were resolved
        with, is aborted, so siblings still waiting send nothing more and
        their late answers or failures are dropped silently.

        `in_body` says whether an error that `run` raises comes from the
        function's own body, which classifies it for an action.
        """
        pending: list[_PendingResult] = []
        _collect_pending(resolved_args, pending)
        if _has_failed_result(resolved_args):
            if pending and args_signal is not None:
                args_signal.abort()
            return _failed_result()
        if not pending:
            return run(self._settled_value(resolved_args))

        deferred = _PendingResult()
        remaining = [len(pending)]

        def _on_arg_settled() -> None:
            if deferred.settled:
                return
            if _has_failed_result(resolved_args):
                if args_signal is not None:
                    args_signal.abort()
                deferred.fail()
                return
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
                if not _is_cancellation(e):
                    err_code = self._resolve_function_error_code(e, is_action, in_body)
                    self._dispatch_function_error(e, name, code_override=err_code)
                deferred.fail()
                return
            self._forward_result(result, deferred, abort_signal)

        for result in pending:
            result.when_settled(_on_arg_settled)
        return deferred

    def _forward_result(
        self,
        result: Any,
        target: _PendingResult,
        abort_signal: AbortSignal | None,
    ) -> None:
        """Settles `target` with `result`, once `result` has settled if pending.

        A `result` that streams values, such as a signal a local function
        returns, keeps updating `target` until `abort_signal` fires, as it
        would have had the call's arguments settled from the start.
        """
        if isinstance(result, _PendingResult):

            def _on_settled() -> None:
                if result.failed:
                    target.fail()
                else:
                    target.settle(result.peek())

            result.when_settled(_on_settled)
            return
        target.settle(self._peek_value(result))
        if not (hasattr(result, "subscribe") and callable(result.subscribe)):
            return
        if abort_signal is not None and abort_signal.aborted:
            return

        def _on_update(new_val: Any) -> None:
            target.value = new_val

        sub = result.subscribe(_on_update)
        if abort_signal is not None and hasattr(sub, "unsubscribe"):
            abort_signal.add_event_listener("abort", sub.unsubscribe)

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
        settled_only: bool = False,
    ) -> Any:
        """Routes a call to the agent: the v1.0 fallback routing.

        With `settled_only`, for a read that can't wait, nothing is sent: the
        answer the surface already holds for the same call is returned, and
        without one the call is an `EXPRESSION_ERROR`.

        A declared (schema-only) function's `requires_user_activation` is
        enforced before anything is resolved or sent. Pending arguments
        settle first. Then a declared function's resolved arguments are
        validated against its schema, and the arguments sent are those a
        local implementation would receive, with the schema's defaults filled
        in at every object level, as a parse of the schema fills them whether
        the catalog was defined in code or read from a document. An
        undeclared function's arguments are sent as they resolve.
        Arguments with no faithful JSON form (such as NaN) are not sent. The
        call always names the catalog it resolved to.

        Returns:
            The call's result, pending (None) until the agent responds. An
            agent error or a timeout is reported as an `EXPRESSION_ERROR`,
            and the result fails, keeping the value None. A call that is
            cancelled, because its surface was deleted, fails silently.

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
        agent_calls = self._agent_calls
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
            # The arguments as written may hold bindings and calls, which the
            # schema may not admit, so only their envelope is checked here.
            # The schema is checked once they have resolved.
            try:
                PayloadValidator(catalog=target_catalog).validate_function_identifiers(
                    name, raw_args
                )
            except A2uiValidationError as e:
                raise A2uiExpressionError(
                    f"Validation failed for function '{name}': {e}",
                    details=e.details,
                ) from e
            args_schema = _function_args_schema(target_catalog, fn)

        bypass_cache = is_action or self._in_action_execution

        def _prepare(resolved_args: Any) -> AgentFunctionCall:
            args: dict[str, Any] = (
                dict(resolved_args) if isinstance(resolved_args, dict) else {}
            )
            if fn is not None:
                args = coerce_validation_results(args_schema, args)
                args = _with_schema_defaults(args_schema, args)
                try:
                    validated = PayloadValidator(
                        catalog=target_catalog
                    ).validate_function(name, args)
                except A2uiValidationError as e:
                    raise A2uiExpressionError(
                        f"Validation failed for function '{name}': {e}",
                        details=e.details,
                    ) from e
                # Validating against a Pydantic model fills in its defaults,
                # those of nested models included.
                args = _merge_parsed_defaults(args, validated)
            return AgentFunctionCall(call=name, catalog_id=catalog_id, args=args)

        if settled_only:
            resolved = self._resolve_value(
                raw_args, True, abort_signal, keep_failed=False
            )
            found, answer = self.surface.settled_agent_answer(_prepare(resolved))
            if not found:
                raise A2uiExpressionError(
                    f"Function '{name}' is not implemented locally, and its result"
                    " can't be awaited here, so it was not sent to the agent."
                )
            return answer

        def _send(resolved_args: Any) -> _PendingResult:
            if abort_signal is not None and abort_signal.aborted:
                # A newer evaluation replaced this one: send nothing.
                return _PendingResult()
            call = _prepare(resolved_args)
            key: str | None = (
                None if bypass_cache or agent_calls is None else agent_call_key(call)
            )
            if key is not None and agent_calls is not None and agent_calls.make(key):
                # The subscription saw this call fail; it was reported then.
                return _failed_result()
            future = self.surface.call_agent_function(
                call,
                abort_signal=abort_signal,
                bypass_cache=bypass_cache,
            )
            result = _PendingResult()

            def _record(failed: bool) -> None:
                if key is not None and agent_calls is not None:
                    agent_calls.record(key, failed=failed)

            if future.done() and not future.cancelled() and future.exception() is None:
                _record(False)
                result.settle(future.result())
                return result

            def _on_response(done: asyncio.Future[Any]) -> None:
                error: BaseException | None = (
                    asyncio.CancelledError() if done.cancelled() else done.exception()
                )
                if (abort_signal is not None and abort_signal.aborted) or getattr(
                    self.surface, "disposed", False
                ):
                    # A newer evaluation replaced this one, or the surface was disposed.
                    return
                if _is_cancellation(error):
                    result.fail()
                    return
                if error is None:
                    _record(False)
                    result.settle(done.result())
                    return
                _record(True)
                self._dispatch_function_error(error, name)
                result.fail()

            future.add_done_callback(_on_response)
            return result

        args_signal = _child_signal(abort_signal)
        return self._run_when_args_settled(
            name,
            self._resolve_value(raw_args, False, args_signal, keep_failed=True),
            _send,
            abort_signal,
            is_action=is_action,
            in_body=False,
            args_signal=args_signal,
        )
