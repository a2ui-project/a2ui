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

from a2ui.constants import CATALOG_COMPONENTS_KEY
from a2ui.core import (
    A2uiCatalogError,
    A2uiRecursionError,
    Catalog,
    CatalogApi,
)
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.transformers.macros.macro import (
    MacroVersionFamily,
    _MacroMetadata,
    _MacroProtocolError,
    _normalize_version_family,
    _validate_v1_0_macro_name,
)
from a2ui.transformers.macros.processor import _MacroProcessor
from a2ui.utils import to_version_number

logger = logging.getLogger(__name__)

_DEFAULT_MACRO_CATALOG_ID = "https://a2ui.org/catalogs/macros"
_MAX_TRACKED_SURFACES = 256

_COMPONENT_ENVELOPE_KEYS: frozenset[str] = frozenset({
    "catalogId",
    "accessibility",
    "metadata",
})


def _apply_envelope_fields(
    comp: dict[str, Any],
    *,
    declared_params: Mapping[str, Any],
    expanded_macro: list[dict[str, Any]],
    instance_id: str | None,
    protocol_version: str | None = None,
) -> None:
    """Propagates undeclared root envelope fields from a macro instance onto its expanded root."""
    if not expanded_macro:
        return

    root_comp = expanded_macro[-1]
    if instance_id is not None:
        for item in reversed(expanded_macro):
            if item.get("id") == instance_id:
                root_comp = item
                break

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

    if protocol_version != to_version_number(ProtocolVersion.V1_0):
        return

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


