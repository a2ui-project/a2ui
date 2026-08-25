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

"""Inference format coordinating prompt generation and parsing of LLM responses using templates."""

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

from .models import Template, StaticTemplate, DynamicTemplate, BaseTemplate
from .processor import TemplateProcessor


def _clean_version(version: str) -> str:
    """Normalizes version string by removing leading 'v' if present."""
    return version.lstrip("v")


class TemplateParser(Parser):
    """Parser decorator that runs template expansion on compiled A2UI messages."""

    def __init__(self, underlying_parser: Parser, processor: TemplateProcessor):
        """Initializes the TemplateParser.

        Args:
            underlying_parser: The underlying inference format parser (e.g.
              ExpressParser).
            processor: The TemplateProcessor instance to expand templates.
        """
        self.underlying_parser = underlying_parser
        self.processor = processor

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        """Checks if the content contains blocks belonging to the underlying parser."""
        return self.underlying_parser.has_format_content(content, complete=complete)

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Tokenizes response content into raw format-content parts."""
        return self.underlying_parser.unwrap(content)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> List[Dict[str, Any]]:
        """Compiles raw format content and expands all template components."""
        raw_msgs = self.underlying_parser.compile(format_content, is_final=is_final)
        expanded = self.processor.process_message(raw_msgs)
        if isinstance(expanded, list):
            return expanded
        elif isinstance(expanded, dict):
            return [expanded]
        return []

    def parse_response(self, content: str) -> List[ResponsePart]:
        """Parses full response content into standard JSON payload parts by unwrapping and expanding templates."""
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
        """Streaming is intentionally disabled for template expansion to keep architectures simple."""
        return False

    def decompile(self, val: Any) -> str:
        """Decompiles structured A2UI payloads into raw format notation."""
        return self.underlying_parser.decompile(val)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps multiple decompiled blocks with the format's enclosing tags."""
        return self.underlying_parser.wrap_decompiled_blocks(blocks)


@experimental
class TemplateInferenceFormat(InferenceFormat):
    """Inference format providing template generation and synchronous expansion."""

    def __init__(
        self,
        templates: Sequence[
            Union[BaseTemplate, Template, StaticTemplate, DynamicTemplate]
        ],
        catalog: Optional[Union[Catalog[Any, Any], A2uiCatalog, Dict[str, Any]]] = None,
        allowed_primitives: Optional[List[str]] = None,
        surface_id: str = "main",
        version: str = "0.9.1",
        underlying_format_factory: Optional[
            Callable[[A2uiCatalog, str, str], InferenceFormat]
        ] = None,
    ):
        """Initializes the TemplateInferenceFormat with registered templates and base catalog.

        Args:
            templates: List of registered Template definitions.
            catalog: Optional base catalog instance or schema dictionary.
            allowed_primitives: List of primitive components from the base
              catalog to allow.
            surface_id: Surface identifier for layout targeting.
            version: Target A2UI protocol version ("0.9", "0.9.1", or "1.0").
            underlying_format_factory: Optional custom factory for underlying
              InferenceFormat.
        """
        self.templates = templates
        self.surface_id = surface_id
        self.version = _clean_version(version)
        self.allowed_primitives = allowed_primitives

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
        elif hasattr(catalog, "catalog_schema"):
            s2c = getattr(catalog, "s2c_schema", None) or load_from_bundled_resource(
                self.version, SERVER_TO_CLIENT_SCHEMA_KEY, SPEC_VERSION_MAP
            )
            common_types = getattr(
                catalog, "common_types_schema", None
            ) or load_from_bundled_resource(
                self.version, COMMON_TYPES_SCHEMA_KEY, SPEC_VERSION_MAP
            )
            self.base_catalog = A2uiCatalog(
                version=self.version,
                name="custom",
                catalog_schema=getattr(catalog, "catalog_schema"),
                s2c_schema=s2c,
                common_types_schema=common_types,
            )
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

        if self.allowed_primitives is None and hasattr(
            self.base_catalog, "catalog_schema"
        ):
            schema_dict = getattr(self.base_catalog, "catalog_schema", {})
            if isinstance(schema_dict, dict) and "components" in schema_dict:
                self.allowed_primitives = list(schema_dict["components"].keys())

        # 2. Initialize TemplateProcessor
        self.processor = TemplateProcessor(
            templates=self.templates,
            base_catalog=self.base_catalog,
            version=self.version,
        )

        # 3. Construct synthetic A2uiCatalog containing allowed primitives + templates
        self.synthetic_catalog_schema = self.processor.generate_inference_catalog(
            allowed_primitives=self.allowed_primitives
        )
        self.synthetic_catalog = A2uiCatalog(
            version=self.version,
            name="synthetic",
            catalog_schema=self.synthetic_catalog_schema,
            s2c_schema=self.base_catalog.s2c_schema,
            common_types_schema=self.base_catalog.common_types_schema,
        )

        # 4. Initialize underlying inference format
        express_version = f"v{self.version}"
        if underlying_format_factory:
            self._underlying_format = underlying_format_factory(
                self.synthetic_catalog, self.surface_id, express_version
            )
        else:
            from a2ui.inference_formats.experimental.express.format import (
                ExpressFormat,
            )

            self._underlying_format = ExpressFormat(
                catalog=self.synthetic_catalog,
                surface_id=self.surface_id,
                version=express_version,
            )

        # 5. Wrap parser with TemplateParser
        self._parser = TemplateParser(self._underlying_format.parser, self.processor)

    @property
    def parser(self) -> TemplateParser:
        """The parser instance associated with the template inference format."""
        return self._parser

    @property
    def prompt_generator(self) -> PromptGenerator:
        """The prompt generator instance associated with the template inference format."""
        return self._underlying_format.prompt_generator


# Backward-compatibility alias
A2uiTemplateManager = TemplateInferenceFormat
