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
from typing import Any
from typing import TYPE_CHECKING

from a2ui.core import A2uiCatalogError
from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import check_catalogs
from a2ui.inference_formats._shared import to_message_dicts
from a2ui.inference_formats.direct_json.decompiler import DirectJsonDecompiler
from a2ui.inference_formats.direct_json.schema_prompt import schema_to_prompt
from a2ui.prompt import PromptGenerator
from a2ui.schema import load_examples
from a2ui.schema.constants import DEFAULT_WORKFLOW_RULES
from a2ui.utils import validate_payload

if TYPE_CHECKING:
    from a2ui.inference_formats.direct_json.format import DirectJsonFormat

__all__ = [
    "DEFAULT_WORKFLOW_RULES",
    "DirectJsonPromptGenerator",
]


class DirectJsonPromptGenerator(PromptGenerator):
    """Formats standard JSON schema system prompt instructions (Direct JSON Format)."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi] | DirectJsonFormat,
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        allowed_messages: Sequence[str] | None = None,
        *,
        examples_path: str | None = None,
    ):
        from a2ui.inference_formats.direct_json.format import DirectJsonFormat as _DJFormat

        if isinstance(catalogs, _DJFormat):
            self._format: DirectJsonFormat | None = catalogs
            self._catalogs = list(catalogs.catalogs)
            self._examples = (
                [list(t) for t in examples]
                if examples is not None
                else catalogs.examples
            )
            self._allowed_messages = (
                list(allowed_messages)
                if allowed_messages is not None
                else catalogs.allowed_messages
            )
            self._examples_path = examples_path or catalogs.examples_path
        else:
            self._format = None
            self._catalogs = list(check_catalogs(catalogs))
            self._examples = (
                [list(t) for t in examples] if examples is not None else None
            )
            self._allowed_messages = (
                list(allowed_messages) if allowed_messages is not None else None
            )
            self._examples_path = examples_path
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
        """Loads and formats the format's few-shot examples."""
        catalogs = list(self._catalogs)
        if catalog is not None:
            catalogs = [catalog, *(c for c in catalogs if c is not catalog)]
        if self._examples:
            blocks: list[str] = []
            for turn in self._examples:
                if validate:
                    validate_payload(catalogs, to_message_dicts(turn))
                decompiled = self._decompiler.decompile(turn)
                blocks.append(f"<a2ui-json>\n{decompiled}\n</a2ui-json>")
            return "\n\n".join(blocks)
        return load_examples(catalogs, self._examples_path, validate=validate)

    def generate(
        self,
        role_description: str = "",
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Any = None,
        allowed_components: Sequence[str] | None = None,
        allowed_messages: Sequence[str] | None = None,
        include_schema: bool = True,
        include_examples: bool = True,
        validate_examples: bool = False,
    ) -> str:
        """Assembles prompt instructions contract for standard JSON."""
        del allowed_components
        if client_ui_capabilities is not None:
            raise A2uiCatalogError(
                "DirectJsonFormat takes resolved catalogs. Resolve them from the"
                " client capabilities with a2ui.utils.resolve_catalogs and build the"
                " format from the result."
            )
        parts: list[str] = []
        if role_description:
            parts.append(role_description)

        rules = DEFAULT_WORKFLOW_RULES
        if workflow_description:
            rules += f"\n{workflow_description}"
        parts.append(f"## Workflow Description:\n{rules}")

        if ui_description:
            parts.append(f"## UI Description:\n{ui_description}")

        if include_schema:
            effective_allowed = (
                allowed_messages
                if allowed_messages is not None
                else self._allowed_messages
            )
            parts.append(
                schema_to_prompt(self._catalogs, allowed_messages=effective_allowed)
            )

        if include_examples:
            examples_str = self.generate_examples(validate=validate_examples)
            if examples_str:
                parts.append(f"### Examples:\n{examples_str}")

        return "\n\n".join(parts)
