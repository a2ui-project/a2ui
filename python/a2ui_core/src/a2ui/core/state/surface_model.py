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

import asyncio
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Sequence
import copy
from dataclasses import dataclass, field
import json
from typing import Any
import warnings

from ..catalog import CatalogApi
from ..common.events import AbortSignal, EventSource
from ..exceptions import A2uiCatalogError, A2uiExpressionError
from ..schema import ProtocolVersion
from .data_model import DataModel
from .surface_components_model import SurfaceComponentsModel

_MAX_AGENT_CALL_CACHE_ENTRIES = 256


@dataclass(frozen=True)
class AgentFunctionCall:
    """A function call that a surface routes to the agent.

    Unlike a `FunctionCall` in a payload, it always names the catalog the call
    resolved to, and its arguments are resolved values.

    Attributes:
        call: Name of the function to call.
        catalog_id: Identifier of the catalog the call resolved to on the
            surface.
        args: Resolved argument values.
    """

    call: str
    catalog_id: str
    args: dict[str, Any] = field(default_factory=dict)


AgentFunctionCaller = Callable[[AgentFunctionCall], Awaitable[Any]]
"""Sends a function call to the agent and resolves with the agent's result.

`MessageProcessor` installs one on each v1.0 surface when it has an
`outbound_listener`; it dispatches `callAgentFunction` through the processor's
`RpcHandler`.
"""


def _agent_call_key(call: AgentFunctionCall) -> str | None:
    """Builds the key that identifies identical agent function calls.

    Returns:
        The key, or None if the arguments cannot be serialized, in which case
        the call is not shared.
    """
    try:
        return json.dumps(
            [call.catalog_id, call.call, call.args],
            sort_keys=True,
            separators=(",", ":"),
        )
    except (TypeError, ValueError):
        return None


