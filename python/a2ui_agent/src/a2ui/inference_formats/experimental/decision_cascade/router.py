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

"""Single-batch UI gate, routing tier selector, and catalog pruning router."""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum
import math

from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.core import CatalogApi
from a2ui.inference_formats.experimental.decision import (
    CatalogDecisionGraph,
    ComponentNodeSpec,
    DecisionAnswer,
    DecisionBackend,
    DecisionBackendError,
    DecisionBatch,
    DecisionQuestion,
    ExpressSurfaceSpec,
    QuestionKind,
)
from a2ui.utils._experimental import experimental

_DEFAULT_LAYOUT_FLOOR: tuple[str, ...] = (
    "Column",
    "Row",
    "Card",
    "Text",
    "Button",
)


class CascadeTier(str, Enum):
    """Execution tier selected by `DecisionCascadeRouter`."""

    TEXT_ONLY = "text_only"
    TEMPLATE = "template"
    PRUNED_EXPRESS = "pruned_express"
    FULL_EXPRESS = "full_express"
    SANDBOX_APP = "sandbox_app"

    def __str__(self) -> str:
        return str.__str__(self)

    def __format__(self, format_spec: str) -> str:
        return str.__format__(str(self), format_spec)

    def __hash__(self) -> int:
        return str.__hash__(self)


def _validate_unit_interval(name: str, value: float) -> None:
    """Validates that `value` is finite and lies in `[0.0, 1.0]`."""
    if not math.isfinite(value) or not (0.0 <= value <= 1.0):
        raise ValueError(f"{name} must be in [0.0, 1.0], got {value}.")


@dataclass(frozen=True)
class CascadeConfig:
    """Thresholds and bounds controlling `DecisionCascadeRouter.route`.

    Attributes:
        needs_ui_threshold: Minimum `gate:needs_ui` probability to render a UI.
        tight_budget_ms: Latency budget below which only `TEMPLATE` or
            `TEXT_ONLY` routes are allowed.
        template_min_confidence: Minimum `route:template` probability required
            to select `TEMPLATE` under a tight latency budget.
        prune_threshold: Minimum `prune:<cid_idx>:<comp_name>` probability to
            keep a component before closure and floor inclusion.
        max_components: Maximum total components across catalogs eligible for
            per-component pruning questions.
        layout_floor: Layout primitive names always preserved when present in a
            catalog during pruning.
    """

    needs_ui_threshold: float = 0.50
    tight_budget_ms: float = 500.0
    template_min_confidence: float = 0.70
    prune_threshold: float = 0.25
    max_components: int = 128
    layout_floor: tuple[str, ...] = _DEFAULT_LAYOUT_FLOOR

    def __post_init__(self) -> None:
        _validate_unit_interval("needs_ui_threshold", self.needs_ui_threshold)
        _validate_unit_interval("template_min_confidence", self.template_min_confidence)
        _validate_unit_interval("prune_threshold", self.prune_threshold)
        if not math.isfinite(self.tight_budget_ms) or self.tight_budget_ms < 0.0:
            raise ValueError(
                f"tight_budget_ms must be non-negative, got {self.tight_budget_ms}."
            )
        if self.max_components < 1:
            raise ValueError(f"max_components must be >= 1, got {self.max_components}.")
        if isinstance(self.layout_floor, (str, bytes)):
            raise TypeError(
                "CascadeConfig.layout_floor must be a sequence of component names, not"
                " a string."
            )
        object.__setattr__(self, "layout_floor", tuple(self.layout_floor))


