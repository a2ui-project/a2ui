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

"""Macro inference format and parser expanding macro components into standard A2UI."""

from __future__ import annotations

import copy
from typing import Any, Callable, Dict, List, Optional, Sequence, Union

from a2ui.core.catalog import Catalog
from a2ui.inference_format import InferenceFormat
from a2ui.parser.parser import Parser
from a2ui.parser.response_part import ResponsePart
from a2ui.prompt import PromptGenerator
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import (
    COMMON_TYPES_SCHEMA_KEY,
    SERVER_TO_CLIENT_SCHEMA_KEY,
    SPEC_VERSION_MAP,
)
from a2ui.schema.utils import load_from_bundled_resource
from google.adk.utils.feature_decorator import experimental

from a2ui.inference_formats.experimental.macros.macro import (
    MacroMetadata,
    get_macro,
    list_macros,
)
from a2ui.inference_formats.experimental.macros.processor import MacroProcessor


def _clean_version(version: str) -> str:
    """Normalizes version string by removing leading 'v' if present."""
    return version.lstrip("v")


class MacroParser(Parser):
    """Parser decorator that runs macro expansion on compiled A2UI messages."""

    def __init__(self, underlying_parser: Parser, processor: MacroProcessor):
        self.underlying_parser = underlying_parser
        self.processor = processor

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        return self.underlying_parser.has_format_content(content, complete=complete)

    def unwrap(self, content: str) -> List[ResponsePart]:
        return self.underlying_parser.unwrap(content)

    @property
    def supports_streaming(self) -> bool:
        return self.underlying_parser.supports_streaming

    def decompile(self, val: Any) -> str:
        return self.underlying_parser.decompile(val)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> List[Dict[str, Any]]:
        raw_msgs = self.underlying_parser.compile(format_content, is_final=is_final)
        expanded_msgs: List[Dict[str, Any]] = []

        for msg in raw_msgs:
            if not isinstance(msg, dict):
                expanded_msgs.append(msg)
                continue

            if "surfaceUpdate" in msg and isinstance(msg["surfaceUpdate"], dict):
                surf = msg["surfaceUpdate"]
                comps = surf.get("components", [])
                expanded_comps: List[Dict[str, Any]] = []

                for comp in comps:
                    if not isinstance(comp, dict):
                        expanded_comps.append(comp)
                        continue

                    c_name = comp.get("component")
                    c_id = comp.get("id")

                    if c_name and self.processor.has_macro(c_name):
                        params = {
                            k: v
                            for k, v in comp.items()
                            if k not in ("component", "id")
                        }
                        try:
                            expanded = self.processor.expand(
                                c_name, params, instance_id=c_id
                            )
                            expanded_comps.extend(expanded)
                        except Exception:
                            expanded_comps.append(comp)
                    else:
                        expanded_comps.append(comp)

                new_msg = dict(msg)
                new_surf = dict(surf)
                new_surf["components"] = expanded_comps
                new_msg["surfaceUpdate"] = new_surf
                expanded_msgs.append(new_msg)

            elif "updateComponents" in msg and isinstance(msg["updateComponents"], dict):
                upd = msg["updateComponents"]
                comps = upd.get("components", [])
                expanded_comps = []

                for comp in comps:
                    if not isinstance(comp, dict):
                        expanded_comps.append(comp)
                        continue

                    c_name = comp.get("component")
                    c_id = comp.get("id")

                    if c_name and self.processor.has_macro(c_name):
                        params = {
                            k: v
                            for k, v in comp.items()
                            if k not in ("component", "id")
                        }
                        try:
                            expanded = self.processor.expand(
                                c_name, params, instance_id=c_id
                            )
                            expanded_comps.extend(expanded)
                        except Exception:
                            expanded_comps.append(comp)
                    else:
                        expanded_comps.append(comp)

                new_msg = dict(msg)
                new_upd = dict(upd)
                new_upd["components"] = expanded_comps
                new_msg["updateComponents"] = new_upd
                expanded_msgs.append(new_msg)

            elif (
                "createSurface" in msg
                and isinstance(msg["createSurface"], dict)
                and "components" in msg["createSurface"]
            ):
                cs = msg["createSurface"]
                comps = cs.get("components", [])
                expanded_comps = []

                for comp in comps:
                    if not isinstance(comp, dict):
                        expanded_comps.append(comp)
                        continue

                    c_name = comp.get("component")
                    c_id = comp.get("id")

                    if c_name and self.processor.has_macro(c_name):
                        params = {
                            k: v
                            for k, v in comp.items()
                            if k not in ("component", "id")
                        }
                        try:
                            expanded = self.processor.expand(
                                c_name, params, instance_id=c_id
                            )
                            expanded_comps.extend(expanded)
                        except Exception:
                            expanded_comps.append(comp)
                    else:
                        expanded_comps.append(comp)

                new_msg = dict(msg)
                new_cs = dict(cs)
                new_cs["components"] = expanded_comps
                new_msg["createSurface"] = new_cs
                expanded_msgs.append(new_msg)

            else:
                expanded_msgs.append(msg)

        return expanded_msgs

    def parse_response(self, content: str) -> List[Dict[str, Any]]:
        raw_msgs = self.underlying_parser.parse_response(content)
        if not raw_msgs:
            return raw_msgs

        expanded_msgs: List[Dict[str, Any]] = []
        for msg in raw_msgs:
            if isinstance(msg, dict) and "updateComponents" in msg:
                upd = msg["updateComponents"]
                comps = upd.get("components", [])
                expanded_comps = []
                for comp in comps:
                    if isinstance(comp, dict) and self.processor.has_macro(comp.get("component", "")):
                        c_name = comp["component"]
                        c_id = comp.get("id")
                        params = {
                            k: v
                            for k, v in comp.items()
                            if k not in ("component", "id")
                        }
                        try:
                            expanded = self.processor.expand(
                                c_name, params, instance_id=c_id
                            )
                            expanded_comps.extend(expanded)
                        except Exception:
                            expanded_comps.append(comp)
                    else:
                        expanded_comps.append(comp)
                new_msg = dict(msg)
                new_upd = dict(upd)
                new_upd["components"] = expanded_comps
                new_msg["updateComponents"] = new_upd
                expanded_msgs.append(new_msg)
            else:
                expanded_msgs.append(msg)

        return expanded_msgs


