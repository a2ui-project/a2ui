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

"""Generator for standard A2UI JSON schema system prompt instructions."""

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from a2ui.core import Catalog, CatalogApi

from a2ui.prompt import PromptGenerator
from a2ui.schema.catalog import render_as_llm_instructions
from a2ui.schema.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG

if TYPE_CHECKING:
    from a2ui.inference_formats.direct_json import DirectJsonFormat

DEFAULT_WORKFLOW_RULES = f"""
The generated response MUST follow these rules:
- The response can contain one or more A2UI JSON blocks.
- Each A2UI JSON block MUST be wrapped in `{A2UI_OPEN_TAG}` and `{A2UI_CLOSE_TAG}` tags.
- Between or around these blocks, you can provide conversational text.
- The JSON part MUST be a single, raw JSON object (usually a list of A2UI messages) and MUST validate against the provided A2UI JSON SCHEMA.
- Top-Down Component Ordering: Within the `components` list of a message:
    - The 'root' component MUST be the FIRST element.
    - Parent components MUST appear before their child components.
    This specific ordering allows the streaming parser to yield and render the UI incrementally as it arrives.
"""


class DirectJsonPromptGenerator(PromptGenerator):
    """Formats standard JSON schema system prompt instructions (Direct JSON Format)."""

    def __init__(self, format_inst: "DirectJsonFormat"):
        """Initializes the prompt generator with a DirectJsonFormat context.

        Args:
            format_inst: The DirectJsonFormat instance.
        """
        self._format = format_inst
        self.selected_catalog: CatalogApi | None = None
        self._allowed_messages: Sequence[str] | None = None

    def generate_base_rules(self) -> str:
        """Returns default JSON workflow rules."""
        return DEFAULT_WORKFLOW_RULES

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Any | None = None,
    ) -> str:
        """Returns LLM instructions for a catalog or all supported catalogs."""
        if not include_schema:
            return ""
        s2c = self._format._server_to_client_schema if self._format else None
        common_types = self._format._common_types_schema if self._format else None
        if catalog:
            return (
                render_as_llm_instructions(
                    catalog,
                    s2c_schema=s2c,
                    common_types_schema=common_types,
                    allowed_messages=self._allowed_messages,
                )
                or ""
            )
        if self.selected_catalog:
            return (
                render_as_llm_instructions(
                    self.selected_catalog,
                    s2c_schema=s2c,
                    common_types_schema=common_types,
                    allowed_messages=self._allowed_messages,
                )
                or ""
            )
        if self._format and self._format._supported_catalogs:
            instructions = [
                inst
                for c in self._format._supported_catalogs
                if (
                    inst := render_as_llm_instructions(
                        c,
                        s2c_schema=s2c,
                        common_types_schema=common_types,
                        allowed_messages=self._allowed_messages,
                    )
                )
            ]
            return "\n\n".join(instructions)
        return ""

    def generate_examples(
        self,
        catalog: Any | None = None,
        validate: bool = False,
    ) -> str:
        """Loads and formats few-shot examples for a catalog."""
        target_catalog = catalog or self.selected_catalog
        if not target_catalog:
            target_catalog = (
                self._format._supported_catalogs[0]
                if self._format._supported_catalogs
                else None
            )
        if not target_catalog:
            return ""
        return self._format.load_examples(target_catalog, validate=validate) or ""

    def generate(
        self,
        role_description: str = "",
        workflow_description: str = "",
        **kwargs: Any,
    ) -> str:
        """Assembles prompt instructions contract for standard JSON.

        Returns:
            The generated prompt snippet for A2UI Direct JSON.
        """
        selected_catalog = self.selected_catalog
        if selected_catalog is None and self._format._supported_catalogs:
            selected_catalog = self._format.get_selected_catalog()
            self.selected_catalog = selected_catalog

        parts: list[str] = []
        if role_description:
            parts.append(role_description)

        rules = DEFAULT_WORKFLOW_RULES
        if workflow_description:
            rules += f"\n{workflow_description}"
        parts.append(f"## Workflow Description:\n{rules}")

        instructions = self._catalog_description(include_schema=True)
        if instructions:
            parts.append(instructions)

        if selected_catalog is not None:
            examples_str = self._format.load_examples(selected_catalog, validate=False)
            if examples_str:
                parts.append(f"### Examples:\n{examples_str}")

        return "\n\n".join(parts)

    def _catalog_description(self, include_schema: bool = True) -> str:
        """Assembles the system prompt component catalog signatures block."""
        if not include_schema:
            return ""
        catalog = getattr(self, "selected_catalog", None)
        if not catalog:
            catalog = (
                self._format._supported_catalogs[0]
                if self._format and self._format._supported_catalogs
                else None
            )
        if not catalog:
            return ""
        s2c = self._format._server_to_client_schema if self._format else None
        common_types = self._format._common_types_schema if self._format else None
        return (
            render_as_llm_instructions(
                catalog,
                s2c_schema=s2c,
                common_types_schema=common_types,
                allowed_messages=self._allowed_messages,
            )
            or ""
        )
