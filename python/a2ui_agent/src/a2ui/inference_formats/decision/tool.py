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

"""A framework-agnostic tool that renders A2UI from an intent and a payload.

Agent frameworks (MCP servers, ADK, OpenAI and Gemini function calling) all
describe tools with a JSON Schema and call them with a dict of arguments.
`DecisionRenderTool` supplies both halves so an integration does not have to
write the schema, decode stringified payloads, or bridge sync and async
itself::

    tool = DecisionRenderTool.create(catalogs)
    declaration = {"name": tool.name, "description": tool.description,
                   "parameters": tool.parameters_json_schema()}
    output = await tool.run_async(call_arguments)
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Any

from a2ui.core import CatalogApi
from a2ui.parser.messages import to_message_dicts

from .archetypes import ArchetypeGrammar
from .backends import DecisionBackend
from .catalog_graph import CatalogDecisionGraph
from .decision_block import DecisionBlock
from .models import (
    BRIEF_ITEM_PATTERN,
    MAX_BRIEF_SECTIONS,
    SynthesisConfig,
    SynthesisOutput,
)
from .patterns import MergedPatternLibrary, PatternLibrary
from .synthesizer import DecisionSynthesizer, FallbackCallback
from .template_registry import TemplateRegistry

_DEFAULT_TOOL_NAME = "render_a2ui_decision"
_DEFAULT_DESCRIPTION = (
    "Renders a user interface from a short description of what to show"
    " (intent) and the data to show (payload). A local decision model picks"
    " the components; do not describe components yourself."
)


class DecisionRenderTool:
    """Tool declaration plus runner for decision-model UI synthesis.

    Attributes:
        name: Tool name advertised to the model.
        description: Tool description advertised to the model.
        synthesizer: The synthesizer that renders each call.
        include_trace: Whether serialized tool results include the decision trace.
    """

    def __init__(
        self,
        synthesizer: DecisionSynthesizer,
        *,
        name: str = _DEFAULT_TOOL_NAME,
        description: str = _DEFAULT_DESCRIPTION,
        surface_id: str | None = None,
        include_trace: bool = False,
    ) -> None:
        """Wraps a synthesizer as a tool.

        Args:
            synthesizer: Renders each tool call.
            name: Tool name advertised to the model.
            description: Tool description advertised to the model.
            surface_id: Surface used when a call names none; None defers to
                the synthesizer's `config.default_surface_id`. A call's own
                `surfaceId` always wins.
            include_trace: Whether serialized results include `trace`.
        """
        self.name = name
        self.description = description
        self.synthesizer = synthesizer
        self._surface_id = surface_id
        self.include_trace = include_trace

    @classmethod
    def create(
        cls,
        catalogs: Sequence[CatalogApi] | CatalogDecisionGraph,
        *,
        backend: DecisionBackend | None = None,
        config: SynthesisConfig | None = None,
        registry: TemplateRegistry | None = None,
        archetypes: ArchetypeGrammar | None = None,
        patterns: PatternLibrary | MergedPatternLibrary | None = None,
        fallback_card: bool = True,
        fallback_fn: FallbackCallback | None = None,
        name: str = _DEFAULT_TOOL_NAME,
        description: str = _DEFAULT_DESCRIPTION,
        surface_id: str | None = None,
        include_trace: bool = False,
    ) -> DecisionRenderTool:
        """Builds a tool and its synthesizer in one call.

        `fallback_card` defaults to True: a tool call that renders nothing is
        an error from the model's point of view, so an abstention renders a
        deterministic card unless the call supplied `fallbackDsl`.

        Args:
            catalogs: The active catalogs, or a prebuilt `CatalogDecisionGraph`.
            backend: Decision backend; defaults to `create_decision_backend()`.
            config: Synthesis thresholds and limits.
            registry: Surface templates offered through the `template` field.
            archetypes: Layout archetype grammar.
            patterns: Catalog pattern library.
            fallback_card: Render a deterministic card on abstention.
            fallback_fn: Custom fallback tried before the card.
            name: Tool name advertised to the model.
            description: Tool description advertised to the model.
            surface_id: Surface used when a call names none; None defers to
                `config.default_surface_id`. A call's own `surfaceId` wins.
            include_trace: Whether serialized results include `trace`.
        """
        synthesizer = DecisionSynthesizer(
            catalogs,
            backend,
            registry=registry,
            config=config,
            archetypes=archetypes,
            patterns=patterns,
            fallback_card=fallback_card,
            fallback_fn=fallback_fn,
        )
        return cls(
            synthesizer,
            name=name,
            description=description,
            surface_id=surface_id,
            include_trace=include_trace,
        )

    def parameters_json_schema(self) -> dict[str, Any]:
        """Returns the JSON Schema for the tool's arguments.

        `payload` accepts an object, an array, or a JSON-encoded string of
        either, since models often stringify nested arguments.
        """
        template_ids = [
            t.template_id for t in self.synthesizer.registry.list_templates()
        ]
        template_schema: dict[str, Any] = {
            "type": "string",
            "description": "Id of a registered surface template to render directly.",
        }
        if template_ids:
            template_schema["enum"] = template_ids
        return {
            "type": "object",
            "properties": {
                "intent": {
                    "type": "string",
                    "description": (
                        "Short natural-language description of the interface to"
                        " render and how the user should interact with it."
                    ),
                },
                "payload": {
                    "description": (
                        "The data to display: a JSON object (preferred) or array,"
                        " or a JSON-encoded string of either. Use descriptive"
                        " camelCase keys. A top-level array is stored under the"
                        " `items` key of the surface data model."
                    ),
                    "anyOf": [
                        {"type": "object"},
                        {"type": "array"},
                        {"type": "string"},
                    ],
                },
                "surfaceId": {
                    "type": "string",
                    "description": "Surface to create or update.",
                },
                "template": template_schema,
                "fallbackDsl": {
                    "type": "string",
                    "description": (
                        "A2UI Express rendered if the decision model is not"
                        " confident enough to choose components."
                    ),
                },
                "layout": {
                    "type": "array",
                    "maxItems": MAX_BRIEF_SECTIONS,
                    "items": {"type": "string", "pattern": BRIEF_ITEM_PATTERN},
                    "description": (
                        "Optional ordered layout brief grouping payload keys by"
                        " role ('<role>:<key>,<key>', up to 6 sections; no"
                        " nested sections)."
                    ),
                },
                "mutablePaths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Optional JSON Pointers (or top-level key names) in"
                        " `payload` that the user may edit, such as form fields"
                        " or settings toggles."
                    ),
                },
            },
            "required": ["intent", "payload"],
            "additionalProperties": False,
        }

    def _synthesis_kwargs(
        self, args: Mapping[str, Any]
    ) -> tuple[DecisionBlock, dict[str, Any]]:
        block = DecisionBlock.from_mapping(args)
        kwargs: dict[str, Any] = {
            "template_id": block.template_id,
            "fallback_dsl": block.fallback_dsl,
        }
        if block.layout:
            kwargs["layout"] = block.layout
        if block.mutable_paths:
            kwargs["mutable_paths"] = block.mutable_paths
        surface_id = block.surface_id or self._surface_id
        if surface_id is not None:
            kwargs["surface_id"] = surface_id
        return block, kwargs

    def format_result(
        self,
        output: SynthesisOutput,
        *,
        include_trace: bool | None = None,
    ) -> dict[str, Any]:
        """Serializes a `SynthesisOutput` into a tool-result dictionary."""
        with_trace = self.include_trace if include_trace is None else include_trace
        result: dict[str, Any] = {
            "stage": str(output.stage),
            "confidence": output.confidence,
            "entropy": output.entropy,
            "messages": to_message_dicts(output.messages),
        }
        if output.layout_plan is not None:
            result["layoutPlan"] = {
                "archetype": output.layout_plan.archetype,
                "blocks": list(output.layout_plan.block_ids()),
            }
        if with_trace:
            result["trace"] = [
                {
                    "questionId": r.question.id,
                    "outcome": r.outcome,
                    "threshold": r.threshold,
                }
                for r in output.trace
            ]
        return result

    def _enrich_output(
        self, output: SynthesisOutput, *, include_trace: bool
    ) -> SynthesisOutput:
        """Attaches `layoutPlan` and optional `trace` to `output.component_tree_spec`."""
        if output.layout_plan is None and not include_trace:
            return output
        spec = dict(output.component_tree_spec or {})
        if output.layout_plan is not None:
            spec["layoutPlan"] = {
                "archetype": output.layout_plan.archetype,
                "blocks": list(output.layout_plan.block_ids()),
            }
        if include_trace:
            spec["trace"] = [
                {
                    "questionId": r.question.id,
                    "outcome": r.outcome,
                    "threshold": r.threshold,
                }
                for r in output.trace
            ]
        return replace(output, component_tree_spec=spec)

    async def run_async(
        self, args: Mapping[str, Any], *, include_trace: bool | None = None
    ) -> SynthesisOutput:
        """Renders one tool call.

        Args:
            args: The tool-call arguments, with the field names from
                `parameters_json_schema` (snake_case spellings are accepted).
            include_trace: When True, includes `trace` in `component_tree_spec`.

        Raises:
            ValueError: If `intent` is missing, `payload` is an invalid JSON
                string, `template` is unknown, or `layout` is invalid.
            TypeError: If `payload` is neither an object nor an array.
        """
        block, kwargs = self._synthesis_kwargs(args)
        output = await self.synthesizer.synthesize(
            block.intent, block.payload, **kwargs
        )
        with_trace = self.include_trace if include_trace is None else include_trace
        return self._enrich_output(output, include_trace=with_trace)

    def run_sync(
        self, args: Mapping[str, Any], *, include_trace: bool | None = None
    ) -> SynthesisOutput:
        """Renders one tool call from synchronous code. See `run_async`."""
        block, kwargs = self._synthesis_kwargs(args)
        output = self.synthesizer.synthesize_sync(block.intent, block.payload, **kwargs)
        with_trace = self.include_trace if include_trace is None else include_trace
        return self._enrich_output(output, include_trace=with_trace)


__all__ = ["DecisionRenderTool"]