@dataclass(frozen=True)
class RouteDecision:
    """Routing decision returned by `DecisionCascadeRouter.route`.

    Attributes:
        tier: Selected `CascadeTier`.
        catalogs: Catalogs to pass downstream (pruned for `PRUNED_EXPRESS`,
            original for `FULL_EXPRESS`/`TEMPLATE`/`SANDBOX_APP`, empty for
            `TEXT_ONLY`).
        template_id: Selected `ExpressSurfaceSpec.id` when `tier` is
            `CascadeTier.TEMPLATE`.
        template: Selected `ExpressSurfaceSpec` when `tier` is
            `CascadeTier.TEMPLATE`.
        needs_ui_probability: Calibrated probability of `gate:needs_ui`.
        tier_confidence: Confidence score associated with the selected route.
        template_confidence: Confidence score of `template` when selected.
        reason: Short machine-readable explanation of the routing decision.
        answers: Raw `DecisionAnswer` tuple returned by the backend.
    """

    tier: CascadeTier
    catalogs: tuple[CatalogApi, ...] = ()
    template_id: str | None = None
    template: ExpressSurfaceSpec | None = None
    needs_ui_probability: float = 0.0
    tier_confidence: float = 0.0
    template_confidence: float = 0.0
    reason: str = ""
    answers: tuple[DecisionAnswer, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        object.__setattr__(self, "tier", CascadeTier(self.tier))
        object.__setattr__(self, "catalogs", tuple(self.catalogs))
        object.__setattr__(self, "answers", tuple(self.answers))


def _rank_candidates(
    candidates: Sequence[str], probabilities: Mapping[str, float]
) -> list[tuple[str, float]]:
    """Ranks `candidates` by descending probability with deterministic tie-break."""
    indexed = [
        (idx, name, float(probabilities.get(name, 0.0)))
        for idx, name in enumerate(candidates)
    ]
    indexed.sort(key=lambda item: (round(-item[2], 6), item[0]))
    return [(name, prob) for _, name, prob in indexed]


def _best_scored(
    candidates: Iterable[str],
    scores: Mapping[str, float],
    decl_index: Mapping[str, int],
) -> str | None:
    """Returns the highest-scoring candidate, breaking ties by declaration index."""
    items = list(candidates)
    if not items:
        return None
    return min(
        items,
        key=lambda name: (round(-scores.get(name, 0.0), 6), decl_index[name]),
    )


def _format_cascade_state(
    prompt: str,
    catalogs: Sequence[CatalogApi],
    templates: Sequence[ExpressSurfaceSpec],
    latency_budget_ms: float | None,
    allow_sandbox_app: bool,
) -> str:
    """Formats the explicit `DecisionBatch.state` string for cascade routing."""
    catalog_summary = ", ".join(
        f"{cat.catalog_id} ({len(cat.components)} components)" for cat in catalogs
    )
    parts = [
        f"User request: {prompt}",
        f"Catalogs: {catalog_summary}",
        f"Registered templates: {len(templates)}",
        f"Sandbox app allowed: {allow_sandbox_app}",
    ]
    if latency_budget_ms is not None:
        parts.append(f"Latency budget (ms): {latency_budget_ms:.1f}")
    return "\n".join(parts)


def _build_tier_options(
    has_templates: bool, allow_sandbox_app: bool
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Builds ordered `route:tier` options and parallel descriptions."""
    entries: list[tuple[str, str]] = []
    if has_templates:
        entries.append((
            CascadeTier.TEMPLATE.value,
            "Match a pre-registered Express surface template directly.",
        ))
    entries.append((
        CascadeTier.PRUNED_EXPRESS.value,
        "Generate an Express surface with a pruned component subset.",
    ))
    entries.append((
        CascadeTier.FULL_EXPRESS.value,
        "Generate an Express surface with the full component catalogs.",
    ))
    if allow_sandbox_app:
        entries.append((
            CascadeTier.SANDBOX_APP.value,
            "Launch an interactive sandbox app beyond standard components.",
        ))
    return tuple(k for k, _ in entries), tuple(d for _, d in entries)


def _build_prune_questions(
    catalogs: Sequence[CatalogApi], graph: CatalogDecisionGraph
) -> list[DecisionQuestion]:
    """Builds `prune:<cid_idx>:<comp_name>` boolean questions per component."""
    questions: list[DecisionQuestion] = []
    for cid_idx, catalog in enumerate(catalogs):
        for comp_name in catalog.components:
            spec = graph.get_component_by_key((catalog.catalog_id, comp_name))
            desc = spec.description if spec is not None and spec.description else ""
            prompt = (
                f"Keep component '{comp_name}' ({desc}) for this UI?"
                if desc
                else f"Keep component '{comp_name}' for this UI?"
            )
            questions.append(
                DecisionQuestion(
                    id=f"prune:{cid_idx}:{comp_name}",
                    kind=QuestionKind.BOOLEAN,
                    prompt=prompt,
                )
            )
    return questions


def _build_cascade_batch(
    prompt: str,
    catalogs: Sequence[CatalogApi],
    graph: CatalogDecisionGraph,
    templates: Sequence[ExpressSurfaceSpec],
    config: CascadeConfig,
    latency_budget_ms: float | None,
    allow_sandbox_app: bool,
) -> DecisionBatch:
    """Constructs the single `DecisionBatch` evaluated by `route()`."""
    questions: list[DecisionQuestion] = [
        DecisionQuestion(
            id="gate:needs_ui",
            kind=QuestionKind.BOOLEAN,
            prompt=(
                "Does this request benefit from a visual UI surface over plain text?"
            ),
            context={
                "yes": "Structured or interactive UI improves clarity or usability.",
                "no": "A plain text response answers the request directly.",
            },
        )
    ]
    tier_options, tier_texts = _build_tier_options(bool(templates), allow_sandbox_app)
    questions.append(
        DecisionQuestion(
            id="route:tier",
            kind=QuestionKind.CHOICE,
            prompt="Which rendering tier best fits this request?",
            options=tier_options,
            option_texts=tier_texts,
            allow_none=False,
        )
    )
    if templates:
        questions.append(
            DecisionQuestion(
                id="route:template",
                kind=QuestionKind.CHOICE,
                prompt=(
                    "Which registered Express surface template matches this request?"
                ),
                options=tuple(t.id for t in templates),
                option_texts=tuple(t.description for t in templates),
                allow_none=True,
            )
        )
    total_components = sum(len(cat.components) for cat in catalogs)
    tight_budget = (
        latency_budget_ms is not None and latency_budget_ms < config.tight_budget_ms
    )
    if not tight_budget and total_components <= config.max_components:
        questions.extend(_build_prune_questions(catalogs, graph))
    state = _format_cascade_state(
        prompt, catalogs, templates, latency_budget_ms, allow_sandbox_app
    )
    return DecisionBatch(state=state, questions=tuple(questions))


def _index_answers(
    answers: Sequence[DecisionAnswer],
    expected_ids: Sequence[str],
    backend: DecisionBackend,
) -> dict[str, DecisionAnswer]:
    """Maps backend answers by question ID and fails loudly if any are missing."""
    by_id = {ans.question_id: ans for ans in answers}
    missing = [qid for qid in expected_ids if qid not in by_id]
    if missing:
        raise DecisionBackendError(
            f"Decision backend omitted answers for questions: {missing}.",
            backend_kind=backend.backend_kind,
            model_id=backend.model_id,
        )
    return by_id


def _is_surface_eligible(spec: ComponentNodeSpec | None) -> bool:
    """Returns whether a component may sit directly at the surface root."""
    if spec is None or not spec.allowed_parents:
        return True
    return "Surface" in spec.allowed_parents


def _edge_allowed(
    parent_spec: ComponentNodeSpec | None,
    parent_name: str,
    child_spec: ComponentNodeSpec | None,
    child_name: str,
) -> bool:
    """Returns whether `parent_name` may contain `child_name` under catalog rules."""
    if (
        child_spec is not None
        and child_spec.allowed_parents
        and parent_name not in child_spec.allowed_parents
    ):
        return False
    if (
        parent_spec is not None
        and parent_spec.allowed_children
        and child_name not in parent_spec.allowed_children
    ):
        return False
    return True


def _build_parent_to_children_edges(
    comp_names: Sequence[str],
    specs: Mapping[str, ComponentNodeSpec | None],
) -> dict[str, list[str]]:
    """Builds allowed parent-to-child adjacency lists across `comp_names`."""
    comp_set = set(comp_names)
    children_by_parent: dict[str, list[str]] = {name: [] for name in comp_names}
    for child in comp_names:
        child_spec = specs.get(child)
        if child_spec is None:
            continue
        for parent in child_spec.allowed_parents:
            if parent in comp_set and _edge_allowed(
                specs.get(parent), parent, child_spec, child
            ):
                children_by_parent[parent].append(child)
    return children_by_parent


def _compute_surface_distances(
    comp_names: Sequence[str],
    specs: Mapping[str, ComponentNodeSpec | None],
) -> dict[str, int]:
    """Computes shortest parent-chain distances to a `"Surface"`-eligible root."""
    children_by_parent = _build_parent_to_children_edges(comp_names, specs)
    distances: dict[str, int] = {
        name: 0 for name in comp_names if _is_surface_eligible(specs.get(name))
    }
    queue: deque[str] = deque(distances)
    while queue:
        parent = queue.popleft()
        next_dist = distances[parent] + 1
        for child in children_by_parent[parent]:
            if child not in distances:
                distances[child] = next_dist
                queue.append(child)
    return distances


def _kept_reaching_surface(
    kept: set[str],
    specs: Mapping[str, ComponentNodeSpec | None],
) -> set[str]:
    """Returns the subset of `kept` connected to a `"Surface"`-eligible root."""
    reaching = {name for name in kept if _is_surface_eligible(specs.get(name))}
    queue: deque[str] = deque(reaching)
    while queue:
        parent = queue.popleft()
        parent_spec = specs.get(parent)
        for child in kept:
            if child in reaching:
                continue
            child_spec = specs.get(child)
            if _edge_allowed(parent_spec, parent, child_spec, child):
                reaching.add(child)
                queue.append(child)
    return reaching


def _valid_upward_parents(
    curr: str,
    specs: Mapping[str, ComponentNodeSpec | None],
    comp_set: set[str],
    dist_to_surface: Mapping[str, int],
) -> list[str]:
    """Returns valid parents of `curr` strictly closer to `"Surface"`."""
    curr_spec = specs.get(curr)
    if curr_spec is None:
        return []
    curr_dist = dist_to_surface[curr]
    return [
        parent
        for parent in curr_spec.allowed_parents
        if parent in comp_set
        and parent in dist_to_surface
        and dist_to_surface[parent] < curr_dist
        and _edge_allowed(specs.get(parent), parent, curr_spec, curr)
    ]


def _trace_upward_path(
    start: str,
    reaching: set[str],
    comp_set: set[str],
    specs: Mapping[str, ComponentNodeSpec | None],
    scores: Mapping[str, float],
    decl_index: Mapping[str, int],
    dist_to_surface: Mapping[str, int],
) -> tuple[list[str], bool]:
    """Traces best-scored upward parents from `start` until reaching a root."""
    curr = start
    path: list[str] = []
    while curr not in reaching and not _is_surface_eligible(specs.get(curr)):
        candidates = _valid_upward_parents(curr, specs, comp_set, dist_to_surface)
        best_parent = _best_scored(candidates, scores, decl_index)
        if best_parent is None:
            return path, False
        path.append(best_parent)
        curr = best_parent
    return path, True


def _close_upward(
    kept: set[str],
    comp_names: Sequence[str],
    specs: Mapping[str, ComponentNodeSpec | None],
    scores: Mapping[str, float],
    decl_index: Mapping[str, int],
    dist_to_surface: Mapping[str, int],
) -> bool:
    """Closes `kept` upward along `allowed_parents` to a `"Surface"`-eligible root."""
    added = False
    comp_set = set(comp_names)
    reaching = _kept_reaching_surface(kept, specs)
    for name in comp_names:
        if name not in kept or name in reaching or name not in dist_to_surface:
            continue
        path, reached = _trace_upward_path(
            name, reaching, comp_set, specs, scores, decl_index, dist_to_surface
        )
        if not reached:
            continue
        for node in path:
            if node not in kept:
                kept.add(node)
                added = True
            reaching.add(node)
        reaching.add(name)
    return added


def _valid_children_for(
    parent_name: str,
    parent_spec: ComponentNodeSpec,
    comp_set: set[str],
    specs: Mapping[str, ComponentNodeSpec | None],
) -> list[str]:
    """Returns valid children in `parent_spec.allowed_children` existing in catalog."""
    strict = [
        ch
        for ch in parent_spec.allowed_children
        if ch in comp_set and _edge_allowed(parent_spec, parent_name, specs.get(ch), ch)
    ]
    if strict:
        return strict
    return [ch for ch in parent_spec.allowed_children if ch in comp_set]


def _close_downward(
    kept: set[str],
    comp_names: Sequence[str],
    specs: Mapping[str, ComponentNodeSpec | None],
    scores: Mapping[str, float],
    decl_index: Mapping[str, int],
) -> bool:
    """Ensures kept containers with `allowed_children` retain their top valid child."""
    added = False
    comp_set = set(comp_names)
    for name in comp_names:
        if name not in kept:
            continue
        spec = specs.get(name)
        if spec is None or not spec.allowed_children:
            continue
        valid_children = _valid_children_for(name, spec, comp_set, specs)
        if not valid_children or any(ch in kept for ch in valid_children):
            continue
        top_child = _best_scored(valid_children, scores, decl_index)
        if top_child is not None:
            kept.add(top_child)
            added = True
    return added


def _prune_single_catalog(
    catalog: CatalogApi,
    cid_idx: int,
    graph: CatalogDecisionGraph,
    answers: Mapping[str, DecisionAnswer],
    config: CascadeConfig,
) -> CatalogApi:
    """Applies threshold pruning, layout floor, closure, and `ComponentPruningTransformer`."""
    comp_names = list(catalog.components.keys())
    decl_index = {name: idx for idx, name in enumerate(comp_names)}
    scores = {name: answers[f"prune:{cid_idx}:{name}"].yes for name in comp_names}
    specs = {
        name: graph.get_component_by_key((catalog.catalog_id, name))
        for name in comp_names
    }
    kept: set[str] = {
        name for name in comp_names if scores[name] >= config.prune_threshold
    }
    kept.update(name for name in config.layout_floor if name in decl_index)

    dist_to_surface = _compute_surface_distances(comp_names, specs)
    for _ in range(len(comp_names) + 1):
        changed_up = _close_upward(
            kept, comp_names, specs, scores, decl_index, dist_to_surface
        )
        changed_down = _close_downward(kept, comp_names, specs, scores, decl_index)
        if not changed_up and not changed_down:
            break

    ordered_kept = [name for name in comp_names if name in kept]
    return ComponentPruningTransformer(ordered_kept).transform(catalog)


@experimental
class DecisionCascadeRouter:
    """Single-batch cascade router gating UI rendering, tier selection, and pruning."""

    def __init__(
        self,
        backend: DecisionBackend,
        *,
        templates: Sequence[ExpressSurfaceSpec] = (),
        config: CascadeConfig | None = None,
    ) -> None:
        """Initializes the cascade router.

        Args:
            backend: Decision backend answering the routing batch.
            templates: Registered Express `.a2ui` surface templates.
            config: Threshold and pruning configuration. Defaults to
                `CascadeConfig()`.

        Raises:
            TypeError: If `backend` is not a `DecisionBackend`.
            ValueError: If `templates` contains duplicate template IDs.
        """
        if not isinstance(backend, DecisionBackend):
            raise TypeError(
                "DecisionCascadeRouter requires a DecisionBackend instance."
            )
        seen_ids: set[str] = set()
        template_tuple = tuple(templates)
        for tmpl in template_tuple:
            if tmpl.id in seen_ids:
                raise ValueError(f"Duplicate ExpressSurfaceSpec id {tmpl.id!r}.")
            seen_ids.add(tmpl.id)
        self._backend = backend
        self._templates = template_tuple
        self._templates_by_id = {tmpl.id: tmpl for tmpl in template_tuple}
        self._config = config if config is not None else CascadeConfig()

    def _select_template(
        self, answer: DecisionAnswer
    ) -> tuple[ExpressSurfaceSpec | None, float]:
        """Selects the winning registered template or returns `(None, none_prob)`."""
        candidates = tuple(t.id for t in self._templates) + ("none",)
        ranked = _rank_candidates(candidates, answer.distribution.probabilities)
        winner_id, winner_prob = ranked[0]
        if winner_id == "none" or winner_prob <= 0.0:
            return None, winner_prob
        return self._templates_by_id[winner_id], winner_prob

    def _resolve_tight_budget(
        self,
        catalogs: Sequence[CatalogApi],
        answer_map: Mapping[str, DecisionAnswer],
        needs_ui_prob: float,
        answers: tuple[DecisionAnswer, ...],
    ) -> RouteDecision:
        """Restricts tight-budget routing to `TEMPLATE` (>= threshold) or `TEXT_ONLY`."""
        if not self._templates:
            return RouteDecision(
                tier=CascadeTier.TEXT_ONLY,
                catalogs=(),
                needs_ui_probability=needs_ui_prob,
                tier_confidence=1.0,
                reason="tight_budget_no_templates",
                answers=answers,
            )
        tmpl, tmpl_prob = self._select_template(answer_map["route:template"])
        if tmpl is not None and tmpl_prob >= self._config.template_min_confidence:
            return RouteDecision(
                tier=CascadeTier.TEMPLATE,
                catalogs=tuple(catalogs),
                template_id=tmpl.id,
                template=tmpl,
                needs_ui_probability=needs_ui_prob,
                tier_confidence=tmpl_prob,
                template_confidence=tmpl_prob,
                reason="tight_budget_template",
                answers=answers,
            )
        return RouteDecision(
            tier=CascadeTier.TEXT_ONLY,
            catalogs=(),
            needs_ui_probability=needs_ui_prob,
            tier_confidence=1.0 - (tmpl_prob if tmpl is not None else 0.0),
            reason="tight_budget_below_template_threshold",
            answers=answers,
        )

    def _resolve_pruned_tier(
        self,
        catalogs: Sequence[CatalogApi],
        graph: CatalogDecisionGraph,
        answer_map: Mapping[str, DecisionAnswer],
        needs_ui_prob: float,
        tier_prob: float,
        answers: tuple[DecisionAnswer, ...],
    ) -> RouteDecision:
        """Executes `PRUNED_EXPRESS` or falls back to `FULL_EXPRESS` above cap."""
        total_components = sum(len(cat.components) for cat in catalogs)
        if total_components > self._config.max_components:
            return RouteDecision(
                tier=CascadeTier.FULL_EXPRESS,
                catalogs=tuple(catalogs),
                needs_ui_probability=needs_ui_prob,
                tier_confidence=tier_prob,
                reason="catalog_exceeds_max_components",
                answers=answers,
            )
        pruned_catalogs = tuple(
            _prune_single_catalog(cat, cid_idx, graph, answer_map, self._config)
            for cid_idx, cat in enumerate(catalogs)
        )
        if not any(cat.components for cat in pruned_catalogs):
            return RouteDecision(
                tier=CascadeTier.FULL_EXPRESS,
                catalogs=tuple(catalogs),
                needs_ui_probability=needs_ui_prob,
                tier_confidence=tier_prob,
                reason="pruned_catalog_empty",
                answers=answers,
            )
        return RouteDecision(
            tier=CascadeTier.PRUNED_EXPRESS,
            catalogs=pruned_catalogs,
            needs_ui_probability=needs_ui_prob,
            tier_confidence=tier_prob,
            reason="selected_pruned_express",
            answers=answers,
        )

    def _resolve_normal_budget(
        self,
        catalogs: Sequence[CatalogApi],
        graph: CatalogDecisionGraph,
        batch: DecisionBatch,
        answer_map: Mapping[str, DecisionAnswer],
        needs_ui_prob: float,
        answers: tuple[DecisionAnswer, ...],
    ) -> RouteDecision:
        """Selects the winning normal-budget tier and applies pruning if chosen."""
        tier_question = next(q for q in batch.questions if q.id == "route:tier")
        ranked_tiers = _rank_candidates(
            tier_question.options, answer_map["route:tier"].distribution.probabilities
        )
        chosen_tier, tier_prob = ranked_tiers[0]

        if chosen_tier == CascadeTier.TEMPLATE.value:
            tmpl, tmpl_prob = self._select_template(answer_map["route:template"])
            if tmpl is not None:
                return RouteDecision(
                    tier=CascadeTier.TEMPLATE,
                    catalogs=tuple(catalogs),
                    template_id=tmpl.id,
                    template=tmpl,
                    needs_ui_probability=needs_ui_prob,
                    tier_confidence=tier_prob,
                    template_confidence=tmpl_prob,
                    reason="selected_template",
                    answers=answers,
                )
            chosen_tier, tier_prob = next(
                (t, p) for t, p in ranked_tiers if t != CascadeTier.TEMPLATE.value
            )

        if chosen_tier == CascadeTier.PRUNED_EXPRESS.value:
            return self._resolve_pruned_tier(
                catalogs, graph, answer_map, needs_ui_prob, tier_prob, answers
            )
        if chosen_tier == CascadeTier.SANDBOX_APP.value:
            return RouteDecision(
                tier=CascadeTier.SANDBOX_APP,
                catalogs=tuple(catalogs),
                needs_ui_probability=needs_ui_prob,
                tier_confidence=tier_prob,
                reason="selected_sandbox_app",
                answers=answers,
            )
        return RouteDecision(
            tier=CascadeTier.FULL_EXPRESS,
            catalogs=tuple(catalogs),
            needs_ui_probability=needs_ui_prob,
            tier_confidence=tier_prob,
            reason="selected_full_express",
            answers=answers,
        )

    async def route(
        self,
        prompt: str,
        catalogs: Sequence[CatalogApi],
        latency_budget_ms: float | None = None,
        allow_sandbox_app: bool = False,
    ) -> RouteDecision:
        """Evaluates UI gating, tier routing, and component pruning in one batch.

        Args:
            prompt: User prompt or turn intent text.
            catalogs: Validated catalogs available for the turn.
            latency_budget_ms: Optional latency budget in milliseconds. Sets
                `timeout_seconds = latency_budget_ms / 1000.0` on the backend
                call and restricts tight budgets (`< tight_budget_ms`) to
                `TEMPLATE` or `TEXT_ONLY`.
            allow_sandbox_app: Whether `CascadeTier.SANDBOX_APP` may be selected.

        Returns:
            A `RouteDecision` describing the selected tier, catalogs, and
            optional template.

        Raises:
            ValueError: If `catalogs` is empty or `latency_budget_ms` is
                non-positive.
            DecisionBackendError: If the decision backend fails or omits answers.
        """
        if not catalogs:
            raise ValueError(
                "DecisionCascadeRouter.route requires at least one catalog."
            )
        timeout_seconds: float | None = None
        if latency_budget_ms is not None:
            if not math.isfinite(latency_budget_ms) or latency_budget_ms <= 0.0:
                raise ValueError(
                    f"latency_budget_ms must be positive, got {latency_budget_ms}."
                )
            timeout_seconds = latency_budget_ms / 1000.0

        graph = CatalogDecisionGraph(catalogs)
        batch = _build_cascade_batch(
            prompt,
            catalogs,
            graph,
            self._templates,
            self._config,
            latency_budget_ms,
            allow_sandbox_app,
        )
        answers = await self._backend.answer(batch, timeout_seconds=timeout_seconds)
        answer_map = _index_answers(
            answers, [q.id for q in batch.questions], self._backend
        )

        needs_ui_prob = answer_map["gate:needs_ui"].yes
        if needs_ui_prob < self._config.needs_ui_threshold:
            return RouteDecision(
                tier=CascadeTier.TEXT_ONLY,
                catalogs=(),
                needs_ui_probability=needs_ui_prob,
                tier_confidence=1.0 - needs_ui_prob,
                reason="needs_ui_below_threshold",
                answers=answers,
            )

        if (
            latency_budget_ms is not None
            and latency_budget_ms < self._config.tight_budget_ms
        ):
            return self._resolve_tight_budget(
                catalogs, answer_map, needs_ui_prob, answers
            )

        return self._resolve_normal_budget(
            catalogs, graph, batch, answer_map, needs_ui_prob, answers
        )
