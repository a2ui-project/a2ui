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

"""Runtime abstraction for configuring and executing A2UI Macros with Inference Formats."""

from __future__ import annotations

from typing import Any, Dict, List, Sequence, Tuple, Type

from pydantic import TypeAdapter

from a2ui.core import CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.transformers.macros import MacroExpander


class MacroAgentRuntime:
    """Centralizes configuration and execution for A2UI Macros and Inference Formats."""

    def __init__(
        self,
        macros: Sequence[Any],
        catalog_version: str = "0.9.1",
        protocol_version: str = "v0.9.1",
        format_class: Type[ExpressFormat] = ExpressFormat,
    ) -> None:
        self.catalog_version = catalog_version
        self.protocol_version = protocol_version

        # 1. Base Catalog
        self.server_catalog: CatalogApi = BasicCatalog(catalog_version)

        # 2. Macro Expander
        self.expander = MacroExpander(macros)

        # 3. Synthetic Inference Catalog with Expanded Macros
        self.inference_catalog = self.expander.transform_to_inference_catalog(
            self.server_catalog
        )

        # 4. Central Inference Format Instance (Reused across prompt gen, compile, parse)
        self.format = format_class(
            catalog=self.inference_catalog,
            surface_id="main",
            version=protocol_version,
        )
        self.message_adapter: TypeAdapter[AgentToRendererMessage] = TypeAdapter(
            AgentToRendererMessage
        )

    @property
    def macros(self) -> Sequence[Any]:
        """Registered macro descriptors."""
        return self.expander.macros

    def generate_system_prompt(self, role_description: str) -> str:
        """Generates system instruction with catalog schema and formatting rules."""
        return self.format.prompt_generator.generate(
            role_description=role_description,
            include_schema=True,
        )

    def compile_dsl(self, dsl: str, surface_id: str = "main") -> List[Dict[str, Any]]:
        """Compiles Express DSL containing macros and lowers output messages to transport."""
        self.format.surface_id = surface_id
        raw_messages = self.format.parser.compile(dsl)
        typed_msgs = [self.message_adapter.validate_python(m) for m in raw_messages]
        lowered_models = self.expander.transform_to_transport(typed_msgs)
        return [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_models]

    def parse_response(
        self, raw_text: str, surface_id: str = "main"
    ) -> Tuple[str, List[Dict[str, Any]]]:
        """Parses LLM response, returning conversational text and lowered transport messages."""
        self.format.surface_id = surface_id
        parts = self.format.parser.parse_response(raw_text)
        text_parts: List[str] = []
        raw_messages: List[Dict[str, Any]] = []

        for part in parts:
            if part.text:
                text_parts.append(part.text)
            if part.a2ui_json:
                raw_messages.extend(part.a2ui_json)

        typed_msgs = [self.message_adapter.validate_python(m) for m in raw_messages]
        lowered_models = self.expander.transform_to_transport(typed_msgs)
        messages = [
            m.model_dump(by_alias=True, exclude_none=True) for m in lowered_models
        ]
        return "\n".join(text_parts).strip(), messages

    def expand(
        self,
        macro_name: str,
        params: Dict[str, Any],
        instance_id: str = "root",
    ) -> List[Dict[str, Any]]:
        """Expands a single macro by name with provided parameters into primitive AST nodes."""
        return self.expander.processor.expand(
            macro_name, params, instance_id=instance_id
        )

    def has_macro(self, macro_name: str) -> bool:
        """Checks if a macro is registered."""
        return self.expander.processor.has_macro(macro_name)