class SurfaceModel:
    """Represents a single active UI Surface state tree."""

    def __init__(
        self,
        surface_id: str,
        default_catalog: CatalogApi | None,
        available_catalogs: dict[str, CatalogApi] | None = None,
        theme: dict[str, Any] | None = None,
        send_data_model: bool = False,
        data_model: DataModel | None = None,
        root_id: str = "root",
        protocol_version: ProtocolVersion | str | None = None,
    ) -> None:
        self.id = surface_id
        # From v1.0 a surface may name no default catalog, so that each
        # component and function call names its own.
        self.default_catalog = default_catalog
        # The surface's protocol version. Defaults to the default catalog's
        # version; surfaces without a default catalog pass it explicitly.
        self.protocol_version: ProtocolVersion | str | None = (
            protocol_version or getattr(default_catalog, "protocol_version", None)
        )
        catalogs: dict[str, CatalogApi] = (
            dict(available_catalogs) if available_catalogs else {}
        )
        if (
            default_catalog is not None
            and default_catalog.id
            and default_catalog.id not in catalogs
        ):
            catalogs[default_catalog.id] = default_catalog
        self.available_catalogs = catalogs

        self.theme = theme or {}
        self.send_data_model = send_data_model

        self.data_model = data_model or DataModel()
        self.components_model = SurfaceComponentsModel(default_catalog)
        self.root_id = root_id
        self.on_action = EventSource()
        self.on_error = EventSource()
        self.on_warning = EventSource()
        # Sends calls to functions the renderer does not implement to the
        # agent. When set, a v1.0 function call whose function has no local
        # implementation in the catalog it resolves to (undeclared, or
        # declared schema-only) is routed here instead of failing, as the v1.0
        # fallback routing defines.
        self.agent_function_caller: AgentFunctionCaller | None = None
        # Agent function calls awaiting a response, keyed by call.
        self._in_flight_agent_calls: dict[str, asyncio.Future[Any]] = {}
        # Settled reactive agent function call answers, bounded by LRU order.
        self._settled_agent_calls: OrderedDict[str, Any] = OrderedDict()
        self._disposed = False

    @property
    def disposed(self) -> bool:
        """Whether this surface has been disposed."""
        return self._disposed

    @property
    def catalog(self) -> CatalogApi | None:
        """The surface's default catalog (deprecated alias for default_catalog)."""
        return self.default_catalog

    def resolve_catalog(
        self, catalog_id: str | None, *, subject: str = "Item"
    ) -> CatalogApi:
        """Resolves the catalog that an item on this surface runs in.

        From v1.0 a component or function call runs in the catalog it names,
        looked up in `available_catalogs`, or else in the surface's default
        catalog. There is no other fallback.

        Args:
            catalog_id: The `catalogId` the item names, or None if it names none.
                An empty string names a catalog too, so it does not fall back
                to the default.
            subject: Describes the item in the error message, e.g.
                "Function call 'formatString'".

        Returns:
            The catalog the item runs in.

        Raises:
            A2uiCatalogError: If the named catalog is not available on this
                surface, or the item names none and the surface has no default.
        """
        if catalog_id is not None:
            catalog = self.available_catalogs.get(catalog_id)
            if catalog is None:
                raise A2uiCatalogError(f"Catalog not found: {catalog_id}")
            return catalog
        if self.default_catalog is None:
            raise A2uiCatalogError(
                f"{subject} names no catalogId and surface {self.id} has no"
                " default catalogId."
            )
        return self.default_catalog

    def call_agent_function(
        self,
        call: AgentFunctionCall,
        *,
        abort_signal: AbortSignal | None = None,
        bypass_cache: bool = False,
    ) -> asyncio.Future[Any]:
        """Sends a function call to the agent through `agent_function_caller`.

        For reactive bindings, a settled answer for the same catalog, function
        and canonical arguments is returned from the surface cache, and a call
        identical to one still awaiting its response shares that response
        instead of sending another message, so re-evaluating a binding or
        flipping a bound argument back does not repeat the request. Failed calls
        are evicted on failure, and imperative action calls (`bypass_cache`)
        always execute fresh.

        Args:
            call: The call to send, naming the catalog it resolved to.
            abort_signal: Optional signal cancelling this caller's interest.
            bypass_cache: When True, bypasses in-flight sharing and settled
                answer caching (used for imperative action calls).

        Returns:
            A future resolving to the agent's result.

        Raises:
            A2uiExpressionError: If no `agent_function_caller` is set.
        """
        caller = self.agent_function_caller
        if caller is None:
            raise A2uiExpressionError(
                f"Function '{call.call}' is not implemented locally and surface"
                f" '{self.id}' cannot call the agent."
            )
        key = None if bypass_cache else _agent_call_key(call)
        if key is not None:
            if key in self._settled_agent_calls:
                self._settled_agent_calls.move_to_end(key)
                settled_val = self._settled_agent_calls[key]
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    loop = asyncio.get_event_loop_policy().get_event_loop()
                settled_fut: asyncio.Future[Any] = loop.create_future()
                settled_fut.set_result(settled_val)
                return settled_fut
            in_flight = self._in_flight_agent_calls.get(key)
            if in_flight is not None:
                return in_flight
        pending = asyncio.ensure_future(caller(call))
        if key is not None:
            self._in_flight_agent_calls[key] = pending

            def _release(done: asyncio.Future[Any]) -> None:
                if self._in_flight_agent_calls.get(key) is done:
                    del self._in_flight_agent_calls[key]
                if (
                    not self._disposed
                    and not done.cancelled()
                    and done.exception() is None
                ):
                    self._settled_agent_calls.pop(key, None)
                    while (
                        len(self._settled_agent_calls) >= _MAX_AGENT_CALL_CACHE_ENTRIES
                    ):
                        self._settled_agent_calls.popitem(last=False)
                    self._settled_agent_calls[key] = done.result()

            pending.add_done_callback(_release)
        return pending

    def dispatch_action(
        self, payload: dict[str, Any], source_component_id: str
    ) -> None:
        """Triggers action emission from component interactives."""
        if not isinstance(payload, dict):
            return
        import datetime

        event_payload = payload
        catalog_id: str | None = payload.get("catalogId")
        if "event" in payload and isinstance(payload["event"], dict):
            event_payload = payload["event"]
        elif "name" in payload:
            event_payload = payload
        else:
            return

        event_dict = event_payload if isinstance(event_payload, dict) else {}
        name = event_dict.get("name")
        if not name or not isinstance(name, str):
            return

        if not catalog_id:
            catalog_id = event_dict.get("catalogId")

        raw_context = event_dict.get("context")
        raw_user_message = event_dict.get("userMessage")
        has_user_message = "userMessage" in event_dict and raw_user_message is not None

        pending_signals: list[Any] = []
        _collect_pending_signals(raw_context, pending_signals)
        user_message_had_signal = False
        if has_user_message:
            before_count = len(pending_signals)
            _collect_pending_signals(raw_user_message, pending_signals)
            user_message_had_signal = len(
                pending_signals
            ) > before_count or _is_settleable_signal(raw_user_message)

        def _finish() -> None:
            if self._disposed:
                return
            if _contains_failed_signal(raw_context) or (
                has_user_message and _contains_failed_signal(raw_user_message)
            ):
                return
            unwrapped_ctx = _unwrap_signals(raw_context)
            context = unwrapped_ctx if isinstance(unwrapped_ctx, dict) else {}

            resolved_um: Any = None
            if has_user_message:
                resolved_um = _unwrap_signals(raw_user_message)
                if (
                    user_message_had_signal
                    and resolved_um is not None
                    and not isinstance(resolved_um, str)
                ):
                    self.dispatch_error({
                        "code": "INVALID_ACTION",
                        "message": "Action event 'userMessage' must be a string.",
                    })
                    return

            action_event: dict[str, Any] = {
                "name": name,
                "surfaceId": self.id,
                "sourceComponentId": source_component_id,
                "timestamp": (
                    datetime.datetime.now(datetime.timezone.utc)
                    .isoformat()
                    .replace("+00:00", "Z")
                ),
                "context": context,
            }
            if catalog_id and isinstance(catalog_id, str):
                action_event["catalogId"] = catalog_id
            if isinstance(resolved_um, str) and resolved_um:
                action_event["userMessage"] = resolved_um

            self.on_action.emit(action_event)

        if not pending_signals:
            _finish()
            return

        remaining = [len(pending_signals)]

        def _on_settled() -> None:
            remaining[0] -= 1
            if remaining[0] == 0:
                _finish()

        for sig in pending_signals:
            sig.when_settled(_on_settled)

    def dispatch_error(self, error: dict[str, Any]) -> None:
        """Dispatches an error from this surface to listeners."""
        if not isinstance(error, dict):
            raise TypeError(
                f"Expected error payload to be a dict, got {type(error).__name__}"
            )
        err_payload = copy.deepcopy(error)
        err_payload["surfaceId"] = self.id
        self.on_error.emit(err_payload)

    def dispatch_warning(self, warning: dict[str, Any]) -> None:
        """Dispatches a non-fatal warning from this surface to listeners."""
        if not isinstance(warning, dict):
            raise TypeError(
                f"Expected warning payload to be a dict, got {type(warning).__name__}"
            )
        warn_payload = copy.deepcopy(warning)
        warn_payload["surfaceId"] = self.id
        self.on_warning.emit(warn_payload)

    def dispose(self) -> None:
        """Disposes of the surface and its resources."""
        self._disposed = True
        self.agent_function_caller = None
        self._in_flight_agent_calls.clear()
        self._settled_agent_calls.clear()
        if hasattr(self.data_model, "dispose") and callable(self.data_model.dispose):
            try:
                self.data_model.dispose()
            except Exception as e:
                warnings.warn(
                    f"Error disposing data_model on surface '{self.id}': {e}",
                    RuntimeWarning,
                    stacklevel=2,
                )
        if hasattr(self.components_model, "dispose") and callable(
            self.components_model.dispose
        ):
            try:
                self.components_model.dispose()
            except Exception as e:
                warnings.warn(
                    f"Error disposing components_model on surface '{self.id}': {e}",
                    RuntimeWarning,
                    stacklevel=2,
                )
        self.on_action.dispose()
        self.on_error.dispose()
        self.on_warning.dispose()


def _is_settleable_signal(value: Any) -> bool:
    return (
        hasattr(value, "settled")
        and hasattr(value, "failed")
        and callable(getattr(value, "when_settled", None))
    )


def _collect_pending_signals(value: Any, out: list[Any]) -> None:
    if _is_settleable_signal(value):
        if not value.settled:
            out.append(value)
    elif isinstance(value, dict):
        for item in value.values():
            _collect_pending_signals(item, out)
    elif isinstance(value, list):
        for item in value:
            _collect_pending_signals(item, out)


def _contains_failed_signal(value: Any) -> bool:
    if _is_settleable_signal(value):
        return bool(value.failed)
    if isinstance(value, dict):
        return any(_contains_failed_signal(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_failed_signal(item) for item in value)
    return False


def _unwrap_signals(value: Any) -> Any:
    if _is_settleable_signal(value):
        return value.peek() if callable(getattr(value, "peek", None)) else value.value
    if isinstance(value, dict):
        return {k: _unwrap_signals(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_unwrap_signals(item) for item in value]
    return value
