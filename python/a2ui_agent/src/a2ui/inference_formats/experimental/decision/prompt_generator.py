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
from typing import TYPE_CHECKING, Any

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import CatalogApi
from a2ui.inference_formats._shared import check_mixed_catalogs
from a2ui.prompt import PromptGenerator

from .archetypes import ArchetypeGrammar
from .catalog_graph import CatalogDecisionGraph
from .decision_block import DecisionBlock
from .models import MAX_BRIEF_SECTIONS

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
   names. Do not put action buttons in `payload`; declare them in the block's
   `actions` field. If you pass an array, it is stored under the `items` key,
   so bindings read `/items/0/...`.

3. `surfaceId` (optional, string): The surface to render into. A new id creates a surface. Reusing an id updates that surface in place: the new layout replaces the old one, and parts that did not change keep their state. To change only one part, also set `region` to that part's role from the `layout` roles (for example `"actions"`); only that part is replaced. To start the surface over, also set `"replace": true`; the old surface is deleted and a new one is created.

4. `region` (optional, string): When updating an existing `surfaceId`, the
   block role (for example `"headline"` or `"actions"`) of the single part to
   re-plan and replace in place.

5. `replace` (optional, boolean): When `true` on an existing `surfaceId`,
   deletes the old surface and creates a new one instead of updating it in
   place. Defaults to `false`.

6. `actions` (optional, object): A map from action id (in display order) to a
   button label string or an options object; the action id is the event name
   sent back when the user triggers the action. Example:
   `{{{{"sign_in": "Sign In", "create_account": "Create account"}}}}`. When an
   action needs extra options, map its id to an object with required `"label"`
   and optional `"scope"` (JSON pointer of the collection the action repeats
   over, such as `"/orders"`), `"key"` (item identity field within `scope`,
   defaulting to `"id"`), `"context"` (object mapping context names to JSON
   pointers), and `"style"` (`"primary"`, `"secondary"`, or `"destructive"`).
   Example: `{{{{"cancel_order": {{{{"label": "Cancel", "scope": "/orders", "style": "destructive"}}}}}}}}`.

7. `exclude` (optional, array of strings): JSON pointers starting with `"/"`
   (for example `["/internalId", "/auth/token"]`) in `payload` that the surface
   must not display.

8. `mutablePaths` (optional, array of strings): JSON pointers (for example `["/email", "/password", "/rememberMe"]`) for fields in `payload` that the user edits. Required for any form or settings surface: forms and settings must list their editable pointers here, or those fields render as read-only display.

9. `layout` (optional, array of up to {MAX_BRIEF_SECTIONS} strings): An ordered
   layout brief grouping payload keys by role, each formatted as
   `"<role>:<key>,<key>"` (keys may be bare top-level names or `/`-prefixed
   JSON pointers; no nested sections). Valid roles are {{brief_roles}}.
   Example: `["picture:name,logoUrl", "collection:/photos", "facts:address,phone"]`.

10. `labels` (optional, object): A map from JSON pointer starting with `"/"`
    (for example `{{{{"/cpu": "Processor load", "/uptimeHours": "Uptime (h)"}}}}`)
    to the display label to show instead of the humanized key name.

11. `fallbackDsl` (optional, string): A2UI Express source rendered if the
    decision model is not confident enough to choose components.

12. `title` (optional, string): An optional title for the surface. When supplied,
    the grammar places it into the page heading or banner without rewriting.

13. `summary` (optional, string): An optional one-line summary or caption for the
    surface. When supplied, the grammar places it into supporting prose without rewriting.

## Example

