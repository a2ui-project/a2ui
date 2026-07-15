# Copyright 2026 Google LLC
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

from typing import Optional, Any, TYPE_CHECKING
from a2ui.prompt.generator import PromptGenerator

if TYPE_CHECKING:
    from a2ui.inference_formats.transport.format import TransportFormat


class TransportPromptGenerator(PromptGenerator):
    """Formats standard JSON schema system prompt instructions (Transport Format)."""

    def __init__(self, format_inst: "TransportFormat"):
        """Initializes the prompt generator with a TransportFormat context.

        Args:
            format_inst: The TransportFormat instance.
        """
        self._format = format_inst

    def generate(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Optional[dict[str, Any]] = None,
        allowed_components: Optional[list[str]] = None,
        allowed_messages: Optional[list[str]] = None,
        include_schema: bool = False,
        include_examples: bool = False,
        validate_examples: bool = False,
    ) -> str:
        """Assembles prompt instructions contract for standard JSON.

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
        selected_catalog = self._format.get_selected_catalog(
            client_ui_capabilities, allowed_components, allowed_messages
        )

        examples_str = ""
        if include_examples:
            examples_str = self._format.load_examples(
                selected_catalog, validate=validate_examples
            )

        parts = [role_description]

        from a2ui.schema.constants import DEFAULT_WORKFLOW_RULES

        rules = DEFAULT_WORKFLOW_RULES
        if workflow_description:
            rules += f"\n{workflow_description}"
        parts.append(f"## Workflow Description:\n{rules}")

        if ui_description:
            parts.append(f"## UI Description:\n{ui_description}")

        if include_schema:
            instructions = selected_catalog.render_as_llm_instructions()
            if instructions:
                parts.append(instructions)

        if examples_str:
            parts.append(f"### Examples:\n{examples_str}")

        return "\n\n".join(parts)
