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

"""Multi-stage local decision-model A2UI surface synthesizer."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
import concurrent.futures
from dataclasses import replace
import inspect
import re
from typing import Any, TypeAlias, cast

from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import CatalogSchemaHelper
from a2ui.parser.messages import to_message_models
from a2ui.utils.validation import validate_payload

from .archetypes import ArchetypeGrammar, LayoutArchetype
from .backends import (
    DecisionBackend,
    DeterministicMockBackend,
    create_decision_backend,
)
from .bindings import is_v10 as _is_v10
from .bindings import make_data_binding as _make_data_binding
from .catalog_graph import CatalogDecisionGraph
from .layout_lint import lint_components
from .layout_planner import LayoutPlanner, PlannerState
from .models import (
    ComponentNodeSpec,
    ComponentSlot,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuery,
    DecisionQuestion,
    DecisionRecord,
    DecisionTask,
    FallbackSource,
    LayoutBrief,
    LayoutPlan,
    PlanOutcome,
    QuestionKind,
    SlotKind,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
    coerce_decision_payload,
)
from .patterns import (
    MergedPatternLibrary,
    PatternError,
    PatternExpander,
    PatternLibrary,
    eligible_archetypes,
)
from .payload_inspector import (
    PointerSummary,
    PointerValueType,
    inspect_payload_pointers,
)
from .template_registry import TemplateRegistry

_CAMEL_RE = re.compile(r"([a-z0-9])([A-Z])")
_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Key under which a top-level JSON array payload is stored in the data model.
_ARRAY_PAYLOAD_KEY = "items"

FallbackMessages: TypeAlias = Sequence[AgentToRendererMessage | Mapping[str, Any]]
"""Messages a fallback callback may return: models or wire-format dicts."""

FallbackCallback: TypeAlias = Callable[
    [str, Mapping[str, Any], str],
    FallbackMessages | Awaitable[FallbackMessages],
]
"""Callback invoked when the decision model abstains.

Receives ``(intent, payload, surface_id)`` and returns the messages to render
instead, either directly or as an awaitable. Dicts are validated with
`to_message_models`.
"""


def _wire_version(protocol_version: str) -> str:
    """Returns the canonical A2UI wire envelope version string."""
    return "v1.0" if _is_v10(protocol_version) else "v0.9"


def _as_data_model(
    payload: Mapping[str, Any] | Sequence[Any] | str,
) -> Mapping[str, Any]:
    """Coerces a payload into the mapping used as the surface data model.

    A JSON array is stored under the `items` key, since a surface data model
    is always an object.
    """
    data = coerce_decision_payload(payload)
    if isinstance(data, Mapping):
        return data
    return {_ARRAY_PAYLOAD_KEY: list(data)}


def _populates_data_model(message: AgentToRendererMessage) -> bool:
    """Returns whether a message writes the surface data model."""
    dumped = message.model_dump(by_alias=True, exclude_none=True)
    if "updateDataModel" in dumped or "dataModelUpdate" in dumped:
        return True
    create = dumped.get("createSurface")
    return isinstance(create, Mapping) and "dataModel" in create


def _passes_calibration_gate(
    dist: DecisionDistribution, config: SynthesisConfig
) -> bool:
    """Returns whether `dist` satisfies the calibration and logit-margin gate."""
    if dist.calibrated:
        return True
    return (dist.top_logit_margin or 0.0) >= config.uncalibrated_min_logit_margin


def _tokenize_identifier(text: str) -> set[str]:
    """Splits camelCase, PascalCase, and path segments into lowercase tokens."""
    expanded = _CAMEL_RE.sub(r"\1 \2", text)
    return set(_TOKEN_RE.findall(expanded.lower()))


def _pointer_matches_slot_type(ptr: PointerSummary, slot_type: str | None) -> bool:
    """Returns whether a pointer's value type is compatible with `slot_type`."""
    if slot_type is None or slot_type == "any":
        return True
    return ptr.value_type == slot_type


def _best_pointer_by_tokens(
    candidates: Sequence[PointerSummary], slot_tokens: set[str]
) -> PointerSummary:
    """Returns the pointer in `candidates` with the highest token overlap."""
    return max(
        candidates,
        key=lambda p: len(slot_tokens & _tokenize_identifier(p.path)),
    )


def _select_required_pointer(
    slot: ComponentSlot,
    compatible: Sequence[PointerSummary],
    unused: Sequence[PointerSummary],
    used_paths: set[str],
    *,
    relative: bool,
) -> str:
    """Selects a pointer path (or fallback path) for a required DATA_VALUE slot."""
    pool = unused if unused else compatible
    if not pool:
        return slot.name if relative else f"/{slot.name}"
    chosen = _best_pointer_by_tokens(pool, _tokenize_identifier(slot.name))
    used_paths.add(chosen.path)
    return chosen.path


def _select_optional_pointer(
    slot: ComponentSlot,
    unused: Sequence[PointerSummary],
    used_paths: set[str],
) -> str | None:
    """Selects an unused pointer path for an optional DATA_VALUE slot, or None."""
    if not unused:
        return None
    slot_tokens = _tokenize_identifier(slot.name)
    if slot.value_type == "any":
        matched = [
            p
            for p in unused
            if (slot_tokens & _tokenize_identifier(p.path)) or p.value_type == "object"
        ]
        if not matched:
            return None
        chosen = max(
            matched,
            key=lambda p: len(slot_tokens & _tokenize_identifier(p.path)),
        )
        used_paths.add(chosen.path)
        return chosen.path
    chosen = _best_pointer_by_tokens(unused, slot_tokens)
    used_paths.add(chosen.path)
    return chosen.path


def _select_pointer_for_slot(
    slot: ComponentSlot,
    pointers: Sequence[PointerSummary],
    used_paths: set[str],
    *,
    relative: bool,
) -> str | None:
    """Selects a JSON Pointer path for `slot` from `pointers`."""
    compatible = [p for p in pointers if _pointer_matches_slot_type(p, slot.value_type)]
    unused = [p for p in compatible if p.path not in used_paths]
    if slot.required:
        return _select_required_pointer(
            slot, compatible, unused, used_paths, relative=relative
        )
    return _select_optional_pointer(slot, unused, used_paths)


def _select_enum_value(slot: ComponentSlot, intent: str) -> str | None:
    """Selects an enum literal matching `intent` or defaults to the first value."""
    if not slot.enum_values:
        return None
    intent_lower = intent.lower()
    for val in slot.enum_values:
        if val.lower() in intent_lower:
            return val
    return slot.enum_values[0]


def _is_binding_ref(ref: Any) -> bool:
    """Returns whether `ref` is a JSON Schema `$ref` to a bindable type."""
    return isinstance(ref, str) and ("DataBinding" in ref or "Dynamic" in ref)


_SCHEMA_TYPE_CONSTRAINTS = frozenset(
    {"type", "$ref", "enum", "const", "oneOf", "anyOf", "allOf"}
)


def _schema_allows_binding(schema: Mapping[str, Any]) -> bool:
    """Returns whether `schema` accepts an A2UI `DataBinding` object."""
    if _is_binding_ref(schema.get("$ref")):
        return True
    for key in ("oneOf", "anyOf", "allOf"):
        sub_list = schema.get(key)
        if isinstance(sub_list, list) and any(
            isinstance(s, Mapping) and _schema_allows_binding(s) for s in sub_list
        ):
            return True
    return not bool(_SCHEMA_TYPE_CONSTRAINTS & schema.keys())


