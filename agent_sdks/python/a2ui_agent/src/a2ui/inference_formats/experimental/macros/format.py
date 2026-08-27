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

                    comp_type = comp.get("component")
                    if comp_type and get_macro(comp_type):
                        # Expand macro
                        args = {k: v for k, v in comp.items() if k not in ("component", "id")}
                        inv_id = comp.get("id")
                        expanded = self.processor.expand(comp_type, args=args, invocation_id=inv_id)
                        expanded_comps.extend(expanded)
                    else:
                        expanded_comps.append(comp)

                surf_copy = dict(surf)
                surf_copy["components"] = expanded_comps
                expanded_msgs.append({"surfaceUpdate": surf_copy})
            else:
                expanded_msgs.append(msg)

        return expanded_msgs

    def parse_response(self, content: str) -> List[ResponsePart]:
        parts = self.unwrap(content)
        parsed_so_far: List[ResponsePart] = []
        for part in parts:
            if part.a2ui_raw is not None:
                try:
                    part.a2ui_json = self.compile(part.a2ui_raw, is_final=part.is_final)
                except Exception as e:
                    from a2ui.parser.errors import A2uiCompilationError

                    if isinstance(e, A2uiCompilationError):
                        e.partial_results = parsed_so_far
                        raise e
                    raise A2uiCompilationError(
                        message=str(e),
                        raw_content=part.a2ui_raw,
                        partial_results=parsed_so_far,
                    ) from e
            parsed_so_far.append(part)
        return parts

    @property
    def supports_streaming(self) -> bool:
        return False

    def decompile(self, val: Any) -> str:
        return self.underlying_parser.decompile(val)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        return self.underlying_parser.wrap_decompiled_blocks(blocks)


@experimental
class MacroInferenceFormat(InferenceFormat):
    """Inference format coordinating prompt generation and expansion of macros."""

    def __init__(
        self,
        macros: Optional[Sequence[Union[Callable[..., Any], MacroMetadata]]] = None,
        catalog: Optional[Union[Catalog[Any, Any], A2uiCatalog, Dict[str, Any]]] = None,
        allowed_primitives: Optional[List[str]] = None,
        surface_id: str = "main",
        version: str = "0.9.1",
        underlying_format_factory: Optional[
            Callable[[A2uiCatalog, str, str], InferenceFormat]
        ] = None,
    ):
        self.surface_id = surface_id
        self.version = _clean_version(version)
        self.allowed_primitives = allowed_primitives
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
                    meta = get_macro(m.__name__)
                    if meta:
                        self.macros.append(meta)
        else:
            self.macros = list_macros()

        # 1. Resolve base catalog
        if catalog is None:
            from a2ui.basic_catalog.provider import BasicCatalog

            config = BasicCatalog.get_config(self.version)
            schema = config.provider.load()
            s2c = load_from_bundled_resource(
                self.version, SERVER_TO_CLIENT_SCHEMA_KEY, SPEC_VERSION_MAP
            )
            common_types = load_from_bundled_resource(
                self.version, COMMON_TYPES_SCHEMA_KEY, SPEC_VERSION_MAP
            )
            self.base_catalog = A2uiCatalog(
                version=self.version,
                name="basic",
                catalog_schema=schema,
                s2c_schema=s2c,
                common_types_schema=common_types,
            )
        elif isinstance(catalog, A2uiCatalog):
            self.base_catalog = catalog
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
                catalog_schema=catalog if isinstance(catalog, dict) else {},
                s2c_schema=s2c,
                common_types_schema=common_types,
            )

        # 2. Inject macros into catalog schema
        synthetic_schema = dict(self.base_catalog.catalog_schema or {})
        components_map = dict(synthetic_schema.get("components", {}))
        for m in self.macros:
            components_map[m.name] = m.to_json_schema()
        synthetic_schema["components"] = components_map

        self.combined_catalog = A2uiCatalog(
            version=self.version,
            name=self.base_catalog.name,
            catalog_schema=synthetic_schema,
            s2c_schema=self.base_catalog.s2c_schema,
            common_types_schema=self.base_catalog.common_types_schema,
        )

        # 3. Instantiate underlying inference format
        if underlying_format_factory:
            self.underlying_format = underlying_format_factory(
                self.combined_catalog, self.surface_id, self.version
            )
        else:
            from a2ui.inference_formats.experimental.express.format import (
                ExpressFormat,
            )

            self.underlying_format = ExpressFormat(
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
