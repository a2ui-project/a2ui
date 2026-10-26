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

"""Prompt generator for the decision inference format.

In this format the model does not author UI. It emits an intent and the data
to show, and the local decision model picks and binds the components.
"""

from __future__ import annotations

from collections.abc import Sequence
import json
from typing import Any

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import check_mixed_catalogs
from a2ui.prompt import PromptGenerator

from .archetypes import ArchetypeGrammar
from .catalog_graph import CatalogDecisionGraph
from .decision_block import DecisionBlock, decision_block_from_messages
from .models import MAX_BRIEF_SECTIONS
from .template_registry import TemplateRegistry

DECISION_RULES_TEMPLATE = f"""# A2UI Decision Block Output Contract

To show the user a rich interface, do not write components. Describe what to
show and provide the data; a local decision model chooses and binds the
components from the active catalogs.

IMPORTANT: Surround every decision block with the sentinel tags
`{A2UI_INFERENCE_OPEN_TAG}` and `{A2UI_INFERENCE_CLOSE_TAG}`. The block body is
one JSON object (or a JSON array of such objects, one per surface).

## Fields

1. `intent` (required, string): A short natural-language description of the
   interface to render, naming what the data is and how the user should see
   or interact with it. Example: "Show the order summary with a confirm button".

2. `payload` (required, object or array): The data to display. Use descriptive
   camelCase keys; key names guide which components are chosen. Keep values
   JSON primitives, objects, and arrays. Store actual field values under each
   key (for example `"email": "alex@example.com", "password": "", "rememberMe": false`),
   not `*Label` or `*Placeholder` keys; field labels are humanized from the key
   names, and action buttons come from an `actions` array of button labels
   (for example `"actions": ["Sign In"]`). If you pass an array, it is stored
   under the `items` key, so bindings read `/items/0/...`.

3. `surfaceId` (optional, string): The surface to create or update. Reuse an
   id to replace an earlier surface.

4. `template` (optional, string): The id of a registered surface template to
   render directly, when one listed below matches.

5. `fallbackDsl` (optional, string): A2UI Express source rendered if the
   decision model is not confident enough to choose components.

6. `layout` (optional, array of up to {MAX_BRIEF_SECTIONS} strings): An ordered
   layout brief grouping payload keys by role, each formatted as
   `"<role>:<key>,<key>"` (keys may be bare top-level names or `/`-prefixed
   JSON pointers; no nested sections). Valid roles are {{brief_roles}}.
   Example: `["picture:name,logoUrl", "collection:/photos", "facts:address,phone"]`.

7. `mutablePaths` (optional, array of strings): JSON pointers (for example
   `["/email", "/password", "/rememberMe"]`) for fields in `payload` that the
   user edits in a form or settings screen.

## Example

{A2UI_INFERENCE_OPEN_TAG}
{{{{"intent": "Show the service health with latency and a refresh button",
 "payload": {{{{"serviceName": "checkout", "latencyMs": 42, "status": "healthy"}}}},
 "layout": ["headline:serviceName,latencyMs,status"],
 "surfaceId": "main"}}}}
{A2UI_INFERENCE_CLOSE_TAG}"""
"""The decision block contract with a ``{brief_roles}`` placeholder.

`decision_rules` fills the placeholder from a grammar; `DECISION_RULES` is
the rendering for the bundled grammar.
"""


def decision_rules(archetypes: ArchetypeGrammar) -> str:
    """Renders `DECISION_RULES_TEMPLATE` with the brief roles of `archetypes`."""
    roles = ", ".join(f"`{r}`" for r in archetypes.brief_roles())
    return DECISION_RULES_TEMPLATE.format(brief_roles=roles)


def __getattr__(name: str) -> Any:
    # `DECISION_RULES` is resolved lazily so importing this module does not load
    # and validate the bundled grammar.
    if name == "DECISION_RULES":
        return decision_rules(ArchetypeGrammar.default())
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


