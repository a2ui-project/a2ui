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
import concurrent.futures
import copy
import inspect
import logging
from collections.abc import Mapping, Sequence
from typing import Any, Callable, Optional, TypeVar, Union, cast

logger = logging.getLogger(__name__)

T = TypeVar("T")

from ..common.events import EventSource
from ..state import SurfaceGroupModel, SurfaceModel, ComponentModel
from ..validation import (
    PayloadValidator,
    ValidationConfig,
    STRICT_VALIDATION,
)
from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction
from ..exceptions import (
    A2uiCatalogError,
    A2uiError,
    A2uiErrorDetail,
    A2uiIntegrityError,
    A2uiRpcError,
    A2uiValidationError,
    RpcErrorCode,
)

from ..schema import AgentToRendererMessage, ProtocolVersion
from ..schema.v1_0 import (
    AgentFunctionResponseMessage,
    CallAgentFunction,
    CallAgentFunctionMessage,
    FunctionResponse,
    FunctionResponseError,
    RendererFunctionResponseMessage,
)
from ..schema.v1_0.common_types import FunctionCall
from .adapters import VersionAdapterFactory
from .operations import (
    InternalAgentFunctionResponseOp,
    InternalCallRendererFunctionOp,
    InternalCreateSurfaceOp,
    InternalDeleteSurfaceOp,
    InternalOperation,
    InternalUpdateComponentsOp,
    InternalUpdateDataModelOp,
)

PendingAgentCallCallback = Callable[[Any, Optional[dict[str, Any]]], None]


from .execution_context import ExecutionContext