class MacroExpander:
    """Expands composite macro components into standard A2UI primitive component subtrees.

    Acts as a catalog and message transformer:
    1. transform_to_inference_catalog: Augments a base catalog with synthesized
       macro component schemas so LLMs can author high-level components (and
       registers the base catalog's primitive names for mixed-catalog scoping).
    2. transform_to_transport: Rewrites outbound messages by expanding macro
       components into flat primitive ASTs understood by downstream renderers.
       By default, each instance tracks ``createSurface``/``deleteSurface``
       default catalogs across calls and should be scoped to a single renderer
       session (or pass ``surface_catalogs`` per call for stateless sharing).
    3. transform_to_inference: Passes transport messages through untouched (safe identity pass-through).
    """

    def __init__(
        self,
        macros: Sequence[Callable[..., Any] | _MacroMetadata] | None = None,
        *,
        passthrough_components: Sequence[str] | None = None,
        catalog_id: str | None = None,
        base_catalogs: Sequence[CatalogApi] | None = None,
        protocol_version: str | ProtocolVersion | None = None,
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
            catalog_id: Optional catalog ID the macros belong to. When set, a macro
                component expands only if its explicit ``catalogId``, or the default
                ``catalogId`` of its surface as seen in ``createSurface`` (or passed via
                ``surface_catalogs``), equals ``catalog_id``. Reuse one ``MacroExpander``
                instance per renderer session or supply ``surface_catalogs`` on
                ``transform_to_transport``. Also used as the catalog ID of ``to_catalog()``.
            base_catalogs: Optional sequence of base catalogs whose primitive component
                names are pre-registered via ``register_catalog`` so ``transform_to_transport``
                can disambiguate mixed-catalog components without calling
                ``transform_to_inference_catalog`` first.
            protocol_version: Optional protocol version (e.g. ``"1.0"`` or ``"0.9.1"``)
                constraining this expander to a single A2UI protocol family.
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

        explicit_version_str = (
            to_version_number(protocol_version)
            if protocol_version is not None
            else None
        )
        detected_families: set[MacroVersionFamily] = {
            m.target_version for m in self.macros if m.target_version is not None
        }
        if explicit_version_str is not None:
            detected_families.add(_normalize_version_family(explicit_version_str))
        if len(detected_families) > 1:
            raise _MacroProtocolError(
                "MacroExpander cannot mix A2UI v0.9 and v1.0 macros or protocol"
                " versions."
            )
        self._target_family: MacroVersionFamily | None = next(
            iter(detected_families), None
        )
        self._explicit_protocol_version: str | None = explicit_version_str
        if self._target_family == "1.0":
            for m in self.macros:
                _validate_v1_0_macro_name(m.name)

        macro_map = {m.name: m for m in self.macros}
        self.processor = _MacroProcessor(
            macro_map, default_version_family=self._target_family
        )
        self.passthrough_components: set[str] | None = (
            set(passthrough_components) if passthrough_components is not None else None
        )
        self.catalog_id: str | None = catalog_id
        self._catalog_base_components: dict[str, set[str]] = {}
        if catalog_id is not None:
            self._catalog_base_components[catalog_id] = set()
        if base_catalogs:
            for catalog in base_catalogs:
                self.register_catalog(catalog)
        self._surface_catalogs: OrderedDict[str, str | None] = OrderedDict()

    def register_catalog(self, catalog: CatalogApi) -> None:
        """Registers a base catalog's primitive component names for mixed-catalog scoping."""
        if catalog.protocol_version:
            cat_family = _normalize_version_family(catalog.protocol_version)
            if self._target_family is not None and self._target_family != cat_family:
                raise _MacroProtocolError(
                    f"Cannot register v{catalog.protocol_version} catalog with"
                    f" v{self._target_family} MacroExpander."
                )
            if self._target_family is None:
                if cat_family == "1.0":
                    for m in self.macros:
                        _validate_v1_0_macro_name(m.name)
                self._target_family = cat_family
                self.processor.default_version_family = cat_family
        if not catalog.catalog_id:
            return
        schema = catalog.to_json()
        comps_map = schema.get(CATALOG_COMPONENTS_KEY, {})
        if isinstance(comps_map, Mapping):
            self._catalog_base_components[catalog.catalog_id] = set(comps_map.keys())

    def transform_to_inference_catalog(self, base_catalog: CatalogApi) -> CatalogApi:
        """Derives an authoring/inference catalog by augmenting the base catalog with macro schemas.

        Also registers ``base_catalog`` via ``register_catalog`` so subsequent
        ``transform_to_transport`` calls recognize its primitive components.

        Args:
            base_catalog: The base client catalog.

        Returns:
            A new Catalog containing macro component schemas.

        Raises:
            A2uiCatalogError: If a macro component collides with an existing component in the base catalog.
            A2uiValidationError: If macro protocol versions or v1.0 component names are invalid.
        """
        base_family = (
            _normalize_version_family(base_catalog.protocol_version)
            if base_catalog.protocol_version
            else None
        )
        if (
            self._target_family is not None
            and base_family is not None
            and self._target_family != base_family
        ):
            raise _MacroProtocolError(
                f"Cannot augment v{base_catalog.protocol_version} catalog with"
                f" v{self._target_family} macros."
            )
        is_v1_0 = base_family == "1.0"
        if is_v1_0:
            for m in self.macros:
                _validate_v1_0_macro_name(m.name)

        schema_copy: dict[str, Any] = base_catalog.to_json()
        comps_map: dict[str, Any] = dict(schema_copy.get(CATALOG_COMPONENTS_KEY, {}))
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

        macro_components = {
            m.name: m.to_json_schema(include_component_const=is_v1_0)
            for m in self.macros
        }

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

        self.register_catalog(base_catalog)

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
                If omitted, uses the expander's configured version or infers
                ``"1.0"`` when registered macros target ``a2ui.builder.v1_0``,
                defaulting to ``"0.9.1"`` otherwise.

        Returns:
            A Catalog instance ready to be used by inference formats and prompt generators.
        """
        # catalog_definition.json writes the version without the leading "v".
        if protocol_version is not None:
            version = to_version_number(protocol_version)
            requested_family = _normalize_version_family(version)
            if (
                self._target_family is not None
                and self._target_family != requested_family
            ):
                raise _MacroProtocolError(
                    f"Cannot export v{self._target_family} macros as a v{version}"
                    " catalog."
                )
        elif self._explicit_protocol_version is not None:
            version = self._explicit_protocol_version
        elif self._target_family == "1.0":
            version = to_version_number(ProtocolVersion.V1_0)
        else:
            version = to_version_number(ProtocolVersion.V0_9_1)

        is_v1_0 = _normalize_version_family(version) == "1.0"
        if is_v1_0:
            for m in self.macros:
                _validate_v1_0_macro_name(m.name)

        catalog_id = self.catalog_id or _DEFAULT_MACRO_CATALOG_ID

        components = {
            m.name: m.to_json_schema(include_component_const=is_v1_0)
            for m in self.macros
        }
        any_comp_refs = [
            {"$ref": f"#/{CATALOG_COMPONENTS_KEY}/{m.name}"} for m in self.macros
        ]
        if is_v1_0:
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
        self,
        messages: Sequence[AgentToRendererMessage],
        *,
        surface_catalogs: Mapping[str, str | None] | None = None,
    ) -> list[AgentToRendererMessage]:
        """Lowers outbound inference messages by expanding macro components into primitive subtrees.

        Args:
            messages: Sequence of strongly-typed AgentToRendererMessage envelopes.
            surface_catalogs: Optional per-call mapping from ``surfaceId`` to its default
                ``catalogId`` (or ``None`` for a v1.0 surface created with no default
                catalog). When provided, surface lifecycle updates in ``messages`` apply
                only to a local copy rather than mutating instance state, allowing a
                single ``MacroExpander`` to be shared safely across sessions.

        Returns:
            List containing the lowered messages with expanded primitive components.
        """
        if not self.macros and self._target_family is None:
            return list(messages)

        active_surfaces: OrderedDict[str, str | None] = (
            OrderedDict(surface_catalogs)
            if surface_catalogs is not None
            else self._surface_catalogs
        )

        result: list[AgentToRendererMessage] = []
        for msg in messages:
            msg_dict: dict[str, Any] = msg.model_dump(by_alias=True, exclude_none=True)
            raw_version = msg_dict.get("version")
            protocol_version = (
                to_version_number(raw_version) if isinstance(raw_version, str) else None
            )
            if protocol_version is not None:
                msg_family = _normalize_version_family(protocol_version)
                if (
                    self._target_family is not None
                    and self._target_family != msg_family
                ):
                    raise _MacroProtocolError(
                        f"Cannot lower v{protocol_version} message envelope with"
                        f" v{self._target_family} MacroExpander."
                    )
            if not self.macros:
                result.append(msg)
                continue
            if "deleteSurface" in msg_dict and isinstance(
                msg_dict["deleteSurface"], dict
            ):
                del_sid = msg_dict["deleteSurface"].get("surfaceId")
                if isinstance(del_sid, str):
                    active_surfaces.pop(del_sid, None)

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
                        active_surfaces[surface_id] = (
                            cid if isinstance(cid, str) and cid else None
                        )
                        active_surfaces.move_to_end(surface_id)
                        if len(active_surfaces) > _MAX_TRACKED_SURFACES:
                            evicted_sid, _ = active_surfaces.popitem(last=False)
                            logger.debug(
                                "Evicted oldest tracked surface %r from MacroExpander"
                                " (limit=%d)",
                                evicted_sid,
                                _MAX_TRACKED_SURFACES,
                            )

                    if isinstance(surface_id, str) and surface_id in active_surfaces:
                        surface_known = True
                        surface_catalog_id = active_surfaces[surface_id]
                    else:
                        surface_known = False
                        surface_catalog_id = None
                    comps = body.get("components")
                    if comps and isinstance(comps, list):
                        body["components"] = self._expand_component_list(
                            comps,
                            surface_id=surface_id
                            if isinstance(surface_id, str)
                            else None,
                            surface_catalog_id=surface_catalog_id,
                            surface_known=surface_known,
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

    def _inherits_enclosing_catalog(
        self,
        c_name: str,
        *,
        depth: int,
        enclosing_catalog_id: str | None,
        surface_catalog_id: str | None,
        active_macros: frozenset[str],
    ) -> bool:
        """Returns whether an unannotated nested component inherits ``enclosing_catalog_id``."""
        if depth == 0 or enclosing_catalog_id is None:
            return False
        if (
            surface_catalog_id is not None
            and surface_catalog_id != enclosing_catalog_id
            and surface_catalog_id != _DEFAULT_MACRO_CATALOG_ID
            and surface_catalog_id not in self._catalog_base_components
        ):
            return False
        if any(c_name in comps for comps in self._catalog_base_components.values()):
            return False
        if c_name in active_macros and not any(self._catalog_base_components.values()):
            return False
        return True

    def _expand_component_list(
        self,
        components: list[dict[str, Any]],
        *,
        depth: int = 0,
        max_depth: int = 16,
        surface_id: str | None = None,
        surface_catalog_id: str | None = None,
        surface_known: bool = False,
        protocol_version: str | None = None,
        active_macros: frozenset[str] = frozenset(),
        enclosing_catalog_id: str | None = None,
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
            effective_catalog_id: str | None = None
            raw_cid = comp.get("catalogId")

            if meta is not None:
                if raw_cid is not None:
                    if not isinstance(raw_cid, str) or not raw_cid:
                        logger.warning(
                            "Skipping macro %r on component %r: invalid catalogId %r",
                            c_name,
                            c_id,
                            raw_cid,
                        )
                        meta = None
                    else:
                        effective_catalog_id = raw_cid
                elif self._inherits_enclosing_catalog(
                    c_name,
                    depth=depth,
                    enclosing_catalog_id=enclosing_catalog_id,
                    surface_catalog_id=surface_catalog_id,
                    active_macros=active_macros,
                ):
                    effective_catalog_id = enclosing_catalog_id
                else:
                    effective_catalog_id = surface_catalog_id

            if meta is not None and depth > 0 and raw_cid is None:
                if any(
                    c_name in comps for comps in self._catalog_base_components.values()
                ):
                    meta = None

            if meta is not None and c_name in active_macros:
                is_base_primitive = (
                    effective_catalog_id != enclosing_catalog_id
                    or (
                        effective_catalog_id is not None
                        and c_name
                        in self._catalog_base_components.get(
                            effective_catalog_id, set()
                        )
                    )
                    or (
                        raw_cid is None
                        and any(
                            c_name in comps
                            for comps in self._catalog_base_components.values()
                        )
                    )
                )
                if is_base_primitive:
                    meta = None

            if meta is not None:
                if self.catalog_id is not None:
                    if effective_catalog_id != self.catalog_id:
                        if raw_cid is None and not surface_known and depth == 0:
                            logger.debug(
                                "Skipping scoped macro %r on component %r: surface"
                                " %r has no known catalogId (expected %r)",
                                c_name,
                                c_id,
                                surface_id,
                                self.catalog_id,
                            )
                        meta = None
                elif self._catalog_base_components:
                    if effective_catalog_id is not None:
                        if (
                            effective_catalog_id not in self._catalog_base_components
                            and effective_catalog_id != _DEFAULT_MACRO_CATALOG_ID
                        ):
                            meta = None
                        elif c_name in self._catalog_base_components.get(
                            effective_catalog_id, set()
                        ) and (
                            self.passthrough_components is None
                            or c_name in self.passthrough_components
                        ):
                            meta = None

            if meta is not None:
                if isinstance(comp.get("parameters"), dict):
                    params = dict(comp["parameters"])
                    for env_key in _COMPONENT_ENVELOPE_KEYS:
                        if (
                            env_key in meta.parameters
                            and comp.get(env_key) is not None
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
                        declared_params=meta.parameters,
                        expanded_macro=expanded_macro,
                        instance_id=c_id,
                        protocol_version=protocol_version,
                    )
                    expanded.extend(
                        self._expand_component_list(
                            expanded_macro,
                            depth=depth + 1,
                            max_depth=max_depth,
                            surface_id=surface_id,
                            surface_catalog_id=surface_catalog_id,
                            surface_known=surface_known,
                            protocol_version=protocol_version,
                            active_macros=active_macros | {c_name},
                            enclosing_catalog_id=effective_catalog_id
                            or self.catalog_id,
                        )
                    )
                except (A2uiRecursionError, RecursionError):
                    raise A2uiRecursionError(
                        "Macro expansion exceeded maximum recursion depth of"
                        f" {max_depth}."
                    )
                except _MacroProtocolError:
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
