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
import dataclasses
from dataclasses import dataclass, field
import inspect
import json
from typing import Any
import warnings

from ..catalog import CatalogApi
from ..common.event_loop import get_or_create_event_loop, running_loop
from ..common.events import AbortSignal, EventSource
from ..common.metadata import (
    A2uiMetadata,
    clone_metadata,
    metadata_equals,
    normalize_metadata,
    validate_metadata,
)
from ..common.uax31 import is_valid_uax31_identifier
from ..exceptions import (
    A2uiCatalogError,
    A2uiExpressionError,
    A2uiRpcError,
    A2uiValidationError,
    RpcErrorCode,
)
from ..schema import ProtocolVersion
from ..security.url_security_policy import (
    DEFAULT_URL_SECURITY_POLICY,
    OpenUrlHandler,
    UrlCheckInfo,
    UrlContext,
    UrlSecurityPolicy,
    apply_url_security_policy,
    redact_url,
)
from .data_model import DataModel
from .surface_components_model import SurfaceComponentsModel

_MAX_AGENT_CALL_CACHE_ENTRIES = 256
# The most blocked URLs a surface remembers, to report each only once.
_MAX_REPORTED_BLOCKED_URLS = 256


def _check_max_agent_call_cache_entries(value: Any) -> int:
    """Returns the cache bound, or raises ValueError if it isn't positive."""
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError("max_agent_call_cache_entries must be a positive integer.")
    return value


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

It returns an awaitable (a future, a task or a coroutine) that resolves with
the agent's answer, or raises with its error. It may also raise
synchronously: an `A2uiRpcError` with code `CANCELLED` fails the call
silently, and any other exception is reported as an `EXPRESSION_ERROR`. A
caller that returns something that is not awaitable, such as None, fails
the call with an `EXPRESSION_ERROR` saying so.

