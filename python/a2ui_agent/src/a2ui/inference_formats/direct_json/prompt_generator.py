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

from collections.abc import Mapping, Sequence
from typing import Any, TYPE_CHECKING

from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.schema.v0_9 import V09Capabilities
from a2ui.inference_formats.direct_json.schema_prompt import schema_to_prompt
from a2ui.prompt import PromptGenerator
from a2ui.schema import load_examples
from a2ui.schema.constants import DEFAULT_WORKFLOW_RULES

if TYPE_CHECKING:
    from a2ui.inference_formats.direct_json import DirectJsonFormat


class DirectJsonPromptGenerator(PromptGenerator):
    """Formats standard JSON schema system prompt instructions (Direct JSON Format)."""

    def __init__(self, format_inst: "DirectJsonFormat"):
        """Initializes the prompt generator with a DirectJsonFormat context.

        Args:
            format_inst: The DirectJsonFormat instance.
        """
        self._format = format_inst

    def generate_base_rules(self) -> str:
        """Returns default JSON workflow rules."""
        return DEFAULT_WORKFLOW_RULES

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Any | None = None,
    ) -> str:
        """Returns LLM instructions for a catalog or all of the format's catalogs."""
        if not include_schema:
            return ""
        return schema_to_prompt([catalog] if catalog else self._format.catalogs)

    def generate_examples(
        self,
        catalog: Any | None = None,
        validate: bool = False,
    ) -> str:
        """Loads and formats the format's few-shot examples.

        Args:
            catalog: Optional catalog to validate the examples against first.
              The examples are validated against every catalog of the format.
            validate: Whether to validate the examples.

        Returns:
            The examples text block, or an empty string.
        """
        catalogs = list(self._format.catalogs)
        if catalog is not None:
            catalogs = [catalog, *(c for c in catalogs if c is not catalog)]
        return load_examples(catalogs, self._format.examples_path, validate=validate)

    def generate(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Mapping[str, Any] | V09Capabilities | None = None,
        allowed_components: Sequence[str] | None = None,
        allowed_messages: Sequence[str] | None = None,
        include_schema: bool = False,
        include_examples: bool = False,
        validate_examples: bool = False,
    ) -> str:
        """Assembles prompt instructions contract for standard JSON.

        The prompt describes every catalog of the format.

        Args:
            role_description: Description of the agent's role.
            workflow_description: Optional description of the task workflow.
            ui_description: Optional UI context or rules.
            client_ui_capabilities: Not supported. The format's catalogs are
              already resolved, so resolve them with
              `a2ui.utils.resolve_catalogs` before building the format.
            allowed_components: Optional list of component tags the LLM may use.
              The prompt describes only these components.
            allowed_messages: Optional list of A2UI message types allowed.
            include_schema: Whether to include component schemas in the prompt.
            include_examples: Whether to include few-shot examples.
            validate_examples: Whether to validate few-shot examples on generation.

        Returns:
            The complete generated prompt system instruction.

        Raises:
            A2uiCatalogError: If `client_ui_capabilities` is given.
        """
        if client_ui_capabilities is not None:
            raise A2uiCatalogError(
                "DirectJsonFormat takes resolved catalogs. Resolve them from the"
                " client capabilities with a2ui.utils.resolve_catalogs and build the"
                " format from the result."
            )
        catalogs: Sequence[CatalogApi] = self._format.catalogs
        if allowed_components is not None:
            pruner = ComponentPruningTransformer(allowed_components)
            catalogs = [pruner.transform(c) for c in catalogs]

        parts = [role_description]

        rules = DEFAULT_WORKFLOW_RULES
        if workflow_description:
            rules += f"\n{workflow_description}"
        parts.append(f"## Workflow Description:\n{rules}")

        if ui_description:
            parts.append(f"## UI Description:\n{ui_description}")

        if include_schema:
            parts.append(schema_to_prompt(catalogs, allowed_messages=allowed_messages))

        if include_examples:
            examples_str = load_examples(
                catalogs, self._format.examples_path, validate=validate_examples
            )
            if examples_str:
                parts.append(f"### Examples:\n{examples_str}")

        return "\n\n".join(parts)
