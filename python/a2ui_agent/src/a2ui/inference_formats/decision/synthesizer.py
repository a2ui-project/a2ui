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

"""Local decision-model A2UI surface synthesizer: one planning path per surface."""

from __future__ import annotations

import asyncio
import collections
from collections.abc import Awaitable, Callable, Collection, Iterable, Mapping, Sequence
import concurrent.futures
import contextvars
import copy as copy_lib
from dataclasses import dataclass, field, replace
import inspect
import re
import time
from typing import TYPE_CHECKING, Any, TypeAlias

from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser.errors import A2uiCompilationError
from a2ui.parser.messages import to_message_dicts, to_message_models
from a2ui.utils import validate_payload
from a2ui.utils.component_envelope import envelope_key

from .archetypes import ArchetypeGrammar, LayoutArchetype
from .backends import DecisionBackend, create_decision_backend
from .bindings import is_v10 as _is_v10
from .catalog_graph import CatalogDecisionGraph
from .layout_lint import lint_components
from .layout_planner import LayoutPlanner, PlannerState, is_secret_pointer
from .models import (
    ActionSpec,
    AuthoredCopy,
    DecisionAnswer,
    DecisionBatch,
    DecisionQuestion,
    DecisionRecord,
    FallbackSource,
    LayoutBrief,
    LayoutPlan,
    PageBindings,
    PlanCacheKey,
    PlannedBlock,
    PlanOutcome,
    QuestionKind,
    SlotBinding,
    SlotKind,
    SurfaceOperation,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
    coerce_decision_payload,
    plan_shape_signature,
)
from .patterns import (
    Expansion,
    MergedPatternLibrary,
    PatternError,
    PatternExpander,
    PatternLibrary,
    eligible_archetypes,
    resolve_fallback_pattern,
    shape_signature,
)
from .payload_inspector import (
    PointerSummary,
    inspect_payload_pointers,
)
from .plan_cache import CachedPlan, PlanCache, replace_block_components
from .template_registry import TemplateRegistry

if TYPE_CHECKING:
    from a2ui.utils import RendererState

# Key under which a top-level JSON array payload is stored in the data model.
_ARRAY_PAYLOAD_KEY = "items"
_ELIGIBILITY_CACHE_SIZE = 256
"""Distinct payload shapes whose archetype eligibility one synthesizer remembers."""

_DECISION_CALL_TIMINGS: contextvars.ContextVar[list[float] | None] = (
    contextvars.ContextVar("_DECISION_CALL_TIMINGS", default=None)
)

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


_WIRE_VERSION = "1.0"
"""The only A2UI wire version the decision format emits."""

_FACTS_BLOCK = "facts"
_ABSTAIN_HELP = (
    "Add a 'fallbackDsl' field, configure fallback_fn, or make sure the"
    " catalog's patterns include a 'facts' pattern."
)


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


def _is_function_call_dict(node: dict[str, Any]) -> bool:
    """Returns whether `node` represents a function call dict."""
    return "args" in node and ("@call" in node or "call" in node)


def _stamp_function_calls(value: Any, catalog_id: str) -> None:
    """Recursively stamps `catalogId` onto function call dicts inside `value`."""
    children: Iterable[Any]
    if isinstance(value, dict):
        if _is_function_call_dict(value):
            value.setdefault("catalogId", catalog_id)
        children = value.values()
    elif isinstance(value, list):
        children = value
    else:
        return
    for child in children:
        if isinstance(child, (dict, list)):
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


_CHILD_SLOT_KINDS = frozenset(
    {SlotKind.CHILD, SlotKind.CHILD_LIST, SlotKind.NAMED_CHILD_ARRAY}
)


def _child_slot_keys(graph: CatalogDecisionGraph) -> frozenset[str]:
    """Property names the catalogs declare as child component slots."""
    return frozenset(
        slot.name
        for spec in graph.root_candidates()
        for slot in spec.slots
        if slot.kind in _CHILD_SLOT_KINDS
    )


def _require_v10(graph: CatalogDecisionGraph) -> None:
    """Raises `ValueError` unless every catalog targets A2UI protocol v1.0."""
    others = [
        f"{c.catalog_id} ({c.protocol_version})"
        for c in graph.catalogs
        if not _is_v10(str(c.protocol_version))
    ]
    if others:
        raise ValueError(
            "The decision format supports A2UI protocol v1.0 only; these catalogs"
            f" use another version: {', '.join(others)}."
        )


def _abstention_reason(abstained: SynthesisOutput) -> str:
    """The last planning outcome recorded in the trace, as the fallback reason."""
    if abstained.fallback_reason:
        return abstained.fallback_reason
    for record in reversed(abstained.trace):
        if record.outcome:
            return record.outcome
    return "no layout plan"


def _creates_surface(
    messages: Sequence[AgentToRendererMessage], surface_id: str
) -> bool:
    """Returns whether `messages` contain a `createSurface` envelope for `surface_id`."""
    return any(
        isinstance(d.get("createSurface"), Mapping)
        and d["createSurface"].get("surfaceId") == surface_id
        for d in to_message_dicts(messages)
    )


def _extract_components_from_messages(
    messages: Sequence[AgentToRendererMessage],
) -> tuple[dict[str, Any], ...]:
    """Extracts the component dicts emitted by `messages`."""
    for d in to_message_dicts(messages):
        upd = d.get("updateComponents")
        if isinstance(upd, Mapping) and isinstance(upd.get("components"), list):
            return tuple(copy_lib.deepcopy(dict(c)) for c in upd["components"])
        create = d.get("createSurface")
        if isinstance(create, Mapping) and isinstance(create.get("components"), list):
            return tuple(copy_lib.deepcopy(dict(c)) for c in create["components"])
    return ()


def _creates_with_send_data_model(
    messages: Sequence[AgentToRendererMessage],
) -> bool:
    """Whether `messages` set `sendDataModel: true` on `createSurface`."""
    return any(
        isinstance(d.get("createSurface"), Mapping)
        and bool(d["createSurface"].get("sendDataModel"))
        for d in to_message_dicts(messages)
    )


