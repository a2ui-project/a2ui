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
from dataclasses import dataclass
import inspect
import logging
from collections.abc import Mapping, Sequence
from typing import Any, Callable, Optional, TypeVar, Union, cast

logger = logging.getLogger(__name__)

T = TypeVar("T")

from ..common.events import EventSource
from .adapters import is_catalog_version_compatible
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

from ..schema import (
    AgentToRendererMessage,
    AgentToRendererMessagePayload,
    ProtocolVersion,
)
from ..schema.v1_0 import (
    AgentFunctionResponseMessage,
    CallAgentFunction,
    CallAgentFunctionMessage,
    CallRendererFunction,
    CallRendererFunctionMessage,
    FunctionResponse,
    FunctionResponseError,
    RendererFunctionResponseMessage,
)
from ..schema.v1_0.common_types import FunctionCall
from .adapters import VersionAdapterFactory
from .execution_context import ExecutionContext
from .operations import (
    InternalAgentFunctionResponseOp,
    InternalCallRendererFunctionOp,
    InternalCreateSurfaceOp,
    InternalDeleteSurfaceOp,
    InternalOperation,
    InternalUpdateComponentsOp,
    InternalUpdateDataModelOp,
)

from dataclasses import dataclass

from ..rpc import CallOptions, OutboundListener, RpcHandler

PendingAgentCallCallback = Callable[[Any, Optional[dict[str, Any]]], None]


from .execution_context import ExecutionContext
from ..resolution.data_context import DataContext


@dataclass
class MessageProcessorOptions:
    """Options for configuring a MessageProcessor instance.

    Attributes:
        validation_config: Validation configuration to enforce on messages, or None.
        outbound_listener: Listener callback for outbound messages dispatched by RPC.
        default_timeout_ms: Default timeout in milliseconds for async RPC calls.
    """

    validation_config: ValidationConfig | None = None
    outbound_listener: OutboundListener | None = None
    default_timeout_ms: float = 30000.0


