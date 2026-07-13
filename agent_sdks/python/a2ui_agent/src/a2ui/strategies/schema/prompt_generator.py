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

from typing import Optional, List
from a2ui.schema.catalog import A2uiCatalog


class SchemaPromptGenerator:
    """Formats standard JSON schema system prompt instructions."""

    def __init__(self, catalog: A2uiCatalog):
        self.catalog = catalog

    def generate(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        examples: str = "",
        include_schema: bool = True,
    ) -> str:
        """Assembles prompt instructions contract for standard JSON."""
        parts = [role_description]

        from a2ui.schema.constants import DEFAULT_WORKFLOW_RULES

        rules = DEFAULT_WORKFLOW_RULES
        if workflow_description:
            rules += f"\n{workflow_description}"
        parts.append(f"## Workflow Description:\n{rules}")

        if ui_description:
            parts.append(f"## UI Description:\n{ui_description}")

        if include_schema:
            instructions = self.catalog.render_as_llm_instructions()
            if instructions:
                parts.append(instructions)

        if examples:
            parts.append(f"### Examples:\n{examples}")

        return "\n\n".join(parts)