@dataclass(frozen=True)
class _SurfaceRequest:
    """Per-call settings that `synthesize` threads through planning and output."""

    surface_id: str
    brief: LayoutBrief | None = None
    copy: AuthoredCopy | None = None
    actions: tuple[ActionSpec, ...] = ()
    operation: SurfaceOperation = SurfaceOperation.CREATE
    surface_sends_data_model: bool = False
    labels: Mapping[str, str] = field(default_factory=dict, hash=False)
    region: str | None = None


def _is_excluded_path(path: str, exclude: Collection[str]) -> bool:
    """Returns whether `path` equals or is nested under any entry in `exclude`."""
    return any(path == ex or path.startswith(f"{ex}/") for ex in exclude)


def _is_excluded_array_element(
    array_path: str, element_key: str, exclude: Collection[str]
) -> bool:
    """Returns whether `element_key` under `array_path` is excluded by `exclude`."""
    return _is_excluded_path(
        f"{array_path}/0/{element_key}", exclude
    ) or _is_excluded_path(f"{array_path}/{element_key}", exclude)


def _filter_array_sample_pointers(
    ptr: PointerSummary, exclude: Collection[str]
) -> PointerSummary:
    """Filters excluded subpaths out of an array pointer's element keys and samples."""
    kept_samples = tuple(
        sp for sp in ptr.sample_pointers if not _is_excluded_path(sp, exclude)
    )
    kept_keys = tuple(
        k
        for k in ptr.element_keys
        if not _is_excluded_array_element(ptr.path, k, exclude)
    )
    if len(kept_samples) == len(ptr.sample_pointers) and len(kept_keys) == len(
        ptr.element_keys
    ):
        return ptr
    # Remove excluded array element subpaths so array blocks cannot bind them.
    kept_key_set = set(kept_keys)
    return replace(
        ptr,
        sample_pointers=kept_samples,
        element_keys=kept_keys,
        sample_type_by_key={
            k: v for k, v in ptr.sample_type_by_key.items() if k in kept_key_set
        },
        element_semantic_types={
            k: v for k, v in ptr.element_semantic_types.items() if k in kept_key_set
        },
    )


def _without_excluded(
    pointers: Sequence[PointerSummary], exclude: Collection[str]
) -> tuple[PointerSummary, ...]:
    """Drops pointers and `sample_pointers` equal to or nested under `exclude`."""
    if not exclude:
        return tuple(pointers)
    return tuple(
        _filter_array_sample_pointers(p, exclude)
        for p in pointers
        if not _is_excluded_path(p.path, exclude)
    )


def _without_non_mutable_secrets(
    pointers: Sequence[PointerSummary],
) -> tuple[PointerSummary, ...]:
    """Strips secret pointers unless the caller explicitly marked them mutable."""
    return tuple(p for p in pointers if p.mutable_hint or not is_secret_pointer(p))


def _unrolled_array_cardinalities_match(
    plan: LayoutPlan, pointers: Sequence[PointerSummary]
) -> bool:
    """Returns whether every statically unrolled array slot matches `pointers` cardinality."""
    # Blocks such as `steps` and primitive scalar arrays unroll one component
    # subtree per item at plan time (capped at 25), so a length change within
    # the same cardinality bucket must miss the cache and re-plan.
    cardinalities = {p.path: p.cardinality for p in pointers if p.value_type == "array"}
    for block in plan.blocks:
        for slot in block.bindings.slots.values():
            if slot.pointer and slot.items:
                expected = min(cardinalities.get(slot.pointer, -1), 25)
                if len(slot.items) != expected:
                    return False
    return True


def _with_labels(
    pointers: Sequence[PointerSummary], labels: Mapping[str, str] | None
) -> tuple[PointerSummary, ...]:
    """Overrides `PointerSummary.label` for pointers named in `labels`."""
    if not labels:
        return tuple(pointers)
    return tuple(
        replace(p, label=labels[p.path]) if p.path in labels else p for p in pointers
    )


def resolve_surface_operation(
    requested: SurfaceOperation,
    *,
    send_data_model: bool,
    surface_sends_data_model: bool,
) -> SurfaceOperation:
    """Applies the escalation rule to the operation the caller asked for.

    `UPDATE_ROOT` keeps the existing surface, and `sendDataModel` can only be
    set by `createSurface`. When the new root needs `sendDataModel` (some
    submit action resolves to no context bindings) and the surface was
    created without it, the update escalates to `REPLACE`, which deletes
    and recreates the surface with the flag set. Every other case keeps the
    requested operation.
    """
    if (
        requested is SurfaceOperation.UPDATE_ROOT
        and send_data_model
        and not surface_sends_data_model
    ):
        return SurfaceOperation.REPLACE
    return requested


def _as_fresh_surface(
    messages: list[AgentToRendererMessage], request: _SurfaceRequest
) -> tuple[list[AgentToRendererMessage], SurfaceOperation]:
    """Prepends `deleteSurface` when fallback messages recreate an existing surface.

    Fallback messages (Express DSL or a host callback) usually start with
    `createSurface`. On a surface the client already shows, that would be
    rejected, so the output becomes a `REPLACE`.
    """
    if request.operation is SurfaceOperation.CREATE or not _creates_surface(
        messages, request.surface_id
    ):
        return messages, request.operation
    delete = to_message_models(
        [{"version": _WIRE_VERSION, "deleteSurface": {"surfaceId": request.surface_id}}]
    )
    return [*delete, *messages], SurfaceOperation.REPLACE


