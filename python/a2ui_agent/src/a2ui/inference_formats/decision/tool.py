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

    tool = DecisionRenderTool.create(catalogs, backend=create_decision_backend())
    declaration = {"name": tool.name, "description": tool.description,
                   "parameters": tool.parameters_json_schema()}
    output = await tool.run_async(call_arguments)
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from a2ui.core import CatalogApi
from a2ui.parser.messages import to_message_dicts

from .archetypes import ArchetypeGrammar
from .backends import DecisionBackend
from .catalog_graph import CatalogDecisionGraph
from .decision_block import DecisionBlock
from .models import (
    BRIEF_ITEM_PATTERN,
    ActionStyle,
    MAX_BRIEF_SECTIONS,
    PlanCacheKey,
    SurfaceOperation,
    SynthesisConfig,
    SynthesisOutput,
)
from .patterns import MergedPatternLibrary, PatternLibrary
from .payload_inspector import PointerSummary, inspect_payload_pointers
from .plan_cache import CachedPlan, PlanCache
from .synthesizer import (
    DecisionSynthesizer,
    FallbackCallback,
    _as_data_model,
    _unrolled_array_cardinalities_match,
    _with_labels,
    _without_excluded,
    _without_non_mutable_secrets,
)
from .template_registry import SurfaceTemplate, TemplateRegistry

_DEFAULT_TOOL_NAME = "render_a2ui_decision"
_DEFAULT_DESCRIPTION = (
    "Renders a user interface from a short description of what to show"
    " (intent) and the data to show (payload). A local decision model picks"
    " the components; do not describe components yourself."
)


_ACTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": (
        "Optional buttons, as a map from action id (the event name the agent"
        " receives) to a label, or to an options object."
    ),
    "additionalProperties": {
        "anyOf": [
            {"type": "string"},
            {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "scope": {
                        "type": "string",
                        "description": (
                            "JSON Pointer of a collection; the action repeats"
                            " on each item."
                        ),
                    },
                    "key": {
                        "type": "string",
                        "description": "Item field that identifies the item.",
                    },
                    "context": {
                        "type": "object",
                        "additionalProperties": {"type": "string"},
                        "description": "Event context: name to JSON Pointer.",
                    },
                    "style": {
                        "type": "string",
                        "enum": [s.value for s in ActionStyle],
                    },
                },
                "required": ["label"],
                "additionalProperties": False,
            },
        ]
    },
}
"""JSON Schema of the `actions` map, matching `ActionSpec.from_block_value`."""


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
        self._last_cached: CachedPlan | None = None
        self._last_surface_id: str | None = None

    @classmethod
    def create(
        cls,
        catalogs: Sequence[CatalogApi] | CatalogDecisionGraph,
        *,
        backend: DecisionBackend,
        config: SynthesisConfig | None = None,
        registry: TemplateRegistry | None = None,
        archetypes: ArchetypeGrammar | None = None,
        patterns: PatternLibrary | MergedPatternLibrary | None = None,
        fallback_fn: FallbackCallback | None = None,
        plan_cache: PlanCache | None = None,
        name: str = _DEFAULT_TOOL_NAME,
        description: str = _DEFAULT_DESCRIPTION,
        surface_id: str | None = None,
        include_trace: bool = False,
    ) -> DecisionRenderTool:
        """Builds a tool and its synthesizer in one call.

        Args:
            catalogs: The active catalogs, or a prebuilt `CatalogDecisionGraph`.
            backend: Decision backend. Required; build one with
                `create_decision_backend()` to read the environment.
            config: Synthesis thresholds and limits.
            registry: Surface templates the model may choose for matching payloads.
            archetypes: Layout archetype grammar.
            patterns: Catalog pattern library.
            fallback_fn: Custom fallback called when the model abstains.
            plan_cache: Optional `PlanCache` shared with the synthesizer.
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
            fallback_fn=fallback_fn,
            plan_cache=plan_cache,
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
                "replace": {
                    "type": "boolean",
                    "description": (
                        "Delete the surface and create it again instead of"
                        " updating it in place. Defaults to false."
                    ),
                },
                "actions": _ACTIONS_SCHEMA,
                "exclude": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Optional JSON Pointers in `payload` the interface must"
                        " not show, such as internal ids."
                    ),
                },
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
                "title": {
                    "type": "string",
                    "description": (
                        "Optional surface title string placed into headings when"
                        " the payload does not contain a dedicated title field."
                    ),
                },
                "summary": {
                    "type": "string",
                    "description": (
                        "Optional surface summary or caption string placed into"
                        " subtitles or alert text."
                    ),
                },
                "region": {
                    "type": "string",
                    "description": (
                        "Optional block role to re-plan and replace in place on"
                        " an existing surface."
                    ),
                },
                "labels": {
                    "type": "object",
                    "additionalProperties": {"type": "string"},
                    "description": (
                        "Optional map from JSON Pointer (starting with '/') to"
                        " a display label overriding the humanized key name."
                    ),
                },
            },
            "required": ["intent", "payload"],
            "additionalProperties": False,
        }

    def _synthesis_kwargs(
        self, args: Mapping[str, Any]
    ) -> tuple[DecisionBlock, dict[str, Any]]:
        """Parses tool `args` into a `DecisionBlock` and synthesizer keyword arguments."""
        block = DecisionBlock.from_mapping(args)
        kwargs = block.to_synthesis_kwargs(default_surface_id=self._surface_id)
        if block.replace:
            kwargs["operation"] = SurfaceOperation.REPLACE
        return block, kwargs

    def _tool_cache_key(
        self, block: DecisionBlock
    ) -> tuple[PlanCacheKey, Mapping[str, Any], tuple[PointerSummary, ...]]:
        """Builds the tool-mode `PlanCacheKey`, normalized data model, and pointers."""
        data = _as_data_model(block.payload)
        pointers = _without_non_mutable_secrets(
            _with_labels(
                _without_excluded(
                    inspect_payload_pointers(data, mutable_paths=block.mutable_paths),
                    block.exclude,
                ),
                block.labels,
            )
        )
        key = self.synthesizer.make_cache_key(
            self.name,
            block.intent,
            pointers,
            actions=block.actions,
            exclude=block.exclude,
            mutable_paths=block.mutable_paths,
            labels=block.labels,
            layout=block.layout,
            title=block.title,
            summary=block.summary,
        )
        return key, data, pointers

    def _check_tool_cache(
        self, block: DecisionBlock, kwargs: Mapping[str, Any]
    ) -> tuple[PlanCacheKey, str, SynthesisOutput | None]:
        """Checks the tool-mode `PlanCache` and returns a rendered hit when eligible."""
        target_surface_id = str(
            kwargs.get("surface_id") or self.synthesizer.config.default_surface_id
        )
        cache = self.synthesizer.plan_cache
        if block.replace:
            cache.invalidate_tool(self.name)
        cache_key, data, pointers = self._tool_cache_key(block)
        if not block.replace and block.region is None:
            cached = cache.get_tool(cache_key)
            if cached is not None and _unrolled_array_cardinalities_match(
                cached.plan, pointers
            ):
                self._last_cached = cached
                self._last_surface_id = target_surface_id
                return (
                    cache_key,
                    target_surface_id,
                    self.synthesizer.render_cached_tool_plan(
                        cached, target_surface_id, data
                    ),
                )
        return cache_key, target_surface_id, None

    def _record_tool_output(
        self,
        block: DecisionBlock,
        cache_key: PlanCacheKey,
        target_surface_id: str,
        output: SynthesisOutput,
    ) -> SynthesisOutput:
        """Records a full-surface `SynthesisOutput` in the tool-mode plan cache."""
        # Region updates emit only the replaced block subtree (without `root`)
        # and must not overwrite the full-surface tool plan cache or `_last_cached`.
        if (
            block.region is None
            and output.layout_plan is not None
            and output.messages
            and output.fallback_source is None
        ):
            entry = self.synthesizer._store_cached_plan(None, cache_key, output)
            if entry is not None and any(
                c.get("id") == "root" for c in entry.components
            ):
                self.synthesizer.plan_cache.put_tool(cache_key, entry)
                self._last_cached = entry
                self._last_surface_id = target_surface_id
        return output

    def promote(
        self,
        template_id: str,
        description: str,
        *,
        is_mutable: bool = False,
    ) -> SurfaceTemplate:
        """Promotes the last cached plan from this tool into a registered `SurfaceTemplate`.

        Args:
            template_id: Identifier for the new template.
            description: Description used by the template question.
            is_mutable: Whether the template's data is user-editable.

        Returns:
            The registered `SurfaceTemplate`.

        Raises:
            ValueError: If no plan has been cached by this tool yet.
        """
        cached = self._last_cached or self.synthesizer.plan_cache.last_tool_entry(
            self.name
        )
        if cached is None:
            raise ValueError(
                "No cached plan to promote; run the tool on a payload first."
            )
        surface_id = (
            self._last_surface_id
            or self._surface_id
            or self.synthesizer.config.default_surface_id
        )
        return self.synthesizer.registry.promote_plan(
            template_id,
            description,
            cached.plan,
            cached.components,
            surface_id=surface_id,
            catalog_id=self.synthesizer.graph.surface_catalog_id,
            is_mutable=is_mutable,
        )

    def format_result(
        self,
        output: SynthesisOutput,
        *,
        include_trace: bool | None = None,
    ) -> dict[str, Any]:
        """Serializes a `SynthesisOutput` into a tool-result dictionary."""
        with_trace = self.include_trace if include_trace is None else include_trace
        result: dict[str, Any] = {
            "stage": output.stage.value,
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

    async def run_async(
        self, args: Mapping[str, Any], *, include_trace: bool | None = None
    ) -> SynthesisOutput:
        """Renders one tool call.

        Args:
            args: The tool-call arguments, with the field names from
                `parameters_json_schema` (snake_case aliases are accepted).
            include_trace: Accepted for compatibility; the trace is always on
                the returned output, and `format_result` decides whether to
                serialize it.

        Returns:
            The `SynthesisOutput` emitted for the tool call.

        Raises:
            ValueError: If `intent` is missing, `payload` is an invalid JSON
                string or `layout` is invalid.
            TypeError: If `payload` is neither an object nor an array.
        """
        del include_trace
        block, kwargs = self._synthesis_kwargs(args)
        cache_key, target_surface_id, hit = self._check_tool_cache(block, kwargs)
        if hit is not None:
            return hit
        output = await self.synthesizer.synthesize(
            block.intent, block.payload, **kwargs
        )
        return self._record_tool_output(block, cache_key, target_surface_id, output)

    def run_sync(
        self, args: Mapping[str, Any], *, include_trace: bool | None = None
    ) -> SynthesisOutput:
        """Renders one tool call from synchronous code. See `run_async`."""
        del include_trace
        block, kwargs = self._synthesis_kwargs(args)
        cache_key, target_surface_id, hit = self._check_tool_cache(block, kwargs)
        if hit is not None:
            return hit
        output = self.synthesizer.synthesize_sync(block.intent, block.payload, **kwargs)
        return self._record_tool_output(block, cache_key, target_surface_id, output)


__all__ = ["DecisionRenderTool"]
