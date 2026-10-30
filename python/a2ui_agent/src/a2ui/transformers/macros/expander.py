# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Macro expander transforming catalog schemas and lowering message envelopes."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable, Mapping, Sequence
import copy
import logging
from typing import Any

from a2ui.builder import v1_0 as builder_v1_0
from a2ui.builder.core import ComponentBuilderNode as CoreComponentBuilderNode
from a2ui.constants import CATALOG_COMPONENTS_KEY
from a2ui.core import (
    A2uiCatalogError,
    A2uiRecursionError,
    A2uiValidationError,
    Catalog,
    CatalogApi,
)
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.transformers.macros.macro import _MacroMetadata
from a2ui.transformers.macros.processor import _MacroProcessor
from a2ui.utils import to_version_number

logger = logging.getLogger(__name__)

_V1_0_BASIC_CATALOG_ID = (
    "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
)
_MAX_TRACKED_SURFACES = 256

_BASIC_PRIMITIVE_NAMES: frozenset[str] = frozenset(
    name
    for name, obj in vars(builder_v1_0.basic).items()
    if isinstance(obj, type)
    and issubclass(obj, CoreComponentBuilderNode)
    and obj is not CoreComponentBuilderNode
    and obj is not builder_v1_0.ComponentBuilderNode
)

_COMPONENT_ENVELOPE_KEYS: frozenset[str] = frozenset({
    "catalogId",
    "accessibility",
    "metadata",
    "weight",
})


def _apply_envelope_fields(
    comp: dict[str, Any],
    declared_params: Mapping[str, Any],
    expanded_macro: list[dict[str, Any]],
    instance_id: str | None,
    catalog_base_components: dict[str, set[str]],
    *,
    macro_catalog_id: str | None = None,
    surface_catalog_id: str | None = None,
    protocol_version: str | None = None,
) -> None:
    """Propagates component envelope fields from a macro instance onto its expanded output."""
    if not expanded_macro:
        return

    root_comp: dict[str, Any] | None = None
    if instance_id is not None:
        for item in reversed(expanded_macro):
            if item.get("id") == instance_id:
                root_comp = item
                break
    if root_comp is None:
        root_comp = expanded_macro[-1]

    if comp.get("accessibility") is not None and "accessibility" not in declared_params:
        a11y_copy = copy.deepcopy(comp["accessibility"])
        if isinstance(root_comp.get("accessibility"), dict) and isinstance(
            a11y_copy, dict
        ):
            root_comp["accessibility"] = {
                **root_comp["accessibility"],
                **a11y_copy,
            }
        else:
            root_comp["accessibility"] = a11y_copy

    if comp.get("metadata") is not None and "metadata" not in declared_params:
        meta_copy = copy.deepcopy(comp["metadata"])
        if isinstance(root_comp.get("metadata"), dict) and isinstance(meta_copy, dict):
            merged_meta = {**root_comp["metadata"], **meta_copy}
            if isinstance(root_comp["metadata"].get("extensions"), dict) and isinstance(
                meta_copy.get("extensions"), dict
            ):
                merged_meta["extensions"] = {
                    **root_comp["metadata"]["extensions"],
                    **meta_copy["extensions"],
                }
            root_comp["metadata"] = merged_meta
        else:
            root_comp["metadata"] = meta_copy

    if comp.get("weight") is not None and "weight" not in declared_params:
        root_comp["weight"] = comp["weight"]

    if comp.get("catalogId") is not None and "catalogId" not in declared_params:
        explicit_cid = comp["catalogId"]
        if isinstance(explicit_cid, str) and explicit_cid:
            if explicit_cid in catalog_base_components:
                base_comps = catalog_base_components[explicit_cid]
                for item in expanded_macro:
                    if "catalogId" not in item and item.get("component") in base_comps:
                        item["catalogId"] = explicit_cid
            elif macro_catalog_id is None and not catalog_base_components:
                for item in expanded_macro:
                    if "catalogId" not in item:
                        item["catalogId"] = explicit_cid

    if (
        protocol_version == "1.0"
        and surface_catalog_id is not None
        and surface_catalog_id != _V1_0_BASIC_CATALOG_ID
        and (
            surface_catalog_id == macro_catalog_id
            or surface_catalog_id in catalog_base_components
        )
    ):
        surface_base_comps = catalog_base_components.get(surface_catalog_id, set())
        for item in expanded_macro:
            comp_type = item.get("component")
            if (
                "catalogId" not in item
                and isinstance(comp_type, str)
                and comp_type not in surface_base_comps
                and comp_type in _BASIC_PRIMITIVE_NAMES
            ):
                item["catalogId"] = _V1_0_BASIC_CATALOG_ID