class DecisionSynthesizer:
    """Catalog-agnostic local decision-model A2UI surface synthesizer.

    Surface operations: `synthesize` takes the `SurfaceOperation` the caller
    decided from its renderer state (`CREATE` for a new surface,
    `UPDATE_ROOT` for one the client already shows, `REPLACE` when the block
    asks for it). An `UPDATE_ROOT` whose new root needs `sendDataModel` on a
    surface created without it escalates to `REPLACE`; see
    `resolve_surface_operation`. `SynthesisOutput.operation` reports the
    operation actually emitted.

    Attributes:
        graph: The catalog decision graph the synthesizer selects from.
        backend: The decision backend that answers question batches.
        registry: The surface templates offered to the template question.
        config: Host-level synthesis settings.
        archetypes: The layout archetype grammar.
        patterns: The catalog pattern library for expanding planned blocks.
        planner: The speculative layout planner.
        expander: The pattern template expander.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi] | CatalogDecisionGraph,
        backend: DecisionBackend,
        *,
        registry: TemplateRegistry | None = None,
        config: SynthesisConfig | None = None,
        archetypes: ArchetypeGrammar | None = None,
        patterns: PatternLibrary | MergedPatternLibrary | None = None,
        fallback_fn: FallbackCallback | None = None,
        plan_cache: PlanCache | None = None,
    ) -> None:
        """Creates a synthesizer.

        Args:
            catalogs: The active catalogs, or a `CatalogDecisionGraph` already
                built from them.
            backend: The decision backend. Required; use `from_env` to build
                one from the `A2UI_DECISION_*` environment variables.
            registry: Surface templates offered to the template question.
            config: Host-level `SynthesisConfig`.
            archetypes: Layout archetype grammar. Defaults to
                `ArchetypeGrammar.default()`.
            patterns: Catalog pattern library. Defaults to
                `MergedPatternLibrary.for_catalogs(graph.catalogs)`.
            fallback_fn: Called with `(intent, payload, surface_id)` when the
                model abstains and no `fallback_dsl` was given; its messages
                are rendered instead.
            plan_cache: Cache of layout plans scoped per `RendererState`.

        Raises:
            TypeError: If `backend` is None.
            ValueError: If any catalog's protocol version is not v1.0.
        """
        if backend is None:
            raise TypeError(
                "DecisionSynthesizer requires a decision backend; pass one or use"
                " DecisionSynthesizer.from_env()."
            )
        self.graph = (
            catalogs
            if isinstance(catalogs, CatalogDecisionGraph)
            else CatalogDecisionGraph(catalogs)
        )
        _require_v10(self.graph)
        self.backend: DecisionBackend = backend
        self.registry = registry if registry is not None else TemplateRegistry()
        self.config = config if config is not None else SynthesisConfig()
        self.archetypes = (
            archetypes if archetypes is not None else ArchetypeGrammar.default()
        )
        self.patterns: PatternLibrary | MergedPatternLibrary = (
            patterns
            if patterns is not None
            else MergedPatternLibrary.for_catalogs(self.graph.catalogs)
        )
        self.planner = LayoutPlanner(
            self.archetypes, self.config, capabilities=self.patterns
        )
        self.expander = PatternExpander(
            self.patterns, self.graph, grammar=self.archetypes
        )
        self._fallback_fn = fallback_fn
        self.plan_cache: PlanCache = (
            plan_cache if plan_cache is not None else PlanCache()
        )
        self._stateless_plans: dict[str, tuple[PlanCacheKey, CachedPlan]] = {}
        self._child_slot_keys = _child_slot_keys(self.graph)
        self._eligibility_cache: collections.OrderedDict[
            tuple[Any, ...], tuple[LayoutArchetype, ...]
        ] = collections.OrderedDict()

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
        fallback_fn: FallbackCallback | None = None,
        plan_cache: PlanCache | None = None,
    ) -> DecisionSynthesizer:
        """Constructs a synthesizer, building the backend from the environment.

        When `backend` is None, `create_decision_backend()` builds it, which
        raises `ValueError` unless `A2UI_DECISION_BACKEND` is set.
        """
        return cls(
            catalogs,
            backend if backend is not None else create_decision_backend(),
            registry=registry,
            config=config,
            archetypes=archetypes,
            patterns=patterns,
            fallback_fn=fallback_fn,
            plan_cache=plan_cache,
        )

    def cache_catalog_id(self) -> str:
        """Returns the catalog identifier used in `PlanCacheKey.catalog_id`."""
        if self.graph.surface_catalog_id is not None:
            return self.graph.surface_catalog_id
        return ",".join(c.catalog_id for c in self.graph.catalogs)

    def make_cache_key(
        self,
        surface_id: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        actions: Sequence[ActionSpec] = (),
        exclude: Collection[str] = (),
        mutable_paths: Collection[str] = (),
        labels: Mapping[str, str] | None = None,
        layout: LayoutBrief | Sequence[str] | None = None,
        title: str | None = None,
        summary: str | None = None,
    ) -> PlanCacheKey:
        """Builds the `PlanCacheKey` for a synthesis request."""
        if isinstance(layout, LayoutBrief):
            layout_items: Sequence[str] = layout.to_items()
        elif layout is None:
            layout_items = ()
        else:
            layout_items = tuple(layout)
        sig = plan_shape_signature(
            pointers,
            intent=intent,
            actions=actions,
            exclude=exclude,
            mutable_paths=mutable_paths,
            labels=labels,
            layout=layout_items,
            title=title,
            summary=summary,
            template_ids=[t.template_id for t in self.registry.list_templates()],
            conservativeness=self.config.conservativeness,
            model_id=self.backend.model_id,
        )
        return PlanCacheKey(
            surface_id=surface_id,
            catalog_id=self.cache_catalog_id(),
            grammar_version=self.archetypes.version,
            shape_signature=sig,
        )

    async def synthesize(
        self,
        intent: str,
        payload: Mapping[str, Any] | Sequence[Any] | str,
        *,
        surface_id: str | None = None,
        actions: Sequence[ActionSpec] = (),
        exclude: Sequence[str] = (),
        mutable_paths: Collection[str] = (),
        layout: LayoutBrief | Sequence[str] | None = None,
        title: str | None = None,
        summary: str | None = None,
        fallback_dsl: str | None = None,
        operation: SurfaceOperation = SurfaceOperation.CREATE,
        surface_sends_data_model: bool = False,
        labels: Mapping[str, str] | None = None,
        region: str | None = None,
        state: RendererState | None = None,
    ) -> SynthesisOutput:
        """Synthesizes validated A2UI messages for one decision block.

        Args:
            intent: Natural-language description of the UI to render.
            payload: The data to bind. A mapping is used as the surface data
                model; a JSON array is stored under the `items` key; a
                JSON-encoded string of either is decoded first.
            surface_id: Target surface. Defaults to
                `config.default_surface_id`.
            actions: The actions the block declared, in order.
            exclude: JSON Pointers the surface must not show; they and their
                descendants are dropped before planning.
            mutable_paths: JSON Pointers the user may edit.
            layout: Optional `LayoutBrief` (or `'role:key,key'` string
                sequence) pinning roles to payload pointers.
            title: Optional authored surface title.
            summary: Optional authored surface summary or caption.
            fallback_dsl: A2UI Express rendered when the model abstains.
            operation: How the messages change the client's surface, decided
                by the caller from its renderer state.
            surface_sends_data_model: Whether the existing surface was created
                with `sendDataModel`; read only for the `UPDATE_ROOT`
                escalation rule.
            labels: Display labels keyed by JSON Pointer, overriding the
                humanized keys.
            region: Id of one planned block to re-plan on an existing surface.
            state: Optional `RendererState` of the active conversation, used
                to scope `self.plan_cache`.

        Returns:
            The synthesis result, stamped with the backend's kind and model
            id and the operation emitted.

        Raises:
            ValueError: If a string payload is not valid JSON, `layout`
                fails brief validation, or `region` has no cached plan or is
                absent from the cached plan.
            TypeError: If the payload is neither an object nor an array.
            DecisionBackendError: If the backend times out or fails.
        """
        target_surface_id = (
            surface_id if surface_id is not None else self.config.default_surface_id
        )
        operation, surface_sends_data_model = self._infer_state_operation(
            state, target_surface_id, operation, surface_sends_data_model
        )
        request = _SurfaceRequest(
            surface_id=target_surface_id,
            brief=_coerce_layout_brief(layout, self.archetypes),
            copy=(
                AuthoredCopy(title=title, summary=summary)
                if (title is not None or summary is not None)
                else None
            ),
            actions=tuple(actions),
            operation=operation,
            surface_sends_data_model=surface_sends_data_model,
            labels=dict(labels) if labels else {},
            region=region,
        )
        data = _as_data_model(payload)
        pointers = _without_non_mutable_secrets(
            _with_labels(
                _without_excluded(
                    inspect_payload_pointers(data, mutable_paths=mutable_paths or ()),
                    exclude,
                ),
                request.labels,
            )
        )
        if operation is SurfaceOperation.REPLACE:
            self._invalidate_surface_cache(state, target_surface_id)
        if region is not None:
            return await self._synthesize_region(
                intent, data, pointers, request, state=state
            )
        cache_key = self.make_cache_key(
            target_surface_id,
            intent,
            pointers,
            actions=request.actions,
            exclude=exclude,
            mutable_paths=mutable_paths,
            labels=request.labels,
            layout=request.brief,
            title=request.copy.title if request.copy is not None else None,
            summary=request.copy.summary if request.copy is not None else None,
        )
        if operation is SurfaceOperation.UPDATE_ROOT and state is not None:
            cached = self.plan_cache.get(state, cache_key)
            if cached is not None and _unrolled_array_cardinalities_match(
                cached.plan, pointers
            ):
                return self._cached_data_only_output(cached, target_surface_id, data)
        return await self._run_full_synthesis(
            intent,
            data,
            pointers,
            request,
            fallback_dsl=fallback_dsl,
            state=state,
            cache_key=cache_key,
        )

    def _infer_state_operation(
        self,
        state: RendererState | None,
        surface_id: str,
        operation: SurfaceOperation,
        surface_sends_data_model: bool,
    ) -> tuple[SurfaceOperation, bool]:
        """Infers `UPDATE_ROOT` and existing `sendDataModel` when `surface_id` is in `state`."""
        if state is None or operation is not SurfaceOperation.CREATE:
            return operation, surface_sends_data_model
        existing = state.get_surface(surface_id)
        if existing is None:
            return operation, surface_sends_data_model
        return SurfaceOperation.UPDATE_ROOT, bool(existing.send_data_model)

    def _invalidate_surface_cache(
        self, state: RendererState | None, surface_id: str
    ) -> None:
        """Evicts cached plans for `surface_id` from `plan_cache` and `_stateless_plans`."""
        if state is not None:
            self.plan_cache.invalidate(state, surface_id)
        self._stateless_plans.pop(surface_id, None)

    async def _run_full_synthesis(
        self,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        request: _SurfaceRequest,
        *,
        fallback_dsl: str | None,
        state: RendererState | None,
        cache_key: PlanCacheKey,
    ) -> SynthesisOutput:
        """Executes full-surface synthesis, caches the plan, or runs the fallback chain."""
        timings: list[float] = []
        token = _DECISION_CALL_TIMINGS.set(timings)
        try:
            output = await self._synthesize_from_catalog(
                intent, data, pointers, request
            )
        finally:
            _DECISION_CALL_TIMINGS.reset(token)

        output = replace(
            output,
            decision_latency_ms=sum(timings),
            decision_calls=len(timings),
            backend_kind=self.backend.backend_kind,
            model_id=self.backend.model_id,
        )
        if output.messages:
            self._store_cached_plan(state, cache_key, output)
            return output
        self._invalidate_surface_cache(state, request.surface_id)
        return await self._fallback(
            output, intent, data, pointers, request, fallback_dsl
        )

    def _store_cached_plan(
        self,
        state: RendererState | None,
        cache_key: PlanCacheKey,
        output: SynthesisOutput,
    ) -> CachedPlan | None:
        """Builds and stores a `CachedPlan` from `output` when it produced components."""
        if output.layout_plan is None or not output.messages:
            return None
        components = _extract_components_from_messages(output.messages)
        if not components:
            return None
        existing_ids: frozenset[str] = frozenset()
        if state is not None and output.operation is SurfaceOperation.UPDATE_ROOT:
            surface = state.get_surface(cache_key.surface_id)
            if surface is not None:
                existing_ids = frozenset(surface.components_model.keys)
        entry = CachedPlan(
            plan=output.layout_plan,
            components=components,
            send_data_model=_creates_with_send_data_model(output.messages),
            trace=output.trace,
            decision_answers=output.decision_answers,
            entropy=output.entropy,
            all_surface_ids=existing_ids,
        )
        if state is not None:
            self.plan_cache.put(state, cache_key, entry)
        self._stateless_plans[cache_key.surface_id] = (cache_key, entry)
        return entry

    def _cached_data_only_output(
        self,
        cached: CachedPlan,
        surface_id: str,
        data: Mapping[str, Any],
    ) -> SynthesisOutput:
        """Emits only `updateDataModel` for an `UPDATE_ROOT` cache hit."""
        raw_messages = [{
            "version": _WIRE_VERSION,
            "updateDataModel": {
                "surfaceId": surface_id,
                "path": "/",
                "value": dict(data),
            },
        }]
        messages = to_message_models(raw_messages)
        validate_payload(self.graph.catalogs, messages)
        stage = (
            SynthesisStage.TEMPLATE_SELECT
            if cached.plan.template_id is not None
            else SynthesisStage.ARCHETYPE
        )
        return SynthesisOutput(
            stage=stage,
            messages=messages,
            confidence=cached.plan.confidence,
            entropy=cached.entropy,
            selected_template_id=cached.plan.template_id,
            layout_plan=cached.plan,
            trace=cached.trace,
            decision_answers=cached.decision_answers,
            operation=SurfaceOperation.UPDATE_ROOT,
            cache_hit=True,
            backend_kind=self.backend.backend_kind,
            model_id=self.backend.model_id,
            decision_calls=0,
            decision_latency_ms=0.0,
        )

    def render_cached_tool_plan(
        self,
        cached: CachedPlan,
        surface_id: str,
        data: Mapping[str, Any],
        operation: SurfaceOperation = SurfaceOperation.CREATE,
    ) -> SynthesisOutput:
        """Renders a cached tool-mode plan with new `data` and zero backend calls."""
        components = [copy_lib.deepcopy(dict(c)) for c in cached.components]
        messages = self._build_validated_messages(
            surface_id,
            components,
            data,
            operation,
            send_data_model=cached.send_data_model,
        )
        stage = (
            SynthesisStage.TEMPLATE_SELECT
            if cached.plan.template_id is not None
            else SynthesisStage.ARCHETYPE
        )
        return SynthesisOutput(
            stage=stage,
            messages=messages,
            confidence=cached.plan.confidence,
            entropy=cached.entropy,
            selected_template_id=cached.plan.template_id,
            layout_plan=cached.plan,
            trace=cached.trace,
            decision_answers=cached.decision_answers,
            operation=operation,
            cache_hit=True,
            backend_kind=self.backend.backend_kind,
            model_id=self.backend.model_id,
            decision_calls=0,
            decision_latency_ms=0.0,
        )

    def _lookup_region_plan(
        self, state: RendererState | None, surface_id: str
    ) -> tuple[PlanCacheKey, CachedPlan]:
        """Returns the cached `(PlanCacheKey, CachedPlan)` for a region update on `surface_id`."""
        found = (
            self.plan_cache.get_for_surface(
                state,
                surface_id,
                catalog_id=self.cache_catalog_id(),
                grammar_version=self.archetypes.version,
            )
            if state is not None
            else self._stateless_plans.get(surface_id)
        )
        if found is None or found[1].plan.template_id is not None:
            raise ValueError(
                f"Cannot update region on surface {surface_id!r}: no cached"
                " layout plan for this surface."
            )
        return found

    def _existing_block_prefix(
        self, cached: CachedPlan, block_id: str, pattern: str
    ) -> tuple[str, str | None]:
        """Returns `(id_prefix, owner_catalog_id)` preserving the cached block root prefix."""
        default_prefix, owner = self._block_prefix_and_owner(block_id, pattern)
        if self.graph.surface_catalog_id is not None:
            return default_prefix, owner
        # Preserve the existing block root prefix wired into `root.children`
        # even if a multi-catalog region re-plan resolves to a different owner.
        candidate_roots = {
            f"{block_id}_root",
            *(
                f"{_catalog_slug(c.catalog_id)}_{block_id}_root"
                for c in self.graph.catalogs
            ),
        }
        for comp in cached.components:
            cid = comp.get("id")
            if isinstance(cid, str) and cid in candidate_roots:
                return cid.removesuffix("_root"), owner
        return default_prefix, owner

    def _region_tainted_cache_key(
        self,
        existing_key: PlanCacheKey,
        region: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        request: _SurfaceRequest,
    ) -> PlanCacheKey:
        """Builds a region-tainted `PlanCacheKey` so full-surface turns miss after region edits."""
        region_key = self.make_cache_key(
            request.surface_id,
            intent,
            pointers,
            actions=request.actions,
            labels=request.labels,
            layout=request.brief,
            title=request.copy.title if request.copy is not None else None,
            summary=request.copy.summary if request.copy is not None else None,
        )
        return replace(
            existing_key,
            shape_signature=f"region:{region}:{region_key.shape_signature}",
        )

    async def _synthesize_region(
        self,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        request: _SurfaceRequest,
        *,
        state: RendererState | None,
    ) -> SynthesisOutput:
        """Re-plans only `request.region` against the cached plan and updates its subtree."""
        region = request.region or ""
        existing_key, cached = self._lookup_region_plan(state, request.surface_id)
        if region not in cached.plan.block_ids():
            raise ValueError(
                f"Surface {request.surface_id!r} plan ({cached.plan.archetype!r})"
                f" has no block {region!r}; active blocks are"
                f" {list(cached.plan.block_ids())}."
            )
        timings: list[float] = []
        token = _DECISION_CALL_TIMINGS.set(timings)
        try:
            new_block, trace, answers = await self._plan_region_block(
                cached.plan, region, intent, data, pointers, request
            )
        finally:
            _DECISION_CALL_TIMINGS.reset(token)

        prefix, owner = self._existing_block_prefix(
            cached, new_block.block_id, new_block.pattern
        )
        expanded = self.expander.expand_block(
            new_block.block_id,
            new_block.pattern,
            new_block.bindings,
            new_block.variant_knobs,
            new_block.instances,
            prefix,
        )
        if not expanded.components:
            raise ValueError(
                f"Region {region!r} expanded to no components on surface"
                f" {request.surface_id!r}."
            )
        self._stamp_multi_catalog_id(expanded.components, owner)
        messages = self._build_validated_messages(
            request.surface_id,
            list(expanded.components),
            data,
            SurfaceOperation.UPDATE_ROOT,
        )
        updated_plan = replace(
            cached.plan,
            blocks=tuple(
                new_block if b.block_id == region else b for b in cached.plan.blocks
            ),
        )
        updated_comps = replace_block_components(
            cached.components, prefix, expanded.components
        )
        new_ids = frozenset(
            str(c["id"]) for c in expanded.components if isinstance(c.get("id"), str)
        )
        updated_entry = replace(
            cached,
            plan=updated_plan,
            components=updated_comps,
            all_surface_ids=cached.all_surface_ids | new_ids,
        )
        tainted_key = self._region_tainted_cache_key(
            existing_key, region, intent, pointers, request
        )
        if state is not None:
            self.plan_cache.invalidate(state, request.surface_id)
            self.plan_cache.put(state, tainted_key, updated_entry)
        self._stateless_plans[request.surface_id] = (tainted_key, updated_entry)
        return SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=messages,
            confidence=cached.plan.confidence,
            entropy=cached.entropy,
            layout_plan=updated_plan,
            trace=trace,
            decision_answers=answers,
            operation=SurfaceOperation.UPDATE_ROOT,
            decision_latency_ms=sum(timings),
            decision_calls=len(timings),
            backend_kind=self.backend.backend_kind,
            model_id=self.backend.model_id,
        )

    async def _plan_region_block(
        self,
        plan: LayoutPlan,
        block_id: str,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        request: _SurfaceRequest,
    ) -> tuple[PlannedBlock, tuple[DecisionRecord, ...], tuple[DecisionAnswer, ...]]:
        """Plans a single block via `planner.build_block_batch` and `read_block`."""
        batch, p_state = self.planner.build_block_batch(
            plan,
            block_id,
            pointers,
            intent=intent,
            labels=request.labels or None,
            payload=data,
            actions=request.actions,
        )
        answers = await self._backend_answer(batch)
        block = self.planner.read_block(p_state, answers)
        return block, tuple(p_state.trace), tuple(p_state.answers_by_id.values())

    async def _backend_answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Calls `self.backend.answer` and records elapsed decision latency."""
        started = time.perf_counter()
        answers = await self.backend.answer(batch)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        reported_ms = getattr(self.backend, "last_call_latency_ms", None)
        if (
            isinstance(reported_ms, (int, float))
            and 0.0 < float(reported_ms) < elapsed_ms
        ):
            elapsed_ms = float(reported_ms)
        timings = _DECISION_CALL_TIMINGS.get()
        if timings is not None:
            timings.append(elapsed_ms)
        return answers

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
            """Runs `synthesize` and closes loop-bound backend resources."""
            try:
                return await self.synthesize(intent, payload, **kwargs)
            finally:
                await self.backend.aclose_current_loop()

        def run_in_new_loop() -> SynthesisOutput:
            """Executes `_run` inside a fresh `asyncio` event loop."""
            return asyncio.run(_run())

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return run_in_new_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(run_in_new_loop).result()

    def _render_template(
        self,
        plan: LayoutPlan,
        state: PlannerState,
        data: Mapping[str, Any],
        request: _SurfaceRequest,
    ) -> SynthesisOutput:
        """Renders the registered template the plan's template question chose.

        The template's components go through the same message builder as an
        expanded plan, so all three surface operations apply. A mutable
        template sets `sendDataModel` on `createSurface` and escalates
        `UPDATE_ROOT` to `REPLACE` when the existing surface lacks it.

        Raises:
            ValueError: If `plan.template_id` names no registered template.
        """
        template_id = plan.template_id or ""
        template = self.registry.get(template_id)
        if template is None:
            known = ", ".join(t.template_id for t in self.registry.list_templates())
            raise ValueError(
                f"Unknown template '{template_id}'. Registered templates:"
                f" {known or 'none'}."
            )
        components = [copy_lib.deepcopy(dict(c)) for c in template.components]
        self._stamp_multi_catalog_id(components, template.catalog_id)
        operation = resolve_surface_operation(
            request.operation,
            send_data_model=template.is_mutable,
            surface_sends_data_model=request.surface_sends_data_model,
        )
        messages = self._build_validated_messages(
            request.surface_id,
            components,
            data,
            operation,
            send_data_model=template.is_mutable,
        )
        _, entropy = _archetype_confidence_and_entropy(state, plan)
        return SynthesisOutput(
            stage=SynthesisStage.TEMPLATE_SELECT,
            messages=messages,
            confidence=plan.confidence,
            entropy=entropy,
            selected_template_id=template.template_id,
            layout_plan=plan,
            trace=tuple(state.trace),
            decision_answers=tuple(state.answers_by_id.values()),
            operation=operation,
        )

    async def _fallback(
        self,
        abstained: SynthesisOutput,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        request: _SurfaceRequest,
        fallback_dsl: str | None,
    ) -> SynthesisOutput:
        """Runs the fallback chain for an abstained output.

        Order: the block's `fallback_dsl`, then the configured `fallback_fn`,
        then one `facts` pattern rendering of the payload from the active
        pattern library. A link that yields no messages passes to the next.
        `fallback_source` names the link that produced the
        messages and `fallback_reason` why the chain ran.

        Raises:
            A2uiCompilationError: If no link produced messages.
        """
        reason = _abstention_reason(abstained)
        if fallback_dsl and fallback_dsl.strip():
            messages = self._compile_fallback_dsl(
                fallback_dsl, data, request.surface_id
            )
            if messages:
                return self._fallback_output(
                    abstained, messages, FallbackSource.DSL, reason, request
                )
        if self._fallback_fn is not None:
            messages = await self._run_fallback_fn(intent, data, request.surface_id)
            if messages:
                return self._fallback_output(
                    abstained, messages, FallbackSource.CALLBACK, reason, request
                )
        facts = self._facts_fallback(intent, data, pointers, request)
        if facts is not None:
            messages, operation = facts
            return replace(
                abstained,
                messages=messages,
                operation=operation,
                fallback_source=FallbackSource.FACTS,
                fallback_reason=reason,
            )
        raise A2uiCompilationError(
            message=(
                f"The decision model abstained ({reason}) and no fallback produced"
                " messages."
            ),
            raw_content=intent,
            help_message=_ABSTAIN_HELP,
        )

    def _fallback_output(
        self,
        abstained: SynthesisOutput,
        messages: list[AgentToRendererMessage],
        source: FallbackSource,
        reason: str,
        request: _SurfaceRequest,
    ) -> SynthesisOutput:
        """Wraps fallback messages, recreating an existing surface when they create it."""
        messages, operation = _as_fresh_surface(messages, request)
        return replace(
            abstained,
            messages=messages,
            operation=operation,
            fallback_source=source,
            fallback_reason=reason,
        )

    async def _run_fallback_fn(
        self, intent: str, data: Mapping[str, Any], surface_id: str
    ) -> list[AgentToRendererMessage]:
        """Calls the host fallback callback and validates its messages."""
        assert self._fallback_fn is not None
        produced = self._fallback_fn(intent, data, surface_id)
        if inspect.isawaitable(produced):
            produced = await produced
        messages = to_message_models(list(produced))
        validate_payload(self.graph.catalogs, messages)
        return messages

    def _facts_fallback(
        self,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        request: _SurfaceRequest,
    ) -> tuple[list[AgentToRendererMessage], SurfaceOperation] | None:
        """Renders the payload as one `facts` block, or None when that is impossible.

        Uses the grammar's `facts` block, its pattern fallback chain in the
        active library, and the planner's deterministic slot binding; no
        model call is made.
        """
        plan = self._facts_plan(intent, data, pointers, request)
        if plan is None:
            return None
        try:
            expansion = self._expand_plan(plan)
            operation = resolve_surface_operation(
                request.operation,
                send_data_model=expansion.send_data_model,
                surface_sends_data_model=request.surface_sends_data_model,
            )
            messages = self._build_validated_messages(
                request.surface_id,
                list(expansion.components),
                data,
                operation,
                send_data_model=expansion.send_data_model,
            )
        except (PatternError, A2uiValidationError):
            return None
        return messages, operation

    def _facts_plan(
        self,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        request: _SurfaceRequest,
    ) -> LayoutPlan | None:
        """Builds a one-block `facts` plan bound to `pointers`, if the catalog can draw it."""
        if _FACTS_BLOCK not in self.archetypes.blocks:
            return None
        spec = self.archetypes.block(_FACTS_BLOCK)
        resolved = resolve_fallback_pattern(spec, self.patterns)
        if resolved is None:
            return None
        visible = [p for p in pointers if not is_secret_pointer(p)]
        bindings = self.planner.bind_slots(
            spec, visible, set(), payload=data, intent=intent
        )
        if not bindings.pointers():
            return None
        title = request.copy.title if request.copy is not None else None
        return LayoutPlan(
            archetype=_FACTS_BLOCK,
            family="",
            blocks=(
                PlannedBlock(
                    block_id=_FACTS_BLOCK,
                    pattern=resolved.pattern,
                    variant_knobs=resolved.knobs,
                    bindings=bindings,
                ),
            ),
            page=PageBindings(title=SlotBinding(literal=title)),
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
                    "version": _WIRE_VERSION,
                    "updateDataModel": {
                        "surfaceId": surface_id,
                        "path": "/",
                        "value": dict(data),
                    },
                }])
            )
        validate_payload(self.graph.catalogs, messages)
        return messages

    async def _plan_layout(
        self,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        request: _SurfaceRequest,
    ) -> tuple[PlanOutcome, PlannerState]:
        """Builds the batch, calls `backend.answer`, and reads the plan.

        One `answer` call, or two when `backend.capabilities.two_stage` is
        set (family and archetype first, then the winning archetype's
        questions).
        """
        planner = self.planner
        templates = self.registry.matching_templates([p.path for p in pointers])
        if self.backend.capabilities.two_stage:
            stage1_batch, state = planner.build_stage1_batch(
                intent,
                pointers,
                brief=request.brief,
                payload=data,
                copy=request.copy,
                templates=templates,
                actions=request.actions,
                labels=request.labels or None,
            )
            stage1_answers = await self._backend_answer(stage1_batch)
            stage2_batch = planner.build_stage2_batch(state, stage1_answers)
            stage2_answers = (
                await self._backend_answer(stage2_batch)
                if stage2_batch.questions
                else ()
            )
            answers: tuple[DecisionAnswer, ...] = (*stage1_answers, *stage2_answers)
        else:
            batch, state = planner.build_batch(
                intent,
                pointers,
                brief=request.brief,
                payload=data,
                copy=request.copy,
                templates=templates,
                actions=request.actions,
                labels=request.labels or None,
            )
            answers = await self._backend_answer(batch)
        return planner.read(state, answers), state

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
        """Assigns `@catalogId` to expanded components on multi-catalog surfaces."""
        if self.graph.surface_catalog_id is not None:
            return
        default_cat = owner or (
            self.graph.catalogs[0].catalog_id if self.graph.catalogs else None
        )
        if default_cat is None:
            return
        comp_cat_key = envelope_key("catalogId", True)
        for comp in comps:
            comp.setdefault(comp_cat_key, default_cat)
            _stamp_function_calls(comp, default_cat)

    def _expand_plan(self, plan: LayoutPlan) -> Expansion:
        """Expands every `PlannedBlock` and the `page` frame through `self.expander`.

        The result lists the page components first, then each block's, and
        carries the page expansion's surface-wide `send_data_model`.
        """
        block_roots: list[str] = []
        block_expansions: list[Expansion] = []
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
            if expanded.components:
                self._stamp_multi_catalog_id(expanded.components, owner)
                block_roots.append(str(expanded.components[0]["id"]))
                block_expansions.append(expanded)
        page_owner = (
            self.patterns.owner_catalog_id("page")
            if isinstance(self.patterns, MergedPatternLibrary)
            else None
        )
        page = self.expander.expand_page(
            plan.page, block_roots=block_roots, blocks=block_expansions
        )
        self._stamp_multi_catalog_id(page.components, page_owner)
        components = list(page.components)
        for expansion in block_expansions:
            components.extend(expansion.components)
        return Expansion(components=components, send_data_model=page.send_data_model)

    def _lint_trace(
        self, plan: LayoutPlan, state: PlannerState, components: list[dict[str, Any]]
    ) -> tuple[list[DecisionRecord], bool]:
        """Runs `lint_components`, returning the trace with findings and whether any is an error."""
        trace = list(state.trace)
        has_error = False
        for finding in lint_components(
            components, plan, child_slot_keys=self._child_slot_keys
        ):
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
            has_error = has_error or finding.severity == "error"
        return trace, has_error

    def _finish_archetype_output(
        self,
        plan: LayoutPlan,
        state: PlannerState,
        expansion: Expansion,
        data: Mapping[str, Any],
        request: _SurfaceRequest,
    ) -> SynthesisOutput:
        """Lints, validates the wire messages, and builds the `SynthesisOutput`."""
        components = list(expansion.components)
        trace, has_error = self._lint_trace(plan, state, components)
        conf, entropy = _archetype_confidence_and_entropy(state, plan)
        if has_error:
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=conf,
                entropy=entropy,
                layout_plan=plan,
                trace=tuple(trace),
                decision_answers=tuple(state.answers_by_id.values()),
            )
        operation = resolve_surface_operation(
            request.operation,
            send_data_model=expansion.send_data_model,
            surface_sends_data_model=request.surface_sends_data_model,
        )
        messages = self._build_validated_messages(
            request.surface_id,
            components,
            data,
            operation,
            send_data_model=expansion.send_data_model,
        )
        return SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=messages,
            confidence=conf,
            entropy=entropy,
            layout_plan=plan,
            trace=tuple(trace),
            decision_answers=tuple(state.answers_by_id.values()),
            operation=operation,
        )

    def _eligible_archetypes(
        self, pointers: Sequence[PointerSummary]
    ) -> tuple[LayoutArchetype, ...]:
        """Memoizes `eligible_archetypes` per payload shape on this synthesizer."""
        key = shape_signature(pointers)
        cached = self._eligibility_cache.get(key)
        if cached is not None:
            self._eligibility_cache.move_to_end(key)
            return cached
        result = eligible_archetypes(self.archetypes, self.patterns, pointers)
        self._eligibility_cache[key] = result
        while len(self._eligibility_cache) > _ELIGIBILITY_CACHE_SIZE:
            self._eligibility_cache.popitem(last=False)
        return result

    def _has_templates_for(self, pointers: Sequence[PointerSummary]) -> bool:
        """Whether any registered template matches the payload's pointers.

        A matching template keeps the batch worth asking even when no
        archetype is eligible (for example, a catalog with no patterns).
        """
        return bool(self.registry.matching_templates([p.path for p in pointers]))

    def _action_gate_output(
        self, state: PlannerState, trace: list[DecisionRecord]
    ) -> SynthesisOutput:
        """Builds an `ABSTAIN_FALLBACK` output when `action-gate` blocks the plan."""
        _record_trace_reason(trace, "action_gate", "Action confidence gate")
        conf, entropy = _archetype_confidence_and_entropy(state, None)
        return SynthesisOutput(
            stage=SynthesisStage.ABSTAIN_FALLBACK,
            messages=[],
            confidence=conf,
            entropy=entropy,
            trace=tuple(trace),
            decision_answers=tuple(state.answers_by_id.values()),
        )

    async def _synthesize_with_archetypes(
        self,
        intent: str,
        data: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        request: _SurfaceRequest,
    ) -> tuple[SynthesisOutput | None, tuple[DecisionRecord, ...]]:
        """Attempts archetype-planned synthesis, returning `(output, trace)`."""
        trace: list[DecisionRecord] = []
        if not self._eligible_archetypes(pointers) and not self._has_templates_for(
            pointers
        ):
            _record_trace_reason(
                trace,
                "no eligible archetype",
                "Are any layout archetypes eligible for the active catalogs and"
                " payload?",
            )
            return None, tuple(trace)
        try:
            outcome, state = await self._plan_layout(intent, data, pointers, request)
            trace = list(state.trace)
            if outcome.reason == "action_gate":
                gated = self._action_gate_output(state, trace)
                return gated, gated.trace
            if outcome.reason != "planned" or outcome.plan is None:
                reason = str(outcome.reason)
                _record_trace_reason(trace, reason, "Archetype planning outcome")
                conf, entropy = _archetype_confidence_and_entropy(state, None)
                abstained = SynthesisOutput(
                    stage=SynthesisStage.ABSTAIN_FALLBACK,
                    messages=[],
                    confidence=conf,
                    entropy=entropy,
                    fallback_reason=reason,
                    trace=tuple(trace),
                    decision_answers=tuple(state.answers_by_id.values()),
                )
                return abstained, abstained.trace
            if outcome.plan.template_id is not None:
                rendered = self._render_template(outcome.plan, state, data, request)
                return rendered, rendered.trace
            finished = self._finish_archetype_output(
                outcome.plan, state, self._expand_plan(outcome.plan), data, request
            )
            return finished, finished.trace
        except (PatternError, A2uiValidationError) as exc:
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
        request: _SurfaceRequest,
    ) -> SynthesisOutput:
        """Runs archetype-planned synthesis, or returns an empty abstention."""
        arch_out, arch_trace = await self._synthesize_with_archetypes(
            intent, payload, pointers, request
        )
        if arch_out is not None:
            return arch_out
        return SynthesisOutput(
            stage=SynthesisStage.ABSTAIN_FALLBACK,
            messages=[],
            confidence=0.0,
            entropy=0.0,
            trace=arch_trace,
        )

    def _build_validated_messages(
        self,
        surface_id: str,
        components: list[dict[str, Any]],
        payload: Mapping[str, Any],
        operation: SurfaceOperation = SurfaceOperation.CREATE,
        *,
        send_data_model: bool = False,
    ) -> list[AgentToRendererMessage]:
        """Builds and validates the wire messages for `operation`.

        `CREATE` emits `createSurface` (with `sendDataModel` when needed),
        `updateComponents`, and `updateDataModel`. `UPDATE_ROOT` emits only
        `updateComponents` and `updateDataModel`, relying on stable per-block
        component ids. `REPLACE` emits `deleteSurface` and then `CREATE`.
        """
        wire_ver = _WIRE_VERSION
        raw_messages: list[dict[str, Any]] = []
        if operation is SurfaceOperation.REPLACE:
            raw_messages.append(
                {"version": wire_ver, "deleteSurface": {"surfaceId": surface_id}}
            )
        if operation is not SurfaceOperation.UPDATE_ROOT:
            create_body: dict[str, Any] = {"surfaceId": surface_id}
            if self.graph.surface_catalog_id is not None:
                create_body["catalogId"] = self.graph.surface_catalog_id
            if send_data_model:
                create_body["sendDataModel"] = True
            raw_messages.append({"version": wire_ver, "createSurface": create_body})
        raw_messages.append({
            "version": wire_ver,
            "updateComponents": {"surfaceId": surface_id, "components": components},
        })
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
