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

"""Abstract prompt generator interface for inference formats."""

from abc import ABC, abstractmethod
from typing import Any, Optional, Union
from a2ui.core.schema.client_capabilities import V09Capabilities


class PromptGenerator(ABC):
    """Abstract base class for inference format prompt generators."""

    def generate_base_rules(self) -> str:
        """Returns the core syntax contract and grammar rules for the inference format.

        Returns:
            The core syntax rules string.
        """
        return ""

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Optional[Any] = None,
    ) -> str:
        """Returns component and function signatures or JSON schemas for a catalog.

        Args:
            include_schema: Whether to include schema details.
            catalog: Optional target catalog instance.

        Returns:
            The catalog instructions string.
        """
        return ""

    def generate_examples(
        self,
        catalog: Optional[Any] = None,
        validate: bool = False,
    ) -> str:
        """Returns formatted few-shot examples for a catalog.

        Args:
            catalog: Optional target catalog instance.
            validate: Whether to validate examples.

        Returns:
            The formatted few-shot examples string.
        """
        return ""

    def generate(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Optional[Union[dict[str, Any], V09Capabilities]] = None,
        allowed_components: Optional[list[str]] = None,
        allowed_messages: Optional[list[str]] = None,
        include_schema: bool = True,
        include_examples: bool = False,
        validate_examples: bool = False,
    ) -> str:
        """Template Method: Assembles prompt instructions using sub-methods.

        Args:
            role_description: Description of the agent's role.
            workflow_description: Optional description of the task workflow.
            ui_description: Optional UI context or rules.
            client_ui_capabilities: Optional client UI capability details.
            allowed_components: Optional list of component tags the LLM may use.
            allowed_messages: Optional list of A2UI message types allowed.
            include_schema: Whether to include component schemas in the prompt.
            include_examples: Whether to include few-shot examples.
            validate_examples: Whether to validate few-shot examples on generation.

        Returns:
            The complete generated prompt system instruction.
        """
        parts = []

        if role_description:
            parts.append(role_description)

        rules = self.generate_base_rules()
        if workflow_description:
            rules = f"{rules}\n\n{workflow_description}" if rules else workflow_description
        if rules:
            parts.append(f"## Workflow Description:\n{rules}")

        if ui_description:
            parts.append(f"## UI Description:\n{ui_description}")

        if include_schema:
            catalog_inst = self.generate_catalog_instructions(include_schema=True)
            if catalog_inst:
                parts.append(catalog_inst)

        if include_examples:
            examples = self.generate_examples(validate=validate_examples)
            if examples:
                parts.append(f"### Examples:\n{examples}")

        return "\n\n".join(parts)