def _default_arg_value(
    param_name: str,
    param_schema: Mapping[str, Any],
    pointers: Sequence[PointerSummary],
    *,
    is_v10: bool,
    relative: bool,
) -> Any:
    """Builds a schema-valid argument value for a check function parameter."""
    if _schema_allows_binding(param_schema):
        if pointers:
            chosen = _best_pointer_by_tokens(pointers, _tokenize_identifier(param_name))
            path = chosen.path
        else:
            path = param_name if relative else f"/{param_name}"
        return _make_data_binding(path, is_v10=is_v10)
    prim_type = param_schema.get("type")
    if prim_type in ("number", "integer"):
        return 1
    if prim_type == "boolean":
        return True
    if prim_type == "array":
        return []
    if prim_type == "object":
        return {}
    return "valid"


def _find_function_helper(
    helpers: Mapping[str, CatalogSchemaHelper],
    fn_name: str,
    preferred_catalog_id: str,
) -> tuple[str | None, CatalogSchemaHelper | None]:
    """Finds the catalog ID and schema helper defining `fn_name`."""
    preferred = helpers.get(preferred_catalog_id)
    if preferred is not None and fn_name in preferred.functions:
        return preferred_catalog_id, preferred
    for cat_id, helper in helpers.items():
        if fn_name in helper.functions:
            return cat_id, helper
    return None, None


def _build_checks(
    graph: CatalogDecisionGraph,
    comp_spec: ComponentNodeSpec,
    pointers: Sequence[PointerSummary],
    *,
    is_v10: bool,
    relative: bool,
) -> list[dict[str, Any]]:
    """Builds validation check rules for checkable components."""
    check_fns = graph.checkable_functions()
    if not comp_spec.supports_checks or not check_fns:
        return []
    helpers: Mapping[str, CatalogSchemaHelper] = graph.helpers()
    chosen_fn = check_fns[0]
    for fn_name in check_fns:
        cat_id, _ = _find_function_helper(helpers, fn_name, comp_spec.catalog_id)
        if cat_id == comp_spec.catalog_id:
            chosen_fn = fn_name
            break
    fn_cat_id, helper = _find_function_helper(helpers, chosen_fn, comp_spec.catalog_id)
    args: dict[str, Any] = {}
    if helper is not None:
        for param_name in helper.get_function_properties(chosen_fn):
            p_schema = helper.get_function_property_schema(chosen_fn, param_name)
            args[param_name] = _default_arg_value(
                param_name,
                p_schema or {},
                pointers,
                is_v10=is_v10,
                relative=relative,
            )
    call_key = "@call" if is_v10 else "call"
    condition: dict[str, Any] = {call_key: chosen_fn, "args": args}
    if graph.surface_catalog_id is None and fn_cat_id is not None:
        condition["catalogId"] = fn_cat_id
    return [{
        "condition": condition,
        "message": (
            f"{chosen_fn[0].upper() + chosen_fn[1:] if chosen_fn else ''} check failed"
        ),
    }]


class _NoEligibleChildError(Exception):
    """Raised internally when a container slot has no eligible leaf candidates."""


def _bind_non_child_slots(
    comp: dict[str, Any],
    spec: ComponentNodeSpec,
    intent: str,
    pointers: Sequence[PointerSummary],
    *,
    is_v10: bool,
    relative: bool,
    allow_actions: bool = True,
) -> None:
    """Binds DATA_VALUE, STATIC_ENUM, and ACTION slots on `comp` in place."""
    used_paths: set[str] = set()
    selected_paths: dict[str, str | None] = {}
    data_slots = [s for s in spec.slots if s.kind == SlotKind.DATA_VALUE]
    for slot in sorted(data_slots, key=lambda s: not s.required):
        selected_paths[slot.name] = _select_pointer_for_slot(
            slot, pointers, used_paths, relative=relative
        )
    for slot in spec.slots:
        if slot.kind == SlotKind.DATA_VALUE:
            path = selected_paths.get(slot.name)
            if path is not None:
                comp[slot.name] = _make_data_binding(path, is_v10=is_v10)
        elif slot.kind == SlotKind.STATIC_ENUM:
            enum_val = _select_enum_value(slot, intent)
            if enum_val is not None:
                comp[slot.name] = enum_val
        elif slot.kind == SlotKind.ACTION and allow_actions:
            comp[slot.name] = {"event": {"name": slot.name}}


def _relative_pointers_for_array(
    array_ptr: PointerSummary | None,
    fallback_pointers: Sequence[PointerSummary],
) -> list[PointerSummary]:
    """Builds relative `PointerSummary` entries for a repeating `ChildList`."""
    if array_ptr is not None and array_ptr.element_keys:
        return [
            PointerSummary(
                path=key,
                value_type=cast(
                    PointerValueType,
                    array_ptr.sample_type_by_key.get(key, "string"),
                ),
                cardinality=1,
                mutable_hint=array_ptr.mutable_hint,
            )
            for key in array_ptr.element_keys
        ]
    return [
        PointerSummary(
            path=p.path.rsplit("/", 1)[-1] or p.path.lstrip("/"),
            value_type=p.value_type,
            cardinality=1,
            mutable_hint=p.mutable_hint,
        )
        for p in fallback_pointers
        if p.value_type != "array"
    ]


def _can_bind_data_pointers(
    spec: ComponentNodeSpec, ptr_types: Collection[str]
) -> bool:
    """Returns whether `spec` has a data slot and needs no array the pointers lack."""
    data_slots = [s for s in spec.slots if s.kind == SlotKind.DATA_VALUE]
    if not data_slots:
        return False
    return "array" in ptr_types or not any(
        s.required and s.value_type == "array" for s in data_slots
    )


def _best_leaf_by_pointer_overlap(
    candidates: Sequence[ComponentNodeSpec],
    pointers: Sequence[PointerSummary],
) -> ComponentNodeSpec:
    """Selects the leaf component whose DATA_VALUE slots best match `pointers`."""
    ptr_types = {p.value_type for p in pointers}
    return max(
        candidates,
        key=lambda c: sum(
            1
            for s in c.slots
            if s.kind == SlotKind.DATA_VALUE and s.value_type in ptr_types
        ),
    )


def _named_child_entry(
    slot: ComponentSlot,
    child_spec: ComponentNodeSpec,
    child_id: str,
    view_ptrs: Sequence[PointerSummary],
    idx: int,
) -> dict[str, Any]:
    """Builds a single `NAMED_CHILD_ARRAY` item dict with label and child id."""
    entry: dict[str, Any] = {}
    if slot.label_key is not None:
        ptr_label = (
            view_ptrs[0].path.rsplit("/", 1)[-1].replace("_", " ").title()
            if view_ptrs and view_ptrs[0].path.strip("/")
            else f"{child_spec.name}_{idx}"
        )
        entry[slot.label_key] = ptr_label
    if slot.child_id_key is not None:
        entry[slot.child_id_key] = child_id
    return entry


def _coerce_layout_brief(
    layout: LayoutBrief | Sequence[str] | None,
    grammar: ArchetypeGrammar,
) -> LayoutBrief | None:
    """Normalizes an optional `LayoutBrief` or string sequence into a `LayoutBrief`."""
    if layout is None:
        return None
    if isinstance(layout, LayoutBrief):
        return layout if layout.sections else None
    parsed = LayoutBrief.parse(layout, roles=grammar.brief_roles())
    return parsed if parsed.sections else None


def _catalog_slug(catalog_id: str) -> str:
    """Extracts a short identifier slug from a catalog URI or ID."""
    parts = [
        p
        for p in catalog_id.split("/")
        if p
        and not p.endswith(".json")
        and not p.startswith("http")
        and not re.match(r"^v\d", p)
    ]
    raw = parts[-1] if parts else catalog_id
    return re.sub(r"[^a-zA-Z0-9]+", "_", raw).strip("_").lower() or "cat"