{A2UI_INFERENCE_OPEN_TAG}
{{{{"intent": "Show the service health with latency and a refresh button",
 "payload": {{{{"serviceName": "checkout", "latencyMs": 42, "status": "healthy"}}}},
 "actions": {{{{"refresh": "Refresh"}}}},
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


if TYPE_CHECKING:
    DECISION_RULES: str


def __getattr__(name: str) -> Any:
    """Resolves `DECISION_RULES` lazily on first attribute access."""
    # `DECISION_RULES` is resolved lazily so importing this module does not load
    # and validate the bundled grammar.
    if name == "DECISION_RULES":
        return decision_rules(ArchetypeGrammar.default())
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def _validate_example_blocks(
    examples: Sequence[DecisionBlock] | None,
) -> list[DecisionBlock] | None:
    """Validates an optional sequence of native `DecisionBlock` examples."""
    if examples is None:
        return None
    if not isinstance(examples, Sequence) or isinstance(
        examples, (str, bytes, bytearray)
    ):
        raise TypeError(
            "DecisionPromptGenerator examples must be a sequence of"
            " DecisionBlock instances."
        )
    blocks: list[DecisionBlock] = []
    for item in examples:
        if not isinstance(item, DecisionBlock):
            raise TypeError(
                "DecisionPromptGenerator examples must be DecisionBlock"
                f" instances, got {type(item).__name__}."
            )
        blocks.append(item)
    return blocks


class DecisionPromptGenerator(PromptGenerator):
    """Builds the system prompt for the decision inference format.

    The catalog section lists component names (not full signatures, which
    the model does not need), derived from the catalogs at generation time.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        block_examples: Sequence[DecisionBlock] | None = None,
        *,
        archetypes: ArchetypeGrammar | None = None,
    ) -> None:
        """Creates a prompt generator.

        Args:
            catalogs: The active catalogs.
            block_examples: Few-shot example decision blocks rendered verbatim
                in the prompt.
            archetypes: Grammar whose brief roles the `layout` field rule
                lists; defaults to `ArchetypeGrammar.default()`.
        """
        self._catalogs = list(check_mixed_catalogs(catalogs))
        self._block_examples = _validate_example_blocks(block_examples)
        self._archetypes = archetypes
        self._graph: CatalogDecisionGraph | None = None

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs configured on this prompt generator."""
        return list(self._catalogs)

    @property
    def block_examples(self) -> list[DecisionBlock] | None:
        """A copy of the configured few-shot decision block examples, if any."""
        return list(self._block_examples) if self._block_examples is not None else None

    @property
    def archetypes(self) -> ArchetypeGrammar:
        """The grammar whose brief roles the prompt lists."""
        if self._archetypes is None:
            self._archetypes = ArchetypeGrammar.default()
        return self._archetypes

    def _get_graph(self) -> CatalogDecisionGraph:
        """Returns the cached `CatalogDecisionGraph` for `self._catalogs`."""
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

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: CatalogApi | None = None,
    ) -> str:
        """Lists the components the decision model may choose from.

        Args:
            include_schema: When False, returns an empty string.
            catalog: Restrict the component list to this catalog.
        """
        if not include_schema:
            return ""
        return "\n".join(self._component_lines(catalog))

    def generate_examples(
        self,
        catalog: CatalogApi | None = None,
        validate: bool = True,
    ) -> str:
        """Formats the configured native `DecisionBlock` examples.

        Args:
            catalog: Unused; kept for the base-class signature.
            validate: Unused; kept for the base-class signature.
        """
        del catalog, validate
        if not self._block_examples:
            return ""
        return "\n\n".join(self.wrap_block(block) for block in self._block_examples)

    @staticmethod
    def wrap_block(block: DecisionBlock) -> str:
        """Serializes a decision block inside the sentinel tags."""
        body = json.dumps(block.to_json(), indent=1, sort_keys=True)
        return f"{A2UI_INFERENCE_OPEN_TAG}\n{body}\n{A2UI_INFERENCE_CLOSE_TAG}"


__all__ = [
    "DECISION_RULES",
    "DECISION_RULES_TEMPLATE",
    "DecisionPromptGenerator",
    "decision_rules",
]