It is called on the event loop that owns the surface. `MessageProcessor`
installs one on each v1.0 surface when it has an `outbound_listener`; it
dispatches `callAgentFunction` through the processor's `RpcHandler`.
"""


def _has_only_string_keys(value: Any) -> bool:
    """Returns whether every object nested in `value` has string keys.

    `json.dumps` turns other keys into strings, which changes the data.
    """
    if isinstance(value, dict):
        return all(
            isinstance(key, str) and _has_only_string_keys(item)
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return all(_has_only_string_keys(item) for item in value)
    return True


def agent_call_key(call: AgentFunctionCall) -> str | None:
    """Builds the key that identifies identical agent function calls.

    The key is the canonical JSON form of the catalog, the function name and
    the arguments, with object keys sorted at every level and array order
    kept. Arguments have a JSON form when `json.dumps(..., allow_nan=False)`
    accepts them, which includes tuples and `str` or `int` based enums, and
    every object key is a string.

    Internal: `DataContext` uses it to remember failed calls. It is not part
    of the public API.

    Returns:
        The key, or None if the arguments have no faithful JSON form.
    """
    if not _has_only_string_keys(call.args):
        return None
    try:
        return json.dumps(
            [call.catalog_id, call.call, call.args],
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError, RecursionError):
        return None


def _settled_future(value: Any) -> asyncio.Future[Any]:
    """Returns a future that already holds `value`."""
    future: asyncio.Future[Any] = get_or_create_event_loop().create_future()
    future.set_result(value)
    return future


def _isolated_future(source: asyncio.Future[Any]) -> asyncio.Future[Any]:
    """Returns a future that settles like `source`, with a copy of its result.

    Callers that share one in-flight call each get their own copy of the
    answer, so one of them changing it does not change it for the others.
    """
    target: asyncio.Future[Any] = source.get_loop().create_future()

    def _copy(done: asyncio.Future[Any]) -> None:
        if target.done():
            return
        if done.cancelled():
            target.cancel()
            return
        error = done.exception()
        if error is not None:
            target.set_exception(error)
        else:
            target.set_result(copy.deepcopy(done.result()))

    source.add_done_callback(_copy)
    return target


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
        metadata: A2uiMetadata | None = None,
        *,
        max_agent_call_cache_entries: int = _MAX_AGENT_CALL_CACHE_ENTRIES,
        url_security_policy: UrlSecurityPolicy | None = None,
        open_url_handler: OpenUrlHandler | None = None,
    ) -> None:
        """Initializes the surface.

        Args:
            max_agent_call_cache_entries: The most settled agent function call
                answers the surface keeps; the oldest is evicted first.
            url_security_policy: Decides which URLs components and functions
                on the surface may load, open, or embed. Defaults to
                `PermissiveUrlSecurityPolicy`, which applies only the built-in
                baseline checks.
            open_url_handler: Opens URLs that `openUrl` was allowed to open.
                Without one, an allowed `openUrl` call does nothing.

        Raises:
            ValueError: If `max_agent_call_cache_entries` isn't a positive
                integer.
        """
        self._max_agent_call_cache_entries = _check_max_agent_call_cache_entries(
            max_agent_call_cache_entries
        )
        self._url_security_policy: UrlSecurityPolicy = (
            url_security_policy
            if url_security_policy is not None
            else DEFAULT_URL_SECURITY_POLICY
        )
        self._open_url_handler = open_url_handler
        # Keys of blocked URLs already reported, oldest first.
        self._reported_blocked_urls: OrderedDict[tuple[Any, ...], None] = OrderedDict()
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
        validate_metadata(metadata, context=f"surface '{surface_id}' metadata")
        self._metadata: A2uiMetadata | None = normalize_metadata(metadata)

        self.data_model = data_model or DataModel()
        self.components_model = SurfaceComponentsModel(default_catalog)
        self.root_id = root_id
        self.on_action = EventSource()
        self.on_error = EventSource()
        self.on_warning = EventSource()
        self._agent_function_caller: AgentFunctionCaller | None = None
        # Agent function calls awaiting a response, keyed by call.
        self._in_flight_agent_calls: dict[str, asyncio.Future[Any]] = {}
        # Settled reactive agent function call answers, bounded in FIFO order:
        # the oldest settled entry is evicted first, and reading an entry
        # doesn't refresh it.
        self._settled_agent_calls: OrderedDict[str, Any] = OrderedDict()
        self._disposed = False
        self.on_metadata_changed = EventSource()

    @property
    def max_agent_call_cache_entries(self) -> int:
        """The most settled agent function call answers the surface keeps."""
        return self._max_agent_call_cache_entries

    @property
    def disposed(self) -> bool:
        """Whether this surface has been disposed."""
        return self._disposed

    @property
    def url_security_policy(self) -> UrlSecurityPolicy:
        """Decides which URLs components and functions on this surface may use.

        Set once at construction: `MessageProcessor` passes
        `MessageProcessorOptions.url_security_policy`, and a surface created
        without one uses `PermissiveUrlSecurityPolicy`. Components and
        functions don't read it directly: they call `sanitize_url` on the
        context they receive, and the resolver filters properties marked as
        URLs.
        """
        return self._url_security_policy

    @property
    def open_url_handler(self) -> OpenUrlHandler | None:
        """Opens URLs that `openUrl` was allowed to open, if the host set one."""
        return self._open_url_handler

    def sanitize_url(
        self, url: str, context: UrlContext, info: UrlCheckInfo | None = None
    ) -> str | None:
        """Checks a URL against the baseline and this surface's policy.

        A blocked URL is reported once as a `URL_BLOCKED` warning on
        `on_warning`, carrying a redacted form of the URL (`redactedUrl`: scheme
        and host, the media type of a `data:` URL, or only the scheme), its
        `context`, and the fields of `info` (`componentId`, `propertyName`,
        and so on). The full URL is never reported, since its path or query
        may hold the data being exfiltrated.

        Components and functions usually call `sanitize_url` on their
        `ComponentContext` or `DataContext`, which fill in `info`.

        Args:
            url: The URL to check.
            context: How the URL is used: `"media"`, `"navigation"`, or
                `"iframe"`.
            info: Where the URL comes from. The surface ID is filled in.

        Returns:
            The URL to use, possibly rewritten, or None when it is blocked.

        Raises:
            ValueError: If `context` is not a URL context.
        """
        full_info = dataclasses.replace(info or UrlCheckInfo(), surface_id=self.id)
        result = apply_url_security_policy(
            self._url_security_policy, url, context, full_info
        )
        if result is None:
            self._report_blocked_url(url, context, full_info)
        return result

    def _report_blocked_url(
        self, url: Any, context: UrlContext, info: UrlCheckInfo
    ) -> None:
        if self._disposed:
            return
        key = (url, context, info.component_id, info.property_name, info.function_name)
        if key in self._reported_blocked_urls:
            return
        while len(self._reported_blocked_urls) >= _MAX_REPORTED_BLOCKED_URLS:
            self._reported_blocked_urls.popitem(last=False)
        self._reported_blocked_urls[key] = None
        if info.property_name:
            source = f"property '{info.property_name}'" + (
                f" of '{info.component_id}'" if info.component_id else ""
            )
        elif info.function_name:
            source = f"function '{info.function_name}'"
        else:
            source = "a component"
        # The full URL may carry the data being exfiltrated in its path or
        # query, so only a redacted form leaves the surface.
        redacted = redact_url(url) if isinstance(url, str) else "invalid"
        warning: dict[str, Any] = {
            key_name: value
            for key_name, value in (
                ("catalogId", info.catalog_id),
                ("componentType", info.component_type),
                ("componentId", info.component_id),
                ("propertyName", info.property_name),
                ("functionName", info.function_name),
            )
            if value is not None
        }
        article = "an" if context == "iframe" else "a"
        warning.update({
            "code": "URL_BLOCKED",
            "message": (
                f"The URL security policy blocked {article} {context} URL"
                f" ({redacted}) in {source}."
            ),
            "redactedUrl": redacted,
            "context": context,
        })
        self.dispatch_warning(warning)

    @property
    def agent_function_caller(self) -> AgentFunctionCaller | None:
        """Sends calls to functions the renderer does not implement to the agent.

        When set, a v1.0 function call whose function has no local
        implementation in the catalog it resolves to (undeclared, or declared
        schema-only) is routed here instead of failing, as the v1.0 fallback
        routing defines. Setting a different caller, or clearing it, drops
        the calls in flight and the cached answers of the previous one.
        """
        return self._agent_function_caller

    @agent_function_caller.setter
    def agent_function_caller(self, caller: AgentFunctionCaller | None) -> None:
        if caller is self._agent_function_caller:
            return
        self._agent_function_caller = caller
        self._in_flight_agent_calls.clear()
        self._settled_agent_calls.clear()

    @property
    def metadata(self) -> A2uiMetadata | None:
        """Returns a defensive copy of the surface's metadata envelope, or None."""
        return clone_metadata(self._metadata)

    @metadata.setter
    def metadata(self, metadata: A2uiMetadata | None) -> None:
        """Replaces the surface's metadata envelope after validating UAX #31 keys."""
        validate_metadata(metadata, context=f"surface '{self.id}' metadata")
        next_meta = normalize_metadata(metadata)
        if metadata_equals(self._metadata, next_meta):
            return
        self._metadata = next_meta
        self.on_metadata_changed.emit(clone_metadata(self._metadata))

    @property
    def extensions(self) -> dict[str, Any] | None:
        """Returns a defensive copy of `metadata['extensions']`, or None."""
        if self._metadata is None or not isinstance(
            self._metadata.get("extensions"), dict
        ):
            return None
        return dict(copy.deepcopy(self._metadata["extensions"]))

    def set_extension(self, key: str, value: Any) -> None:
        """Sets a single extension key on the surface metadata envelope.

        Passing ``None`` stores a JSON ``null`` value under ``key``; use
        :meth:`remove_extension` to delete an extension key.
        """
        if not isinstance(key, str) or not is_valid_uax31_identifier(key):
            raise A2uiValidationError(
                f"Invalid UAX #31 extension identifier '{key}' in surface"
                f" '{self.id}' metadata.extensions."
            )
        current_ext = (
            dict(self._metadata.get("extensions") or {})
            if self._metadata is not None
            else {}
        )
        current_ext[key] = copy.deepcopy(value)
        self.metadata = {"extensions": current_ext}

    def remove_extension(self, key: str) -> None:
        """Removes a single extension key, collapsing empty metadata to None."""
        if (
            self._metadata is None
            or not isinstance(self._metadata.get("extensions"), dict)
            or key not in self._metadata["extensions"]
        ):
            return
        current_ext = dict(self._metadata["extensions"])
        del current_ext[key]
        self.metadata = {"extensions": current_ext} if current_ext else None

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
        flipping a bound argument back does not repeat the request. Each
        caller gets its own copy of a shared or cached answer. A failed call
        is evicted before its callers learn of the failure, and imperative
        action calls (`bypass_cache`) always execute fresh.

        Nothing is sent on a disposed surface, nor for an evaluation that
        `abort_signal` has aborted.

        Args:
            call: The call to send, naming the catalog it resolved to.
            abort_signal: Optional signal cancelling this caller's interest.
                If it has fired already, nothing is sent and the returned
                future holds None.
            bypass_cache: When True, bypasses in-flight sharing and settled
                answer caching (used for imperative action calls).

        Call it on the event loop that owns the surface. Off a running loop,
        such as from synchronous code or a worker thread, only a cached
        answer can be read; a call that would have to be sent fails at once,
        since its answer could never arrive there.

        Returns:
            A future resolving to the agent's result. A cached answer's future
            is done already, so code off the loop can read it.

        Raises:
            A2uiRpcError: With code `CANCELLED` if the surface is disposed.
            A2uiExpressionError: If no `agent_function_caller` is set, the
                arguments have no faithful JSON form (such as NaN or an
                infinity), the call would have to be sent while no event loop
                is running, or the caller returns something not awaitable.
        """
        if self._disposed:
            raise A2uiRpcError(
                f"Pending calls for surface '{self.id}' were cancelled.",
                code=RpcErrorCode.CANCELLED,
            )
        caller = self._agent_function_caller
        if caller is None:
            raise A2uiExpressionError(
                f"Function '{call.call}' is not implemented locally and surface"
                f" '{self.id}' cannot call the agent."
            )
        key = agent_call_key(call)
        if key is None:
            raise A2uiExpressionError(
                f"Function '{call.call}' arguments are not valid JSON, so the"
                " call was not sent to the agent."
            )
        if abort_signal is not None and abort_signal.aborted:
            return _settled_future(None)
        if not bypass_cache and key in self._settled_agent_calls:
            return _settled_future(copy.deepcopy(self._settled_agent_calls[key]))
        loop = running_loop()
        if loop is None:
            raise A2uiExpressionError(
                f"Function '{call.call}' was not sent to the agent: no event loop"
                " is running in this thread, so its answer could never arrive."
                " Evaluate the surface on the event loop that owns it."
            )
        if bypass_cache:
            return self._send_agent_call(caller, call, loop)
        in_flight = self._in_flight_agent_calls.get(key)
        if in_flight is not None:
            return _isolated_future(in_flight)
        pending = self._send_agent_call(caller, call, loop)
        self._in_flight_agent_calls[key] = pending

        def _release(done: asyncio.Future[Any]) -> None:
            # Runs before the callers' callbacks, so a failed call is gone
            # from the surface by the time they hear of the failure.
            if self._in_flight_agent_calls.get(key) is done:
                del self._in_flight_agent_calls[key]
            if (
                self._disposed
                # The answer of a caller that has been replaced is stale.
                or self._agent_function_caller is not caller
                or done.cancelled()
                or done.exception() is not None
            ):
                return
            self._settled_agent_calls.pop(key, None)
            while len(self._settled_agent_calls) >= self._max_agent_call_cache_entries:
                self._settled_agent_calls.popitem(last=False)
            self._settled_agent_calls[key] = copy.deepcopy(done.result())

        pending.add_done_callback(_release)
        return _isolated_future(pending)

    def settled_agent_answer(self, call: AgentFunctionCall) -> tuple[bool, Any]:
        """Returns the answer this surface holds for `call`, without sending it.

        Returns:
            Whether a settled answer for the same catalog, function and
            arguments is cached, and a copy of it (None if there is none).
        """
        if self._disposed:
            return False, None
        key = agent_call_key(call)
        if key is None or key not in self._settled_agent_calls:
            return False, None
        return True, copy.deepcopy(self._settled_agent_calls[key])

    @staticmethod
    def _send_agent_call(
        caller: AgentFunctionCaller,
        call: AgentFunctionCall,
        loop: asyncio.AbstractEventLoop,
    ) -> asyncio.Future[Any]:
        """Sends `call` through `caller` and returns its result as a future."""
        sent: Any = caller(call)
        if isinstance(sent, asyncio.Future):
            return sent
        if not inspect.isawaitable(sent):
            raise A2uiExpressionError(
                f"The agent function caller returned {type(sent).__name__} for"
                f" function '{call.call}'; it must return an awaitable."
            )
        return asyncio.ensure_future(sent, loop=loop)

    def dispatch_action(
        self,
        payload: dict[str, Any],
        source_component_id: str,
        metadata: A2uiMetadata | None = None,
    ) -> None:
        """Triggers action emission from component interactives.

        The event's `context` values and `userMessage` may hold results that
        `DataContext.resolve_action` left pending, such as agent function
        results. The action is emitted once they have all settled, and not at
        all if one of them fails; that failure has been reported already.

        `userMessage` is validated where it is resolved. A non-string that an
        action expression produced is an `INVALID_ACTION` error, whether it
        resolved inside `resolve_action` or settled here later. A non-string
        passed to this method as a literal is ignored.
        """
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

        payload_metadata = (
            event_dict.get("metadata")
            if "metadata" in event_dict
            else payload.get("metadata")
        )
        effective_metadata: A2uiMetadata | None = None
        if payload_metadata is not None and metadata is not None:
            validate_metadata(payload_metadata, context="action metadata")
            validate_metadata(metadata, context="action metadata")
            merged_ext: dict[str, Any] = {}
            if isinstance(payload_metadata.get("extensions"), dict):
                merged_ext.update(payload_metadata["extensions"])
            if isinstance(metadata.get("extensions"), dict):
                merged_ext.update(metadata["extensions"])
            effective_metadata = {"extensions": merged_ext} if merged_ext else None
        elif metadata is not None:
            effective_metadata = metadata
        else:
            effective_metadata = payload_metadata

        cloned_metadata: A2uiMetadata | None = None
        if effective_metadata is not None:
            validate_metadata(effective_metadata, context="action metadata")
            cloned_metadata = normalize_metadata(effective_metadata)

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
                        "message": (
                            "Action event 'userMessage' must resolve to a string."
                        ),
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
            if cloned_metadata is not None:
                action_event["metadata"] = cloned_metadata

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
        if err_payload.get("functionCallId"):
            err_payload.pop("surfaceId", None)
        else:
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
        self._agent_function_caller = None
        self._in_flight_agent_calls.clear()
        self._settled_agent_calls.clear()
        self._reported_blocked_urls.clear()
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
        self.on_metadata_changed.dispose()


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