class MessageProcessor:
    """Core processor for handling A2UI messages, updating state, and executing operations."""

    def __init__(
        self,
        catalogs: Sequence[Catalog[TComponent, TFunction]] | None = None,
        action_handler: Callable[[dict[str, Any]], None] | None = None,
        options: MessageProcessorOptions | None = None,
    ) -> None:
        """Initializes a MessageProcessor with component catalogs and options.

        Args:
            catalogs: Sequence of component and function catalogs for resolution.
            action_handler: Optional callback invoked when UI actions trigger.
            options: Optional configuration options including validation rules.

        Raises:
            ValueError: If catalogs is empty or None.
        """
        if not catalogs:
            raise ValueError("At least one catalog must be provided.")
        self.catalogs = catalogs
        self.model = SurfaceGroupModel()
        opts = options or MessageProcessorOptions()
        self.validation_config = opts.validation_config
        self.rpc = RpcHandler(
            catalogs=catalogs,
            outbound_listener=opts.outbound_listener,
            default_timeout_ms=opts.default_timeout_ms,
        )
        if action_handler:
            self.model.on_action.subscribe(action_handler)

    def _extract_operations(
        self, messages: AgentToRendererMessagePayload
    ) -> list[InternalOperation]:
        """Resolves adapter and extracts operations from payload or raw operation."""
        if isinstance(messages, InternalOperation):
            return [messages]
        adapter = VersionAdapterFactory.resolve_from_payload(messages)
        return adapter.extract_operations(messages)

    def process_messages(
        self,
        messages: AgentToRendererMessagePayload,
        context: ExecutionContext | None = None,
    ) -> None:
        """Accepts a list of parsed JSON messages and executes state operations in order synchronously."""
        for op in self._extract_operations(messages):
            self.process_operation(op, context)

    async def process_messages_async(
        self,
        messages: AgentToRendererMessagePayload,
        context: ExecutionContext | None = None,
    ) -> list[dict[str, Any]]:
        """Asynchronously processes messages, executing RPC calls and returning all produced responses."""
        responses: list[dict[str, Any]] = []
        for op in self._extract_operations(messages):
            resp = await self.process_operation_async(op, context)
            if resp is not None:
                responses.append(resp)
        return responses

    async def process_operation_async(
        self,
        op: InternalOperation,
        context: ExecutionContext | None = None,
    ) -> dict[str, Any] | None:
        """Executes a single internal operation asynchronously, returning a response dict if RPC call, else None."""
        if isinstance(op, InternalCallRendererFunctionOp):
            is_user_activated = (
                getattr(context, "is_user_activated", False) if context else False
            )
            surface = next(iter(self.model.surfaces.values()), None)
            data_context = DataContext(surface=surface, path="/") if surface else None
            call_msg = CallRendererFunctionMessage(
                version=cast(Any, op.version),
                call_renderer_function=CallRendererFunction(  # type: ignore[call-arg]
                    functionCallId=op.function_call_id,
                    callFunction=FunctionCall(
                        call=op.call,
                        catalogId=op.catalog_id,
                        args=op.args,
                    ),
                ),
            )
            return await self.rpc.handle_call_renderer_function_async(
                call_msg,
                context=data_context,
                is_user_activated=is_user_activated or op.is_user_activated,
            )
        self.process_operation(op)
        return None

    def call_agent_function(
        self,
        surface_id: str,
        call: FunctionCall,
        options: CallOptions | None = None,
    ) -> asyncio.Future[Any]:
        """Invokes a remote function on the server agent using RpcHandler."""
        return self.rpc.call_agent_function(
            surface_id=surface_id,
            call=call,
            options=options,
        )

    def _resolve_catalog(self, catalog_id: str | None = None) -> Any | None:
        """Resolves a catalog by catalog_id, or returns None if catalog_id is None or not found."""
        return self.rpc.resolve_catalog(catalog_id)

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

    def process_operation(
        self,
        op: InternalOperation,
        context: ExecutionContext | None = None,
    ) -> None:
        """Executes a single canonical internal state operation."""
        if isinstance(op, InternalCreateSurfaceOp):
            self._process_create_surface_op(op)
        elif isinstance(op, InternalDeleteSurfaceOp):
            self.model.delete_surface(op.surface_id)
        elif isinstance(op, InternalUpdateComponentsOp):
            self._process_update_components_op(op)
        elif isinstance(op, InternalUpdateDataModelOp):
            self._process_update_data_model_op(op)
        elif isinstance(op, InternalCallRendererFunctionOp):
            self._process_call_renderer_function_op(op, context)
        elif isinstance(op, InternalAgentFunctionResponseOp):
            self._process_agent_function_response_op(op)
        return None

    def _process_call_renderer_function_op(
        self,
        op: InternalCallRendererFunctionOp,
        context: ExecutionContext | None = None,
    ) -> None:
        """Processes an inbound callRendererFunction operation synchronously."""
        is_user_activated = (
            getattr(context, "is_user_activated", False) if context else False
        )
        surface = next(iter(self.model.surfaces.values()), None)
        data_context = DataContext(surface=surface, path="/") if surface else None
        call_msg = CallRendererFunctionMessage(
            version=cast(Any, op.version),
            call_renderer_function=CallRendererFunction(  # type: ignore[call-arg]
                functionCallId=op.function_call_id,
                callFunction=FunctionCall(
                    call=op.call,
                    catalogId=op.catalog_id,
                    args=op.args,
                ),
            ),
        )
        try:
            self.rpc.handle_call_renderer_function(
                call_msg,
                context=data_context,
                is_user_activated=is_user_activated or op.is_user_activated,
            )
        except Exception as err:
            logger.error(
                "Unhandled error in callRendererFunction (%s): %s", op.call, err
            )

    def _process_agent_function_response_op(
        self, op: InternalAgentFunctionResponseOp
    ) -> None:
        """Processes an inbound agentFunctionResponse from the agent."""
        msg_dict = {
            "version": op.version,
            "agentFunctionResponse": {
                "functionCallId": op.function_call_id,
                "value": op.value,
                "error": op.error,
            },
        }
        self.rpc.handle_agent_function_response(msg_dict)

    def _process_create_surface_op(self, op: InternalCreateSurfaceOp) -> None:
        """Processes a createSurface operation, validating catalog and theme compatibility."""
        surface_id = op.surface_id
        catalog_id = op.catalog_id
        theme = op.theme or {}
        send_data_model = op.send_data_model

        if catalog_id is None and self.catalogs:
            # v0.8 fallback to the first catalog
            surface_catalog = self.catalogs[0]
        else:
            surface_catalog = cast(Any, self._resolve_catalog(catalog_id))
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

        surface_proto_ver = getattr(surface_catalog, "protocol_version", None)
        msg_version = op.version or getattr(self, "version", None)
        if (
            surface_proto_ver
            and msg_version
            and not is_catalog_version_compatible(surface_proto_ver, msg_version)
        ):
            cat_name = catalog_id or getattr(surface_catalog, "catalog_id", "unknown")
            raise A2uiValidationError(
                f"Surface '{surface_id}' catalog '{cat_name}' specification version"
                f" ({surface_proto_ver}) does not match message protocol version"
                f" ({msg_version})."
            )

        matching_available_catalogs = {
            getattr(cat, "catalog_id", f"cat_{i}"): cat
            for i, cat in enumerate(self.catalogs)
            if is_catalog_version_compatible(
                getattr(cat, "protocol_version", None),
                surface_proto_ver,
            )
        }
        new_surface = SurfaceModel(
            surface_id=surface_id,
            default_catalog=surface_catalog,
            available_catalogs=matching_available_catalogs,
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
        """Processes an updateComponents operation, validating catalog and component consistency."""
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

        new_component_models: list[ComponentModel] = []
        for comp in components:
            comp_dict = (
                comp
                if isinstance(comp, dict)
                else comp.model_dump(by_alias=True, exclude_none=True)
                if hasattr(comp, "model_dump")
                else cast(dict[str, Any], comp)
            )
            c_id = comp_dict.get("id")
            if not c_id:
                raise A2uiValidationError(
                    "Component update payload is missing an 'id' / missing required"
                    " 'id' field."
                )

            existing = surface.components_model.get(c_id)
            comp_type_raw = comp_dict.get("component")
            if not existing and not comp_type_raw:
                raise A2uiValidationError(
                    f"Cannot create component {c_id} without a type."
                )
            c_type = cast(str, comp_type_raw or (existing.type if existing else ""))

            comp_cat_id = comp_dict.get("catalogId")
            if comp_cat_id:
                comp_catalog = self._resolve_catalog(comp_cat_id)
                if not comp_catalog:
                    raise A2uiCatalogError(f"Catalog not found: {comp_cat_id}")
                comp_ver = getattr(comp_catalog, "protocol_version", None)
                surface_ver = getattr(surface.default_catalog, "protocol_version", None)
                if (
                    comp_ver
                    and surface_ver
                    and not is_catalog_version_compatible(comp_ver, surface_ver)
                ):
                    raise A2uiCatalogError(
                        f"Component {c_id} catalog '{comp_cat_id}' has different"
                        f" protocol version {comp_ver} than default catalog"
                        f" {surface_ver}."
                    )
            else:
                comp_catalog = surface.default_catalog

            properties = {
                k: v
                for k, v in comp_dict.items()
                if k not in ("id", "component", "catalogId")
            }

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
