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
from ..catalog import CatalogApi
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

from ..rpc import CallOptions, OutboundListener, RpcHandler
from ..resolution.data_context import DataContext

PendingAgentCallCallback = Callable[[Any, Optional[dict[str, Any]]], None]


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


@dataclass
class CapabilitiesOptions:
    """Options for generating renderer capabilities.

    Attributes:
        versions: Sequence of protocol versions to generate capabilities for.
            Defaults to [ProtocolVersion.V0_9].
        include_inline_catalogs: Whether full definitions of all catalogs will be included inline.
    """

    versions: Sequence[ProtocolVersion | str]
    include_inline_catalogs: bool = False
    component_envelope_ref: str | None = None


class MessageProcessor:
    """Core processor for handling A2UI messages, updating state, and executing operations."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi] | None = None,
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
            data_context = self._resolve_rpc_data_context(op)
            call_msg = CallRendererFunctionMessage(
                version=cast(Any, op.version),
                call_renderer_function=CallRendererFunction(  # type: ignore[call-arg]
                    functionCallId=op.function_call_id,
                    # Optional fields stay absent when unset: SpecBaseModel
                    # rejects explicit nulls.
                    callFunction=FunctionCall(  # type: ignore[call-arg]
                        call=op.call,
                        args=op.args,
                        **({"catalogId": op.catalog_id} if op.catalog_id else {}),
                    ),
                    **(
                        {"surfaceId": op.surface_id}
                        if op.surface_id is not None
                        else {}
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

    @classmethod
    def _generate_legacy_inline_catalog(
        cls,
        catalog: Any,
        component_envelope_ref: str = "common_types.json#/$defs/ComponentCommon",
    ) -> dict[str, Any]:
        """Generates a legacy (< 1.0) inline catalog dictionary."""
        components: dict[str, Any] = {}
        raw_components = getattr(catalog, "components", {}) or {}
        for name, comp in raw_components.items():
            s = getattr(comp, "schema", None)
            if isinstance(s, type) and hasattr(s, "model_json_schema"):
                s = s.model_json_schema()
            s_dict = copy.deepcopy(s) if isinstance(s, dict) else {}
            props = dict(s_dict.get("properties") or {})
            props.pop("id", None)
            props.pop("component", None)
            req = [
                r for r in s_dict.get("required") or [] if r not in ("id", "component")
            ]
            components[name] = {
                "allOf": [
                    {"$ref": component_envelope_ref},
                    {
                        "properties": {
                            "component": {"const": name},
                            **props,
                        },
                        "required": ["component", *req],
                    },
                ]
            }

        functions: list[dict[str, Any]] = []
        raw_functions = getattr(catalog, "functions", {}) or {}
        for name, fn in raw_functions.items():
            s = getattr(fn, "schema", None)
            if isinstance(s, type) and hasattr(s, "model_json_schema"):
                s = s.model_json_schema()
            s_dict = copy.deepcopy(s) if isinstance(s, dict) else {}
            if "parameters" in s_dict and isinstance(s_dict["parameters"], dict):
                params = s_dict["parameters"]
            elif (
                "properties" in s_dict
                and isinstance(s_dict["properties"], dict)
                and "args" in s_dict["properties"]
                and isinstance(s_dict["properties"]["args"], dict)
            ):
                params = s_dict["properties"]["args"]
            else:
                params = s_dict or {
                    "type": "object",
                    "properties": {},
                }
            fn_entry: dict[str, Any] = {
                "name": name,
            }
            desc = getattr(fn, "description", None) or s_dict.get("description")
            if isinstance(desc, str) and desc:
                fn_entry["description"] = desc
            fn_entry["returnType"] = getattr(fn, "return_type", None) or s_dict.get(
                "returnType", "any"
            )
            fn_entry["parameters"] = params
            functions.append(fn_entry)

        raw_theme = getattr(catalog, "theme_schema", None)
        theme: dict[str, Any] | None = None
        if isinstance(raw_theme, dict) and raw_theme:
            theme = raw_theme["properties"] if "properties" in raw_theme else raw_theme

        result: dict[str, Any] = {
            "catalogId": getattr(catalog, "catalog_id", ""),
        }
        if components:
            result["components"] = components
        if functions:
            result["functions"] = functions
        if theme:
            result["theme"] = theme
        return result

    def get_renderer_capabilities(
        self,
        options: CapabilitiesOptions,
    ) -> dict[str, Any]:
        """Generates renderer capabilities dictionary keyed by protocol version(s).

        Args:
            options: Configuration options for capability generation.

        Returns:
            Renderer capabilities dictionary.
        """
        if not options or not options.versions:
            raise A2uiValidationError(
                "At least one protocol version must be provided in CapabilitiesOptions"
                " to generate renderer capabilities."
            )
        from ..common.semver import is_at_least_version

        effective_versions = options.versions
        effective_include_inline = options.include_inline_catalogs
        envelope_ref = (
            options.component_envelope_ref or "common_types.json#/$defs/ComponentCommon"
        )

        capabilities: dict[str, Any] = {}
        for ver in effective_versions:
            if not ver:
                continue
            ver_str = ver.value if isinstance(ver, ProtocolVersion) else str(ver)
            version_caps: dict[str, Any] = {
                "supportedCatalogIds": [
                    cat_id
                    for c in self.catalogs
                    if (cat_id := getattr(c, "catalog_id", None)) is not None
                ]
            }
            if effective_include_inline:
                inline_catalogs: list[dict[str, Any]] = []
                for c in self.catalogs:
                    if is_at_least_version(ver_str, ProtocolVersion.V1_0):
                        schema = getattr(c, "catalog_schema", None)
                        if schema is not None:
                            inline_catalogs.append(schema)
                    else:
                        inline_catalogs.append(
                            self._generate_legacy_inline_catalog(c, envelope_ref)
                        )
                version_caps["inlineCatalogs"] = inline_catalogs
            capabilities[ver_str] = version_caps

        return capabilities

    def get_renderer_data_model(
        self, version: str | ProtocolVersion | None = None
    ) -> dict[str, Any] | None:
        """Aggregates active renderer data models for sync metadata.

        If version is provided, returns data models only for surfaces compatible with that version.
        If version is omitted:
          - Automatically derives the protocol version from the active surface(s) with send_data_model.
          - If active surfaces have conflicting protocol versions, raises A2uiValidationError.

        Args:
            version: Optional target protocol version to filter surfaces.

        Returns:
            Renderer data model dictionary, or None if no matching surfaces exist.
        """
        enabled_surfaces = [
            s for s in self.model.surfaces.values() if s.send_data_model
        ]
        if not enabled_surfaces:
            return None

        if version is not None:
            ver_str = (
                version.value if isinstance(version, ProtocolVersion) else str(version)
            )
            surfaces = {}
            for surface in enabled_surfaces:
                cat_ver = (
                    surface.default_catalog.protocol_version
                    if surface.default_catalog
                    else None
                )
                if not cat_ver or is_catalog_version_compatible(cat_ver, ver_str):
                    surfaces[surface.id] = surface.data_model.get("/")
            if not surfaces:
                return None
            return {"version": ver_str, "surfaces": surfaces}

        versions_set = {
            s.default_catalog.protocol_version.value
            if isinstance(s.default_catalog.protocol_version, ProtocolVersion)
            else str(s.default_catalog.protocol_version)
            for s in enabled_surfaces
            if s.default_catalog
            and getattr(s.default_catalog, "protocol_version", None)
        }

        if len(versions_set) > 1:
            raise A2uiValidationError(
                "Multiple protocol versions detected among active surfaces:"
                f" {sorted(versions_set)}. Specify a target protocol version in"
                " get_renderer_data_model(version)."
            )

        ver_str = next(iter(versions_set)) if versions_set else "v1.0"
        surfaces = {s.id: s.data_model.get("/") for s in enabled_surfaces}
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

    def _resolve_rpc_data_context(
        self, op: InternalCallRendererFunctionOp
    ) -> DataContext | None:
        """Resolves the DataContext for an inbound callRendererFunction operation."""
        if op.surface_id is not None:
            surface = self.model.get_surface(op.surface_id)
            return DataContext(surface=surface, path="/") if surface else None

        target_catalog = cast(Any, self._resolve_catalog(op.catalog_id))
        if target_catalog is None:
            return None

        available_catalogs = {
            getattr(cat, "catalog_id", f"cat_{i}"): cat
            for i, cat in enumerate(self.catalogs)
        }
        fallback_surface = SurfaceModel(
            surface_id=f"_rpc_fallback_{op.function_call_id or 'default'}",
            default_catalog=target_catalog,
            available_catalogs=available_catalogs,
        )
        return DataContext(surface=fallback_surface, path="/")

    def _process_call_renderer_function_op(
        self,
        op: InternalCallRendererFunctionOp,
        context: ExecutionContext | None = None,
    ) -> None:
        """Processes an inbound callRendererFunction operation synchronously."""
        is_user_activated = (
            getattr(context, "is_user_activated", False) if context else False
        )
        data_context = self._resolve_rpc_data_context(op)
        call_msg = CallRendererFunctionMessage(
            version=cast(Any, op.version),
            call_renderer_function=CallRendererFunction(  # type: ignore[call-arg]
                functionCallId=op.function_call_id,
                callFunction=FunctionCall(  # type: ignore[call-arg]
                    call=op.call,
                    args=op.args,
                    **({"catalogId": op.catalog_id} if op.catalog_id else {}),
                ),
                **({"surfaceId": op.surface_id} if op.surface_id is not None else {}),
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

        if op.data_model is not None:
            self._process_update_data_model_op(
                InternalUpdateDataModelOp(
                    surface_id=surface_id, path="/", value=op.data_model
                )
            )

        if op.components is not None:
            self._process_update_components_op(
                InternalUpdateComponentsOp(
                    surface_id=surface_id, components=op.components
                )
            )

    def _process_update_components_op(self, op: InternalUpdateComponentsOp) -> None:
        """Processes an updateComponents operation, validating catalog and component consistency."""
        surface_id = op.surface_id
        surface = self.model.get_surface(surface_id)
        if not surface:
            raise A2uiIntegrityError(f"Surface not found for message: {surface_id}")

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
            elif existing and (not comp_type_raw or comp_type_raw == existing.type):
                comp_catalog = existing.catalog
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
                if (
                    existing.type != new_comp.type
                    or existing.catalog is not new_comp.catalog
                ):
                    surface.components_model.remove_component(new_comp.id)
                    surface.components_model.add_component(new_comp)
                else:
                    existing.properties = new_comp.properties
            else:
                surface.components_model.add_component(new_comp)

    def _process_update_data_model_op(self, op: InternalUpdateDataModelOp) -> None:
        surface_id = op.surface_id
        surface = self.model.get_surface(surface_id)
        if not surface:
            raise A2uiIntegrityError(f"Surface not found for message: {surface_id}")

        path = op.path or "/"
        value = op.value
        surface.data_model.set(path, value)