class MacroExpander:
    """Expands composite macro components into standard A2UI primitive component subtrees.

    Acts as a catalog and message transformer:
    1. transform_to_inference_catalog: Augments a base catalog with synthesized
       macro component schemas so LLMs can author high-level components.
    2. transform_to_transport: Rewrites outbound messages by expanding macro
       components into flat primitive ASTs understood by downstream renderers.
    3. transform_to_inference: Passes transport messages through untouched (safe identity pass-through).
    """

    def __init__(
        self,
        macros: Sequence[Callable[..., Any] | _MacroMetadata] | None = None,
        *,
        passthrough_components: Sequence[str] | None = None,
        catalog_id: str | None = None,
    ):
        """Initializes the macro expander.

        Args:
            macros: Explicit sequence of macro functions decorated with @macro.
            passthrough_components: Optional sequence of component names from the source
                catalog to pass through to the inference catalog. If None (default), all
                source catalog components pass through. If specified, only these
                components are retained from the source catalog alongside the macros.
                Passing an empty sequence ([]) retains zero source catalog components,
                exposing exclusively the macros.
            catalog_id: Optional catalog identifier scoping macro expansion to components
                resolved to this catalog on mixed-catalog surfaces.
        """
        self.macros: list[_MacroMetadata] = []
        if macros:
            for m in macros:
                if isinstance(m, _MacroMetadata):
                    self.macros.append(m)
                elif hasattr(m, "__a2ui_macro__"):
                    self.macros.append(getattr(m, "__a2ui_macro__"))
                elif callable(m):
                    raise ValueError(
                        f"Callable '{m.__name__}' is not decorated with @macro."
                    )

        macro_map = {m.name: m for m in self.macros}
        self.processor = _MacroProcessor(macro_map)
        self.passthrough_components: set[str] | None = (
            set(passthrough_components) if passthrough_components is not None else None
        )
        self.catalog_id: str | None = catalog_id
        self._catalog_base_components: dict[str, set[str]] = {}
        if catalog_id is not None:
            self._catalog_base_components[catalog_id] = set()
        self._surface_catalogs: OrderedDict[str, str] = OrderedDict()

    def transform_to_inference_catalog(self, base_catalog: CatalogApi) -> CatalogApi:
        """Derives an authoring/inference catalog by augmenting the base catalog with macro schemas.

        Args:
            base_catalog: The base client catalog.

        Returns:
            A new Catalog containing macro component schemas.

        Raises:
            A2uiCatalogError: If a macro component collides with an existing component in the base catalog.
        """
        schema_copy: dict[str, Any] = base_catalog.to_json()
        comps_map: dict[str, Any] = dict(schema_copy.get(CATALOG_COMPONENTS_KEY, {}))
        base_components = set(comps_map.keys())
        defs_map = schema_copy.get("$defs")
        any_comp: Any = (
            defs_map.get("anyComponent") if isinstance(defs_map, dict) else None
        )
        # A document whose component union is not a `oneOf` list, or that has
        # none, admits all its components; writing a union of only the macros
        # would drop the others.
        any_comp_refs: list[dict[str, Any]] | None = (
            any_comp.get("oneOf") if isinstance(any_comp, dict) else None
        )
        if not isinstance(any_comp_refs, list):
            any_comp_refs = None

        # Filter base catalog components if passthrough_components is specified
        if self.passthrough_components is not None:
            pruned_base_names = set(comps_map.keys()) - self.passthrough_components
            for name in pruned_base_names:
                del comps_map[name]
            if any_comp_refs is not None:
                any_comp_refs[:] = [
                    ref
                    for ref in any_comp_refs
                    if not any(
                        ref.get("$ref", "").endswith(f"/{name}")
                        for name in pruned_base_names
                    )
                ]

        macro_components = {m.name: m.to_json_schema() for m in self.macros}

        for name, comp_schema in macro_components.items():
            if name in comps_map:
                raise A2uiCatalogError(
                    f"Macro component '{name}' collides with an existing component in"
                    " the base catalog."
                )
            comps_map[name] = comp_schema
            ref_entry = {"$ref": f"#/{CATALOG_COMPONENTS_KEY}/{name}"}
            if any_comp_refs is not None and ref_entry not in any_comp_refs:
                any_comp_refs.append(ref_entry)

        if base_catalog.catalog_id and (
            self.catalog_id is None or base_catalog.catalog_id == self.catalog_id
        ):
            self._catalog_base_components[base_catalog.catalog_id] = base_components

        schema_copy[CATALOG_COMPONENTS_KEY] = comps_map
        return Catalog.from_json(
            catalog_schema=schema_copy,
            protocol_version=base_catalog.protocol_version,
            catalog_id=base_catalog.catalog_id,
        )

    def to_catalog(
        self,
        protocol_version: str | ProtocolVersion | None = None,
    ) -> CatalogApi:
        """Exports a standalone Catalog containing exclusively the macro component schemas.

        Args:
            protocol_version: Optional protocol version for the exported catalog.
                If omitted, infers ``"1.0"`` when any registered macro targets
                ``a2ui.builder.v1_0``, defaulting to ``"0.9.1"`` otherwise.

        Returns:
            A Catalog instance ready to be used by inference formats and prompt generators.
        """
        # catalog_definition.json writes the version without the leading "v".
        if protocol_version is not None:
            version = to_version_number(protocol_version)
        elif any(m.is_v1_0 for m in self.macros):
            version = to_version_number(ProtocolVersion.V1_0)
        else:
            version = to_version_number(ProtocolVersion.V0_9_1)
        catalog_id = self.catalog_id or "https://a2ui.org/catalogs/macros"

        components = {m.name: m.to_json_schema() for m in self.macros}
        any_comp_refs = [
            {"$ref": f"#/{CATALOG_COMPONENTS_KEY}/{m.name}"} for m in self.macros
        ]
        if version == to_version_number(ProtocolVersion.V1_0):
            any_comp_def: dict[str, Any] = (
                {
                    "oneOf": any_comp_refs,
                    "discriminator": {"propertyName": "component"},
                }
                if any_comp_refs
                else {"not": {}}
            )
            defs: dict[str, Any] = {
                "anyComponent": any_comp_def,
                "anyFunction": {"not": {}},
            }
        else:
            defs = {
                "anyComponent": (
                    {"oneOf": any_comp_refs} if any_comp_refs else {"not": {}}
                )
            }

        schema: dict[str, Any] = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": version,
            "catalogId": catalog_id,
            "title": "A2UI Macros Catalog",
            "description": "Standalone catalog of high-level A2UI macro components.",
            CATALOG_COMPONENTS_KEY: components,
            "$defs": defs,
        }

        return Catalog.from_json(
            catalog_schema=schema,
            protocol_version=version,
            catalog_id=catalog_id,
        )

    def transform_to_transport(
        self, messages: Sequence[AgentToRendererMessage]
    ) -> list[AgentToRendererMessage]:
        """Lowers outbound inference messages by expanding macro components into primitive subtrees.

        Args:
            messages: Sequence of strongly-typed AgentToRendererMessage envelopes.

        Returns:
            List containing the lowered messages with expanded primitive components.
        """
        if not self.macros:
            return list(messages)

        result: list[AgentToRendererMessage] = []
        for msg in messages:
            msg_dict: dict[str, Any] = msg.model_dump(by_alias=True, exclude_none=True)
            raw_version = msg_dict.get("version")
            protocol_version = (
                to_version_number(raw_version) if isinstance(raw_version, str) else None
            )
            if "deleteSurface" in msg_dict and isinstance(
                msg_dict["deleteSurface"], dict
            ):
                del_sid = msg_dict["deleteSurface"].get("surfaceId")
                if isinstance(del_sid, str):
                    self._surface_catalogs.pop(del_sid, None)

            for envelope_key in (
                "surfaceUpdate",
                "createSurface",
                "updateComponents",
            ):
                if envelope_key in msg_dict and isinstance(
                    msg_dict[envelope_key], dict
                ):
                    body = dict(msg_dict[envelope_key])
                    surface_id = body.get("surfaceId")
                    if envelope_key == "createSurface" and isinstance(surface_id, str):
                        cid = body.get("catalogId")
                        if isinstance(cid, str) and cid:
                            self._surface_catalogs[surface_id] = cid
                            self._surface_catalogs.move_to_end(surface_id)
                            if len(self._surface_catalogs) > _MAX_TRACKED_SURFACES:
                                self._surface_catalogs.popitem(last=False)
                        else:
                            self._surface_catalogs.pop(surface_id, None)

                    surface_catalog_id = (
                        self._surface_catalogs.get(surface_id)
                        if isinstance(surface_id, str)
                        else None
                    )
                    comps = body.get("components")
                    if comps and isinstance(comps, list):
                        body["components"] = self._expand_component_list(
                            comps,
                            surface_catalog_id=surface_catalog_id,
                            protocol_version=protocol_version,
                        )
                        msg_dict[envelope_key] = body

            lowered = type(msg).model_validate(msg_dict)
            result.append(lowered)

        return result

    def transform_to_inference(
        self, messages: Sequence[AgentToRendererMessage]
    ) -> list[AgentToRendererMessage]:
        """Lifts transport messages to inference level (safe identity pass-through)."""
        return list(messages)

    def _expand_component_list(
        self,
        components: list[dict[str, Any]],
        *,
        depth: int = 0,
        max_depth: int = 16,
        surface_catalog_id: str | None = None,
        protocol_version: str | None = None,
        active_macros: frozenset[str] = frozenset(),
    ) -> list[dict[str, Any]]:
        """Expands macro components in a flat component list."""
        if depth > max_depth:
            raise A2uiRecursionError(
                f"Macro expansion exceeded maximum recursion depth of {max_depth}."
            )

        expanded: list[dict[str, Any]] = []
        for comp in components:
            if not isinstance(comp, dict):
                expanded.append(comp)
                continue

            c_name = comp.get("component")
            c_id = comp.get("id")
            if not isinstance(c_name, str):
                expanded.append(comp)
                continue

            meta = self.processor.get_macro(c_name)
            if (
                meta is not None
                and c_name in active_macros
                and c_name in _BASIC_PRIMITIVE_NAMES
            ):
                meta = None

            if meta is not None:
                if "catalogId" in comp:
                    raw_cid = comp["catalogId"]
                    if not isinstance(raw_cid, str) or not raw_cid:
                        meta = None
                    effective_catalog_id: str | None = (
                        raw_cid if isinstance(raw_cid, str) else None
                    )
                else:
                    effective_catalog_id = surface_catalog_id

                if meta is not None:
                    if self.catalog_id is not None:
                        if effective_catalog_id != self.catalog_id:
                            meta = None
                    elif (
                        self._catalog_base_components
                        and c_name in _BASIC_PRIMITIVE_NAMES
                    ):
                        if effective_catalog_id not in self._catalog_base_components:
                            meta = None

            if meta is not None:
                if isinstance(comp.get("parameters"), dict):
                    params = dict(comp["parameters"])
                    for env_key in _COMPONENT_ENVELOPE_KEYS:
                        if (
                            env_key in meta.parameters
                            and env_key in comp
                            and env_key not in params
                        ):
                            params[env_key] = comp[env_key]
                else:
                    params = {
                        k: v
                        for k, v in comp.items()
                        if k not in ("component", "id", "parameters")
                        and (k not in _COMPONENT_ENVELOPE_KEYS or k in meta.parameters)
                    }
                try:
                    expanded_macro = self.processor.expand(
                        c_name,
                        params,
                        instance_id=c_id,
                        protocol_version=protocol_version,
                    )
                    _apply_envelope_fields(
                        comp,
                        meta.parameters,
                        expanded_macro,
                        c_id,
                        self._catalog_base_components,
                        macro_catalog_id=self.catalog_id,
                        surface_catalog_id=surface_catalog_id,
                        protocol_version=protocol_version,
                    )
                    expanded.extend(
                        self._expand_component_list(
                            expanded_macro,
                            depth=depth + 1,
                            max_depth=max_depth,
                            surface_catalog_id=surface_catalog_id,
                            protocol_version=protocol_version,
                            active_macros=active_macros | {c_name},
                        )
                    )
                except (A2uiRecursionError, RecursionError):
                    raise A2uiRecursionError(
                        "Macro expansion exceeded maximum recursion depth of"
                        f" {max_depth}."
                    )
                except A2uiValidationError:
                    raise
                except Exception as e:
                    logger.error(
                        "Failed to expand macro %r: %s", c_name, e, exc_info=True
                    )
                    expanded.append(comp)
            else:
                expanded.append(comp)

        return expanded


__all__ = ["MacroExpander"]