@experimental
class MacroInferenceFormat(InferenceFormat):
    """Inference format coordinating prompt generation and expansion of macros.

    Requires a base_format (e.g. ExpressFormat, ElementalFormat) to define the
    underlying syntax and surface.
    """

    def __init__(
        self,
        base_format: Optional[InferenceFormat] = None,
        *,
        catalog: Optional[Union[A2uiCatalog, dict[str, Any]]] = None,
        macros: Optional[Sequence[Union[Callable[..., Any], MacroMetadata]]] = None,
        surface_id: Optional[str] = None,
        version: Optional[str] = None,
    ):
        if base_format is None:
            raise ValueError(
                "MacroInferenceFormat requires a base_format to be passed (e.g. "
                "MacroInferenceFormat(base_format=ExpressFormat(catalog=catalog, surface_id='main')))."
            )

        self.surface_id = surface_id or getattr(base_format, "surface_id", "main")
        raw_version = version or getattr(base_format, "version", "0.9.1")
        clean_v = _clean_version(raw_version)
        if clean_v not in ("0.9", "0.9.1", "0.8"):
            clean_v = "0.9.1"
        self.version = clean_v
        self.processor = MacroProcessor()

        # Ingest macros
        if macros is not None:
            self.macros: list[MacroMetadata] = []
            for m in macros:
                if isinstance(m, MacroMetadata):
                    self.macros.append(m)
                elif hasattr(m, "__a2ui_macro__"):
                    self.macros.append(getattr(m, "__a2ui_macro__"))
                elif callable(m):
                    meta = get_macro(m.__name__) or get_macro(m.__name__.title())
                    if meta:
                        self.macros.append(meta)
        else:
            self.macros = list_macros()

        # 1. Resolve base catalog from base_format or catalog parameter
        extracted_catalog = catalog or getattr(base_format, "catalog", None)
        if extracted_catalog is None:
            raise ValueError(
                "A catalog must be provided to MacroInferenceFormat (either via base_format or as catalog=...). "
                "Inference formats must remain catalog-agnostic."
            )
        elif isinstance(extracted_catalog, A2uiCatalog):
            self.base_catalog = extracted_catalog
        else:
            s2c = load_from_bundled_resource(
                self.version, SERVER_TO_CLIENT_SCHEMA_KEY, SPEC_VERSION_MAP
            )
            common_types = load_from_bundled_resource(
                self.version, COMMON_TYPES_SCHEMA_KEY, SPEC_VERSION_MAP
            )
            self.base_catalog = A2uiCatalog(
                version=self.version,
                name="custom",
                catalog_schema=extracted_catalog if isinstance(extracted_catalog, dict) else {},
                s2c_schema=s2c,
                common_types_schema=common_types,
            )

        # 2. Inject macros into catalog schema
        synthetic_schema = copy.deepcopy(self.base_catalog.catalog_schema or {})
        components_map = dict(synthetic_schema.get("components", {}))
        defs_map = synthetic_schema.setdefault("$defs", {})
        any_comp_refs = defs_map.setdefault("anyComponent", {}).setdefault("oneOf", [])

        for m in self.macros:
            components_map[m.name] = m.to_json_schema()
            ref_entry = {"$ref": f"#/components/{m.name}"}
            if ref_entry not in any_comp_refs:
                any_comp_refs.append(ref_entry)

        synthetic_schema["components"] = components_map

        self.combined_catalog = A2uiCatalog(
            version=self.version,
            name=self.base_catalog.name,
            catalog_schema=synthetic_schema,
            s2c_schema=self.base_catalog.s2c_schema,
            common_types_schema=self.base_catalog.common_types_schema,
        )

        # 3. Instantiate underlying inference format with the combined catalog
        fmt_cls = base_format.__class__
        try:
            self.underlying_format = fmt_cls(
                catalog=self.combined_catalog,
                surface_id=self.surface_id,
                version=self.version,
                examples_path=getattr(base_format, "examples_path", None),
            )
        except Exception:
            self.underlying_format = fmt_cls(
                catalog=self.combined_catalog,
                surface_id=self.surface_id,
                version=self.version,
            )

    @property
    def prompt_generator(self) -> PromptGenerator:
        return self.underlying_format.prompt_generator

    @property
    def parser(self) -> Parser:
        return MacroParser(self.underlying_format.parser, processor=self.processor)