def _stamp_function_calls(value: Any, catalog_id: str) -> None:
    """Recursively stamps `catalogId` onto function call dicts inside `value`."""
    if isinstance(value, list):
        for item in value:
            _stamp_function_calls(item, catalog_id)
        return
    if not isinstance(value, dict):
        return
    if ("@call" in value or "call" in value) and "args" in value:
        value.setdefault("catalogId", catalog_id)
    for child in value.values():
        _stamp_function_calls(child, catalog_id)


def _archetype_confidence_and_entropy(
    state: PlannerState, plan: LayoutPlan | None
) -> tuple[float, float]:
    """Extracts confidence and normalized entropy from the archetype or family answer."""
    family = (
        plan.family
        if plan is not None
        else (
            state.selected_archetype.family
            if state.selected_archetype is not None
            else None
        )
    )
    arch_ans = state.answers_by_id.get(f"archetype:{family}") if family else None
    conf = (
        plan.confidence
        if plan is not None
        else (arch_ans.top()[1] if arch_ans is not None else 0.0)
    )
    if arch_ans is not None:
        return conf, arch_ans.distribution.normalized_entropy()
    fam_ans = state.answers_by_id.get("family")
    if fam_ans is not None:
        return conf, fam_ans.distribution.normalized_entropy()
    return conf, 0.0


def _record_trace_reason(trace: list[DecisionRecord], reason: str, prompt: str) -> None:
    """Appends a synthetic `DecisionRecord` with `outcome=reason` if not already last."""
    if trace and trace[-1].outcome == reason:
        return
    trace.append(
        DecisionRecord(
            question=DecisionQuestion(
                id="archetype_status",
                kind=QuestionKind.BOOLEAN,
                prompt=prompt,
                allow_none=False,
            ),
            outcome=reason,
        )
    )