class MessageProcessor:
    """Core processor for handling A2UI messages, updating state, and executing operations."""

    def __init__(
        self,
        catalogs: Sequence[Catalog[TComponent, TFunction]] | None = None,
        validation_config: ValidationConfig | None = None,
        action_handler: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        if not catalogs:
            raise ValueError("At least one catalog must be provided.")
        self.catalogs = catalogs
        self.model = SurfaceGroupModel()
        self.validation_config = validation_config
        self.on_agent_function_response = EventSource()
        self._pending_agent_calls: dict[str, PendingAgentCallCallback] = {}
        if action_handler:
            self.model.on_action.subscribe(action_handler)

    def register_pending_agent_call(
        self,
        function_call_id: str,
        callback: PendingAgentCallCallback,
    ) -> None:
        """Registers a pending callback for an outbound callAgentFunction invocation."""
        self._pending_agent_calls[function_call_id] = callback

    def register_pending_future(
        self,
        function_call_id: str,
        future: asyncio.Future[T] | concurrent.futures.Future[T],
    ) -> None:
        """Helper method to adapt an asyncio or concurrent Future as a pending agent call callback."""

        def _future_cb(val: Any, err: dict[str, Any] | None) -> None:
            if not (hasattr(future, "done") and future.done()):
                try:
                    if err:
                        err_code = err.get("code", RpcErrorCode.UNKNOWN_ERROR.value)
                        err_msg = err.get("message", "Agent function execution failed")
                        future.set_exception(
                            A2uiRpcError(
                                f"Agent function error [{err_code}]: {err_msg}",
                                function_call_id=function_call_id,
                                code=err_code,
                            )
                        )
                    else:
                        future.set_result(val)
                except (
                    asyncio.InvalidStateError,
                    concurrent.futures.InvalidStateError,
                ) as exc:
                    logger.debug(
                        "Ignored agentFunctionResponse for call %s: pending future"
                        " already done or cancelled (%s)",
                        function_call_id,
                        exc,
                    )

        self.register_pending_agent_call(function_call_id, _future_cb)

    def cleanup_pending_agent_call(self, function_call_id: str) -> None:
        """Removes a pending agent function call by ID."""
        self._pending_agent_calls.pop(function_call_id, None)

    def cleanup_all_pending_agent_calls(self, reason: str) -> None:
        """Cancels/fails all pending agent calls and clears the pending registry."""
        for call_id, callback in list(self._pending_agent_calls.items()):
            self._invoke_pending_callback(
                call_id,
                callback,
                None,
                {
                    "code": RpcErrorCode.CANCELLED.value,
                    "message": f"Pending agent call cancelled: {reason}",
                },
            )
        self._pending_agent_calls.clear()

    def _invoke_pending_callback(
        self,
        call_id: str,
        callback: Callable[..., Any],
        value: Any,
        error: dict[str, Any] | None,
    ) -> None:
        """Safely invokes a registered callback, supporting 1- or 2-parameter signatures and catching exceptions."""
        try:
            try:
                sig = inspect.signature(callback)
                params = list(sig.parameters.values())
                if len(params) == 1 and params[0].kind in (
                    inspect.Parameter.POSITIONAL_ONLY,
                    inspect.Parameter.POSITIONAL_OR_KEYWORD,
                ):
                    callback(value)
                else:
                    callback(value, error)
            except (ValueError, TypeError):
                try:
                    callback(value, error)
                except TypeError:
                    callback(value)
        except Exception as exc:
            logger.error(
                "Unhandled error in pending callback for call %s: %s",
                call_id,
                exc,
                exc_info=True,
            )

    def process_messages(
        self,
        messages: (
            AgentToRendererMessage
            | Sequence[AgentToRendererMessage]
            | Mapping[str, Any]
            | Sequence[Mapping[str, Any]]
        ),
        context: ExecutionContext | None = None,
    ) -> list[dict[str, Any]]:
        """Accepts a list of parsed JSON messages and executes them in order."""
        adapter = VersionAdapterFactory.resolve_from_payload(messages)
        operations = adapter.extract_operations(messages, context=context)
        responses: list[dict[str, Any]] = []
        for op in operations:
            resp = self._process_operation(op)
            if resp:
                responses.append(resp)
        return responses

    def create_call_agent_function_message(
        self,
        surface_id: str,
        function_call_id: str,
        call: str,
        version: str,
        catalog_id: str | None = None,
        args: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Helper method to format an outbound callAgentFunction message for the agent."""
        msg = CallAgentFunctionMessage(
            version=cast(Any, version),
            call_agent_function=CallAgentFunction(  # type: ignore[call-arg]
                surfaceId=surface_id,
                functionCallId=function_call_id,
                callFunction=FunctionCall(
                    call=call,
                    catalogId=catalog_id,
                    args=args or {},
                ),
            ),
        )
        return msg.model_dump(by_alias=True, exclude_none=True, exclude_unset=True)

    def _resolve_catalog(self, catalog_id: str | None = None) -> Any | None:
        """Resolves catalog by catalog_id or defaults to primary catalog."""
        if catalog_id is not None:
            for cat in self.catalogs:
                if getattr(cat, "catalog_id", None) == catalog_id:
                    return cat
            return None
        elif self.catalogs:
            return self.catalogs[0]
        return None

    def get_renderer_capabilities(
        self,
        versions: list[ProtocolVersion],
        include_inline_catalogs: bool = False,
    ) -> dict[str, Any]:
        """Generates renderer capabilities dictionary keyed by protocol version(s)."""
        capabilities: dict[str, Any] = {}
        for ver in versions:
            version_caps: dict[str, Any] = {
                "supportedCatalogIds": [
                    cat_id
                    for c in self.catalogs
                    if (cat_id := getattr(c, "catalog_id", None)) is not None
                ]
            }
            if include_inline_catalogs:
                version_caps["inlineCatalogs"] = [
                    schema
                    for c in self.catalogs
                    if (schema := getattr(c, "catalog_schema", None)) is not None
                ]
            capabilities[ver.value] = version_caps

        return capabilities

    def get_renderer_data_model(
        self, version: str | ProtocolVersion = ProtocolVersion.V0_9
    ) -> dict[str, Any] | None:
        """Aggregates active renderer data models for sync metadata."""
        surfaces = {}
        for surface in self.model.surfaces.values():
            if surface.send_data_model:
                surfaces[surface.id] = surface.data_model.get("/")

        if not surfaces:
            return None

        ver_str = (
            version.value if isinstance(version, ProtocolVersion) else str(version)
        )
        return {"version": ver_str, "surfaces": surfaces}

    def _process_operation(self, op: InternalOperation) -> dict[str, Any] | None:
        """Dispatches canonical internal operations."""
        if isinstance(op, InternalCreateSurfaceOp):
            self._process_create_surface_op(op)
        elif isinstance(op, InternalDeleteSurfaceOp):
            self.model.delete_surface(op.surface_id)
        elif isinstance(op, InternalUpdateComponentsOp):
            self._process_update_components_op(op)
        elif isinstance(op, InternalUpdateDataModelOp):
            self._process_update_data_model_op(op)
        elif isinstance(op, InternalCallRendererFunctionOp):
            return self._process_call_renderer_function_op(op)
        elif isinstance(op, InternalAgentFunctionResponseOp):
            self._process_agent_function_response_op(op)
        return None

    def _process_agent_function_response_op(
        self, op: InternalAgentFunctionResponseOp
    ) -> None:
        """Processes an inbound agentFunctionResponse from the agent."""
        if op.error:
            resp_error = FunctionResponseError.model_validate(op.error)
            response_obj = FunctionResponse(  # type: ignore[call-arg]
                functionCallId=op.function_call_id,
                error=resp_error,
            )
        else:
            response_obj = FunctionResponse(  # type: ignore[call-arg]
                functionCallId=op.function_call_id,
                value=op.value,
            )

        pending_cb = self._pending_agent_calls.pop(op.function_call_id, None)
        if pending_cb is not None:
            self._invoke_pending_callback(
                op.function_call_id, pending_cb, op.value, op.error
            )

        self.on_agent_function_response.emit(
            response_obj.model_dump(
                by_alias=True, exclude_none=True, exclude_unset=True
            )
        )

    def _process_call_renderer_function_op(
        self, op: InternalCallRendererFunctionOp
    ) -> dict[str, Any]:
        """Executes an agent-initiated function call on the renderer."""
        call_id = op.function_call_id
        version = op.version
        matched_catalog = None

        def make_error(code: RpcErrorCode, msg: str) -> dict[str, Any]:
            resp = RendererFunctionResponseMessage(
                version=cast(Any, version),
                rendererFunctionResponse=FunctionResponse(  # type: ignore[call-arg]
                    functionCallId=call_id,
                    error=FunctionResponseError(code=code.value, message=msg),
                ),
            )
            return resp.model_dump(by_alias=True, exclude_unset=True)

        matched_catalog = self._resolve_catalog(op.catalog_id)
        if not matched_catalog:
            return make_error(
                RpcErrorCode.INVALID_FUNCTION_CALL,
                f"Catalog not found: {op.catalog_id}",
            )

        fn = (
            matched_catalog.get_function(op.call)
            if hasattr(matched_catalog, "get_function")
            else getattr(matched_catalog, "functions", {}).get(op.call)
        )
        if not fn:
            return make_error(
                RpcErrorCode.INVALID_FUNCTION_CALL,
                f"Function not found: {op.call}",
            )

        allowed_callers = getattr(fn, "allowed_callers", None) or "rendererOnly"
        if allowed_callers not in ("agentOnly", "rendererOrAgent"):
            return make_error(
                RpcErrorCode.INVALID_FUNCTION_CALL,
                f"Function '{op.call}' cannot be called by agent"
                f" (allowedCallers is {allowed_callers}).",
            )

        requires_user_activation = getattr(fn, "requires_user_activation", False)
        if requires_user_activation and not op.user_activation_present:
            return make_error(
                RpcErrorCode.INVALID_FUNCTION_CALL,
                f"Function '{op.call}' requires user activation context to execute.",
            )

        try:
            PayloadValidator(catalog=matched_catalog).validate_function(
                op.call, op.args
            )
        except Exception as e:
            return make_error(
                RpcErrorCode.INVALID_FUNCTION_CALL,
                f"Invalid arguments for function '{op.call}': {e}",
            )

        try:
            val = None
            if hasattr(fn, "execute"):
                res = fn.execute(op.args)
                if inspect.isawaitable(res):
                    try:
                        loop = asyncio.get_running_loop()
                        val = loop.run_until_complete(res)
                    except RuntimeError:

                        async def _run_coro() -> Any:
                            return await res

                        val = asyncio.run(_run_coro())
                else:
                    val = res

            resp = RendererFunctionResponseMessage(
                version=cast(Any, version),
                rendererFunctionResponse=FunctionResponse(  # type: ignore[call-arg]
                    functionCallId=call_id,
                    value=val,
                ),
            )
            return resp.model_dump(by_alias=True, exclude_unset=True)
        except Exception as e:
            return make_error(
                RpcErrorCode.EXECUTION_ERROR,
                str(e),
            )

    def _process_create_surface_op(self, op: InternalCreateSurfaceOp) -> None:
        surface_id = op.surface_id
        catalog_id = op.catalog_id
        theme = op.theme or {}
        send_data_model = op.send_data_model

        surface_catalog = self._resolve_catalog(catalog_id)
        if not surface_catalog:
            if catalog_id is not None:
                raise A2uiCatalogError(f"Catalog not found: {catalog_id}")
            raise A2uiCatalogError("No default catalog available for surface.")

        if self.model.get_surface(surface_id):
            raise A2uiIntegrityError(f"Surface {surface_id} already exists.")

        if theme:
            try:
                PayloadValidator(
                    catalog=surface_catalog,
                    config=self.validation_config,
                ).validate_theme(theme)
            except Exception as e:
                raise A2uiValidationError(
                    f"Validation failed for theme on surface '{surface_id}': {e}"
                ) from e

        new_surface = SurfaceModel(
            surface_id=surface_id,
            default_catalog=surface_catalog,
            theme=theme,
            send_data_model=send_data_model,
        )
        if op.root:
            new_surface.root_id = op.root
        self.model.add_surface(new_surface)

        if op.components is not None:
            self._process_update_components_op(
                InternalUpdateComponentsOp(
                    surface_id=surface_id, components=op.components
                )
            )

        if op.data_model is not None:
            self._process_update_data_model_op(
                InternalUpdateDataModelOp(
                    surface_id=surface_id, path="/", value=op.data_model
                )
            )

    def _process_update_components_op(self, op: InternalUpdateComponentsOp) -> None:
        surface_id = op.surface_id
        surface = self.model.get_surface(surface_id)
        if not surface:
            raise A2uiIntegrityError(
                f"Surface not found for message: {surface_id}. Surface {surface_id} not"
                " found for components update."
            )

        components = op.components
        if not isinstance(components, list):
            raise A2uiValidationError("Components payload must be a list.")

        component_catalogs: dict[str, Catalog[Any, Any]] = {}
        for comp in components:
            comp_dict = (
                comp
                if isinstance(comp, dict)
                else comp.model_dump(by_alias=True, exclude_none=True)
                if hasattr(comp, "model_dump")
                else cast(dict[str, Any], comp)
            )
            comp_id = comp_dict.get("id")
            if not comp_id:
                raise A2uiValidationError(
                    "Component update payload is missing an 'id' / missing required"
                    " 'id' field."
                )
            comp_cat_id = comp_dict.get("catalogId")
            if comp_cat_id:
                matched_catalog = self._resolve_catalog(comp_cat_id)
                if not matched_catalog:
                    raise A2uiCatalogError(f"Catalog not found: {comp_cat_id}")
                component_catalogs[comp_id] = matched_catalog

            existing = surface.components_model.get(comp_id)
            comp_type = comp_dict.get("component")
            if not existing and not comp_type:
                raise A2uiValidationError(
                    f"Cannot create component {comp_id} without a type."
                )

        new_component_models: list[ComponentModel] = []
        for comp in components:
            comp_dict = (
                comp
                if isinstance(comp, dict)
                else comp.model_dump(by_alias=True, exclude_none=True)
                if hasattr(comp, "model_dump")
                else cast(dict[str, Any], comp)
            )
            c_id = cast(str, comp_dict.get("id"))
            existing = surface.components_model.get(c_id)
            c_type = cast(
                str, comp_dict.get("component") or (existing.type if existing else "")
            )

            properties = {
                k: v
                for k, v in comp_dict.items()
                if k not in ("id", "component", "catalogId")
            }

            comp_catalog = component_catalogs.get(
                c_id,
                existing.catalog
                if (
                    existing
                    and (
                        not comp_dict.get("component")
                        or comp_dict.get("component") == existing.type
                    )
                )
                else surface.default_catalog,
            )
            new_comp = ComponentModel(c_id, c_type, comp_catalog, properties)
            new_component_models.append(new_comp)

        surface.components_model.validate_components_update(
            new_component_models,
            root_id=surface.root_id or "root",
            config=self.validation_config,
        )

        for new_comp in new_component_models:
            existing = surface.components_model.get(new_comp.id)
            if existing:
                if existing.type != new_comp.type:
                    surface.components_model.remove_component(new_comp.id)
                    surface.components_model.add_component(new_comp)
                else:
                    existing.catalog = new_comp.catalog
                    existing.properties = new_comp.properties
            else:
                surface.components_model.add_component(new_comp)

    def _process_update_data_model_op(self, op: InternalUpdateDataModelOp) -> None:
        surface_id = op.surface_id
        surface = self.model.get_surface(surface_id)
        if not surface:
            raise A2uiIntegrityError(
                f"Surface not found for message: {surface_id}. Surface {surface_id} not"
                " found for data model update."
            )

        path = op.path or "/"
        value = op.value

        surface.data_model.set(path, value)
