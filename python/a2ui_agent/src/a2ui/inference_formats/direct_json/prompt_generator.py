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

from __future__ import annotations

from collections.abc import Sequence

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import check_catalogs
from a2ui.inference_formats._shared import to_message_dicts
from a2ui.inference_formats.direct_json.decompiler import DirectJsonDecompiler
from a2ui.inference_formats.direct_json.schema_prompt import schema_to_prompt
from a2ui.prompt import PromptGenerator
from a2ui.schema import DEFAULT_WORKFLOW_RULES
from a2ui.utils import validate_payload

__all__ = [
    "DEFAULT_WORKFLOW_RULES",
    "DirectJsonPromptGenerator",
]


class DirectJsonPromptGenerator(PromptGenerator):
    """Formats standard JSON schema system prompt instructions (Direct JSON Format)."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        allowed_messages: Sequence[str] | None = None,
    ):
        self._catalogs = list(check_catalogs(catalogs))
        self._examples = [list(t) for t in examples] if examples is not None else None
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self._decompiler = DirectJsonDecompiler()

    @property
    def catalogs(self) -> list[CatalogApi]:
        return list(self._catalogs)

    @property
    def examples(self) -> list[list[AgentToRendererMessage]] | None:
        return [list(t) for t in self._examples] if self._examples is not None else None

    @property
    def allowed_messages(self) -> list[str] | None:
        return (
            list(self._allowed_messages) if self._allowed_messages is not None else None
        )

    def generate_base_rules(self) -> str:
        """Returns default JSON workflow rules."""
        return DEFAULT_WORKFLOW_RULES

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: CatalogApi | None = None,
        allowed_messages: Sequence[str] | None = None,
    ) -> str:
        """Returns LLM instructions for a catalog or all of the format's catalogs."""
        if not include_schema:
            return ""
        effective_allowed = (
            allowed_messages if allowed_messages is not None else self._allowed_messages
        )
        return schema_to_prompt(
            [catalog] if catalog is not None else self._catalogs,
            allowed_messages=effective_allowed,
        )

    def generate_examples(
        self,
        catalog: CatalogApi | None = None,
        validate: bool = False,
    ) -> str:
        """Formats the generator's few-shot examples."""
        if not self._examples:
            return ""
        catalogs = list(self._catalogs)
        if catalog is not None:
            catalogs = [catalog, *(c for c in catalogs if c is not catalog)]
        blocks: list[str] = []
        for turn in self._examples:
            if validate:
                validate_payload(catalogs, to_message_dicts(turn))
            decompiled = self._decompiler.decompile(turn)
            blocks.append(f"<a2ui-json>\n{decompiled}\n</a2ui-json>")
        return "\n\n".join(blocks)

    def generate(self) -> str:
        """Assembles the prompt snippet for the Direct JSON format."""
        parts: list[str] = [f"## Workflow Description:\n{DEFAULT_WORKFLOW_RULES}"]
        parts.append(
            schema_to_prompt(self._catalogs, allowed_messages=self._allowed_messages)
        )
        examples_str = self.generate_examples()
        if examples_str:
            parts.append(f"### Examples:\n{examples_str}")
        return "\n\n".join(parts)