class DecisionSynthesizer:
    """Catalog-agnostic local decision-model A2UI surface synthesizer.

    Attributes:
        graph: The catalog decision graph the synthesizer selects from.
        backend: The decision backend that scores candidates.
        registry: The surface template registry consulted first.
        config: Default thresholds and structural limits.
        archetypes: The layout archetype grammar.
        patterns: The catalog pattern library for expanding planned blocks.
        planner: The speculative layout planner.
        expander: The pattern template expander.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi] | CatalogDecisionGraph,
        backend: DecisionBackend | None = None,
        *,
        registry: TemplateRegistry | None = None,
        config: SynthesisConfig | None = None,
        archetypes: ArchetypeGrammar | None = None,
        patterns: PatternLibrary | MergedPatternLibrary | None = None,
        fallback_card: bool = False,
        fallback_fn: FallbackCallback | None = None,
    ) -> None:
        """Creates a synthesizer.

        Args:
            catalogs: The active catalogs, or a `CatalogDecisionGraph` already
                built from them.
            backend: The decision backend. Defaults to
                `create_decision_backend()`, which reads the
                `A2UI_DECISION_*` environment variables.
            registry: Surface templates tried before catalog synthesis.
            config: Default `SynthesisConfig`; `synthesize` may override it
                per call.
            archetypes: Layout archetype grammar. Defaults to
                `ArchetypeGrammar.default()`.
            patterns: Catalog pattern library. Defaults to
                `PatternLibrary.for_catalogs(graph.catalogs)`.
            fallback_card: When True and the model abstains with no other
                fallback available, render a deterministic root container
                bound to the payload instead of returning no messages.
            fallback_fn: Called with `(intent, payload, surface_id)` when the
                model abstains and no `fallback_dsl` was given; its messages
                are rendered instead.
        """
        self.graph = (
            catalogs
            if isinstance(catalogs, CatalogDecisionGraph)
            else CatalogDecisionGraph(catalogs)
        )
        self.backend = backend if backend is not None else create_decision_backend()
        self.registry = registry if registry is not None else TemplateRegistry()
        self.config = config if config is not None else SynthesisConfig()
        self.archetypes = (
            archetypes if archetypes is not None else ArchetypeGrammar.default()
        )
        self.patterns: PatternLibrary | MergedPatternLibrary = (
            patterns
            if patterns is not None
            else PatternLibrary.for_catalogs(self.graph.catalogs)
        )
        self.planner = LayoutPlanner(
            self.archetypes, self.config, capabilities=self.patterns
        )
        self.expander = PatternExpander(
            self.patterns, self.graph, grammar=self.archetypes
        )
        self._fallback_card = fallback_card
        self._fallback_fn = fallback_fn

    @classmethod
    def from_env(
        cls,
        catalogs: Sequence[CatalogApi] | CatalogDecisionGraph,
        *,
        backend: DecisionBackend | None = None,
        registry: TemplateRegistry | None = None,
        config: SynthesisConfig | None = None,
        archetypes: ArchetypeGrammar | None = None,
        patterns: PatternLibrary | MergedPatternLibrary | None = None,
        fallback_card: bool = False,
        fallback_fn: FallbackCallback | None = None,
    ) -> DecisionSynthesizer:
        """Constructs a DecisionSynthesizer using the environment-configured decision backend.

        Equivalent to calling the constructor; kept for callers that prefer the
        explicit name.
        """
        return cls(
            catalogs,
            backend,
            registry=registry,
            config=config,
            archetypes=archetypes,
            patterns=patterns,
            fallback_card=fallback_card,
            fallback_fn=fallback_fn,
        )

    def _describe_component(self, comp: ComponentNodeSpec) -> str:
        """Produces a concise natural-language summary of a component spec."""
        parts: list[str] = []
        if comp.description:
            parts.append(comp.description.rstrip("."))
        slot_summaries: list[str] = []
        for s in comp.slots:
            slot_desc = s.description.rstrip(".") if s.description else ""
            if slot_desc:
                slot_summaries.append(f"{s.name} ({s.kind.value}: {slot_desc})")
            else:
                slot_summaries.append(f"{s.name} ({s.kind.value})")
        if slot_summaries:
            parts.append(f"Slots: {', '.join(slot_summaries)}")
        return ". ".join(parts) if parts else comp.name

    async def synthesize(
        self,
        intent: str,
        payload: Mapping[str, Any] | Sequence[Any] | str,
        *,
        surface_id: str | None = None,
        mutable_paths: Collection[str] = (),
        config: SynthesisConfig | None = None,
        template_id: str | None = None,
        fallback_dsl: str | None = None,
        layout: LayoutBrief | Sequence[str] | None = None,
    ) -> SynthesisOutput:
        """Synthesizes validated A2UI messages without mutating the template registry.

        Args:
            intent: Natural-language description of the UI to render.
            payload: The data to bind. A mapping is used as the surface data
                model; a JSON array is stored under the `items` key; a
                JSON-encoded string of either is decoded first.
            surface_id: Target surface. Defaults to `config.default_surface_id`.
            mutable_paths: JSON Pointers the user may edit, which raises the
                confidence bar.
            config: Per-call override of the synthesizer's `SynthesisConfig`.
            template_id: Render this registered template directly, skipping
                model selection.
            fallback_dsl: A2UI Express rendered when the model abstains.
            layout: Optional `LayoutBrief` (or `'role:key,key'` string sequence)
                pinning roles to payload pointers.

        Returns:
            The synthesis result. When the model abstains and a fallback
            (`fallback_dsl`, `fallback_fn`, or `fallback_card`) applies, the
            stage stays `ABSTAIN_FALLBACK`, `messages` holds the fallback
            output, and `fallback_source` names which fallback produced it.

        Raises:
            ValueError: If `template_id` names no registered template, a
                string payload is not valid JSON, or `layout` fails brief
                validation.
            TypeError: If the payload is neither an object nor an array.
        """
        active_config = config if config is not None else self.config
        target_surface_id = (
            surface_id if surface_id is not None else active_config.default_surface_id
        )
        data = _as_data_model(payload)
        brief = _coerce_layout_brief(layout, self.archetypes)

        if template_id is not None:
            return self._render_named_template(template_id, data, target_surface_id)

        pointers = inspect_payload_pointers(data, mutable_paths=mutable_paths)
        has_mutable = bool(mutable_paths) or any(p.mutable_hint for p in pointers)

        stage1_out = await self._try_template_stage(
            intent,
            data,
            pointers,
            target_surface_id=target_surface_id,
            has_mutable=has_mutable,
            config=active_config,
        )
        if stage1_out is not None:
            return stage1_out

        output = await self._synthesize_from_catalog(
            intent,
            data,
            pointers,
            target_surface_id=target_surface_id,
            has_mutable=has_mutable,
            config=active_config,
            layout=brief,
        )
        if output.stage is not SynthesisStage.ABSTAIN_FALLBACK or output.messages:
            return output
        return await self._resolve_abstention_fallback(
            output,
            intent,
            data,
            pointers,
            surface_id=target_surface_id,
            fallback_dsl=fallback_dsl,
            config=active_config,
        )

    def synthesize_sync(
        self,
        intent: str,
        payload: Mapping[str, Any] | Sequence[Any] | str,
        **kwargs: Any,
    ) -> SynthesisOutput:
        """Runs `synthesize` to completion from synchronous code.

        Works both with and without a running event loop on the calling
        thread. With a running loop (for example inside `Parser.compile` called
        from an async framework), synthesis runs on a helper thread with its
        own loop and the calling loop blocks until it finishes. HTTP backends
        re-create their client per loop, so this is safe for every bundled
        backend.

        Args:
            intent: See `synthesize`.
            payload: See `synthesize`.
            **kwargs: Keyword arguments forwarded to `synthesize`.

        Returns:
            The `SynthesisOutput` from `synthesize`.
        """

        async def _run() -> SynthesisOutput:
            try:
                return await self.synthesize(intent, payload, **kwargs)
            finally:
                close_fn = getattr(
                    self.backend, "aclose_current_loop", None
                ) or getattr(self.backend, "aclose", None)
                if callable(close_fn):
                    await close_fn()

        def run_in_new_loop() -> SynthesisOutput:
            return asyncio.run(_run())

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return run_in_new_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(run_in_new_loop).result()

    def _render_named_template(
        self, template_id: str, data: Mapping[str, Any], surface_id: str
    ) -> SynthesisOutput:
        """Renders a registered template by id with full confidence."""
        template = self.registry.get(template_id)
        if template is None:
            known = ", ".join(t.template_id for t in self.registry.list_templates())
            raise ValueError(
                f"Unknown template '{template_id}'. Registered templates:"
                f" {known or 'none'}."
            )
        messages = template.render_messages(data, surface_id=surface_id)
        validate_payload(self.graph.catalogs, messages)
        tree_spec: dict[str, Any] = {"template_id": template.template_id}
        root_comp_name = template.root_component()
        if root_comp_name is not None:
            tree_spec["root_component"] = root_comp_name
        return SynthesisOutput(
            stage=SynthesisStage.TEMPLATE_SELECT,
            messages=messages,
            confidence=1.0,
            entropy=0.0,
            selected_template_id=template.template_id,
            component_tree_spec=tree_spec,
        )

    async def _resolve_abstention_fallback(
        self,
        abstained: SynthesisOutput,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        surface_id: str,
        fallback_dsl: str | None,
        config: SynthesisConfig,
    ) -> SynthesisOutput:
        """Fills an abstained output from the first applicable fallback.

        Order: `fallback_dsl`, then the configured `fallback_fn`, then the
        deterministic card when `fallback_card` is on. With none applicable,
        the abstained output is returned unchanged.
        """
        messages: list[AgentToRendererMessage] | None = None
        source: FallbackSource | None = None
        if fallback_dsl and fallback_dsl.strip():
            messages = self._compile_fallback_dsl(fallback_dsl, data, surface_id)
            source = FallbackSource.DSL
        elif self._fallback_fn is not None:
            produced = self._fallback_fn(intent, data, surface_id)
            if inspect.isawaitable(produced):
                produced = await produced
            messages = to_message_models(list(produced))
            validate_payload(self.graph.catalogs, messages)
            source = FallbackSource.CALLBACK
        elif self._fallback_card:
            messages = await self._synthesize_fallback_card(
                intent, data, pointers, surface_id=surface_id, config=config
            )
            source = FallbackSource.CARD if messages else None
        if not messages:
            return abstained
        return SynthesisOutput(
            stage=SynthesisStage.ABSTAIN_FALLBACK,
            messages=messages,
            confidence=abstained.confidence,
            entropy=abstained.entropy,
            fallback_source=source,
            layout_plan=abstained.layout_plan,
            trace=abstained.trace,
        )

    def _compile_fallback_dsl(
        self, dsl: str, data: Mapping[str, Any], surface_id: str
    ) -> list[AgentToRendererMessage]:
        """Compiles Express fallback DSL, adding the payload as the data model.

        The Express package is imported lazily: `a2ui.inference_formats`
        imports this package before `express`, so a module-level import would
        see a partially initialized package.
        """
        from a2ui.inference_formats.express import ExpressCompiler

        messages = ExpressCompiler(list(self.graph.catalogs)).compile(
            dsl, surface_id=surface_id
        )
        if data and not any(_populates_data_model(m) for m in messages):
            messages.extend(
                to_message_models([{
                    "version": _wire_version(self.graph.protocol_version),
                    "updateDataModel": {
                        "surfaceId": surface_id,
                        "path": "/",
                        "value": dict(data),
                    },
                }])
            )
        validate_payload(self.graph.catalogs, messages)
        return messages

    async def _synthesize_fallback_card(
        self,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        surface_id: str,
        config: SynthesisConfig,
    ) -> list[AgentToRendererMessage]:
        """Builds a deterministic root container bound to the payload pointers.

        Uses the first action-free container the catalogs define (or the first
        action-free root candidate) and the deterministic heuristic backend for
        child slots, so the result is the same for the same catalogs and
        payload. Action slots are never bound because confidence was low.
        """
        candidates = [
            c
            for c in (
                *self.graph.container_candidates(),
                *self.graph.leaf_candidates(),
            )
            if not c.has_action_slot
        ]
        if not candidates:
            return []
        deterministic = DecisionSynthesizer(
            self.graph,
            DeterministicMockBackend(),
            registry=self.registry,
            config=config,
        )
        for candidate in candidates:
            try:
                components = await deterministic._build_component_subtree(
                    candidate,
                    "root",
                    intent,
                    pointers,
                    depth=1,
                    allow_actions=False,
                    config=config,
                )
                return self._build_validated_messages(surface_id, components, data)
            except (_NoEligibleChildError, A2uiValidationError):
                continue
        return []

    async def _try_template_stage(
        self,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        target_surface_id: str,
        has_mutable: bool,
        config: SynthesisConfig,
    ) -> SynthesisOutput | None:
        """Executes Stage 1 template matching and risk-tiered confidence gating."""
        pointer_paths = [p.path for p in pointers]
        matching = self.registry.matching_templates(pointer_paths)
        if not matching:
            return None

        matching_descriptions = {
            t.template_id: t.description for t in matching if t.description
        }
        query_context: dict[str, Any] = {"pointers": pointer_paths}
        if matching_descriptions:
            query_context["candidate_descriptions"] = matching_descriptions

        dist = await self.backend.predict(
            DecisionQuery(
                task=DecisionTask.TEMPLATE_SELECT,
                prompt=intent,
                candidates=tuple(t.template_id for t in matching),
                context=query_context,
            )
        )
        if not _passes_calibration_gate(dist, config):
            return None

        top_id, top_prob = dist.top_choice()
        template = self.registry.get(top_id)
        if template is None:
            return None

        threshold = (
            config.mutable_confidence_threshold
            if (has_mutable or template.is_mutable)
            else config.template_confidence_threshold
        )
        if top_prob < threshold:
            return None

        messages = template.render_messages(payload, surface_id=target_surface_id)
        validate_payload(self.graph.catalogs, messages)
        tree_spec: dict[str, Any] = {"template_id": template.template_id}
        root_comp_name = template.root_component()
        if root_comp_name is not None:
            tree_spec["root_component"] = root_comp_name
        return SynthesisOutput(
            stage=SynthesisStage.TEMPLATE_SELECT,
            messages=messages,
            confidence=top_prob,
            entropy=dist.normalized_entropy(),
            selected_template_id=template.template_id,
            component_tree_spec=tree_spec,
        )

    async def _plan_layout(
        self,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        brief: LayoutBrief | None,
        config: SynthesisConfig,
    ) -> tuple[PlanOutcome, PlannerState]:
        """Builds a speculative batch, calls `backend.answer` (with at most one re-ask), and reads the plan."""
        planner = (
            self.planner
            if config == self.config
            else LayoutPlanner(self.archetypes, config, capabilities=self.patterns)
        )
        batch, state = planner.build_batch(intent, pointers, brief=brief, payload=data)
        answers = await self.backend.answer(batch)
        outcome = planner.read(state, answers)
        if outcome.plan is None:
            return outcome, state
        reask = planner.needs_reask(outcome.plan, state)
        if not reask:
            return outcome, state
        reask_batch = DecisionBatch(
            shared_context={**batch.shared_context, "reask": True},
            questions=reask,
        )
        reask_answers = await self.backend.answer(reask_batch)
        reask_by_id = {ans.question_id: ans for ans in reask_answers}
        existing_ids = {a.question_id for a in answers}
        merged = tuple(reask_by_id.get(a.question_id, a) for a in answers) + tuple(
            ans for ans in reask_answers if ans.question_id not in existing_ids
        )
        state.trace.clear()
        return planner.read(state, merged), state

    def _block_prefix_and_owner(
        self, block_id: str, pattern: str
    ) -> tuple[str, str | None]:
        """Returns `(id_prefix, owner_catalog_id)` for a planned block."""
        if self.graph.surface_catalog_id is not None:
            return block_id, None
        base_pattern = pattern.split(".", 1)[0].split(":", 1)[0]
        owner: str | None = None
        if isinstance(self.patterns, MergedPatternLibrary):
            owner = self.patterns.owner_catalog_id(base_pattern)
        elif self.patterns.catalog_ids:
            owner = self.patterns.catalog_ids[0]
        if owner is None and self.graph.catalogs:
            owner = self.graph.catalogs[0].catalog_id
        slug = _catalog_slug(owner) if owner else "cat"
        return f"{slug}_{block_id}", owner

    def _stamp_multi_catalog_id(
        self, comps: Sequence[dict[str, Any]], owner: str | None
    ) -> None:
        """Assigns `catalogId` to expanded components on multi-catalog surfaces."""
        if self.graph.surface_catalog_id is not None:
            return
        default_cat = owner or (
            self.graph.catalogs[0].catalog_id if self.graph.catalogs else None
        )
        if default_cat is None:
            return
        for comp in comps:
            comp.setdefault("catalogId", default_cat)
            _stamp_function_calls(comp, default_cat)

    def _expand_plan(self, plan: LayoutPlan) -> list[dict[str, Any]]:
        """Expands every `PlannedBlock` and the `page` frame through `self.expander`."""
        block_roots: list[str] = []
        block_components: list[dict[str, Any]] = []
        for block in plan.blocks:
            prefix, owner = self._block_prefix_and_owner(block.block_id, block.pattern)
            expanded = self.expander.expand_block(
                block.block_id,
                block.pattern,
                block.bindings,
                block.variant_knobs,
                block.instances,
                prefix,
            )
            if expanded:
                self._stamp_multi_catalog_id(expanded, owner)
                block_roots.append(str(expanded[0]["id"]))
                block_components.extend(expanded)
        page_owner = (
            self.patterns.owner_catalog_id("page")
            if isinstance(self.patterns, MergedPatternLibrary)
            else None
        )
        page_components = self.expander.expand_page(plan.page, block_roots=block_roots)
        self._stamp_multi_catalog_id(page_components, page_owner)
        return [*page_components, *block_components]

    def _finish_archetype_output(
        self,
        plan: LayoutPlan,
        state: PlannerState,
        components: list[dict[str, Any]],
        data: Mapping[str, Any],
        target_surface_id: str,
    ) -> SynthesisOutput:
        """Runs `lint_components`, validates wire messages, and builds `SynthesisOutput`."""
        trace = list(state.trace)
        findings = lint_components(components, plan)
        has_error = False
        for finding in findings:
            trace.append(
                DecisionRecord(
                    question=DecisionQuestion(
                        id=f"lint:{finding.code}",
                        kind=QuestionKind.BOOLEAN,
                        prompt=finding.message,
                        allow_none=False,
                    ),
                    outcome=f"{finding.severity}:{finding.code}",
                )
            )
            if finding.severity == "error":
                has_error = True
        conf, entropy = _archetype_confidence_and_entropy(state, plan)
        if has_error:
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=conf,
                entropy=entropy,
                layout_plan=plan,
                trace=tuple(trace),
            )
        messages = self._build_validated_messages(target_surface_id, components, data)
        root_comp = (
            str(components[0].get("component", "Column")) if components else "Column"
        )
        return SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=messages,
            confidence=conf,
            entropy=entropy,
            component_tree_spec={
                "root_component": root_comp,
                "archetype": plan.archetype,
                "blocks": list(plan.block_ids()),
                "layoutPlan": {
                    "archetype": plan.archetype,
                    "blocks": list(plan.block_ids()),
                },
                "components": components,
            },
            layout_plan=plan,
            trace=tuple(trace),
        )

    async def _synthesize_with_archetypes(
        self,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        target_surface_id: str,
        brief: LayoutBrief | None,
        config: SynthesisConfig,
    ) -> tuple[SynthesisOutput | None, tuple[DecisionRecord, ...]]:
        """Attempts archetype-planned synthesis, returning `(output, trace)`."""
        eligible = eligible_archetypes(self.archetypes, self.patterns, pointers)
        if not eligible:
            trace: list[DecisionRecord] = []
            _record_trace_reason(
                trace,
                "no eligible archetype",
                "Are any layout archetypes eligible for the active catalogs and"
                " payload?",
            )
            return None, tuple(trace)
        trace = []
        try:
            outcome, state = await self._plan_layout(
                intent,
                data,
                pointers,
                brief=brief,
                config=config,
            )
            trace = list(state.trace)
            if outcome.reason == "action_gate":
                _record_trace_reason(trace, "action_gate", "Action confidence gate")
                conf, entropy = _archetype_confidence_and_entropy(state, None)
                return (
                    SynthesisOutput(
                        stage=SynthesisStage.ABSTAIN_FALLBACK,
                        messages=[],
                        confidence=conf,
                        entropy=entropy,
                        trace=tuple(trace),
                    ),
                    tuple(trace),
                )
            if outcome.reason != "planned" or outcome.plan is None:
                _record_trace_reason(
                    trace, outcome.reason, "Archetype planning outcome"
                )
                return None, tuple(trace)
            components = self._expand_plan(outcome.plan)
            finished = self._finish_archetype_output(
                outcome.plan, state, components, data, target_surface_id
            )
            return finished, finished.trace
        except (
            _NoEligibleChildError,
            PatternError,
            A2uiValidationError,
        ) as exc:
            _record_trace_reason(
                trace,
                f"{type(exc).__name__}: {exc}",
                "Archetype planning or expansion validation",
            )
            return None, tuple(trace)

    async def _synthesize_from_catalog(
        self,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        target_surface_id: str,
        has_mutable: bool,
        config: SynthesisConfig,
        layout: LayoutBrief | None = None,
    ) -> SynthesisOutput:
        """Executes Stage 2 catalog-guided synthesis or Stage 3 abstain fallback."""
        arch_trace: tuple[DecisionRecord, ...] = ()
        if config.use_archetypes:
            arch_out, arch_trace = await self._synthesize_with_archetypes(
                intent,
                payload,
                pointers,
                target_surface_id=target_surface_id,
                brief=layout,
                config=config,
            )
            if arch_out is not None:
                return arch_out

        flat_out = await self._synthesize_flat_catalog_path(
            intent,
            payload,
            pointers,
            target_surface_id=target_surface_id,
            has_mutable=has_mutable,
            config=config,
        )
        return replace(flat_out, trace=arch_trace) if arch_trace else flat_out

    async def _synthesize_flat_catalog_path(
        self,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        target_surface_id: str,
        has_mutable: bool,
        config: SynthesisConfig,
    ) -> SynthesisOutput:
        """Executes the flat leaf/container/switcher catalog synthesis path."""
        root_candidates = (
            (self.graph.leaf_candidates() or self.graph.root_candidates())
            if config.max_tree_depth <= 1
            else self.graph.root_candidates()
        )
        if not root_candidates:
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=0.0,
                entropy=0.0,
            )

        cand_descriptions = {
            c.name: self._describe_component(c) for c in root_candidates
        }
        dist = await self.backend.predict(
            DecisionQuery(
                task=DecisionTask.ROOT_COMPONENT,
                prompt=intent,
                candidates=tuple(c.name for c in root_candidates),
                context={
                    "pointers": [p.path for p in pointers],
                    "types": {p.path: p.value_type for p in pointers},
                    "candidate_descriptions": cand_descriptions,
                },
            )
        )
        top_name, top_prob = dist.top_choice()
        entropy = dist.normalized_entropy()
        root_spec = self.graph.get_component(top_name)

        if (
            not _passes_calibration_gate(dist, config)
            or top_prob < config.abstain_threshold
            or root_spec is None
        ):
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=top_prob,
                entropy=entropy,
            )

        if self._should_wrap_in_switcher(dist, root_spec, entropy, config=config):
            return await self._synthesize_multi_view_switcher(
                intent,
                payload,
                pointers,
                dist,
                target_surface_id=target_surface_id,
                has_mutable=has_mutable,
                confidence=top_prob,
                entropy=entropy,
                config=config,
            )

        if not root_spec.is_container or config.max_tree_depth <= 1:
            return self._synthesize_leaf_fast_path(
                root_spec,
                intent,
                payload,
                pointers,
                target_surface_id=target_surface_id,
                has_mutable=has_mutable,
                confidence=top_prob,
                entropy=entropy,
                config=config,
            )

        return await self._synthesize_container_tree(
            root_spec,
            intent,
            payload,
            pointers,
            target_surface_id=target_surface_id,
            has_mutable=has_mutable,
            confidence=top_prob,
            entropy=entropy,
            config=config,
        )

    def _should_wrap_in_switcher(
        self,
        dist: DecisionDistribution,
        root_spec: ComponentNodeSpec,
        entropy: float,
        *,
        config: SynthesisConfig,
    ) -> bool:
        """Checks whether high-entropy multi-view switcher wrapping applies."""
        if config.max_tree_depth <= 1:
            return False
        if root_spec.is_multi_view_switcher:
            return False
        if not self.graph.multi_view_switchers():
            return False
        if entropy < (1.0 - config.entropy_switch_margin):
            return False
        viable_count = sum(1 for p in dist.probabilities.values() if p >= 0.25)
        return viable_count >= 2

    def _select_competing_views(
        self, dist: DecisionDistribution, switcher_name: str
    ) -> list[ComponentNodeSpec]:
        """Selects the top 2 non-switcher view specs from `dist`."""
        ranked = sorted(
            dist.probabilities.items(), key=lambda item: item[1], reverse=True
        )
        views: list[ComponentNodeSpec] = []
        for cand_name, _ in ranked:
            if cand_name == switcher_name:
                continue
            spec = self.graph.get_component(cand_name)
            if (
                spec is not None
                and not spec.is_multi_view_switcher
                and spec not in views
            ):
                views.append(spec)
            if len(views) == 2:
                return views
        for fallback in self.graph.root_candidates():
            if not fallback.is_multi_view_switcher and fallback not in views:
                views.append(fallback)
            if len(views) == 2:
                break
        return views

    def _switcher_requires_mutable_gate(
        self,
        switcher: ComponentNodeSpec,
        views: Sequence[ComponentNodeSpec],
        has_mutable: bool,
    ) -> bool:
        """Returns whether switcher synthesis requires the mutable threshold."""
        return (
            has_mutable
            or switcher.has_action_slot
            or any(v.has_action_slot for v in views)
        )

    async def _synthesize_multi_view_switcher(
        self,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        dist: DecisionDistribution,
        *,
        target_surface_id: str,
        has_mutable: bool,
        confidence: float,
        entropy: float,
        config: SynthesisConfig,
    ) -> SynthesisOutput:
        """Wraps competing candidate views in a multi-view switcher."""
        switcher = self.graph.multi_view_switchers()[0]
        max_views = min(2, config.max_children_per_container)
        views = self._select_competing_views(dist, switcher.name)[:max_views]
        if (
            self._switcher_requires_mutable_gate(switcher, views, has_mutable)
            and confidence < config.mutable_confidence_threshold
        ):
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=confidence,
                entropy=entropy,
            )

        is_v10 = _is_v10(self.graph.protocol_version)
        allow_actions = confidence >= config.mutable_confidence_threshold
        root_comp = self._init_component_dict(switcher, "root")
        _bind_non_child_slots(
            root_comp,
            switcher,
            intent,
            pointers,
            is_v10=is_v10,
            relative=False,
            allow_actions=allow_actions,
        )

        child_components: list[dict[str, Any]] = []
        named_items: list[dict[str, Any]] = []
        array_slot = next(
            s for s in switcher.slots if s.kind == SlotKind.NAMED_CHILD_ARRAY
        )

        try:
            for idx, view_spec in enumerate(views, start=1):
                view_id = f"view_{idx}"
                built = await self._build_component_subtree(
                    view_spec,
                    view_id,
                    intent,
                    pointers,
                    depth=2,
                    allow_actions=allow_actions,
                    config=config,
                )
                child_components.extend(built)
                item: dict[str, Any] = {}
                if array_slot.label_key is not None:
                    item[array_slot.label_key] = view_spec.name
                if array_slot.child_id_key is not None:
                    item[array_slot.child_id_key] = view_id
                named_items.append(item)
        except _NoEligibleChildError:
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=confidence,
                entropy=entropy,
            )

        root_comp[array_slot.name] = named_items
        checks = _build_checks(
            self.graph, switcher, pointers, is_v10=is_v10, relative=False
        )
        if checks:
            root_comp["checks"] = checks

        components = [root_comp, *child_components]
        messages = self._build_validated_messages(
            target_surface_id, components, payload
        )
        return SynthesisOutput(
            stage=SynthesisStage.CONTAINER_2PASS,
            messages=messages,
            confidence=confidence,
            entropy=entropy,
            component_tree_spec={
                "root_component": switcher.name,
                "views": [v.name for v in views],
                "components": components,
            },
        )

    def _synthesize_leaf_fast_path(
        self,
        root_spec: ComponentNodeSpec,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        target_surface_id: str,
        has_mutable: bool,
        confidence: float,
        entropy: float,
        config: SynthesisConfig,
    ) -> SynthesisOutput:
        """Executes Stage 2A 1-pass leaf component synthesis."""
        if (
            root_spec.has_action_slot or has_mutable
        ) and confidence < config.mutable_confidence_threshold:
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=confidence,
                entropy=entropy,
            )

        allow_actions = confidence >= config.mutable_confidence_threshold
        leaf_comp = self._build_leaf_dict(
            root_spec,
            "root",
            intent,
            pointers,
            relative=False,
            allow_actions=allow_actions,
        )
        components = [leaf_comp]
        messages = self._build_validated_messages(
            target_surface_id, components, payload
        )
        return SynthesisOutput(
            stage=SynthesisStage.FAST_1PASS_LEAF,
            messages=messages,
            confidence=confidence,
            entropy=entropy,
            component_tree_spec={
                "root_component": root_spec.name,
                "components": components,
            },
        )

    async def _synthesize_container_tree(
        self,
        root_spec: ComponentNodeSpec,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        target_surface_id: str,
        has_mutable: bool,
        confidence: float,
        entropy: float,
        config: SynthesisConfig,
    ) -> SynthesisOutput:
        """Executes Stage 2B 2-pass container and child slot synthesis."""
        if (
            root_spec.has_action_slot or has_mutable
        ) and confidence < config.mutable_confidence_threshold:
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=confidence,
                entropy=entropy,
            )

        allow_actions = confidence >= config.mutable_confidence_threshold
        try:
            components = await self._build_component_subtree(
                root_spec,
                "root",
                intent,
                pointers,
                depth=1,
                allow_actions=allow_actions,
                config=config,
            )
        except _NoEligibleChildError:
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=confidence,
                entropy=entropy,
            )
        messages = self._build_validated_messages(
            target_surface_id, components, payload
        )
        return SynthesisOutput(
            stage=SynthesisStage.CONTAINER_2PASS,
            messages=messages,
            confidence=confidence,
            entropy=entropy,
            component_tree_spec={
                "root_component": root_spec.name,
                "components": components,
            },
        )

    def _init_component_dict(
        self, spec: ComponentNodeSpec, comp_id: str
    ) -> dict[str, Any]:
        """Creates a base component dictionary with `id`, `component`, and optional `catalogId`."""
        comp: dict[str, Any] = {"id": comp_id, "component": spec.name}
        if self.graph.surface_catalog_id is None:
            comp["catalogId"] = spec.catalog_id
        return comp

    def _build_leaf_dict(
        self,
        spec: ComponentNodeSpec,
        comp_id: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        relative: bool,
        allow_actions: bool = True,
    ) -> dict[str, Any]:
        """Builds a single leaf component dictionary bound to `pointers`."""
        is_v10 = _is_v10(self.graph.protocol_version)
        comp = self._init_component_dict(spec, comp_id)
        _bind_non_child_slots(
            comp,
            spec,
            intent,
            pointers,
            is_v10=is_v10,
            relative=relative,
            allow_actions=allow_actions,
        )
        checks = _build_checks(
            self.graph, spec, pointers, is_v10=is_v10, relative=relative
        )
        if checks:
            comp["checks"] = checks
        return comp

    def _coerce_to_leaf_if_depth_reached(
        self,
        spec: ComponentNodeSpec,
        pointers: Sequence[PointerSummary],
        *,
        depth: int,
        allow_actions: bool,
        config: SynthesisConfig,
    ) -> ComponentNodeSpec:
        """Replaces a container `spec` with a leaf when `depth` hits `max_tree_depth`."""
        if not spec.is_container or depth < config.max_tree_depth:
            return spec
        leaf_pool = [
            c
            for c in self.graph.leaf_candidates()
            if allow_actions or not c.has_action_slot
        ]
        if not leaf_pool:
            return spec
        return _best_leaf_by_pointer_overlap(leaf_pool, pointers)

    async def _build_component_subtree(
        self,
        spec: ComponentNodeSpec,
        comp_id: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        depth: int = 1,
        allow_actions: bool = True,
        config: SynthesisConfig,
    ) -> list[dict[str, Any]]:
        """Builds a component and any child components required by its container slots."""
        effective_spec = self._coerce_to_leaf_if_depth_reached(
            spec,
            pointers,
            depth=depth,
            allow_actions=allow_actions,
            config=config,
        )
        if not effective_spec.is_container:
            return [
                self._build_leaf_dict(
                    effective_spec,
                    comp_id,
                    intent,
                    pointers,
                    relative=False,
                    allow_actions=allow_actions,
                )
            ]

        is_v10 = _is_v10(self.graph.protocol_version)
        comp = self._init_component_dict(effective_spec, comp_id)
        _bind_non_child_slots(
            comp,
            effective_spec,
            intent,
            pointers,
            is_v10=is_v10,
            relative=False,
            allow_actions=allow_actions,
        )

        children: list[dict[str, Any]] = []
        prefix = "" if comp_id == "root" else f"{comp_id}_"
        child_counter = 0

        for slot in effective_spec.slots:
            if not slot.required and len(children) >= config.max_children_per_container:
                continue
            if slot.kind == SlotKind.CHILD_LIST:
                child_counter += 1
                item_id = f"{prefix}item_{child_counter}"
                item_comp, array_path = await self._build_child_list_item(
                    effective_spec.name,
                    slot.name,
                    item_id,
                    intent,
                    pointers,
                    allow_actions=allow_actions,
                )
                comp[slot.name] = {"path": array_path, "componentId": item_id}
                children.append(item_comp)
            elif slot.kind == SlotKind.CHILD:
                child_counter += 1
                child_id = f"{prefix}child_{child_counter}"
                child_comp = await self._build_single_child(
                    effective_spec.name,
                    slot.name,
                    child_id,
                    intent,
                    pointers,
                    allow_actions=allow_actions,
                )
                comp[slot.name] = child_id
                children.append(child_comp)
            elif slot.kind == SlotKind.NAMED_CHILD_ARRAY:
                remaining = max(1, config.max_children_per_container - len(children))
                named_items, named_children = await self._build_named_child_array(
                    effective_spec.name,
                    slot,
                    prefix,
                    intent,
                    pointers,
                    max_items=remaining,
                    allow_actions=allow_actions,
                )
                comp[slot.name] = named_items
                children.extend(named_children)

        checks = _build_checks(
            self.graph, effective_spec, pointers, is_v10=is_v10, relative=False
        )
        if checks:
            comp["checks"] = checks

        return [comp, *children]

    async def _build_child_list_item(
        self,
        parent_name: str,
        slot_name: str,
        item_id: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        allow_actions: bool = True,
    ) -> tuple[dict[str, Any], str]:
        """Synthesizes a repeating leaf component for a `CHILD_LIST` slot."""
        array_ptr = next((p for p in pointers if p.value_type == "array"), None)
        array_path = array_ptr.path if array_ptr is not None else f"/{slot_name}"
        rel_pointers = _relative_pointers_for_array(array_ptr, pointers)
        item_spec = await self._choose_child_component(
            intent,
            slot_name,
            parent_name,
            rel_pointers,
            allow_actions=allow_actions,
        )
        item_comp = self._build_leaf_dict(
            item_spec,
            item_id,
            intent,
            rel_pointers,
            relative=True,
            allow_actions=allow_actions,
        )
        return item_comp, array_path

    async def _build_single_child(
        self,
        parent_name: str,
        slot_name: str,
        child_id: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        allow_actions: bool = True,
    ) -> dict[str, Any]:
        """Synthesizes a scalar-bound leaf component for a `CHILD` slot."""
        scalar_ptrs = [p for p in pointers if p.value_type != "array"] or list(pointers)
        child_spec = await self._choose_child_component(
            intent,
            slot_name,
            parent_name,
            scalar_ptrs,
            allow_actions=allow_actions,
        )
        return self._build_leaf_dict(
            child_spec,
            child_id,
            intent,
            scalar_ptrs,
            relative=False,
            allow_actions=allow_actions,
        )

    def _select_named_child_specs(
        self,
        parent_name: str,
        *,
        max_items: int,
        allow_actions: bool,
    ) -> list[ComponentNodeSpec]:
        """Selects up to `max_items` leaf specs for a `NAMED_CHILD_ARRAY` slot."""
        del parent_name
        raw_leaves = [
            c
            for c in self.graph.leaf_candidates()
            if allow_actions or not c.has_action_slot
        ]
        if not raw_leaves:
            return []
        cap = min(2, max(1, max_items))
        return raw_leaves[:cap] if len(raw_leaves) >= cap else (raw_leaves * cap)[:cap]

    async def _build_named_child_array(
        self,
        parent_name: str,
        slot: ComponentSlot,
        prefix: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        max_items: int = 2,
        allow_actions: bool = True,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Synthesizes child leaf views for a `NAMED_CHILD_ARRAY` slot."""
        scalar_ptrs = [p for p in pointers if p.value_type != "array"] or list(pointers)
        fallback_specs = self._select_named_child_specs(
            parent_name, max_items=max_items, allow_actions=allow_actions
        )
        if not fallback_specs:
            raise _NoEligibleChildError(
                f"No eligible leaf candidates available for child slot '{slot.name}'"
                f" on '{parent_name}'."
            )
        items: list[dict[str, Any]] = []
        children: list[dict[str, Any]] = []
        for idx, _ in enumerate(fallback_specs, start=1):
            view_ptrs = (
                [scalar_ptrs[idx - 1]] if idx <= len(scalar_ptrs) else scalar_ptrs
            )
            child_spec = await self._choose_child_component(
                intent,
                f"{slot.name}[{idx - 1}]",
                parent_name,
                view_ptrs,
                allow_actions=allow_actions,
            )
            child_id = f"{prefix}view_{idx}"
            children.append(
                self._build_leaf_dict(
                    child_spec,
                    child_id,
                    intent,
                    view_ptrs,
                    relative=False,
                    allow_actions=allow_actions,
                )
            )
            items.append(_named_child_entry(slot, child_spec, child_id, view_ptrs, idx))
        return items, children

    def _eligible_child_candidates(
        self,
        child_pointers: Sequence[PointerSummary],
        *,
        allow_actions: bool,
    ) -> tuple[ComponentNodeSpec, ...]:
        """Narrows leaf candidates to those that can bind `child_pointers`.

        Drops action-bearing components when actions are not allowed, then
        prefers components with a data slot whose required array slots the
        pointers can satisfy.
        """
        raw_candidates = [
            c
            for c in self.graph.leaf_candidates()
            if allow_actions or not c.has_action_slot
        ]
        if not raw_candidates:
            return ()
        filtered = list(raw_candidates)
        ptr_types = {p.value_type for p in child_pointers}
        data_capable = [c for c in filtered if _can_bind_data_pointers(c, ptr_types)]
        if child_pointers and data_capable:
            filtered = data_capable
        return tuple(filtered)

    def _child_slot_context(
        self,
        slot_name: str,
        parent_name: str,
        child_pointers: Sequence[PointerSummary],
        candidates: Sequence[ComponentNodeSpec],
    ) -> dict[str, Any]:
        """Builds the `DecisionQuery.context` for a child slot choice."""
        parent_spec = self.graph.get_component(parent_name)
        parent_slot = parent_spec.get_slot(slot_name) if parent_spec else None
        return {
            "parent": parent_name,
            "parent_description": (
                parent_spec.description
                if parent_spec and parent_spec.description
                else parent_name
            ),
            "slot": slot_name,
            "slot_description": (
                parent_slot.description
                if parent_slot and parent_slot.description
                else slot_name
            ),
            "pointers": [p.path for p in child_pointers],
            "candidate_descriptions": {
                c.name: self._describe_component(c) for c in candidates
            },
        }

    async def _choose_child_component(
        self,
        intent: str,
        slot_name: str,
        parent_name: str,
        child_pointers: Sequence[PointerSummary],
        *,
        allow_actions: bool = True,
    ) -> ComponentNodeSpec:
        """Selects a leaf component for a container slot via backend or pointer fit."""
        candidates = self._eligible_child_candidates(
            child_pointers, allow_actions=allow_actions
        )
        if not candidates:
            raise _NoEligibleChildError(
                f"No eligible leaf candidates available for child slot '{slot_name}'"
                f" on '{parent_name}'."
            )
        if len(candidates) == 1:
            return candidates[0]
        dist = await self.backend.predict(
            DecisionQuery(
                task=DecisionTask.CHILD_COMPONENT,
                prompt=intent,
                candidates=tuple(c.name for c in candidates),
                context=self._child_slot_context(
                    slot_name, parent_name, child_pointers, candidates
                ),
            )
        )
        top_name, top_prob = dist.top_choice()
        chosen = self.graph.get_component(top_name)
        if (
            chosen is not None
            and not chosen.is_container
            and top_prob > 0.0
            and chosen in candidates
        ):
            return chosen
        return _best_leaf_by_pointer_overlap(candidates, child_pointers)

    def _build_validated_messages(
        self,
        surface_id: str,
        components: list[dict[str, Any]],
        payload: Mapping[str, Any],
    ) -> list[AgentToRendererMessage]:
        """Builds and validates `createSurface`, `updateComponents`, and `updateDataModel`."""
        wire_ver = _wire_version(self.graph.protocol_version)
        create_body: dict[str, Any] = {"surfaceId": surface_id}
        if self.graph.surface_catalog_id is not None:
            create_body["catalogId"] = self.graph.surface_catalog_id

        raw_messages: list[dict[str, Any]] = [
            {"version": wire_ver, "createSurface": create_body},
            {
                "version": wire_ver,
                "updateComponents": {
                    "surfaceId": surface_id,
                    "components": components,
                },
            },
        ]
        if payload:
            raw_messages.append({
                "version": wire_ver,
                "updateDataModel": {
                    "surfaceId": surface_id,
                    "path": "/",
                    "value": dict(payload),
                },
            })
        models = to_message_models(raw_messages)
        validate_payload(self.graph.catalogs, models)
        return models