class DecisionPromptGenerator(PromptGenerator):
    """Builds the system prompt for the decision inference format.

    The catalog section lists component names (not full signatures, which
    the model does not need) and the registered template ids, derived from
    the catalogs and registry at generation time.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        *,
        registry: TemplateRegistry | None = None,
        archetypes: ArchetypeGrammar | None = None,
    ) -> None:
        """Creates a prompt generator.

        Args:
            catalogs: The active catalogs.
            examples: Few-shot example turns as A2UI messages; each is
                decompiled into a decision block for the prompt.
            registry: Templates whose ids are offered for the `template` field.
            archetypes: Grammar whose brief roles the `layout` field rule
                lists; defaults to `ArchetypeGrammar.default()`.
        """
        self._catalogs = list(check_mixed_catalogs(catalogs))
        self._examples = [list(t) for t in examples] if examples is not None else None
        self._registry = registry if registry is not None else TemplateRegistry()
        self._archetypes = archetypes
        self._graph: CatalogDecisionGraph | None = None

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs configured on this prompt generator."""
        return list(self._catalogs)

    @property
    def registry(self) -> TemplateRegistry:
        """The template registry whose ids the prompt offers."""
        return self._registry

    @property
    def archetypes(self) -> ArchetypeGrammar:
        """The grammar whose brief roles the prompt lists."""
        if self._archetypes is None:
            self._archetypes = ArchetypeGrammar.default()
        return self._archetypes

    def _get_graph(self) -> CatalogDecisionGraph:
        if self._graph is None:
            self._graph = CatalogDecisionGraph(self._catalogs)
        return self._graph

    def generate_base_rules(self) -> str:
        """Returns the decision block contract and field rules."""
        return decision_rules(self.archetypes)

    def _component_lines(self, catalog: Any | None) -> list[str]:
        """Lists the components the decision model may choose from."""
        specs = self._get_graph().root_candidates()
        if catalog is not None:
            wanted = getattr(catalog, "catalog_id", catalog)
            specs = tuple(s for s in specs if s.catalog_id == wanted)
        return [
            "## Available Components",
            "",
            (
                "The decision model selects from these components; you do not name"
                " them, but your `intent` and `payload` keys should make the right"
                " choice clear:"
            ),
            *(f"- {spec.name}" for spec in specs),
        ]

    def _template_lines(self) -> list[str]:
        """Lists the registered template ids, or nothing when there are none."""
        templates = self._registry.list_templates()
        if not templates:
            return []
        lines = ["", "## Registered Templates", ""]
        lines.append("Set `template` to one of these ids when it fits:")
        for template in templates:
            desc = f": {template.description}" if template.description else ""
            lines.append(f"- `{template.template_id}`{desc}")
        return lines

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Any | None = None,
    ) -> str:
        """Lists the components the decision model may choose and the templates.

        Args:
            include_schema: When False, returns an empty string.
            catalog: Restrict the component list to this catalog.
        """
        if not include_schema:
            return ""
        return "\n".join([*self._component_lines(catalog), *self._template_lines()])

    def generate_examples(
        self,
        catalog: Any | None = None,
        validate: bool = False,
    ) -> str:
        """Formats the configured example turns as decision blocks.

        Args:
            catalog: Unused; kept for the base-class signature.
            validate: When True, example messages are validated against the
                catalogs before decompilation.
        """
        del catalog
        if not self._examples:
            return ""
        if validate:
            from a2ui.inference_formats._shared import to_message_dicts
            from a2ui.utils import validate_payload

            for turn in self._examples:
                validate_payload(self._catalogs, to_message_dicts(turn))
        return "\n\n".join(self.decompile(turn) for turn in self._examples)

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Renders messages as a wrapped decision block.

        Format-specific (not part of `PromptGenerator`): only the data model
        and surface id survive, with a synthetic `Render <surface>` intent.
        See `decision_block_from_messages`.
        """
        block = decision_block_from_messages(a2ui_payload)
        return self.wrap_block(block)

    @staticmethod
    def wrap_block(block: DecisionBlock) -> str:
        """Serializes a decision block inside the sentinel tags."""
        body = json.dumps(block.to_json(), indent=1, sort_keys=True)
        return f"{A2UI_INFERENCE_OPEN_TAG}\n{body}\n{A2UI_INFERENCE_CLOSE_TAG}"

    def generate(self) -> str:
        """Assembles the prompt snippet for the decision format."""
        parts: list[str] = [f"## Workflow Description:\n{self.generate_base_rules()}"]
        catalog_inst = self.generate_catalog_instructions(include_schema=True)
        if catalog_inst:
            parts.append(catalog_inst)
        examples = self.generate_examples(validate=True)
        if examples:
            parts.append(f"### Examples:\n{examples}")
        return "\n\n".join(parts)


__all__ = [
    "DECISION_RULES",
    "DECISION_RULES_TEMPLATE",
    "DecisionPromptGenerator",
    "decision_rules",
]
