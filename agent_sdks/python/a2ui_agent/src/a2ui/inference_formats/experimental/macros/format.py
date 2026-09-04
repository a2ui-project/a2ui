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

"""Macro inference format coordinating prompt generation and macro catalog synthesis."""

from __future__ import annotations

from typing import Any, Callable, Optional, Sequence, Union

from a2ui.inference_format import InferenceFormat
from a2ui.parser.parser import Parser
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
from a2ui.inference_formats.experimental.macros.parser import MacroParser
from a2ui.inference_formats.experimental.macros.processor import MacroProcessor


def _clean_version(version: str) -> str:
    """Normalizes version string by removing leading 'v' if present."""
    return version.lstrip("v")


@experimental
class MacroInferenceFormat(InferenceFormat):
    """Inference format coordinating prompt generation and expansion of macros.

    Wraps a base inference format (e.g. ExpressFormat, ElementalFormat),
    synthesizes a unified catalog that combines base catalog components with
    registered macro definitions, and returns a MacroParser that expands
    macro component tags into standard A2UI wire messages.
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
        """Initializes the macro inference format.

        Args:
            base_format: The underlying syntax format to wrap (e.g., ExpressFormat).
            catalog: Optional override catalog. If omitted, uses base_format.catalog.
            macros: Explicit sequence of macro functions or MacroMetadata objects.
                If None, defaults to all globally registered macros.
            surface_id: Target surface identifier for emitted envelopes.
            version: A2UI protocol version (defaults to '0.9.1').

        Raises:
            ValueError: If base_format or a valid catalog is not provided.
        """
        if base_format is None:
            raise ValueError(
                "MacroInferenceFormat requires a base_format to be passed (e.g."
                " MacroInferenceFormat(base_format=ExpressFormat(catalog=catalog,"
                " surface_id='main')))."
            )

        self.surface_id = surface_id or getattr(base_format, "surface_id", "main")
        raw_version = version or getattr(base_format, "version", "v0.9.1")
        clean_v = _clean_version(raw_version)
        if clean_v not in ("0.9", "0.9.1", "0.8", "1.0"):
            clean_v = "0.9.1"
        self.version = raw_version
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
                "A catalog must be provided to MacroInferenceFormat (either via"
                " base_format or as catalog=...). Inference formats must remain"
                " catalog-agnostic."
            )
        elif isinstance(extracted_catalog, A2uiCatalog):
            self.base_catalog = extracted_catalog
        else:
            s2c = load_from_bundled_resource(
                clean_v, SERVER_TO_CLIENT_SCHEMA_KEY, SPEC_VERSION_MAP
            )
            common_types = load_from_bundled_resource(
                clean_v, COMMON_TYPES_SCHEMA_KEY, SPEC_VERSION_MAP
            )
            self.base_catalog = A2uiCatalog(
                version=self.version,
                name="custom",
                catalog_schema=extracted_catalog
                if isinstance(extracted_catalog, dict)
                else {},
                s2c_schema=s2c,
                common_types_schema=common_types,
            )

        # 2. Programmatically combine base catalog with macro component schemas
        macro_components = {m.name: m.to_json_schema() for m in self.macros}
        self.combined_catalog = self.base_catalog.with_components(macro_components)

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
        """Returns the prompt generator configured with combined catalog components."""
        return self.underlying_format.prompt_generator

    @property
    def parser(self) -> Parser:
        """Returns the MacroParser wrapping the underlying syntax parser."""
        return MacroParser(self.underlying_format.parser, processor=self.processor)


__all__ = ["MacroInferenceFormat", "MacroParser"]
