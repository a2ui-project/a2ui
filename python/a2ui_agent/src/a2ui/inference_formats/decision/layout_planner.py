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

"""Speculative batch planner and deterministic layout rules for A2UI surfaces."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field, replace
import re
from typing import Any

from a2ui.core import A2uiValidationError

from .archetypes import (
    ABSTRACT_PATTERNS,
    ArchetypeGrammar,
    BlockRef,
    BlockSpec,
    LayoutArchetype,
    MeasureSpec,
    QuestionSpec,
    Range,
    ShapeFilter,
    SlotSpec,
)
from .models import (
    ActionSpec,
    ActionStyle,
    AuthoredCopy,
    BlockBindings,
    DecisionAnswer,
    DecisionBatch,
    DecisionQuestion,
    DecisionRecord,
    LayoutBrief,
    LayoutPlan,
    PageBindings,
    PatternCapabilities,
    PlannedBlock,
    PlanOutcome,
    PlanReason,
    QuestionKind,
    SemanticType,
    SlotBinding,
    SynthesisConfig,
)
from .payload_inspector import PointerSummary, split_pointer
from .semantic_types import humanize_key
from .template_registry import SurfaceTemplate

_PATTERN_VARIANT_REQ_RE = re.compile(r"^pattern:([a-z_]+):([a-z_]+)$")

_NUMERIC_SEMANTIC_TYPES: frozenset[str] = frozenset({
    "number",
    "integer",
    "count",
    "currency",
    "percent",
    "ratio",
    "quantity",
    "rating",
    "bounded",
    "duration",
})
_TEXT_FALLBACK_TYPES: frozenset[str] = frozenset({
    "string",
    "name",
    "title",
    "identifier",
})
_PAGE_TITLE_KEYS: frozenset[str] = frozenset({
    "title",
    "name",
    "subject",
    "heading",
})
_MARK_KEY_HINTS: frozenset[str] = frozenset({
    "logo",
    "icon",
    "avatar",
})
_NON_FACT_SEMANTIC_TYPES: frozenset[str] = frozenset({
    "image_url",
    "video_url",
    "audio_url",
    "document_url",
    "long_text",
    "markdown",
    "code",
    "array",
    "object",
    "empty",
})
_OPTIONAL_TEXT_KEYS: Mapping[str, frozenset[str]] = {
    "caption": frozenset({"caption", "alt", "subtitle", "title"}),
    "heading": frozenset({"heading", "title", "header", "subject"}),
    "text": frozenset({
        "text",
        "message",
        "detail",
        "description",
        "summary",
        "body",
        "reason",
    }),
}


class _AllCapabilities:
    """Default `PatternCapabilities` used when no catalog capabilities are passed."""

    def has_pattern(self, name: str, variant: str | None = None) -> bool:
        """Returns whether `name` is one of the grammar's `ABSTRACT_PATTERNS`."""
        del variant
        return name in ABSTRACT_PATTERNS


@dataclass
class PlannerState:
    """State carried from `LayoutPlanner.build_batch` into `read`.

    Attributes:
        intent: Natural-language intent describing the surface to render.
        pointers: Normalized payload pointer summaries available for binding.
        eligible: Ordered tuple of eligible `LayoutArchetype` candidates.
        prior_archetypes: Archetype IDs selected within the speculative pair budget.
        brief: Optional `LayoutBrief` pinning roles to payload pointers.
        batch: Compiled `DecisionBatch` of questions sent to the decision backend.
        payload: Raw data model dictionary being bound.
        derived_anatomy: Deterministic `(block_id, knob_name)` answers bypassed from batching.
        budget_exhausted: Whether the speculative pair budget was reached during batch compilation.
        trace: Chronological list of `DecisionRecord` entries accumulated during planning.
        answers_by_id: Map of question ID to `DecisionAnswer` returned by the backend.
        salience_scores: Map of `"<block_id>:<pointer>"` to salience score.
        gate_probabilities: Map of block ID to gate `yes` probability.
        selected_archetype: Winning `LayoutArchetype`, once chosen.
        page_claimed_pointers: Pointers claimed by the page frame (title, subtitle, mark).
        action_gate_blocked: Whether the `action-gate` rule vetoed an `act` plan.
        required_block_missing: Whether a required block (`!`) failed to bind or resolve.
        copy: Optional `AuthoredCopy` (surface title and summary).
        templates: Registered `SurfaceTemplate` entries matching the payload's pointers.
        actions: Declared `ActionSpec` items from the decision block.
        labels: Agent-supplied display labels keyed by normalized JSON Pointer.
        exclude: JSON Pointers excluded from rendering and orphan recovery.
        orphan_pointers: Pointers placed by `apply_no_orphaned_pointers` during `read`.
        region_plan: Cached `LayoutPlan` when planning a single-block region update.
        region_block_id: Target block ID when planning a single-block region update.
        region_used_pointers: Pointers already bound outside `region_block_id` on `region_plan`.
    """

    intent: str
    pointers: tuple[PointerSummary, ...]
    eligible: tuple[LayoutArchetype, ...]
    prior_archetypes: tuple[str, ...]
    brief: LayoutBrief | None
    batch: DecisionBatch
    payload: Mapping[str, Any] = field(default_factory=dict)
    derived_anatomy: dict[tuple[str, str], str] = field(default_factory=dict)
    budget_exhausted: bool = False
    trace: list[DecisionRecord] = field(default_factory=list)
    answers_by_id: dict[str, DecisionAnswer] = field(default_factory=dict)
    salience_scores: dict[str, float] = field(default_factory=dict)
    gate_probabilities: dict[str, float] = field(default_factory=dict)
    selected_archetype: LayoutArchetype | None = None
    page_claimed_pointers: set[str] = field(default_factory=set)
    action_gate_blocked: bool = False
    required_block_missing: bool = False
    copy: AuthoredCopy | None = None
    templates: tuple[SurfaceTemplate, ...] = ()
    """Registered templates whose required pointers the payload satisfies."""
    actions: tuple[ActionSpec, ...] = ()
    """The actions the decision block declared, in order."""
    labels: dict[str, str] = field(default_factory=dict)
    """Agent-supplied display labels keyed by normalized JSON Pointer."""
    exclude: frozenset[str] = field(default_factory=frozenset)
    """JSON Pointers excluded from rendering and orphan recovery."""
    orphan_pointers: set[str] = field(default_factory=set)
    """Pointers placed by `apply_no_orphaned_pointers` during `read`."""
    region_plan: LayoutPlan | None = None
    """Cached `LayoutPlan` when `PlannerState` was built for a region update."""
    region_block_id: str | None = None
    """Target block ID when `PlannerState` was built for a region update."""
    region_used_pointers: set[str] = field(default_factory=set)
    """Pointers already claimed outside `region_block_id` on `region_plan`."""


MAX_ORPHAN_FACTS_ROWS = 8
"""Maximum extra `facts` rows added by `no-orphaned-pointers`."""


def compute_fit_score(
    archetype_prob: float,
    normalized_entropy: float,
    orphan_pointer_share: float,
    weak_required_slot_share: float,
) -> float:
    """Computes the surface fit score in ``[0.0, 1.0]``.

    Formula:
        ``fit_score = p * (1 - 0.35 * h) * (1 - 0.50 * o) * (1 - 0.40 * w)``

    where all four inputs are clamped to ``[0.0, 1.0]``:
    - ``p`` (`archetype_prob`): winning archetype probability; monotonic
      increasing.
    - ``h`` (`normalized_entropy`): normalized Shannon entropy of the winning
      choice distribution; monotonic decreasing.
    - ``o`` (`orphan_pointer_share`): share of bound pointers placed by
      `no-orphaned-pointers`; monotonic decreasing.
    - ``w`` (`weak_required_slot_share`): share of required slots whose
      instance bindings scored below `thresholds.instance` (or fell back to a
      default literal); monotonic decreasing.
    """
    p = min(max(archetype_prob, 0.0), 1.0)
    h = min(max(normalized_entropy, 0.0), 1.0)
    o = min(max(orphan_pointer_share, 0.0), 1.0)
    w = min(max(weak_required_slot_share, 0.0), 1.0)
    score = p * (1.0 - 0.35 * h) * (1.0 - 0.50 * o) * (1.0 - 0.40 * w)
    return min(max(score, 0.0), 1.0)


def _normalize_pointer_key(raw: str) -> str:
    """Normalizes a bare key or JSON Pointer into a leading-slash pointer."""
    cleaned = raw.strip()
    if not cleaned:
        return ""
    return cleaned if cleaned.startswith("/") else f"/{cleaned}"


def _normalize_labels(labels: Mapping[str, str] | None) -> dict[str, str]:
    """Normalizes an optional pointer-to-label map into leading-slash pointers."""
    if not labels:
        return {}
    out: dict[str, str] = {}
    for raw_ptr, raw_lbl in labels.items():
        norm_ptr = _normalize_pointer_key(str(raw_ptr))
        lbl_str = str(raw_lbl).strip()
        if norm_ptr and lbl_str:
            out[norm_ptr] = lbl_str
    return out


def _normalize_exclude(exclude: Collection[str] | None) -> frozenset[str]:
    """Normalizes an optional collection of excluded JSON Pointers."""
    if not exclude:
        return frozenset()
    return frozenset(
        norm for raw in exclude if (norm := _normalize_pointer_key(str(raw)))
    )


def _is_excluded_pointer(path: str, exclude: Collection[str]) -> bool:
    """Returns whether `path` equals or is nested under any pointer in `exclude`."""
    if not exclude:
        return False
    return any(path == ex or path.startswith(f"{ex}/") for ex in exclude)


def _apply_label_override(
    ptr: PointerSummary, norm_labels: Mapping[str, str]
) -> PointerSummary:
    """Replaces `ptr.label` when `norm_labels` defines an agent label for `ptr.path`."""
    override = norm_labels.get(ptr.path)
    if override is not None and override != ptr.label:
        return replace(ptr, label=override)
    return ptr


def _resolve_pointer_value(payload: Mapping[str, Any], pointer: str) -> Any:
    """Resolves an RFC 6901 JSON Pointer against `payload`, or returns None."""
    if not payload or not pointer.startswith("/"):
        return None
    current: Any = payload
    for raw_seg in pointer.lstrip("/").split("/"):
        seg = raw_seg.replace("~1", "/").replace("~0", "~")
        if isinstance(current, Mapping) and seg in current:
            current = current[seg]
        elif (
            isinstance(current, Sequence)
            and not isinstance(current, (str, bytes))
            and seg.isdigit()
            and int(seg) < len(current)
        ):
            current = current[int(seg)]
        else:
            return None
    return current


def _build_parent_object_summary(
    parent: str, normalized: Sequence[PointerSummary]
) -> PointerSummary:
    """Synthesizes a parent `object` `PointerSummary` for grouped child pointers."""
    parent_key = split_pointer(parent)[1]
    children = [p for p in normalized if p.parent == parent]
    return PointerSummary(
        path=parent,
        value_type="object",
        cardinality=len(children),
        mutable_hint=any(c.mutable_hint for c in children),
        semantic_type=SemanticType.OBJECT,
        key=parent_key,
        label=humanize_key(parent_key),
    )


def _build_sample_pointer_summary(sample: str) -> PointerSummary:
    """Builds a scalar `image_url` `PointerSummary` for an array sample pointer."""
    s_parent, s_key = split_pointer(sample)
    return PointerSummary(
        path=sample,
        value_type="string",
        cardinality=1,
        semantic_type=SemanticType.IMAGE_URL,
        key=s_key,
        label=humanize_key(s_key),
        parent=s_parent,
    )


def _maybe_append_parent_summary(
    ptr: PointerSummary,
    filtered: Sequence[PointerSummary],
    excluded_parents: set[str],
    norm_exclude: Collection[str],
    norm_labels: Mapping[str, str],
    result: list[PointerSummary],
) -> None:
    """Appends a synthesized parent object `PointerSummary` when unseen."""
    parent = ptr.parent or ""
    if (
        not parent
        or parent in excluded_parents
        or _is_excluded_pointer(parent, norm_exclude)
    ):
        return
    excluded_parents.add(parent)
    summary = _build_parent_object_summary(parent, filtered)
    result.append(_apply_label_override(summary, norm_labels))


def _append_sample_summaries(
    ptr: PointerSummary,
    existing_paths: set[str],
    norm_exclude: Collection[str],
    norm_labels: Mapping[str, str],
    result: list[PointerSummary],
) -> None:
    """Appends scalar sample image `PointerSummary` entries for `ptr`."""
    for sample in ptr.sample_pointers:
        if sample in existing_paths or _is_excluded_pointer(sample, norm_exclude):
            continue
        existing_paths.add(sample)
        summary = _build_sample_pointer_summary(sample)
        result.append(_apply_label_override(summary, norm_labels))


def _normalize_pointers(
    pointers: Sequence[PointerSummary],
    *,
    labels: Mapping[str, str] | None = None,
    exclude: Collection[str] = (),
) -> tuple[PointerSummary, ...]:
    """Expands `pointers`, drops excluded paths, and applies agent `labels`."""
    norm_labels = _normalize_labels(labels)
    norm_exclude = _normalize_exclude(exclude)
    filtered = [p for p in pointers if not _is_excluded_pointer(p.path, norm_exclude)]
    existing_paths = {p.path for p in filtered}
    excluded_parents = existing_paths | {
        p.path for p in filtered if p.value_type == "array"
    }
    result: list[PointerSummary] = []
    for ptr in filtered:
        _maybe_append_parent_summary(
            ptr,
            filtered,
            excluded_parents,
            norm_exclude,
            norm_labels,
            result,
        )
        result.append(_apply_label_override(ptr, norm_labels))
        _append_sample_summaries(ptr, existing_paths, norm_exclude, norm_labels, result)
    return tuple(result)


def _in_range(value: int, bounds: Range | None) -> bool:
    """Returns whether `value` falls within inclusive `bounds`."""
    if bounds is None:
        return True
    low, high = bounds
    if low is not None and value < low:
        return False
    if high is not None and value > high:
        return False
    return True


def _matches_primary_type(sem_type: str, target: str, ptr: PointerSummary) -> bool:
    """Checks whether `ptr` directly satisfies semantic type `target`."""
    if target == sem_type:
        return True
    if target == "enum" and sem_type == "status":
        return True
    if target == "any":
        return ptr.value_type in {"string", "number", "boolean"}
    if target == "mutable":
        return ptr.mutable_hint and ptr.value_type in {"string", "number", "boolean"}
    if target in {"string", "long_text"} and sem_type == "empty":
        return ptr.mutable_hint and ptr.value_type == "string"
    return False


def _matches_fallback_type(sem_type: str, target: str) -> bool:
    """Checks coarse type compatibility (`number` and `string` supertypes)."""
    if target == "number":
        return sem_type in _NUMERIC_SEMANTIC_TYPES
    if target == "string":
        return sem_type in _TEXT_FALLBACK_TYPES
    return False


def _pointer_matches_types(
    ptr: PointerSummary, from_types: Sequence[str], *, allow_fallback: bool = True
) -> bool:
    """Returns whether `ptr` matches any semantic type in `from_types`."""
    for target in from_types:
        if _matches_primary_type(ptr.semantic_type, target, ptr):
            return True
    if not allow_fallback:
        return False
    return any(_matches_fallback_type(ptr.semantic_type, t) for t in from_types)


def _array_element_types(ptr: PointerSummary) -> set[str]:
    """Returns the set of element semantic types present on an array `ptr`."""
    types: set[str] = set()
    if ptr.element_keys:
        types.add("object")
    for sem in ptr.element_semantic_types.values():
        types.add(sem)
        if sem in _NUMERIC_SEMANTIC_TYPES:
            types.add("number")
    if not ptr.element_keys and ptr.cardinality > 0 and not types:
        types.add("string")
    return types


def _is_nested_mutable_setting(
    ptr: PointerSummary, pointers: Sequence[PointerSummary]
) -> bool:
    """Returns whether `ptr` is a child field of a mutable settings object."""
    if not ptr.mutable_hint or not ptr.parent:
        return False
    return any(
        p.path == ptr.parent and p.value_type == "object" and p.mutable_hint
        for p in pointers
    )


def _shape_matching_pointers(
    shape: ShapeFilter, pointers: Sequence[PointerSummary]
) -> list[PointerSummary]:
    """Returns pointers matching `shape.pointers`, excluding nested mutable settings."""
    matched: list[PointerSummary] = []
    for ptr in pointers:
        if shape.mutable is None and _is_nested_mutable_setting(ptr, pointers):
            continue
        if _pointer_matches_types(ptr, shape.pointers):
            matched.append(ptr)
    return matched


def _single_array_matches_shape(arr: PointerSummary, shape: ShapeFilter) -> bool:
    """Returns whether one array pointer `arr` satisfies `shape` array constraints."""
    if not _in_range(arr.cardinality, shape.array_length):
        return False
    if shape.element_types and not (
        _array_element_types(arr) & set(shape.element_types)
    ):
        return False
    if shape.element_keys:
        keys_low = {k.lower() for k in arr.element_keys}
        if not (keys_low & {k.lower() for k in shape.element_keys}):
            return False
    return True


def _matches_array_shape(
    shape: ShapeFilter, pointers: Sequence[PointerSummary]
) -> bool:
    """Checks `array_length`, `element_types`, and `element_keys` on array pointers."""
    if (
        shape.array_length is None
        and not shape.element_types
        and not shape.element_keys
    ):
        return True
    return any(
        _single_array_matches_shape(p, shape)
        for p in pointers
        if p.value_type == "array"
    )


def _pointer_prose_level(ptr: PointerSummary) -> str | None:
    """Extracts or computes the `prose.length` level for `ptr`."""
    level = ptr.hints.get("length")
    if isinstance(level, str):
        return level
    wc = ptr.hints.get("wordCount")
    if not isinstance(wc, (int, float)):
        return None
    if wc < 15:
        return "line"
    if wc < 60:
        return "blurb"
    return "summary" if wc < 200 else "article"


def _matches_prose_length(
    shape: ShapeFilter, pointers: Sequence[PointerSummary]
) -> bool:
    """Checks `shape.prose_length` against `long_text` and `markdown` pointers."""
    if not shape.prose_length:
        return True
    allowed = set(shape.prose_length)
    return any(_pointer_prose_level(p) in allowed for p in pointers)


def _matches_shape(
    shape: ShapeFilter,
    pointers: Sequence[PointerSummary],
    *,
    check_actions_gate: bool = False,
    actions_allowed: bool = True,
) -> bool:
    """Evaluates a `ShapeFilter` against normalized `pointers`."""
    if shape.is_empty:
        return True
    if check_actions_gate and shape.actions_allowed and not actions_allowed:
        return False
    if shape.mutable is not None:
        if not any(p.mutable_hint == shape.mutable for p in pointers):
            return False
    if shape.pointers:
        matched = _shape_matching_pointers(shape, pointers)
        if not matched or not _in_range(len(matched), shape.count):
            return False
    elif shape.count is not None and not _in_range(len(pointers), shape.count):
        return False
    if not _matches_array_shape(shape, pointers):
        return False
    return _matches_prose_length(shape, pointers)


def _find_sibling_pointer(
    ptr: PointerSummary,
    sibling_names: Sequence[str],
    from_types: Sequence[str],
    pointers: Sequence[PointerSummary],
) -> PointerSummary | None:
    """Finds a sibling pointer in `ptr.parent` matching `sibling_names` and `from_types`."""
    base_low = ptr.key.lower()
    targets_low = tuple(s.lower() for s in sibling_names)
    for cand in pointers:
        if cand.path == ptr.path or cand.parent != ptr.parent:
            continue
        if not _pointer_matches_types(cand, from_types):
            continue
        cand_low = cand.key.lower()
        if cand_low in targets_low:
            return cand
        if any(
            cand_low == f"{base_low}{t}" or cand_low == f"{base_low}_{t}"
            for t in targets_low
        ):
            return cand
    return None


def _absorbed_for_single_pointer(
    ptr: PointerSummary,
    pointers: Sequence[PointerSummary],
    has_currency: bool,
) -> list[str]:
    """Returns sibling pointer paths absorbed by `ptr`."""
    found: list[str] = []
    if has_currency and ptr.key.lower() == "currency":
        found.append(ptr.path)
    if ptr.semantic_type in _NUMERIC_SEMANTIC_TYPES:
        sib = _find_sibling_pointer(
            ptr,
            ("delta", "change", "diff", "previous"),
            ("number", "percent"),
            pointers,
        )
        if sib is not None:
            found.append(sib.path)
    if ptr.semantic_type == "bounded":
        for bound_key in ("min", "max", "total", "limit"):
            sib = _find_sibling_pointer(ptr, (bound_key,), ("number",), pointers)
            if sib is not None:
                found.append(sib.path)
    return found


def _collect_absorbed_siblings(
    pointers: Sequence[PointerSummary],
) -> set[str]:
    """Returns paths of pointers absorbed as delta, bound, or currency siblings."""
    has_currency = any(p.semantic_type == "currency" for p in pointers)
    by_parent: dict[str | None, list[PointerSummary]] = {}
    for ptr in pointers:
        by_parent.setdefault(ptr.parent, []).append(ptr)
    absorbed: set[str] = set()
    for ptr in pointers:
        siblings = by_parent.get(ptr.parent, ())
        absorbed.update(_absorbed_for_single_pointer(ptr, siblings, has_currency))
    return absorbed


def _page_title_pointer(
    pointers: Sequence[PointerSummary],
) -> PointerSummary | None:
    """Finds the top-level pointer that serves as the page title, if any."""
    for ptr in pointers:
        if ptr.parent or ptr.mutable_hint:
            continue
        if (
            ptr.key.lower() in _PAGE_TITLE_KEYS
            and ptr.semantic_type in _TEXT_FALLBACK_TYPES
        ):
            return ptr
    return None


def _is_avoided_key(ptr: PointerSummary, avoid_keys: Sequence[str]) -> bool:
    """Returns whether `ptr.key` or `ptr.hints['keyHint']` matches `avoid_keys`."""
    if not avoid_keys:
        return False
    low = ptr.key.lower()
    hint = str(ptr.hints.get("keyHint", "")).lower()
    return any(ak.lower() in low or ak.lower() == hint for ak in avoid_keys)


def _score_candidate_pointer(
    ptr: PointerSummary,
    slot: SlotSpec,
    preferred_paths: Sequence[str],
) -> tuple[int, int, int]:
    """Scores `ptr` for `slot` (higher is better): brief preference, prefer hint, type rank."""
    brief_rank = 1 if ptr.path in preferred_paths else 0
    low = ptr.key.lower()
    prefer_rank = (
        1
        if any(pref.lower() == low or pref.lower() in low for pref in slot.prefer)
        else 0
    )
    type_rank = 0
    for idx, target in enumerate(slot.from_types):
        if _matches_primary_type(ptr.semantic_type, target, ptr):
            type_rank = len(slot.from_types) - idx + 10
            break
    if type_rank == 0:
        for idx, target in enumerate(slot.from_types):
            if _matches_fallback_type(ptr.semantic_type, target):
                type_rank = len(slot.from_types) - idx
                break
    if "enum" in slot.from_types and ptr.semantic_type in {"status", "enum"}:
        type_rank += 20
    return (brief_rank, prefer_rank, type_rank)


def _is_eligible_scalar_candidate(
    ptr: PointerSummary,
    slot: SlotSpec,
    pointers: Sequence[PointerSummary],
    used: set[str],
) -> bool:
    """Checks whether `ptr` is an eligible candidate for non-repeated `slot`."""
    if ptr.path in used or not _pointer_matches_types(ptr, slot.from_types):
        return False
    if not slot.required and slot.name in _OPTIONAL_TEXT_KEYS:
        allowed_keys = _OPTIONAL_TEXT_KEYS[slot.name]
        return ptr.key.lower() in allowed_keys or (
            slot.name == "text" and ptr.semantic_type == "long_text"
        )
    if slot.mutable and not ptr.mutable_hint:
        return False
    if _is_avoided_key(ptr, slot.avoid_keys):
        return False
    return not _is_nested_mutable_setting(ptr, pointers)


def _format_choice_options(raw: Any) -> list[dict[str, str]] | None:
    """Converts a payload option sequence into `{label, value}` choice objects."""
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)) or not raw:
        return None
    formatted: list[dict[str, str]] = []
    for elem in raw:
        if isinstance(elem, Mapping) and "label" in elem and "value" in elem:
            formatted.append({"label": str(elem["label"]), "value": str(elem["value"])})
        elif not isinstance(elem, Mapping):
            text = str(elem)
            formatted.append({"label": text, "value": text})
    return formatted or None


def _bind_key_fallback_slot(
    bound_slots: Mapping[str, SlotBinding],
    pointers: Sequence[PointerSummary],
) -> SlotBinding:
    """Falls back to the label of the block's primary bound pointer for `from: ['key']`."""
    for prev in bound_slots.values():
        if prev.pointer:
            ptr = next((p for p in pointers if p.path == prev.pointer), None)
            if ptr is not None:
                return SlotBinding(literal=ptr.label or humanize_key(ptr.key))
    return SlotBinding()


def _bind_scalar_slot(
    slot: SlotSpec,
    pointers: Sequence[PointerSummary],
    used: set[str],
    *,
    preferred_paths: Sequence[str] = (),
    payload: Mapping[str, Any] | None = None,
) -> SlotBinding:
    """Binds a single non-repeated `SlotSpec` against available `pointers`."""
    candidates = [
        p for p in pointers if _is_eligible_scalar_candidate(p, slot, pointers, used)
    ]
    if not candidates:
        return (
            SlotBinding(literal=slot.default)
            if slot.default is not None
            else SlotBinding()
        )
    best = max(
        candidates,
        key=lambda p: _score_candidate_pointer(p, slot, preferred_paths),
    )
    if slot.name == "categories" and payload:
        opts = _format_choice_options(_resolve_pointer_value(payload, best.path))
        if opts is not None:
            return SlotBinding(
                literal=opts,
                items=({"$claimed": SlotBinding(pointer=best.path)},),
            )
    return SlotBinding(pointer=best.path, semantic_type=best.semantic_type)


def _action_slot_binding(
    spec: ActionSpec, *, element_keys: Sequence[str] = ()
) -> SlotBinding:
    """Builds the `action` `SlotBinding` carrying `ActionSpec` metadata."""
    meta: dict[str, SlotBinding] = {}
    eff_key = spec.key or (
        "id" if spec.scope is not None and "id" in element_keys else None
    )
    if eff_key:
        meta["$key"] = SlotBinding(literal=eff_key)
    if spec.scope:
        meta["$scope"] = SlotBinding(literal=spec.scope)
    if spec.context:
        meta["$context"] = SlotBinding(
            fields={
                name: SlotBinding(pointer=ptr) for name, ptr in spec.context.items()
            }
        )
    if spec.style is not None:
        meta["$style"] = SlotBinding(literal=spec.style.value)
    return SlotBinding(literal=spec.id, fields=meta)


def _score_element_key(
    ek: str,
    ek_sem: SemanticType,
    field_spec: SlotSpec,
    preferred_names: set[str],
) -> int | None:
    """Returns a non-negative match score for `ek` against `field_spec`, or None."""
    fake_ptr = PointerSummary(
        path=ek,
        value_type="string",
        cardinality=1,
        semantic_type=ek_sem,
        key=ek,
    )
    if _is_avoided_key(fake_ptr, field_spec.avoid_keys):
        return None
    if not _pointer_matches_types(fake_ptr, field_spec.from_types):
        return None
    low_ek = ek.lower()
    is_pref = any(pref == low_ek or pref in low_ek for pref in preferred_names)
    return (10 if is_pref else 0) + (5 if ek_sem in field_spec.from_types else 1)


def _pick_best_element_key(
    arr_ptr: PointerSummary,
    field_name: str,
    field_spec: SlotSpec,
    used_keys: set[str],
    *,
    min_score: int = 0,
) -> str | None:
    """Selects the best matching relative key on `arr_ptr` for `field_spec`."""
    best_key: str | None = None
    best_score = min_score - 1
    default_prefs = (
        ("name", "title", "label", "headline")
        if field_name in {"headline", "title", "label"} and not field_spec.prefer
        else ()
    )
    preferred_names = {
        p.lower() for p in (*field_spec.prefer, *default_prefs, field_name)
    }
    for ek in arr_ptr.element_keys:
        if ek in used_keys or ek.lower() in {"actions", "action"}:
            continue
        ek_sem = arr_ptr.element_semantic_types.get(ek, SemanticType.STRING)
        score = _score_element_key(ek, ek_sem, field_spec, preferred_names)
        if score is not None and score > best_score:
            best_score = score
            best_key = ek
    return best_key


def _bind_element_field_pass(
    arr_ptr: PointerSummary,
    field_group: Sequence[tuple[str, SlotSpec]],
    bound_fields: dict[str, SlotBinding],
    used_keys: set[str],
    *,
    min_score: int,
) -> None:
    """Binds unbound element fields in `field_group` at `min_score`."""
    for field_name, field_spec in field_group:
        if field_name in bound_fields:
            continue
        best_key = _pick_best_element_key(
            arr_ptr,
            field_name,
            field_spec,
            used_keys,
            min_score=min_score,
        )
        if best_key is not None:
            used_keys.add(best_key)
            bound_fields[field_name] = SlotBinding(
                pointer=best_key,
                semantic_type=arr_ptr.element_semantic_types.get(
                    best_key, SemanticType.STRING
                ),
            )
        elif min_score == 0 and not arr_ptr.element_keys and field_spec.required:
            bound_fields[field_name] = SlotBinding(pointer="")


def _bind_repeated_element_field(
    arr_ptr: PointerSummary,
    field_spec: SlotSpec,
    used_keys: set[str],
) -> tuple[dict[str, SlotBinding], ...]:
    """Binds a repeated element field (such as `comparison.attributes`) to `{label, value}` pairs."""
    excluded = {"id", "action", "actions"}
    preferred_names = {p.lower() for p in field_spec.prefer}
    candidates = [
        ek
        for ek in arr_ptr.element_keys
        if ek not in used_keys
        and ek.lower() not in excluded
        and _score_element_key(
            ek,
            arr_ptr.element_semantic_types.get(ek, SemanticType.STRING),
            field_spec,
            preferred_names,
        )
        is not None
    ]
    if not candidates:
        candidates = [
            ek
            for ek in arr_ptr.element_keys
            if ek.lower() not in excluded
            and _score_element_key(
                ek,
                arr_ptr.element_semantic_types.get(ek, SemanticType.STRING),
                field_spec,
                preferred_names,
            )
            is not None
        ]
    if field_spec.max is not None:
        candidates = candidates[: field_spec.max]
    used_keys.update(candidates)
    return tuple(
        {
            "label": SlotBinding(literal=humanize_key(ek)),
            "value": SlotBinding(
                pointer=ek,
                semantic_type=arr_ptr.element_semantic_types.get(
                    ek, SemanticType.STRING
                ),
            ),
        }
        for ek in candidates
    )


def _bind_array_element_fields(
    arr_ptr: PointerSummary,
    fields: Mapping[str, SlotSpec],
) -> dict[str, SlotBinding]:
    """Binds relative per-element fields of a repeated array-backed slot."""
    bound_fields: dict[str, SlotBinding] = {}
    used_keys: set[str] = set()
    req_fields = tuple((k, v) for k, v in fields.items() if v.required and not v.repeat)
    opt_fields = tuple(
        (k, v) for k, v in fields.items() if not v.required and not v.repeat
    )
    rep_fields = tuple((k, v) for k, v in fields.items() if v.repeat)
    _bind_element_field_pass(arr_ptr, req_fields, bound_fields, used_keys, min_score=0)
    for cutoff in (10, 0):
        _bind_element_field_pass(
            arr_ptr, opt_fields, bound_fields, used_keys, min_score=cutoff
        )
    for field_name, field_spec in rep_fields:
        items = _bind_repeated_element_field(arr_ptr, field_spec, used_keys)
        if items:
            bound_fields[field_name] = SlotBinding(items=items)
    return bound_fields


def _unroll_single_array_item(
    ptr: PointerSummary, idx: int, fields: Mapping[str, SlotBinding]
) -> dict[str, SlotBinding]:
    """Unrolls one indexed item from `fields` for `ptr`."""
    row: dict[str, SlotBinding] = {}
    for f_name, f_bind in fields.items():
        if not f_bind.bound:
            continue
        if f_name == "action" and f_bind.pointer is None:
            row[f_name] = f_bind
        else:
            row[f_name] = SlotBinding(
                pointer=(
                    f"{ptr.path}/{idx}/{f_bind.pointer}"
                    if f_bind.pointer
                    else f"{ptr.path}/{idx}"
                ),
                semantic_type=f_bind.semantic_type,
            )
    return row


def _unroll_array_items(
    ptr: PointerSummary,
    fields: Mapping[str, SlotBinding],
    *,
    max_items: int | None = None,
) -> tuple[dict[str, SlotBinding], ...]:
    """Unrolls `fields` into indexed element bindings across `ptr.cardinality`."""
    limit = (
        min(ptr.cardinality, max_items) if max_items is not None else ptr.cardinality
    )
    return tuple(_unroll_single_array_item(ptr, idx, fields) for idx in range(limit))


def _attach_collection_item_metadata(
    ptr: PointerSummary,
    fields: dict[str, SlotBinding],
    scoped_actions: Sequence[ActionSpec],
) -> None:
    """Attaches implicit `id` field and scoped item action onto `fields`."""
    if "id" in ptr.element_keys and "id" not in fields:
        fields["id"] = SlotBinding(pointer="id")
    scoped = next((a for a in scoped_actions if a.scope == ptr.path), None)
    if scoped is not None:
        fields["action"] = _action_slot_binding(scoped, element_keys=ptr.element_keys)


def _try_bind_single_array(
    block_id: str,
    slot: SlotSpec,
    ptr: PointerSummary,
    scoped_actions: Sequence[ActionSpec],
) -> SlotBinding | None:
    """Attempts to bind repeated `slot` to array pointer `ptr`."""
    fields = _bind_array_element_fields(ptr, slot.fields)
    if any(
        f_spec.required and f_name not in fields
        for f_name, f_spec in slot.fields.items()
    ):
        return None
    if block_id == "collection":
        _attach_collection_item_metadata(ptr, fields, scoped_actions)
    should_unroll = block_id == "steps" or not ptr.element_keys
    items = (
        _unroll_array_items(
            ptr, fields, max_items=slot.max if slot.max is not None else 25
        )
        if should_unroll
        else ()
    )
    return SlotBinding(pointer=ptr.path, fields=fields, items=items)


def _bind_array_repeated_slot(
    block_id: str,
    slot: SlotSpec,
    pointers: Sequence[PointerSummary],
    used: set[str],
    *,
    scoped_actions: Sequence[ActionSpec] = (),
) -> SlotBinding:
    """Binds a repeated slot whose `from_types` is ``('array',)``."""
    for ptr in pointers:
        if ptr.path in used or ptr.value_type != "array" or ptr.cardinality <= 0:
            continue
        bound = _try_bind_single_array(block_id, slot, ptr, scoped_actions)
        if bound is not None:
            return bound
    return SlotBinding()


def _bind_actions_slot(slot: SlotSpec, actions: Sequence[ActionSpec]) -> SlotBinding:
    """Binds `actions.buttons` from surface-level `ActionSpec` entries."""
    surface_actions = [a for a in actions if a.scope is None]
    if not surface_actions:
        return SlotBinding()
    if slot.max is not None:
        surface_actions = surface_actions[: slot.max]
    items = tuple(
        {
            "action": _action_slot_binding(act),
            "label": SlotBinding(literal=act.label),
        }
        for act in surface_actions
    )
    return SlotBinding(items=items)


def _bind_groups_slot(
    pointers: Sequence[PointerSummary],
    used: set[str],
) -> SlotBinding:
    """Binds `groups.groups` from object pointers and their mutable child rows."""
    group_items: list[dict[str, SlotBinding]] = []
    for obj_ptr in pointers:
        if obj_ptr.path in used or obj_ptr.value_type != "object":
            continue
        child_rows = [
            p
            for p in pointers
            if p.parent == obj_ptr.path
            and p.path not in used
            and p.mutable_hint
            and p.value_type in {"string", "number", "boolean"}
        ]
        if not child_rows:
            continue
        row_items = tuple(
            {
                "label": SlotBinding(literal=row.label or humanize_key(row.key)),
                "value": SlotBinding(pointer=row.path),
            }
            for row in child_rows
        )
        group_items.append({
            "heading": SlotBinding(literal=obj_ptr.label or humanize_key(obj_ptr.key)),
            "rows": SlotBinding(items=row_items),
        })
    if not group_items:
        return SlotBinding()
    return SlotBinding(items=tuple(group_items))


def _bind_sibling_item_field(
    block_id: str,
    f_name: str,
    sib: PointerSummary,
    payload: Mapping[str, Any] | None,
) -> SlotBinding:
    """Binds a sibling field on a scalar-repeated item."""
    if block_id == "form" and payload:
        raw = _resolve_pointer_value(payload, sib.path)
        if (
            f_name in {"min", "max"}
            and isinstance(raw, (int, float))
            and not isinstance(raw, bool)
        ):
            return SlotBinding(
                literal=raw,
                items=({"$claimed": SlotBinding(pointer=sib.path)},),
            )
        if f_name == "options":
            opts = _format_choice_options(raw)
            if opts is not None:
                return SlotBinding(
                    literal=opts,
                    items=({"$claimed": SlotBinding(pointer=sib.path)},),
                )
    return SlotBinding(pointer=sib.path)


def _build_scalar_item_mapping(
    ptr: PointerSummary,
    slot: SlotSpec,
    pointers: Sequence[PointerSummary],
    *,
    block_id: str = "",
    payload: Mapping[str, Any] | None = None,
) -> dict[str, SlotBinding]:
    """Builds the per-element field mapping for one scalar pointer in `items`/`rows`."""
    item: dict[str, SlotBinding] = {}
    for f_name, f_spec in slot.fields.items():
        if "key" in f_spec.from_types:
            item[f_name] = SlotBinding(literal=ptr.label or humanize_key(ptr.key))
        elif f_spec.sibling:
            sib = _find_sibling_pointer(
                ptr, f_spec.sibling, f_spec.from_types, pointers
            )
            if sib is not None:
                item[f_name] = _bind_sibling_item_field(block_id, f_name, sib, payload)
        elif f_name == "value" or "any" in f_spec.from_types:
            item[f_name] = SlotBinding(pointer=ptr.path)
    return item


def _is_scalar_repeated_candidate(
    ptr: PointerSummary,
    block_id: str,
    slot: SlotSpec,
    pointers: Sequence[PointerSummary],
    used: set[str],
    absorbed: set[str],
) -> bool:
    """Checks whether `ptr` can be an element in a scalar-repeated slot."""
    if ptr.path in used or ptr.path in absorbed:
        return False
    if ptr.path.count("/") >= 2 and "/0/" in ptr.path:
        return False
    if block_id != "form" and _is_nested_mutable_setting(ptr, pointers):
        return False
    if block_id in {"headline", "facts"} and (
        ptr.semantic_type in _NON_FACT_SEMANTIC_TYPES
    ):
        return False
    return _pointer_matches_types(ptr, slot.from_types)


def _select_candidates_by_salience(
    candidates: list[PointerSummary],
    slot: SlotSpec,
    salience_scores: Mapping[str, float],
    salience_spec: QuestionSpec | None,
) -> list[PointerSummary]:
    """Orders and filters `candidates` according to `salience_scores` and `slot.max`."""
    ordered = list(candidates)
    if slot.order_by == "salience" and salience_scores:
        ordered.sort(key=lambda p: -salience_scores.get(p.path, 0.0))
    if salience_spec is not None and salience_spec.select and salience_scores:
        cut = salience_spec.select.get("aboveLevel", 0.0)
        above = [p for p in ordered if salience_scores.get(p.path, cut) >= cut]
        min_count = int(salience_spec.select.get("min", 1))
        ordered = above if len(above) >= min_count else ordered[:min_count]
    if slot.max is not None:
        ordered = ordered[: slot.max]
    return ordered


def _bind_scalar_repeated_slot(
    block_id: str,
    slot: SlotSpec,
    pointers: Sequence[PointerSummary],
    used: set[str],
    salience_scores: Mapping[str, float],
    salience_spec: QuestionSpec | None,
    *,
    payload: Mapping[str, Any] | None = None,
) -> SlotBinding:
    """Binds a repeated slot assembled from scalar pointers (`headline`, `facts`, `form`)."""
    absorbed = _collect_absorbed_siblings(pointers)
    candidates = [
        p
        for p in pointers
        if _is_scalar_repeated_candidate(p, block_id, slot, pointers, used, absorbed)
    ]
    if not candidates:
        return SlotBinding()
    selected = _select_candidates_by_salience(
        candidates, slot, salience_scores, salience_spec
    )
    items = tuple(
        _build_scalar_item_mapping(
            ptr, slot, pointers, block_id=block_id, payload=payload
        )
        for ptr in selected
    )
    return SlotBinding(items=items)


def _resolve_block_pattern(
    spec: BlockSpec, capabilities: PatternCapabilities
) -> tuple[str, dict[str, str]] | None:
    """Walks `spec.fallback` against `capabilities`, returning ``(pattern, preset_knobs)``."""
    # Check every candidate (including terminal patterns) against capabilities
    # so custom catalogs that omit `prose` or `facts` return None cleanly.
    candidates = (spec.pattern, *spec.fallback)
    for entry in candidates:
        pat_name, _, knob_val = entry.partition(":")
        if knob_val:
            if capabilities.has_pattern(pat_name, knob_val):
                return pat_name, {"layout": knob_val}
        elif capabilities.has_pattern(pat_name):
            return pat_name, {}
    return None


def _evaluate_single_measure(
    m_spec: MeasureSpec,
    bindings: BlockBindings,
    pointers_by_path: Mapping[str, PointerSummary],
) -> str | None:
    """Evaluates a single `MeasureSpec` against `bindings`."""
    parts = m_spec.derived_from.split(".")
    if len(parts) != 3 or parts[1] != "hints":
        return None
    slot_binding = bindings.get(parts[0])
    ptr = (
        pointers_by_path.get(slot_binding.pointer or "")
        if slot_binding is not None
        else None
    )
    raw_val = ptr.hints.get(parts[2]) if ptr is not None else None
    if isinstance(raw_val, (int, float)):
        return m_spec.level_for(float(raw_val))
    return None


def _compute_block_measures(
    spec: BlockSpec,
    bindings: BlockBindings,
    pointers_by_path: Mapping[str, PointerSummary],
) -> dict[str, str]:
    """Computes `MeasureSpec` levels (such as `prose.length`) from bound slots."""
    computed: dict[str, str] = {}
    for m_name, m_spec in spec.measures.items():
        level = _evaluate_single_measure(m_spec, bindings, pointers_by_path)
        if level is not None:
            computed[m_name] = level
    return computed


def _derive_from_key_hint(primary_ptr: PointerSummary, key_hint_map: Any) -> str | None:
    """Matches `primary_ptr` key or `keyHint` against `key_hint_map`."""
    if not isinstance(key_hint_map, Mapping):
        return None
    hint = str(primary_ptr.hints.get("keyHint", "")).lower()
    if hint in key_hint_map:
        return str(key_hint_map[hint])
    low_key = primary_ptr.key.lower()
    for k, derived in key_hint_map.items():
        if k in low_key:
            return str(derived)
    return None


def _derive_from_aspect_ratio(
    primary_ptr: PointerSummary, aspect_map: Any
) -> str | None:
    """Matches `primary_ptr.hints['aspectRatio']` against `aspect_map`."""
    ratio = primary_ptr.hints.get("aspectRatio")
    if not isinstance(aspect_map, Mapping) or not isinstance(ratio, (int, float)):
        return None
    for thresh_str, derived in aspect_map.get("under", {}).items():
        if float(ratio) < float(thresh_str):
            return str(derived)
    for thresh_str, derived in aspect_map.get("over", {}).items():
        if float(ratio) > float(thresh_str):
            return str(derived)
    return None


def _derive_anatomy_from_hints(
    q_spec: QuestionSpec,
    bindings: BlockBindings,
    pointers_by_path: Mapping[str, PointerSummary],
) -> str | None:
    """Evaluates `q_spec.derived_when` against the block's primary bound pointer."""
    if not q_spec.derived_when:
        return None
    primary_ptr = next(
        (pointers_by_path[p] for p in bindings.pointers() if p in pointers_by_path),
        None,
    )
    if primary_ptr is None:
        return None
    from_key = _derive_from_key_hint(primary_ptr, q_spec.derived_when.get("keyHint"))
    if from_key is not None:
        return from_key
    return _derive_from_aspect_ratio(
        primary_ptr, q_spec.derived_when.get("aspectRatio")
    )


def _find_matching_item_label(
    field_name: str,
    allowed: set[str],
    bindings: BlockBindings,
    pointers_by_path: Mapping[str, PointerSummary],
) -> str | None:
    """Finds the label of the first bound item whose `field_name` has a type in `allowed`."""
    for slot_binding in bindings.slots.values():
        for item in slot_binding.items:
            sub = item.get(field_name)
            ptr = pointers_by_path.get(sub.pointer or "") if sub is not None else None
            if ptr is not None and ptr.semantic_type in allowed:
                return ptr.label or ptr.key
    return None


def _anatomy_applies(
    q_spec: QuestionSpec,
    bindings: BlockBindings,
    pointers_by_path: Mapping[str, PointerSummary],
) -> tuple[bool, dict[str, str]]:
    """Checks `q_spec.applies_when` and returns placeholder values if applicable."""
    if not q_spec.applies_when:
        return True, {}
    for field_name, required_sem in q_spec.applies_when.items():
        allowed = {required_sem} if isinstance(required_sem, str) else set(required_sem)
        matched_label = _find_matching_item_label(
            field_name, allowed, bindings, pointers_by_path
        )
        if matched_label is not None:
            return True, {"label": matched_label}
    return False, {}


def _filter_anatomy_options(
    q_spec: QuestionSpec, capabilities: PatternCapabilities
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Removes choice options whose `pattern:<name>.<variant>` requirement fails."""
    options: list[str] = []
    texts: list[str] = []
    for opt_id, desc in q_spec.options.items():
        reqs = q_spec.requires.get(opt_id, ())
        supported = True
        for req in reqs:
            match = _PATTERN_VARIANT_REQ_RE.match(req)
            if match is not None and not capabilities.has_pattern(
                match.group(1), match.group(2)
            ):
                supported = False
                break
        if supported:
            options.append(opt_id)
            texts.append(desc)
    return tuple(options), tuple(texts)


def _expected_score(answer: DecisionAnswer) -> float:
    """Returns `answer.expected` or computes the mean index from `distribution`."""
    if answer.expected is not None:
        return float(answer.expected)
    return sum(
        idx * prob
        for idx, (_, prob) in enumerate(answer.distribution.probabilities.items())
    )


def _prominence_level(score: float) -> str:
    """Maps a `picture.prominence` expected score in `[0, 3]` to its knob name."""
    levels = ("mark", "supporting", "leading", "full")
    idx = min(max(int(score + 0.5), 0), len(levels) - 1)
    return levels[idx]


def _single_requirement_holds(
    req: str,
    bindings: BlockBindings,
    capabilities: PatternCapabilities,
    actions_allowed: bool,
    has_image: bool,
) -> bool:
    """Checks one entry of a question option's `requires` list."""
    if req == "actions_allowed":
        return actions_allowed
    match = _PATTERN_VARIANT_REQ_RE.match(req)
    if match is not None:
        return capabilities.has_pattern(match.group(1), match.group(2))
    if req == "picture":
        items = bindings.get("items")
        pic_bound = (
            items is not None
            and "picture" in items.fields
            and items.fields["picture"].bound
        )
        return has_image and (pic_bound or bindings.is_bound("picture"))
    return bindings.is_bound(req)


def _option_requirements_hold(
    reqs: Sequence[str],
    bindings: BlockBindings,
    capabilities: PatternCapabilities,
    actions_allowed: bool,
    pointers: Sequence[PointerSummary],
) -> bool:
    """Checks whether all `requires` entries for a choice option are satisfied."""
    has_image = any(p.semantic_type in {"image_url", "media_object"} for p in pointers)
    return all(
        _single_requirement_holds(
            req, bindings, capabilities, actions_allowed, has_image
        )
        for req in reqs
    )


# ---------------------------------------------------------------------------
# The 11 Grammar Rules (`apply_<rule>`)
# ---------------------------------------------------------------------------


def apply_required_block_wins(
    plan: LayoutPlan,
    state: PlannerState,
) -> LayoutPlan:
    """Rule `required-block-wins`: `!` blocks are present whatever their gate says."""
    archetype = state.selected_archetype
    if archetype is None:
        return plan
    by_id = {b.block_id: b for b in plan.blocks}
    for ref in archetype.blocks:
        if ref.requirement != "required":
            continue
        if ref.id not in by_id:
            prob = state.gate_probabilities.get(ref.id, 1.0)
            by_id[ref.id] = PlannedBlock(
                block_id=ref.id,
                pattern=ref.id,
                probability=prob,
            )
    ordered = tuple(by_id[ref.id] for ref in archetype.blocks if ref.id in by_id)
    return replace(plan, blocks=ordered)


def apply_at_least(
    plan: LayoutPlan,
    state: PlannerState,
    grammar: ArchetypeGrammar | None = None,
) -> LayoutPlan:
    """Rule `at-least`: top up with highest-probability expected blocks when needed."""
    archetype = state.selected_archetype
    if archetype is None or len(plan.blocks) >= archetype.at_least:
        return plan
    gram = grammar or ArchetypeGrammar.default()
    by_id = {b.block_id: b for b in plan.blocks}
    candidates: list[tuple[float, int, BlockRef]] = []
    for idx, ref in enumerate(archetype.blocks):
        if ref.requirement != "expected" or ref.id in by_id:
            continue
        spec = gram.block(ref.id)
        if not _matches_shape(spec.shape, state.pointers):
            continue
        prob = state.gate_probabilities.get(ref.id, 0.0)
        candidates.append((prob, -idx, ref))
    candidates.sort(reverse=True)
    for prob, _, ref in candidates:
        if len(by_id) >= archetype.at_least:
            break
        by_id[ref.id] = PlannedBlock(
            block_id=ref.id,
            pattern=gram.block(ref.id).pattern,
            probability=prob,
        )
    ordered = tuple(by_id[ref.id] for ref in archetype.blocks if ref.id in by_id)
    return replace(plan, blocks=ordered)


def apply_fallback_must_end(
    plan: LayoutPlan,
    state: PlannerState,
    grammar: ArchetypeGrammar | None = None,
    capabilities: PatternCapabilities | None = None,
) -> LayoutPlan:
    """Rule `fallback-must-end`: walks each block's fallback chain to a supported pattern."""
    del state
    gram = grammar or ArchetypeGrammar.default()
    caps = capabilities or _AllCapabilities()
    updated: list[PlannedBlock] = []
    for block in plan.blocks:
        spec = gram.block(block.block_id)
        resolved = _resolve_block_pattern(spec, caps)
        if resolved is None:
            continue
        pat_name, preset_knobs = resolved
        knobs = {**preset_knobs, **block.variant_knobs}
        updated.append(replace(block, pattern=pat_name, variant_knobs=knobs))
    return replace(plan, blocks=tuple(updated))


def apply_catalog_eligibility(
    plan: LayoutPlan,
    state: PlannerState,
) -> LayoutPlan:
    """Rule `catalog-eligibility`: required blocks must resolve on the catalog."""
    archetype = state.selected_archetype
    if archetype is None:
        return plan
    present_ids = {b.block_id for b in plan.blocks}
    for req_id in archetype.required_block_ids():
        if req_id not in present_ids:
            state.required_block_missing = True
    return plan


_PROSE_BODY_KEYS: frozenset[str] = frozenset(
    {"summary", "description", "body", "overview", "notes", "article"}
)


def _is_dedicated_prose_pointer(
    body_slot: SlotBinding | None, pointers: Sequence[PointerSummary]
) -> bool:
    """Returns whether `body_slot` binds a dedicated prose pointer in `pointers`."""
    if body_slot is None or not body_slot.pointer:
        return False
    ptr_summary = next((p for p in pointers if p.path == body_slot.pointer), None)
    if ptr_summary is None:
        return False
    if ptr_summary.semantic_type in {SemanticType.LONG_TEXT, SemanticType.MARKDOWN}:
        return True
    low_key = ptr_summary.key.lower()
    return any(pref in low_key for pref in _PROSE_BODY_KEYS)


def _apply_authored_prose_summary(
    block_id: str, bindings: BlockBindings, state: PlannerState
) -> BlockBindings:
    """Injects `state.copy.summary` into `prose.body` when no prose pointer is bound."""
    if block_id != "prose" or state.copy is None or not state.copy.summary:
        return bindings
    if _is_dedicated_prose_pointer(bindings.get("body"), state.pointers):
        return bindings
    return BlockBindings(
        slots={**bindings.slots, "body": SlotBinding(literal=state.copy.summary)}
    )


def _apply_compose_action(
    block_id: str,
    bindings: BlockBindings,
    plan_block_ids: set[str],
    actions: Sequence[ActionSpec],
) -> BlockBindings:
    """Binds `compose` send action from surface `ActionSpec` when `actions` block is absent."""
    if block_id != "compose" or "actions" in plan_block_ids:
        return bindings
    surface_act = next((a for a in actions if a.scope is None), None)
    if surface_act is None:
        return bindings
    return BlockBindings(
        slots={
            **bindings.slots,
            "action": _action_slot_binding(surface_act),
            "sendLabel": SlotBinding(literal=surface_act.label),
        }
    )


def apply_pointer_once_per_region(
    plan: LayoutPlan,
    state: PlannerState,
    planner: LayoutPlanner,
) -> LayoutPlan:
    """Rule `pointer-once-per-region`: blocks claim pointers in archetype order."""
    used: set[str] = set(state.page_claimed_pointers)
    plan_ids = {b.block_id for b in plan.blocks}
    updated: list[PlannedBlock] = []
    for block in plan.blocks:
        spec = planner.grammar.block(block.block_id)
        brief_sec = (
            state.brief.section(block.block_id) if state.brief is not None else None
        )
        preferred = brief_sec.pointers if brief_sec is not None else ()
        bindings = planner.bind_slots(
            spec,
            state.pointers,
            used,
            salience_scores=state.salience_scores,
            payload=state.payload,
            intent=state.intent,
            preferred_paths=preferred,
            actions=state.actions,
            labels=state.labels,
            exclude=state.exclude,
        )
        bindings = _apply_authored_prose_summary(block.block_id, bindings, state)
        bindings = _apply_compose_action(
            block.block_id, bindings, plan_ids, state.actions
        )
        used.update(bindings.pointers())
        knobs, instances = planner._resolve_block_questions(
            spec,
            bindings,
            state,
            actions_allowed=True,
            preset_knobs=block.variant_knobs,
        )
        updated.append(
            replace(
                block,
                bindings=bindings,
                variant_knobs=knobs,
                instances=instances,
            )
        )
    return replace(plan, blocks=tuple(updated))


def _adjust_collection_picture_layout(
    block: PlannedBlock, has_image: bool
) -> PlannedBlock:
    """Downgrades `collection` visual layouts to `rows` when no picture is bound."""
    if block.block_id != "collection" or block.variant_knobs.get("layout") not in {
        "cards",
        "grid",
        "reel",
    }:
        return block
    items = block.bindings.get("items")
    has_pic_field = (
        items is not None
        and "picture" in items.fields
        and items.fields["picture"].bound
    )
    if has_image and has_pic_field:
        return block
    return replace(block, variant_knobs={**block.variant_knobs, "layout": "rows"})


def _find_unused_mark_pointer(
    pointers: Sequence[PointerSummary], claimed: set[str]
) -> SlotBinding:
    """Finds an unclaimed logo, icon, or avatar `image_url` pointer for `page.mark`."""
    for ptr in pointers:
        if (
            ptr.path not in claimed
            and ptr.semantic_type == "image_url"
            and _is_avoided_key(ptr, tuple(_MARK_KEY_HINTS))
        ):
            return SlotBinding(pointer=ptr.path)
    return SlotBinding()


def _keep_picture_block(
    block: PlannedBlock, has_image: bool, mark_binding: SlotBinding
) -> tuple[bool, SlotBinding]:
    """Evaluates whether to keep a `picture` block and updates `page.mark`."""
    pic_slot = block.bindings.get("picture")
    if not has_image or pic_slot is None or not pic_slot.bound:
        return False, mark_binding
    if block.variant_knobs.get("prominence") == "mark":
        if not mark_binding.bound and pic_slot.pointer:
            mark_binding = SlotBinding(pointer=pic_slot.pointer)
        return False, mark_binding
    return True, mark_binding


def apply_pictures_need_a_look(
    plan: LayoutPlan,
    state: PlannerState,
) -> LayoutPlan:
    """Rule `pictures-need-a-look`: enforces image requirements and assigns `page.mark`."""
    has_image = any(
        p.semantic_type in {"image_url", "media_object"} for p in state.pointers
    )
    claimed: set[str] = set()
    updated_blocks: list[PlannedBlock] = []
    mark_binding = plan.page.mark
    for block in plan.blocks:
        if block.block_id == "picture":
            keep, mark_binding = _keep_picture_block(block, has_image, mark_binding)
            if not keep:
                continue
        adjusted = _adjust_collection_picture_layout(block, has_image)
        claimed.update(adjusted.bindings.pointers())
        updated_blocks.append(adjusted)
    if not mark_binding.bound:
        mark_binding = _find_unused_mark_pointer(state.pointers, claimed)
    page = replace(plan.page, mark=mark_binding)
    return replace(plan, blocks=tuple(updated_blocks), page=page)


def _is_pointer_covered(path: str, claimed: set[str]) -> bool:
    """Returns whether `path` or any ancestor/descendant pointer is in `claimed`."""
    if path in claimed:
        return True
    prefix = f"{path}/"
    return any(cp.startswith(prefix) or path.startswith(f"{cp}/") for cp in claimed)


def _has_uncovered_data_array(
    pointers: Sequence[PointerSummary],
    claimed: set[str],
    exclude: Collection[str] = (),
) -> bool:
    """Returns whether `pointers` has an unclaimed, non-excluded non-image array."""
    return any(
        p.value_type == "array"
        and p.cardinality > 0
        and not _is_excluded_pointer(p.path, exclude)
        and not _is_pointer_covered(p.path, claimed)
        and "image_url" not in p.element_semantic_types.values()
        for p in pointers
    )


def _try_recover_orphan_collection(
    blocks: list[PlannedBlock],
    present_ids: set[str],
    claimed: set[str],
    plan: LayoutPlan,
    state: PlannerState,
    planner: LayoutPlanner,
) -> None:
    """Appends a `collection` block when an unclaimed data array exists."""
    if present_ids & {"collection", "steps", "comparison"}:
        return
    if not _has_uncovered_data_array(state.pointers, claimed, state.exclude):
        return
    col_spec = planner.grammar.block("collection")
    resolved_col = _resolve_block_pattern(col_spec, planner._capabilities)
    if resolved_col is None:
        return
    col_pat, col_preset = resolved_col
    col_bindings = planner.bind_slots(
        col_spec,
        state.pointers,
        set(claimed),
        salience_scores=state.salience_scores,
        payload=state.payload,
        intent=state.intent,
        actions=state.actions,
        labels=state.labels,
        exclude=state.exclude,
    )
    if not col_bindings.is_bound("items"):
        return
    col_knobs, col_inst = planner._resolve_block_questions(
        col_spec,
        col_bindings,
        state,
        actions_allowed=plan.actions_allowed,
        preset_knobs=col_preset,
    )
    blocks.append(
        PlannedBlock(
            block_id="collection",
            pattern=col_pat,
            bindings=col_bindings,
            variant_knobs=col_knobs,
            instances=col_inst,
        )
    )
    recovered_ptrs = col_bindings.pointers()
    claimed.update(recovered_ptrs)
    state.orphan_pointers.update(recovered_ptrs)
    present_ids.add("collection")


_SECRET_FACT_AVOID_KEYS = ("ssn", "api_key", "token", "iban", "password", "secret")


def is_secret_pointer(ptr: PointerSummary) -> bool:
    """Whether `ptr` names a credential or identity number that facts must not show."""
    return _is_avoided_key(ptr, _SECRET_FACT_AVOID_KEYS)


def _uncovered_scalar_fact_pointers(
    state: PlannerState,
    claimed: set[str],
    *,
    allow_prose_fallback: bool,
) -> list[PointerSummary]:
    """Returns unclaimed, non-excluded top-level scalar pointers for `facts` recovery."""
    prose_types = {"long_text", "markdown", "code"}
    return [
        p
        for p in state.pointers
        if not p.parent
        and p.value_type in {"string", "number", "boolean"}
        and not _is_excluded_pointer(p.path, state.exclude)
        and not _is_nested_mutable_setting(p, state.pointers)
        and not is_secret_pointer(p)
        and not _is_pointer_covered(p.path, claimed)
        and (
            p.semantic_type not in _NON_FACT_SEMANTIC_TYPES
            or (allow_prose_fallback and p.semantic_type in prose_types)
        )
    ]


def _select_orphan_scalars(
    candidates: list[PointerSummary], salience_scores: Mapping[str, float]
) -> list[PointerSummary]:
    """Orders orphan scalar candidates by salience and caps at `MAX_ORPHAN_FACTS_ROWS`."""
    ordered = list(candidates)
    if salience_scores:
        ordered.sort(key=lambda p: -salience_scores.get(p.path, 0.0))
    return ordered[:MAX_ORPHAN_FACTS_ROWS]


def _merge_or_insert_facts_rows(
    blocks: list[PlannedBlock],
    present_ids: set[str],
    claimed: set[str],
    extra_rows: tuple[dict[str, SlotBinding], ...],
    facts_spec: BlockSpec,
    facts_pat: str,
    facts_preset: Mapping[str, str],
    plan: LayoutPlan,
    state: PlannerState,
    planner: LayoutPlanner,
) -> None:
    """Appends `extra_rows` to an existing `facts` block or inserts a new one."""
    if "facts" in present_ids:
        for idx, b in enumerate(blocks):
            if b.block_id == "facts":
                existing_rows = b.bindings.get("rows")
                merged_items = (
                    (*existing_rows.items, *extra_rows)
                    if existing_rows is not None
                    else extra_rows
                )
                new_bindings = BlockBindings(
                    slots={
                        **b.bindings.slots,
                        "rows": SlotBinding(items=merged_items),
                    }
                )
                blocks[idx] = replace(b, bindings=new_bindings)
                claimed.update(new_bindings.pointers())
                return
        return

    facts_bindings = BlockBindings(slots={"rows": SlotBinding(items=extra_rows)})
    facts_knobs, facts_inst = planner._resolve_block_questions(
        facts_spec,
        facts_bindings,
        state,
        actions_allowed=plan.actions_allowed,
        preset_knobs=facts_preset,
    )
    insert_idx = next(
        (idx for idx, b in enumerate(blocks) if b.block_id in {"actions", "compose"}),
        len(blocks),
    )
    blocks.insert(
        insert_idx,
        PlannedBlock(
            block_id="facts",
            pattern=facts_pat,
            bindings=facts_bindings,
            variant_knobs=facts_knobs,
            instances=facts_inst,
        ),
    )
    claimed.update(facts_bindings.pointers())


def apply_no_orphaned_pointers(
    plan: LayoutPlan,
    state: PlannerState,
    planner: LayoutPlanner,
) -> LayoutPlan:
    """Recovers unclaimed top-level pointers (at most 8 extra `facts` rows; never `exclude`d)."""
    state.orphan_pointers = set()
    claimed: set[str] = (
        set(state.page_claimed_pointers)
        | set(plan.page.title.pointers())
        | set(plan.page.subtitle.pointers())
        | set(plan.page.mark.pointers())
        | _collect_absorbed_siblings(state.pointers)
        | set(state.exclude)
    )
    for b in plan.blocks:
        claimed.update(b.bindings.pointers())

    blocks = list(plan.blocks)
    present_ids = {b.block_id for b in blocks}

    _try_recover_orphan_collection(blocks, present_ids, claimed, plan, state, planner)

    prose_ans = state.answers_by_id.get("gate:prose")
    allow_prose_fallback = (
        "prose" not in present_ids
        and plan.urgency < 1.5
        and (prose_ans is None or prose_ans.yes >= 0.50)
    )
    uncovered_scalars = _select_orphan_scalars(
        _uncovered_scalar_fact_pointers(
            state, claimed, allow_prose_fallback=allow_prose_fallback
        ),
        state.salience_scores,
    )
    if uncovered_scalars:
        facts_spec = planner.grammar.block("facts")
        resolved_facts = _resolve_block_pattern(facts_spec, planner._capabilities)
        if resolved_facts is not None:
            facts_pat, facts_preset = resolved_facts
            extra_rows = tuple(
                _build_scalar_item_mapping(
                    ptr, facts_spec.slots["rows"], state.pointers
                )
                for ptr in uncovered_scalars
            )
            state.orphan_pointers.update(p.path for p in uncovered_scalars)
            _merge_or_insert_facts_rows(
                blocks,
                present_ids,
                claimed,
                extra_rows,
                facts_spec,
                facts_pat,
                facts_preset,
                plan,
                state,
                planner,
            )

    return replace(plan, blocks=tuple(blocks))


def _is_collection_picture_sparse(
    items: SlotBinding | None, payload: Mapping[str, Any]
) -> bool:
    """Returns whether `picture` is unbound or missing on over half of `items`."""
    pic_field = items.fields.get("picture") if items is not None else None
    if pic_field is None or not pic_field.bound:
        return True
    if items is None or not items.pointer or not payload:
        return False
    arr_val = _resolve_pointer_value(payload, items.pointer)
    if (
        not isinstance(arr_val, Sequence)
        or isinstance(arr_val, (str, bytes))
        or not arr_val
    ):
        return False
    key = pic_field.pointer or ""
    with_pic = sum(1 for el in arr_val if isinstance(el, Mapping) and bool(el.get(key)))
    return with_pic * 2 < len(arr_val)


def apply_leading_all_or_none(
    plan: LayoutPlan,
    state: PlannerState,
) -> LayoutPlan:
    """Rule `leading-all-or-none`: falls back to `icon` or `none` if pictures are sparse."""
    updated: list[PlannedBlock] = []
    for block in plan.blocks:
        if block.block_id == "collection" and block.variant_knobs.get("leading") in {
            "thumbnail",
            "avatar",
        }:
            items = block.bindings.get("items")
            if _is_collection_picture_sparse(items, state.payload):
                fallback = (
                    "icon" if items is not None and "icon" in items.fields else "none"
                )
                block = replace(
                    block,
                    variant_knobs={**block.variant_knobs, "leading": fallback},
                )
        updated.append(block)
    return replace(plan, blocks=tuple(updated))


def _degrade_group_instances(
    instances: Mapping[str, Mapping[str, str]],
) -> dict[str, dict[str, str]]:
    """Degrades interactive `groups` row kinds (`switch`, `danger`, `navigation`) to `value`."""
    degraded: dict[str, dict[str, str]] = {}
    for elem_key, elem_map in instances.items():
        row_kind = elem_map.get("row_kind")
        if row_kind in {"switch", "danger", "navigation"}:
            degraded[elem_key] = {**elem_map, "row_kind": "value"}
        else:
            degraded[elem_key] = dict(elem_map)
    return degraded


def _gate_single_block(
    block: PlannedBlock,
    required_ids: set[str],
    state: PlannerState,
    gate: float = 1.0,
) -> PlannedBlock | None:
    """Applies the `actions_allowed == False` gate to one `PlannedBlock`."""
    if block.block_id in {"actions", "compose"}:
        if block.block_id in required_ids and any(
            b.bound for b in block.bindings.slots.values()
        ):
            state.action_gate_blocked = True
        return None
    if block.block_id == "filters":
        return None
    if (
        block.block_id == "collection"
        and block.variant_knobs.get("trailing") == "button"
    ):
        has_scoped = (
            _scoped_collection_action(block.bindings, state.actions) is not None
        )
        if has_scoped and state.gate_probabilities.get("collection", 0.0) >= gate:
            return block
        return replace(block, variant_knobs={**block.variant_knobs, "trailing": "none"})
    if block.block_id == "groups":
        return replace(block, instances=_degrade_group_instances(block.instances))
    return block


def _effective_action_confidence(plan: LayoutPlan, state: PlannerState) -> float:
    """Returns `plan.confidence`, pooling `confirm`+`checkout` when `act` has no `none`/`result` mass."""
    if plan.family == "act" and plan.archetype in {"confirm", "checkout"}:
        arch_ans = state.answers_by_id.get("archetype:act")
        if arch_ans is not None:
            probs = arch_ans.distribution.probabilities
            if probs.get("none", 1.0) <= 0.02 and probs.get("result", 1.0) <= 0.02:
                return max(
                    plan.confidence,
                    probs.get("confirm", 0.0) + probs.get("checkout", 0.0),
                )
    return plan.confidence


def _compute_action_gate(
    stakes: float, floor: float, cap: float, conservativeness: float
) -> float:
    """Computes the action gate threshold scaled by `stakes` and `conservativeness`."""
    clamped_stakes = min(max(stakes / 3.0, 0.0), 1.0)
    base = floor + (cap - floor) * clamped_stakes
    c = min(max(conservativeness, 0.0), 1.0)
    if c <= 0.5:
        return floor + (base - floor) * (c / 0.5)
    return base + (cap - base) * ((c - 0.5) / 0.5)


def apply_actions_gate(
    plan: LayoutPlan,
    state: PlannerState,
    floor: float,
    cap: float,
    *,
    conservativeness: float = 0.5,
) -> LayoutPlan:
    """Rule `actions-gate`: computes `actions_allowed` and gates interactive blocks.

    At default ``conservativeness=0.5`` the gate is
    ``floor + (cap - floor) * stakes / 3``; ``conservativeness=0.0`` lowers it
    to `floor` and ``1.0`` raises it to `cap`.
    """
    gate = _compute_action_gate(plan.stakes, floor, cap, conservativeness)
    allowed = _effective_action_confidence(plan, state) >= gate
    plan = replace(plan, actions_allowed=allowed)
    if allowed:
        return plan
    archetype = state.selected_archetype
    required_ids = set(archetype.required_block_ids()) if archetype else set()
    updated: list[PlannedBlock] = []
    for block in plan.blocks:
        gated = _gate_single_block(block, required_ids, state, gate)
        if gated is not None:
            updated.append(gated)
    return replace(plan, blocks=tuple(updated))


def _button_meta(idx: int, item: Mapping[str, SlotBinding]) -> tuple[str, str, str]:
    """Extracts `(action_id, label, style)` from a bound `actions.buttons` item."""
    act_slot = item.get("action")
    lbl_slot = item.get("label")
    act_id = (
        str(act_slot.literal)
        if act_slot is not None and act_slot.literal is not None
        else str(idx)
    )
    label = (
        str(lbl_slot.literal)
        if lbl_slot is not None and lbl_slot.literal is not None
        else act_id
    )
    style_slot = act_slot.fields.get("$style") if act_slot is not None else None
    style = (
        str(style_slot.literal)
        if style_slot is not None and style_slot.literal is not None
        else ""
    )
    return act_id, label, style


def _extract_button_records(
    raw_items: Sequence[Mapping[str, SlotBinding]],
    instances: Mapping[str, Mapping[str, str]],
    stakes: float,
) -> list[tuple[Mapping[str, SlotBinding], str, str, bool, bool]]:
    """Builds ``(item, act_id, label, is_primary, is_destructive)`` tuples."""
    records: list[tuple[Mapping[str, SlotBinding], str, str, bool, bool]] = []
    seen_primary = False
    for idx, item in enumerate(raw_items):
        act_id, label, _ = _button_meta(idx, item)
        inst = (
            instances.get(act_id)
            or instances.get(label)
            or instances.get(str(idx))
            or {}
        )
        is_dest = inst.get("destructive") == "true"
        is_prim = (
            inst.get("primary") == "true"
            and not seen_primary
            and not (stakes >= 2.0 and is_dest)
        )
        if is_prim:
            seen_primary = True
        records.append((item, act_id, label, is_prim, is_dest))
    return records


def _reorder_and_enforce_actions(block: PlannedBlock, stakes: float) -> PlannedBlock:
    """Enforces at most one primary button and demotes/reorders destructive buttons."""
    buttons = block.bindings.get("buttons")
    if buttons is None or not buttons.items:
        return block
    records = _extract_button_records(buttons.items, block.instances, stakes)
    sort_idx = 4 if (stakes >= 2.0 and any(r[4] for r in records)) else 3
    records.sort(key=lambda r: 1 if r[sort_idx] else 0)
    new_items = tuple(r[0] for r in records)
    new_instances: dict[str, dict[str, str]] = {}
    for idx, (_, act_id, label, is_prim, is_dest) in enumerate(records):
        entry = {
            "primary": "true" if is_prim else "false",
            "destructive": "true" if is_dest else "false",
        }
        new_instances[str(idx)] = entry
        new_instances[act_id] = entry
        new_instances[label] = entry
    new_buttons = replace(buttons, items=new_items)
    new_bindings = BlockBindings(slots={**block.bindings.slots, "buttons": new_buttons})
    return replace(block, bindings=new_bindings, instances=new_instances)


def apply_one_primary_action(
    plan: LayoutPlan,
    state: PlannerState,
) -> LayoutPlan:
    """Rule `one-primary-action`: at most one primary button; destructive demoted at high stakes."""
    del state
    updated = tuple(
        _reorder_and_enforce_actions(b, plan.stakes) if b.block_id == "actions" else b
        for b in plan.blocks
    )
    return replace(plan, blocks=updated)


def _terse_transform_block(
    block: PlannedBlock,
    prose_req: bool,
    has_page_pattern: bool,
) -> PlannedBlock | None:
    """Applies `urgency-terse` trimming to a single `PlannedBlock`."""
    if block.block_id == "prose" and not prose_req:
        return None
    if block.block_id == "headline":
        items = block.bindings.get("items")
        if items is not None and len(items.items) > 3:
            trimmed = replace(items, items=items.items[:3])
            return replace(
                block,
                bindings=BlockBindings(
                    slots={**block.bindings.slots, "items": trimmed}
                ),
            )
    if block.block_id == "actions" and has_page_pattern:
        return replace(block, variant_knobs={**block.variant_knobs, "sticky": "yes"})
    return block


def apply_urgency_terse(
    plan: LayoutPlan,
    state: PlannerState,
    capabilities: PatternCapabilities | None = None,
) -> LayoutPlan:
    """Rule `urgency-terse`: drops optional prose, caps headline at 3, sets sticky actions."""
    if plan.urgency < 1.5:
        return plan
    caps = capabilities or _AllCapabilities()
    has_page = caps.has_pattern("page")
    archetype = state.selected_archetype
    # Keep `prose` when it is required or when dropping it would violate `archetype.at_least`.
    prose_req = (
        archetype.requirement_of("prose") == "required"
        or len(plan.blocks) <= archetype.at_least
        if archetype is not None
        else False
    )
    updated: list[PlannedBlock] = []
    for block in plan.blocks:
        transformed = _terse_transform_block(block, prose_req, has_page)
        if transformed is not None:
            updated.append(transformed)
    has_actions = any(b.block_id == "actions" for b in updated)
    page = (
        replace(plan.page, sticky_actions=True)
        if (has_actions and has_page)
        else plan.page
    )
    return replace(plan, blocks=tuple(updated), page=page)


def _block_has_required_bindings(block: PlannedBlock, spec: BlockSpec) -> bool:
    """Returns whether `block` bound all required slots (and at least one slot)."""
    if not block.bindings.pointers() and not any(
        b.bound for b in block.bindings.slots.values()
    ):
        return False
    for slot_name, slot_spec in spec.slots.items():
        if slot_spec.required and not block.bindings.is_bound(slot_name):
            return False
    return True


def apply_no_empty_container(
    plan: LayoutPlan,
    state: PlannerState,
    grammar: ArchetypeGrammar | None = None,
) -> LayoutPlan:
    """Rule `no-empty-container`: drops blocks with unbound required slots."""
    gram = grammar or ArchetypeGrammar.default()
    kept = tuple(
        b
        for b in plan.blocks
        if _block_has_required_bindings(b, gram.block(b.block_id))
    )
    archetype = state.selected_archetype
    if archetype is not None:
        kept_ids = {b.block_id for b in kept}
        for req_id in archetype.required_block_ids():
            if req_id not in kept_ids:
                state.required_block_missing = True
        if not kept:
            state.required_block_missing = True
    return replace(plan, blocks=kept)


def _scoped_collection_action(
    bindings: BlockBindings, actions: Sequence[ActionSpec]
) -> ActionSpec | None:
    """Returns the first `ActionSpec` scoped to `bindings`'s `items` pointer."""
    items = bindings.get("items")
    if items is None or not items.pointer:
        return None
    return next((a for a in actions if a.scope == items.pointer), None)


def _form_mutable_pointers(plan: LayoutPlan) -> tuple[str, ...]:
    """Collects mutable pointers bound in `form.fields` across `plan.blocks`."""
    found: list[str] = []
    for block in plan.blocks:
        if block.block_id != "form":
            continue
        fields_slot = block.bindings.get("fields")
        if fields_slot is None:
            continue
        for item in fields_slot.items:
            val_slot = item.get("value")
            if val_slot is not None and val_slot.pointer:
                found.append(val_slot.pointer)
    return tuple(found)


def _decorate_action_block(
    block: PlannedBlock, form_ptrs: Sequence[str], has_plan_mutable: bool
) -> PlannedBlock:
    """Attaches `$mutable` and `$plan_mutable` slots to one action/compose block."""
    if block.block_id not in {"actions", "compose"}:
        return block
    extra: dict[str, SlotBinding] = {}
    if has_plan_mutable:
        extra["$plan_mutable"] = SlotBinding(literal=True)
    if block.block_id == "actions" and form_ptrs:
        extra["$mutable"] = SlotBinding(
            fields={p: SlotBinding(pointer=p) for p in form_ptrs}
        )
    if not extra:
        return block
    return replace(
        block, bindings=BlockBindings(slots={**block.bindings.slots, **extra})
    )


def _attach_plan_action_metadata(plan: LayoutPlan, state: PlannerState) -> LayoutPlan:
    """Attaches `$mutable` and `$plan_mutable` metadata onto surviving action blocks."""
    form_ptrs = _form_mutable_pointers(plan)
    has_plan_mutable = any(p.mutable_hint for p in state.pointers)
    if not form_ptrs and not has_plan_mutable:
        return plan
    updated = tuple(
        _decorate_action_block(b, form_ptrs, has_plan_mutable) for b in plan.blocks
    )
    return replace(plan, blocks=updated)


class LayoutPlanner:
    """Speculative single-batch layout planner for archetype-driven A2UI synthesis."""

    def __init__(
        self,
        grammar: ArchetypeGrammar | None = None,
        config: SynthesisConfig | None = None,
        *,
        capabilities: PatternCapabilities | None = None,
    ) -> None:
        """Initializes a layout planner with a grammar, config, and pattern capabilities."""
        self._grammar = grammar or ArchetypeGrammar.default()
        self._config = config or SynthesisConfig()
        self._capabilities: PatternCapabilities = (
            capabilities if capabilities is not None else _AllCapabilities()
        )

    @property
    def grammar(self) -> ArchetypeGrammar:
        """The `ArchetypeGrammar` governing this planner."""
        return self._grammar

    @property
    def config(self) -> SynthesisConfig:
        """The `SynthesisConfig` governing the pair budget and conservativeness."""
        return self._config

    def threshold(self, name: str) -> float:
        """The grammar's threshold `name`.

        Raises:
            KeyError: If the grammar does not define `name`.
        """
        return self._grammar.threshold(name)

    def bind_slots(
        self,
        spec: BlockSpec,
        pointers: Sequence[PointerSummary],
        used: set[str],
        *,
        salience_scores: Mapping[str, float] | None = None,
        payload: Mapping[str, Any] | None = None,
        intent: str = "",
        preferred_paths: Sequence[str] = (),
        actions: Sequence[ActionSpec] = (),
        labels: Mapping[str, str] | None = None,
        exclude: Collection[str] = (),
    ) -> BlockBindings:
        """Deterministically binds `spec.slots` against `pointers` excluding `used`."""
        norm_pointers = _normalize_pointers(pointers, labels=labels, exclude=exclude)
        local_used = set(used) | set(_normalize_exclude(exclude))
        bound_slots: dict[str, SlotBinding] = {}
        for slot_name, slot_spec in spec.slots.items():
            binding = self._bind_one_slot(
                spec,
                slot_spec,
                norm_pointers,
                local_used,
                salience_scores=salience_scores or {},
                payload=payload or {},
                intent=intent,
                preferred_paths=preferred_paths,
                actions=actions,
            )
            if not binding.bound and "key" in slot_spec.from_types:
                binding = _bind_key_fallback_slot(bound_slots, norm_pointers)
            if binding.bound:
                bound_slots[slot_name] = binding
                local_used.update(binding.pointers())
        return BlockBindings(slots=bound_slots)

    def _bind_one_slot(
        self,
        spec: BlockSpec,
        slot: SlotSpec,
        pointers: Sequence[PointerSummary],
        used: set[str],
        *,
        salience_scores: Mapping[str, float],
        payload: Mapping[str, Any],
        intent: str,
        preferred_paths: Sequence[str],
        actions: Sequence[ActionSpec],
    ) -> SlotBinding:
        """Dispatches binding for a single `SlotSpec`."""
        del intent
        if not slot.repeat:
            return _bind_scalar_slot(
                slot,
                pointers,
                used,
                preferred_paths=preferred_paths,
                payload=payload,
            )
        if slot.from_types == ("action",):
            return _bind_actions_slot(slot, actions)
        if slot.from_types == ("object",):
            return _bind_groups_slot(pointers, used)
        if slot.from_types == ("array",):
            scoped = tuple(a for a in actions if a.scope is not None)
            return _bind_array_repeated_slot(
                spec.id, slot, pointers, used, scoped_actions=scoped
            )
        return _bind_scalar_repeated_slot(
            spec.id,
            slot,
            pointers,
            used,
            salience_scores,
            spec.salience,
            payload=payload,
        )

    def _block_shape_holds(
        self,
        spec: BlockSpec,
        pointers: Sequence[PointerSummary],
        actions: Sequence[ActionSpec],
    ) -> bool:
        """Returns whether `spec.shape` holds against `pointers` and `actions`."""
        if spec.id == "actions":
            return any(a.scope is None for a in actions)
        return _matches_shape(spec.shape, pointers)

    def _is_required_block_viable(
        self,
        req_id: str,
        pointers: Sequence[PointerSummary],
        base_used: set[str],
        *,
        actions: Sequence[ActionSpec] = (),
    ) -> bool:
        """Returns whether required block `req_id` resolves and binds on `pointers`."""
        spec = self._grammar.block(req_id)
        if _resolve_block_pattern(spec, self._capabilities) is None:
            return False
        if not self._block_shape_holds(spec, pointers, actions):
            return False
        bindings = self.bind_slots(spec, pointers, set(base_used), actions=actions)
        return _block_has_required_bindings(
            PlannedBlock(block_id=req_id, pattern=spec.pattern, bindings=bindings),
            spec,
        )

    def _default_eligible(
        self,
        pointers: Sequence[PointerSummary],
        *,
        actions: Sequence[ActionSpec] = (),
    ) -> tuple[LayoutArchetype, ...]:
        """Filters `grammar.archetypes` by shape, catalog support, and required slots."""
        page_ptr = _page_title_pointer(pointers)
        base_used = {page_ptr.path} if page_ptr is not None else set()
        return tuple(
            arch
            for arch in self._grammar.archetypes
            if _matches_shape(arch.shape, pointers)
            and all(
                self._is_required_block_viable(
                    req_id, pointers, base_used, actions=actions
                )
                for req_id in arch.required_block_ids()
            )
        )

    def _block_satisfied_for_prior(
        self,
        spec: BlockSpec,
        pointers: Sequence[PointerSummary],
        base_used: set[str],
        actions: Sequence[ActionSpec],
    ) -> bool:
        """Returns whether `spec` counts as satisfied when ordering prior archetypes."""
        if spec.shape.is_empty:
            bindings = self.bind_slots(spec, pointers, set(base_used), actions=actions)
            return _block_has_required_bindings(
                PlannedBlock(block_id=spec.id, pattern=spec.pattern, bindings=bindings),
                spec,
            )
        return self._block_shape_holds(spec, pointers, actions)

    def _satisfied_block_count(
        self,
        arch: LayoutArchetype,
        pointers: Sequence[PointerSummary],
        actions: Sequence[ActionSpec] = (),
    ) -> int:
        """Counts how many blocks in `arch` satisfy their shape filter on `pointers`."""
        page_ptr = _page_title_pointer(pointers)
        base_used = {page_ptr.path} if page_ptr is not None else set()
        return sum(
            1
            for ref in arch.blocks
            if self._block_satisfied_for_prior(
                self._grammar.block(ref.id), pointers, base_used, actions
            )
        )

    def prior_archetypes(
        self,
        eligible: Sequence[LayoutArchetype],
        pointers: Sequence[PointerSummary],
        brief: LayoutBrief | None = None,
        *,
        actions: Sequence[ActionSpec] = (),
    ) -> tuple[LayoutArchetype, ...]:
        """Orders `eligible` archetypes by brief pin first, then satisfied block shapes."""
        norm = _normalize_pointers(pointers)
        pinned_families = (
            {r for r in brief.roles() if r != "none" and r in self._grammar.families()}
            if brief is not None
            else set()
        )
        pinned_blocks = (
            {r for r in brief.roles() if r in self._grammar.blocks}
            if brief is not None
            else set()
        )
        grammar_order = {a.id: idx for idx, a in enumerate(self._grammar.archetypes)}

        def _sort_key(arch: LayoutArchetype) -> tuple[int, int, int]:
            """Scores `arch` by brief pin priority, satisfied block shapes, and grammar order."""
            is_pinned = 0
            if arch.family in pinned_families:
                is_pinned = 2
            elif pinned_blocks and pinned_blocks.issubset(set(arch.block_ids())):
                is_pinned = 1
            satisfied = self._satisfied_block_count(arch, norm, actions)
            return (-is_pinned, -satisfied, grammar_order.get(arch.id, 999))

        return tuple(sorted(eligible, key=_sort_key))

    def _init_planner_state(
        self,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        eligible: Sequence[LayoutArchetype] | None,
        brief: LayoutBrief | None,
        payload: Mapping[str, Any] | None,
        copy: AuthoredCopy | None,
        templates: Sequence[SurfaceTemplate],
        actions: Sequence[ActionSpec],
        labels: Mapping[str, str] | None = None,
        exclude: Collection[str] = (),
    ) -> tuple[PlannerState, tuple[LayoutArchetype, ...]]:
        """Initializes `PlannerState` and prioritized archetypes for batch building."""
        norm_labels = _normalize_labels(labels)
        norm_exclude = _normalize_exclude(exclude)
        norm_pointers = _normalize_pointers(
            pointers, labels=norm_labels, exclude=norm_exclude
        )
        action_tuple = tuple(actions)
        if eligible is None:
            elig = self._default_eligible(norm_pointers, actions=action_tuple)
        else:
            has_surface_act = any(a.scope is None for a in action_tuple)
            elig = tuple(
                a
                for a in eligible
                if has_surface_act or "actions" not in a.required_block_ids()
            )
        prior = self.prior_archetypes(elig, norm_pointers, brief, actions=action_tuple)
        available_paths = {p.path for p in norm_pointers}
        matching_templates = tuple(
            t for t in templates if t.matches_payload(available_paths)
        )
        state = PlannerState(
            intent=intent,
            pointers=norm_pointers,
            eligible=elig,
            prior_archetypes=tuple(a.id for a in prior),
            brief=brief,
            batch=DecisionBatch(shared_context={}, questions=()),
            payload=dict(payload) if payload is not None else {},
            copy=copy,
            templates=matching_templates,
            actions=action_tuple,
            labels=norm_labels,
            exclude=norm_exclude,
        )
        return state, prior

    def build_batch(
        self,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        eligible: Sequence[LayoutArchetype] | None = None,
        brief: LayoutBrief | None = None,
        payload: Mapping[str, Any] | None = None,
        copy: AuthoredCopy | None = None,
        templates: Sequence[SurfaceTemplate] = (),
        actions: Sequence[ActionSpec] = (),
        labels: Mapping[str, str] | None = None,
        exclude: Collection[str] = (),
    ) -> tuple[DecisionBatch, PlannerState]:
        """Builds a speculative `DecisionBatch` and `PlannerState` for one surface.

        `labels` maps pointers to display labels that override humanized keys.
        `exclude` omits pointers from binding and orphan recovery.
        """
        state, prior = self._init_planner_state(
            intent,
            pointers,
            eligible=eligible,
            brief=brief,
            payload=payload,
            copy=copy,
            templates=templates,
            actions=actions,
            labels=labels,
            exclude=exclude,
        )
        questions: list[DecisionQuestion] = []
        self._append_template_question(questions, state)
        self._append_job_questions(questions, state)
        self._append_archetype_questions(questions, state)
        self._append_gate_and_anatomy_questions(questions, state)
        self._append_salience_questions(questions, state)
        self._append_instance_questions(questions, state, prior[:2])
        batch = DecisionBatch(
            shared_context={
                "intent": intent,
                "pointers": [p.path for p in state.pointers],
            },
            questions=tuple(questions),
        )
        state.batch = batch
        return batch, state

    def build_stage1_batch(
        self,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        eligible: Sequence[LayoutArchetype] | None = None,
        brief: LayoutBrief | None = None,
        payload: Mapping[str, Any] | None = None,
        copy: AuthoredCopy | None = None,
        templates: Sequence[SurfaceTemplate] = (),
        actions: Sequence[ActionSpec] = (),
        labels: Mapping[str, str] | None = None,
        exclude: Collection[str] = (),
    ) -> tuple[DecisionBatch, PlannerState]:
        """Builds Stage 1 (`template`, `family`, `stakes`, `urgency`, and `archetype:*`)."""
        state, _ = self._init_planner_state(
            intent,
            pointers,
            eligible=eligible,
            brief=brief,
            payload=payload,
            copy=copy,
            templates=templates,
            actions=actions,
            labels=labels,
            exclude=exclude,
        )
        questions: list[DecisionQuestion] = []
        self._append_template_question(questions, state)
        self._append_job_questions(questions, state)
        self._append_archetype_questions(questions, state)
        batch = DecisionBatch(
            shared_context={
                "intent": intent,
                "pointers": [p.path for p in state.pointers],
            },
            questions=tuple(questions),
        )
        state.batch = batch
        return batch, state

    def _needs_stage2_salience(
        self, gated_blocks: Sequence[BlockSpec], state: PlannerState
    ) -> bool:
        """Returns whether Stage 2 should ask salience questions for `gated_blocks`."""
        if not any(b.id in {"headline", "facts"} for b in gated_blocks):
            return False
        page_ptr = _page_title_pointer(state.pointers)
        absorbed = _collect_absorbed_siblings(state.pointers)
        sal_candidates = [
            ptr
            for ptr in state.pointers
            if self._is_salience_candidate(ptr, page_ptr, absorbed, state)
        ]
        return len(sal_candidates) > 3

    def build_stage2_batch(
        self,
        state: PlannerState,
        stage1_answers: Sequence[DecisionAnswer],
    ) -> DecisionBatch:
        """Builds Stage 2 (`gate`, `anatomy`, `salience`, and `instance` for the winning archetype)."""
        self._validate_and_index_answers(state, stage1_answers)
        if (
            self._read_template(state) is not None
            or self._check_no_fit_family(state)[0]
        ):
            state.trace.clear()
            return DecisionBatch(
                shared_context=dict(state.batch.shared_context), questions=()
            )
        family = self._read_family(state)
        archetype = (
            self._read_archetype(state, family)[0] if family is not None else None
        )
        state.trace.clear()
        if archetype is None:
            return DecisionBatch(
                shared_context=dict(state.batch.shared_context), questions=()
            )

        questions: list[DecisionQuestion] = list(state.batch.questions)
        seen_ids = {q.id for q in questions}
        pinned_blocks = (
            {r for r in state.brief.roles() if r in self._grammar.blocks}
            if state.brief is not None
            else set()
        )
        gated_blocks = self._collect_gated_blocks(state, (archetype,))

        for spec in gated_blocks:
            if spec.gate is not None and spec.id not in pinned_blocks:
                self._try_add_question(
                    questions,
                    DecisionQuestion(
                        id=f"gate:{spec.id}",
                        kind=QuestionKind.BOOLEAN,
                        prompt=spec.gate.question,
                        context={"yes": spec.gate.yes, "no": spec.gate.no},
                        allow_none=False,
                    ),
                    state,
                    seen_ids=seen_ids,
                )
        self._append_anatomy_for_blocks(questions, gated_blocks, state, seen_ids)
        if self._needs_stage2_salience(gated_blocks, state):
            self._append_salience_questions(questions, state)
        self._append_instance_questions(questions, state, (archetype,))
        stage1_len = len(state.batch.questions)
        stage2_questions = tuple(questions[stage1_len:])
        state.batch = DecisionBatch(
            shared_context=dict(state.batch.shared_context),
            questions=tuple(questions),
        )
        return DecisionBatch(
            shared_context=dict(state.batch.shared_context),
            questions=stage2_questions,
        )

    def _try_add_question(
        self,
        questions: list[DecisionQuestion],
        question: DecisionQuestion,
        state: PlannerState,
        *,
        seen_ids: set[str],
    ) -> bool:
        """Appends `question` if its ID is unseen and within `config.max_pairs`."""
        if question.id in seen_ids:
            return True
        current_pairs = sum(len(q.candidates()) for q in questions)
        if current_pairs + len(question.candidates()) > self._config.max_pairs:
            state.budget_exhausted = True
            return False
        seen_ids.add(question.id)
        questions.append(question)
        return True

    def _pinned_families(self, state: PlannerState) -> list[str]:
        """Returns non-`none` eligible family roles pinned by `state.brief`."""
        if state.brief is None:
            return []
        eligible_fams = {a.family for a in state.eligible}
        return [
            r
            for r in state.brief.roles()
            if r != "none" and r in self._grammar.families() and r in eligible_fams
        ]

    def _append_template_question(
        self, questions: list[DecisionQuestion], state: PlannerState
    ) -> None:
        """Emits the `template` choice question when matching templates exist."""
        if not state.templates:
            return
        seen_ids = {q.id for q in questions}
        self._try_add_question(
            questions,
            DecisionQuestion(
                id="template",
                kind=QuestionKind.CHOICE,
                prompt=(
                    "Which registered template best fits this surface, or"
                    " should a layout be composed?"
                ),
                options=(*(t.template_id for t in state.templates), "compose"),
                option_texts=(
                    *(t.description for t in state.templates),
                    (
                        "Compose a layout from archetypes instead of using a fixed"
                        " template."
                    ),
                ),
                allow_none=False,
            ),
            state,
            seen_ids=seen_ids,
        )

    def _append_job_questions(
        self, questions: list[DecisionQuestion], state: PlannerState
    ) -> None:
        """Emits `family` (unless brief-pinned), `stakes`, and `urgency` questions."""
        seen_ids = {q.id for q in questions}
        if not self._pinned_families(state):
            fam_spec = self._grammar.job["family"]
            self._try_add_question(
                questions,
                DecisionQuestion(
                    id="family",
                    kind=QuestionKind.CHOICE,
                    prompt=fam_spec.question,
                    options=tuple(fam_spec.options),
                    option_texts=tuple(fam_spec.options.values()),
                    allow_none=fam_spec.allow_none and "none" not in fam_spec.options,
                ),
                state,
                seen_ids=seen_ids,
            )
        for score_id in ("stakes", "urgency"):
            spec = self._grammar.job[score_id]
            self._try_add_question(
                questions,
                DecisionQuestion(
                    id=score_id,
                    kind=QuestionKind.SCORE,
                    prompt=spec.question,
                    options=spec.levels,
                    allow_none=False,
                ),
                state,
                seen_ids=seen_ids,
            )

    def _append_archetype_questions(
        self, questions: list[DecisionQuestion], state: PlannerState
    ) -> None:
        """Emits one `archetype:<family>` question per family with eligible archetypes."""
        seen_ids = {q.id for q in questions}
        pinned = self._pinned_families(state)
        families_to_ask = tuple(pinned) if pinned else self._grammar.families()
        for fam in families_to_ask:
            if fam == "none":
                continue
            fam_archs = [a for a in state.eligible if a.family == fam]
            if not fam_archs:
                continue
            self._try_add_question(
                questions,
                DecisionQuestion(
                    id=f"archetype:{fam}",
                    kind=QuestionKind.CHOICE,
                    prompt=f"Which {fam} archetype best fits this surface?",
                    options=tuple(a.id for a in fam_archs),
                    option_texts=tuple(a.criteria for a in fam_archs),
                    allow_none=True,
                ),
                state,
                seen_ids=seen_ids,
            )

    def _is_redundant_optional_fallback(
        self, ref: BlockRef, archetype: LayoutArchetype
    ) -> bool:
        """Returns True when an optional block's unsupported pattern degrades to a sibling block."""
        if ref.requirement != "optional":
            return False
        spec = self._grammar.block(ref.id)
        if self._capabilities.has_pattern(spec.pattern):
            return False
        resolved = _resolve_block_pattern(spec, self._capabilities)
        if resolved is None:
            return True
        fb_pat, _ = resolved
        return fb_pat != spec.pattern and fb_pat in set(archetype.block_ids())

    def _collect_gated_blocks(
        self,
        state: PlannerState,
        archetypes: Sequence[LayoutArchetype] | None = None,
    ) -> list[BlockSpec]:
        """Returns unique `BlockSpec`s from `archetypes` (or `state.eligible`) whose payload shape holds."""
        gated: list[BlockSpec] = []
        seen: set[str] = set()
        for arch in archetypes if archetypes is not None else state.eligible:
            for ref in arch.blocks:
                if ref.id in seen or self._is_redundant_optional_fallback(ref, arch):
                    continue
                seen.add(ref.id)
                spec = self._grammar.block(ref.id)
                if self._block_shape_holds(spec, state.pointers, state.actions):
                    gated.append(spec)
        return gated

    def _append_gate_and_anatomy_questions(
        self, questions: list[DecisionQuestion], state: PlannerState
    ) -> None:
        """Emits `gate:<block>` and `anatomy:<block>.<knob>` questions."""
        seen_ids = {q.id for q in questions}
        pinned_blocks = (
            {r for r in state.brief.roles() if r in self._grammar.blocks}
            if state.brief is not None
            else set()
        )
        gated_blocks = self._collect_gated_blocks(state)
        for spec in gated_blocks:
            if spec.gate is not None and spec.id not in pinned_blocks:
                self._try_add_question(
                    questions,
                    DecisionQuestion(
                        id=f"gate:{spec.id}",
                        kind=QuestionKind.BOOLEAN,
                        prompt=spec.gate.question,
                        context={"yes": spec.gate.yes, "no": spec.gate.no},
                        allow_none=False,
                    ),
                    state,
                    seen_ids=seen_ids,
                )
        self._append_anatomy_for_blocks(questions, gated_blocks, state, seen_ids)

    def _append_single_block_anatomy(
        self,
        questions: list[DecisionQuestion],
        spec: BlockSpec,
        bindings: BlockBindings,
        by_path: Mapping[str, PointerSummary],
        state: PlannerState,
        seen_ids: set[str],
    ) -> None:
        """Emits `anatomy:<block>.<knob>` questions for a single `BlockSpec`."""
        has_scoped_act = (
            spec.id == "collection"
            and _scoped_collection_action(bindings, state.actions) is not None
        )
        for knob, q_spec in spec.anatomy.items():
            if has_scoped_act and knob == "trailing":
                continue
            derived = _derive_anatomy_from_hints(q_spec, bindings, by_path)
            if derived is not None:
                state.derived_anatomy[(spec.id, knob)] = derived
                continue
            applies, fmt_vars = _anatomy_applies(q_spec, bindings, by_path)
            if not applies or q_spec.options_from is not None:
                continue
            q_obj = self._build_anatomy_question(spec.id, knob, q_spec, fmt_vars)
            if q_obj is not None:
                self._try_add_question(questions, q_obj, state, seen_ids=seen_ids)

    def _append_anatomy_for_blocks(
        self,
        questions: list[DecisionQuestion],
        blocks: Sequence[BlockSpec],
        state: PlannerState,
        seen_ids: set[str],
    ) -> None:
        """Emits `anatomy:<block>.<knob>` questions for `blocks`."""
        by_path = {p.path: p for p in state.pointers}
        page_ptr = _page_title_pointer(state.pointers)
        base_used = {page_ptr.path} if page_ptr is not None else set()
        for spec in blocks:
            bindings = self.bind_slots(
                spec,
                state.pointers,
                set(base_used),
                payload=state.payload,
                intent=state.intent,
                actions=state.actions,
                labels=state.labels,
                exclude=state.exclude,
            )
            self._append_single_block_anatomy(
                questions, spec, bindings, by_path, state, seen_ids
            )

    def _build_anatomy_question(
        self,
        block_id: str,
        knob: str,
        q_spec: QuestionSpec,
        fmt_vars: Mapping[str, str],
    ) -> DecisionQuestion | None:
        """Constructs a single `anatomy:<block>.<knob>` `DecisionQuestion`."""
        q_id = f"anatomy:{block_id}.{knob}"
        prompt = q_spec.question.format(**fmt_vars) if fmt_vars else q_spec.question
        if q_spec.kind is QuestionKind.BOOLEAN:
            return DecisionQuestion(
                id=q_id,
                kind=QuestionKind.BOOLEAN,
                prompt=prompt,
                context={"yes": q_spec.yes, "no": q_spec.no},
                allow_none=False,
            )
        if q_spec.kind is QuestionKind.SCORE:
            return DecisionQuestion(
                id=q_id,
                kind=QuestionKind.SCORE,
                prompt=prompt,
                options=q_spec.levels,
                allow_none=False,
            )
        options, texts = _filter_anatomy_options(q_spec, self._capabilities)
        if not options:
            return None
        return DecisionQuestion(
            id=q_id,
            kind=QuestionKind.CHOICE,
            prompt=prompt,
            options=options,
            option_texts=texts,
            allow_none=q_spec.allow_none,
        )

    def _is_salience_candidate(
        self,
        ptr: PointerSummary,
        page_ptr: PointerSummary | None,
        absorbed: set[str],
        state: PlannerState,
    ) -> bool:
        """Returns whether `ptr` should receive a `salience:<pointer>` question."""
        if page_ptr is not None and ptr.path == page_ptr.path:
            return False
        if ptr.path in absorbed or (ptr.path.count("/") >= 2 and "/0/" in ptr.path):
            return False
        if _is_nested_mutable_setting(ptr, state.pointers):
            return False
        if ptr.semantic_type in _NON_FACT_SEMANTIC_TYPES:
            return False
        headline_block = self._grammar.blocks.get("headline")
        facts_block = self._grammar.blocks.get("facts")
        headline_types = (
            headline_block.slots["items"].from_types
            if headline_block is not None and "items" in headline_block.slots
            else ()
        )
        facts_types = (
            facts_block.slots["rows"].from_types
            if facts_block is not None and "rows" in facts_block.slots
            else ()
        )
        return _pointer_matches_types(ptr, headline_types) or _pointer_matches_types(
            ptr, facts_types
        )

    def _append_salience_questions(
        self, questions: list[DecisionQuestion], state: PlannerState
    ) -> None:
        """Emits `salience:<pointer>` score questions for candidate scalar pointers."""
        has_salience_block = any(
            ref.id in {"headline", "facts", "collection"}
            for arch in state.eligible
            for ref in arch.blocks
        )
        headline_block = self._grammar.blocks.get("headline")
        sal_spec = headline_block.salience if headline_block is not None else None
        if not has_salience_block or sal_spec is None:
            return
        seen_ids = {q.id for q in questions}
        page_ptr = _page_title_pointer(state.pointers)
        absorbed = _collect_absorbed_siblings(state.pointers)
        added = 0
        for ptr in state.pointers:
            if not self._is_salience_candidate(ptr, page_ptr, absorbed, state):
                continue
            if added >= _MAX_SALIENCE_QUESTIONS:
                state.budget_exhausted = True
                break
            if self._try_add_question(
                questions,
                DecisionQuestion(
                    id=f"salience:{ptr.path}",
                    kind=QuestionKind.SCORE,
                    prompt=sal_spec.question.format(label=ptr.label or ptr.key),
                    options=sal_spec.levels,
                    allow_none=False,
                ),
                state,
                seen_ids=seen_ids,
            ):
                added += 1

    def _append_instance_questions(
        self,
        questions: list[DecisionQuestion],
        state: PlannerState,
        top_archetypes: Sequence[LayoutArchetype],
    ) -> None:
        """Emits speculative `instance:<block>.<q>:<elem>` questions for `top_archetypes`."""
        seen_ids = {q.id for q in questions}
        page_ptr = _page_title_pointer(state.pointers)
        base_used = {page_ptr.path} if page_ptr is not None else set()
        seen_blocks: set[str] = set()
        for arch in top_archetypes:
            for ref in arch.blocks:
                if ref.id in seen_blocks:
                    continue
                seen_blocks.add(ref.id)
                spec = self._grammar.block(ref.id)
                if not spec.instance or not self._block_shape_holds(
                    spec, state.pointers, state.actions
                ):
                    continue
                bindings = self.bind_slots(
                    spec,
                    state.pointers,
                    set(base_used),
                    payload=state.payload,
                    intent=state.intent,
                    actions=state.actions,
                    labels=state.labels,
                    exclude=state.exclude,
                )
                for q_obj in self._build_block_instance_questions(
                    spec, bindings, state
                ):
                    self._try_add_question(questions, q_obj, state, seen_ids=seen_ids)

    def _build_block_instance_questions(
        self,
        spec: BlockSpec,
        bindings: BlockBindings,
        state: PlannerState,
    ) -> list[DecisionQuestion]:
        """Builds the list of `DecisionQuestion` objects for `spec.instance`."""
        if spec.id in {"banner", "outcome"}:
            return self._build_scalar_instance_questions(spec, bindings, state)
        if spec.id == "actions":
            return self._build_actions_instance_questions(spec, bindings)
        if spec.id == "groups":
            return self._build_groups_instance_questions(spec, bindings, state)
        if spec.id in {"headline", "form"}:
            return self._build_items_instance_questions(spec, bindings, state)
        return []

    def _build_scalar_instance_questions(
        self,
        spec: BlockSpec,
        bindings: BlockBindings,
        state: PlannerState,
    ) -> list[DecisionQuestion]:
        """Builds instance questions for single-slot blocks (`banner`, `outcome`)."""
        slot_name = "title" if spec.id == "banner" else "headline"
        slot_binding = bindings.get(slot_name)
        if slot_binding is None or not slot_binding.pointer:
            return []
        ptr_path = slot_binding.pointer
        val = _resolve_pointer_value(state.payload, ptr_path)
        ptr_obj = next((p for p in state.pointers if p.path == ptr_path), None)
        fallback_lbl = (
            ptr_obj.label
            if ptr_obj is not None and ptr_obj.label
            else ptr_path.lstrip("/")
        )
        if ptr_path in state.labels:
            lbl = state.labels[ptr_path]
            display = f"{lbl} ({val})" if val is not None else lbl
        else:
            display = str(val) if val is not None else fallback_lbl
        built: list[DecisionQuestion] = []
        for q_name, q_spec in spec.instance.items():
            built.append(
                DecisionQuestion(
                    id=f"instance:{spec.id}.{q_name}:{ptr_path}",
                    kind=QuestionKind.CHOICE,
                    prompt=q_spec.question.format(**{slot_name: display}),
                    options=tuple(q_spec.options),
                    option_texts=tuple(q_spec.options.values()),
                    allow_none=q_spec.allow_none,
                )
            )
        return built

    def _build_primary_action_question(
        self,
        prim_spec: QuestionSpec | None,
        metas: Sequence[tuple[str, str, str]],
    ) -> DecisionQuestion | None:
        """Builds `instance:actions.primary:buttons` unless style pins primary."""
        if prim_spec is None or any(
            st == ActionStyle.PRIMARY.value for _, _, st in metas
        ):
            return None
        excluded = {
            ActionStyle.SECONDARY.value,
            ActionStyle.DESTRUCTIVE.value,
        }
        candidates = [(aid, lbl) for aid, lbl, st in metas if st not in excluded]
        if not candidates:
            return None
        return DecisionQuestion(
            id="instance:actions.primary:buttons",
            kind=QuestionKind.CHOICE,
            prompt=prim_spec.question,
            options=tuple(aid for aid, _ in candidates),
            option_texts=tuple(lbl for _, lbl in candidates),
            allow_none=prim_spec.allow_none,
        )

    def _build_actions_instance_questions(
        self, spec: BlockSpec, bindings: BlockBindings
    ) -> list[DecisionQuestion]:
        """Builds `actions.primary` and `actions.destructive` instance questions."""
        buttons = bindings.get("buttons")
        if buttons is None or not buttons.items:
            return []
        metas = [_button_meta(idx, item) for idx, item in enumerate(buttons.items)]
        built: list[DecisionQuestion] = []
        prim_q = self._build_primary_action_question(
            spec.instance.get("primary"), metas
        )
        if prim_q is not None:
            built.append(prim_q)
        dest_spec = spec.instance.get("destructive")
        if dest_spec is not None:
            built.extend(
                DecisionQuestion(
                    id=f"instance:actions.destructive:{aid}",
                    kind=QuestionKind.BOOLEAN,
                    prompt=dest_spec.question.format(label=lbl),
                    context={"yes": dest_spec.yes, "no": dest_spec.no},
                    allow_none=False,
                )
                for aid, lbl, st in metas
                if st != ActionStyle.DESTRUCTIVE.value
            )
        return built

    def _build_single_group_row_question(
        self,
        row_item: Mapping[str, SlotBinding],
        q_spec: QuestionSpec,
        state: PlannerState,
    ) -> DecisionQuestion | None:
        """Builds one `instance:groups.row_kind:<pointer>` question for `row_item`."""
        val_binding = row_item.get("value")
        lbl_binding = row_item.get("label")
        if val_binding is None or not val_binding.pointer:
            return None
        ptr_path = val_binding.pointer
        label = str(
            (lbl_binding.literal if lbl_binding is not None else None) or ptr_path
        )
        raw_val = _resolve_pointer_value(state.payload, ptr_path)
        label_text = f"{label} ({raw_val})" if raw_val is not None else label
        return DecisionQuestion(
            id=f"instance:groups.row_kind:{ptr_path}",
            kind=QuestionKind.CHOICE,
            prompt=q_spec.question.format(label=label_text),
            options=tuple(q_spec.options),
            option_texts=tuple(q_spec.options.values()),
            allow_none=q_spec.allow_none,
        )

    def _build_groups_instance_questions(
        self,
        spec: BlockSpec,
        bindings: BlockBindings,
        state: PlannerState,
    ) -> list[DecisionQuestion]:
        """Builds `instance:groups.row_kind:<pointer>` questions for each setting row."""
        groups_slot = bindings.get("groups")
        q_spec = spec.instance.get("row_kind")
        if groups_slot is None or q_spec is None:
            return []
        built: list[DecisionQuestion] = []
        for group_item in groups_slot.items:
            rows_slot = group_item.get("rows")
            if rows_slot is None:
                continue
            for row_item in rows_slot.items:
                q_obj = self._build_single_group_row_question(row_item, q_spec, state)
                if q_obj is not None:
                    built.append(q_obj)
        return built

    def _questions_for_single_item(
        self,
        spec: BlockSpec,
        item: Mapping[str, SlotBinding],
        by_path: Mapping[str, PointerSummary],
        state: PlannerState,
    ) -> list[DecisionQuestion]:
        """Builds instance questions for one item in `headline` or `form`."""
        val_b = item.get("value")
        lbl_b = item.get("label")
        if val_b is None or not val_b.pointer:
            return []
        ptr_path = val_b.pointer
        ptr = by_path.get(ptr_path)
        label = str((lbl_b.literal if lbl_b else None) or ptr_path)
        raw_val = _resolve_pointer_value(state.payload, ptr_path)
        val_str = (
            str(raw_val) if raw_val is not None else (ptr.semantic_type if ptr else "")
        )
        return [
            self._make_item_instance_question(
                spec.id, q_name, q_spec, ptr_path, label, val_str, item
            )
            for q_name, q_spec in spec.instance.items()
            if _item_instance_applies(q_spec, item, ptr)
        ]

    def _build_items_instance_questions(
        self,
        spec: BlockSpec,
        bindings: BlockBindings,
        state: PlannerState,
    ) -> list[DecisionQuestion]:
        """Builds per-item instance questions for `headline` and `form`."""
        slot_name = "items" if spec.id == "headline" else "fields"
        slot_binding = bindings.get(slot_name)
        if slot_binding is None or not slot_binding.items:
            return []
        by_path = {p.path: p for p in state.pointers}
        built: list[DecisionQuestion] = []
        for item in slot_binding.items:
            built.extend(self._questions_for_single_item(spec, item, by_path, state))
        return built

    def _make_item_instance_question(
        self,
        block_id: str,
        q_name: str,
        q_spec: QuestionSpec,
        ptr_path: str,
        label: str,
        val_str: str,
        item: Mapping[str, SlotBinding],
    ) -> DecisionQuestion:
        """Creates one `DecisionQuestion` for an item in `headline` or `form`."""
        q_id = f"instance:{block_id}.{q_name}:{ptr_path}"
        prompt = q_spec.question.format(label=label, value=val_str)
        if q_spec.kind is QuestionKind.BOOLEAN:
            return DecisionQuestion(
                id=q_id,
                kind=QuestionKind.BOOLEAN,
                prompt=prompt,
                context={"yes": q_spec.yes, "no": q_spec.no},
                allow_none=False,
            )
        options = [
            opt
            for opt in q_spec.options
            if all(
                req in item and item[req].bound for req in q_spec.requires.get(opt, ())
            )
        ]
        texts = [q_spec.options[opt] for opt in options]
        return DecisionQuestion(
            id=q_id,
            kind=QuestionKind.CHOICE,
            prompt=prompt,
            options=tuple(options),
            option_texts=tuple(texts),
            allow_none=q_spec.allow_none,
        )

    def _read_template(self, state: PlannerState) -> tuple[str, float] | None:
        """Reads the `template` choice question against `template`/`templateMutable`."""
        q_map = {q.id: q for q in state.batch.questions}
        tpl_q = q_map.get("template")
        tpl_ans = state.answers_by_id.get("template")
        if tpl_q is None or tpl_ans is None:
            return None
        chosen, prob = tpl_ans.top()
        tpl_by_id = {t.template_id: t for t in state.templates}
        chosen_tpl = tpl_by_id.get(chosen)
        is_mut = any(p.mutable_hint for p in state.pointers) or (
            chosen_tpl is not None and chosen_tpl.is_mutable
        )
        thresh = self.threshold("templateMutable" if is_mut else "template")
        if chosen != "compose" and chosen_tpl is not None and prob >= thresh:
            state.trace.append(
                DecisionRecord(
                    question=tpl_q,
                    answer=tpl_ans,
                    threshold=thresh,
                    outcome=chosen,
                )
            )
            return chosen, prob
        state.trace.append(
            DecisionRecord(
                question=tpl_q,
                answer=tpl_ans,
                threshold=thresh,
                outcome="compose",
            )
        )
        return None

    def _recover_button_action(
        self, idx: int, item: Mapping[str, SlotBinding]
    ) -> ActionSpec:
        """Recovers one surface `ActionSpec` from a bound `actions.buttons` item."""
        act_id, label, style_str = _button_meta(idx, item)
        style = ActionStyle(style_str) if style_str else None
        act_slot = item.get("action")
        ctx_meta = act_slot.fields.get("$context") if act_slot is not None else None
        ctx = (
            {k: sb.pointer for k, sb in ctx_meta.fields.items() if sb.pointer}
            if ctx_meta is not None
            else {}
        )
        return ActionSpec(id=act_id, label=label, context=ctx, style=style)

    def _recover_scoped_collection_action(
        self, block: PlannedBlock
    ) -> tuple[ActionSpec, ...]:
        """Recovers a scoped item `ActionSpec` from `collection.items.fields['action']`."""
        items_slot = block.bindings.get("items")
        if items_slot is None:
            return ()
        act_field = items_slot.fields.get("action")
        if act_field is None or act_field.literal is None:
            return ()
        scope_meta = act_field.fields.get("$scope")
        key_meta = act_field.fields.get("$key")
        scope_val = (
            str(scope_meta.literal)
            if scope_meta is not None and scope_meta.literal
            else items_slot.pointer
        )
        key_val = (
            str(key_meta.literal) if key_meta is not None and key_meta.literal else None
        )
        lbl = block.variant_knobs.get("trailing.label") or str(act_field.literal)
        return (
            ActionSpec(
                id=str(act_field.literal),
                label=lbl,
                scope=scope_val,
                key=key_val,
            ),
        )

    def _recover_block_actions(self, block: PlannedBlock) -> tuple[ActionSpec, ...]:
        """Recovers `ActionSpec` entries already bound on `block` for region updates."""
        buttons = block.bindings.get("buttons")
        if buttons is not None and buttons.items:
            return tuple(
                self._recover_button_action(idx, item)
                for idx, item in enumerate(buttons.items)
            )
        return self._recover_scoped_collection_action(block)

    def _other_plan_pointers(self, plan: LayoutPlan, target_block_id: str) -> set[str]:
        """Collects pointers claimed by `plan.page` and blocks other than `target_block_id`."""
        claimed: set[str] = (
            set(plan.page.title.pointers())
            | set(plan.page.subtitle.pointers())
            | set(plan.page.mark.pointers())
        )
        for block in plan.blocks:
            if block.block_id != target_block_id:
                claimed.update(block.bindings.pointers())
        return claimed

    def _bind_region_slots(
        self,
        spec: BlockSpec,
        state: PlannerState,
        used: set[str],
    ) -> BlockBindings:
        """Binds `spec` slots for a region update, retrying with `used=set()` if needed."""
        bindings = self.bind_slots(
            spec,
            state.pointers,
            set(used),
            salience_scores=state.salience_scores,
            payload=state.payload,
            intent=state.intent,
            actions=state.actions,
            labels=state.labels,
            exclude=state.exclude,
        )
        if not any(b.bound for b in bindings.slots.values()) and used:
            return self.bind_slots(
                spec,
                state.pointers,
                set(),
                salience_scores=state.salience_scores,
                payload=state.payload,
                intent=state.intent,
                actions=state.actions,
                labels=state.labels,
                exclude=state.exclude,
            )
        return bindings

    def _append_region_salience_questions(
        self,
        questions: list[DecisionQuestion],
        spec: BlockSpec,
        state: PlannerState,
        used: set[str],
        seen_ids: set[str],
    ) -> None:
        """Emits `salience:<pointer>` questions only for candidate pointers of `spec`."""
        if spec.id not in {"headline", "facts"} and spec.salience is None:
            return
        headline_block = self._grammar.blocks.get("headline")
        sal_spec = spec.salience or (
            headline_block.salience if headline_block is not None else None
        )
        if sal_spec is None:
            return
        absorbed = _collect_absorbed_siblings(state.pointers)
        added = 0
        for ptr in state.pointers:
            if ptr.path in used or not self._is_salience_candidate(
                ptr, None, absorbed, state
            ):
                continue
            if added >= _MAX_SALIENCE_QUESTIONS:
                state.budget_exhausted = True
                break
            if self._try_add_question(
                questions,
                DecisionQuestion(
                    id=f"salience:{ptr.path}",
                    kind=QuestionKind.SCORE,
                    prompt=sal_spec.question.format(label=ptr.label or ptr.key),
                    options=sal_spec.levels,
                    allow_none=False,
                ),
                state,
                seen_ids=seen_ids,
            ):
                added += 1

    def build_block_batch(
        self,
        plan: LayoutPlan,
        block_id: str,
        pointers: Sequence[PointerSummary],
        *,
        intent: str = "",
        labels: Mapping[str, str] | None = None,
        payload: Mapping[str, Any] | None = None,
        actions: Sequence[ActionSpec] = (),
        exclude: Collection[str] = (),
    ) -> tuple[DecisionBatch, PlannerState]:
        """Builds a batch that re-plans only `block_id` of `plan`, for region updates.

        Raises:
            A2uiValidationError: If `block_id` is not present in `plan.blocks`
                or is unknown to the grammar.
        """
        existing = next((b for b in plan.blocks if b.block_id == block_id), None)
        if existing is None or block_id not in self._grammar.blocks:
            raise A2uiValidationError(
                f"Block {block_id!r} is not present in the cached layout plan"
                f" {list(plan.block_ids())}."
            )
        spec = self._grammar.block(block_id)
        norm_labels = _normalize_labels(labels)
        norm_exclude = _normalize_exclude(exclude)
        norm_pointers = _normalize_pointers(
            pointers, labels=norm_labels, exclude=norm_exclude
        )
        effective_actions = tuple(actions) or self._recover_block_actions(existing)
        other_used = self._other_plan_pointers(plan, block_id)
        selected_arch = (
            self._grammar.archetype(plan.archetype)
            if plan.archetype in {a.id for a in self._grammar.archetypes}
            else None
        )
        state = PlannerState(
            intent=intent,
            pointers=norm_pointers,
            eligible=(selected_arch,) if selected_arch is not None else (),
            prior_archetypes=(plan.archetype,) if plan.archetype else (),
            brief=None,
            batch=DecisionBatch(shared_context={}, questions=()),
            payload=dict(payload) if payload is not None else {},
            selected_archetype=selected_arch,
            actions=effective_actions,
            labels=norm_labels,
            exclude=norm_exclude,
            region_plan=plan,
            region_block_id=block_id,
            region_used_pointers=other_used,
        )
        prelim_bindings = self._bind_region_slots(spec, state, other_used)
        questions: list[DecisionQuestion] = []
        seen_ids: set[str] = set()
        by_path = {p.path: p for p in state.pointers}
        self._append_single_block_anatomy(
            questions, spec, prelim_bindings, by_path, state, seen_ids
        )
        self._append_region_salience_questions(
            questions, spec, state, other_used, seen_ids
        )
        for q_obj in self._build_block_instance_questions(spec, prelim_bindings, state):
            self._try_add_question(questions, q_obj, state, seen_ids=seen_ids)

        batch = DecisionBatch(
            shared_context={
                "intent": intent,
                "region": block_id,
                "pointers": [p.path for p in state.pointers],
            },
            questions=tuple(questions),
        )
        state.batch = batch
        return batch, state

    def _apply_region_collection_rules(
        self, block: PlannedBlock, state: PlannerState
    ) -> PlannedBlock:
        """Enforces picture-layout and sparse-leading rules on a region `collection`."""
        has_image = any(
            p.semantic_type in {"image_url", "media_object"} for p in state.pointers
        )
        block = _adjust_collection_picture_layout(block, has_image)
        if block.block_id != "collection" or block.variant_knobs.get("leading") not in {
            "thumbnail",
            "avatar",
        }:
            return block
        items = block.bindings.get("items")
        if not _is_collection_picture_sparse(items, state.payload):
            return block
        fallback = "icon" if items is not None and "icon" in items.fields else "none"
        return replace(
            block,
            variant_knobs={**block.variant_knobs, "leading": fallback},
        )

    def _apply_region_urgency_rule(
        self, block: PlannedBlock, plan: LayoutPlan, state: PlannerState
    ) -> PlannedBlock:
        """Applies the `urgency-terse` transformation to `block` when `plan.urgency >= 1.5`."""
        if plan.urgency < 1.5:
            return block
        prose_req = (
            state.selected_archetype.requirement_of("prose") == "required"
            if state.selected_archetype is not None
            else True
        )
        terse = _terse_transform_block(
            block, prose_req, self._capabilities.has_pattern("page")
        )
        return terse if terse is not None else block

    def _apply_region_block_rules(
        self,
        block: PlannedBlock,
        spec: BlockSpec,
        plan: LayoutPlan,
        state: PlannerState,
    ) -> PlannedBlock:
        """Applies block-level invariants (`pictures`, `actions_gate`, `urgency`) to `block`."""
        block = self._apply_region_collection_rules(block, state)
        if not plan.actions_allowed:
            gated = _gate_single_block(block, set(), state)
            if gated is None:
                raise A2uiValidationError(
                    f"Block {block.block_id!r} is disallowed by the cached plan's"
                    " action gate."
                )
            block = gated
        if block.block_id == "actions":
            block = _reorder_and_enforce_actions(block, plan.stakes)
        block = self._apply_region_urgency_rule(block, plan, state)
        has_mut = any(p.mutable_hint for p in state.pointers) or any(
            b.block_id in {"form", "groups"} for b in plan.blocks
        )
        block = _decorate_action_block(block, _form_mutable_pointers(plan), has_mut)
        if not _block_has_required_bindings(block, spec):
            raise A2uiValidationError(
                f"Region update for block {block.block_id!r} could not bind its"
                " required slots."
            )
        return block

    def read_block(
        self,
        state: PlannerState,
        answers: Sequence[DecisionAnswer],
    ) -> PlannedBlock:
        """Reads the answers to a `build_block_batch` batch into one planned block.

        Raises:
            A2uiValidationError: If `state` was not created by `build_block_batch`,
                answers do not match the batch, or required slots cannot bind.
        """
        plan = state.region_plan
        block_id = state.region_block_id
        if plan is None or block_id is None:
            raise A2uiValidationError(
                "PlannerState was not initialized by LayoutPlanner.build_block_batch."
            )
        existing = next((b for b in plan.blocks if b.block_id == block_id), None)
        if existing is None:
            raise A2uiValidationError(
                f"Block {block_id!r} is not present in the cached layout plan."
            )
        self._validate_and_index_answers(state, answers)
        self._read_salience_scores(state)
        spec = self._grammar.block(block_id)
        resolved = _resolve_block_pattern(spec, self._capabilities)
        if resolved is None:
            raise A2uiValidationError(
                f"Block {block_id!r} has no supported pattern on the active catalog."
            )
        pat_name, preset_knobs = resolved
        bindings = self._bind_region_slots(spec, state, state.region_used_pointers)
        plan_ids = {b.block_id for b in plan.blocks}
        bindings = _apply_compose_action(block_id, bindings, plan_ids, state.actions)
        knobs, instances = self._resolve_block_questions(
            spec,
            bindings,
            state,
            actions_allowed=plan.actions_allowed,
            preset_knobs=preset_knobs,
        )
        updated = PlannedBlock(
            block_id=block_id,
            pattern=pat_name,
            bindings=bindings,
            variant_knobs=knobs,
            instances=instances,
            probability=existing.probability,
        )
        return self._apply_region_block_rules(updated, spec, plan, state)

    def _record_fit_score(
        self,
        state: PlannerState,
        score: float,
        *,
        arch_prob: float,
        entropy: float,
        orphan_share: float,
        weak_share: float,
    ) -> None:
        """Appends a `fit_score` `DecisionRecord` to `state.trace`."""
        thresh = self.threshold("noFit") if "noFit" in self._grammar.thresholds else 0.5
        state.trace.append(
            DecisionRecord(
                question=DecisionQuestion(
                    id="fit_score",
                    kind=QuestionKind.BOOLEAN,
                    prompt="Archetype layout fit score",
                    allow_none=False,
                ),
                threshold=thresh,
                outcome=(
                    f"{score:.4f} (archetype_prob={arch_prob:.2f},"
                    f" entropy={entropy:.2f},"
                    f" orphan_share={orphan_share:.2f},"
                    f" weak_required_share={weak_share:.2f})"
                ),
            )
        )

    def _check_no_fit_family(self, state: PlannerState) -> tuple[bool, float]:
        """Checks whether `family == 'none'` won at `thresholds.noFit` or higher."""
        if self._brief_pinned_family(state.brief) is not None:
            return False, 0.0
        q_map = {q.id: q for q in state.batch.questions}
        fam_q = q_map.get("family")
        fam_ans = state.answers_by_id.get("family")
        if fam_q is None or fam_ans is None:
            return False, 0.0
        chosen, prob = fam_ans.top()
        no_fit_thresh = (
            self.threshold("noFit") if "noFit" in self._grammar.thresholds else 0.5
        )
        if chosen != "none" or prob < no_fit_thresh:
            return False, 0.0
        state.trace.append(
            DecisionRecord(
                question=fam_q,
                answer=fam_ans,
                threshold=no_fit_thresh,
                outcome="no_fit",
            )
        )
        entropy = fam_ans.distribution.normalized_entropy()
        non_none_mass = max(0.0, 1.0 - prob)
        score = compute_fit_score(non_none_mass, entropy, 0.0, 0.0)
        self._record_fit_score(
            state,
            score,
            arch_prob=non_none_mass,
            entropy=entropy,
            orphan_share=0.0,
            weak_share=0.0,
        )
        return True, score

    def read(
        self,
        state: PlannerState,
        answers: Sequence[DecisionAnswer],
    ) -> PlanOutcome:
        """Reads backend `answers` into a validated `PlanOutcome`.

        When the batch carried a `template` question and its winner clears
        the threshold, the plan's `LayoutPlan.template_id` names that
        template; when `family == "none"` clears `thresholds.noFit`, returns
        `PlanOutcome(plan=None, reason=PlanReason.NO_FIT, fit_score=...)`.
        """
        self._validate_and_index_answers(state, answers)
        tpl_winner = self._read_template(state)
        if tpl_winner is not None:
            tpl_id, tpl_prob = tpl_winner
            stakes, urgency = self._read_stakes_and_urgency(state)
            clamped_fit = min(max(tpl_prob, 0.0), 1.0)
            return PlanOutcome(
                plan=LayoutPlan(
                    archetype="",
                    family="",
                    blocks=(),
                    stakes=stakes,
                    urgency=urgency,
                    confidence=tpl_prob,
                    template_id=tpl_id,
                    fit_score=clamped_fit,
                ),
                reason=PlanReason.PLANNED,
                fit_score=clamped_fit,
            )
        is_no_fit, no_fit_score = self._check_no_fit_family(state)
        if is_no_fit:
            return PlanOutcome(
                plan=None, reason=PlanReason.NO_FIT, fit_score=no_fit_score
            )
        family = self._read_family(state)
        if family is None:
            return PlanOutcome(plan=None, reason=PlanReason.NO_FAMILY)
        stakes, urgency = self._read_stakes_and_urgency(state)
        archetype, confidence = self._read_archetype(state, family)
        if archetype is None:
            return PlanOutcome(plan=None, reason=PlanReason.NO_ARCHETYPE)
        state.selected_archetype = archetype
        self._warn_unused_brief_blocks(state, archetype)
        self._read_salience_scores(state)
        initial_blocks = self._read_gated_blocks(state, archetype)
        page = self._initial_page_bindings(state, archetype)
        plan = LayoutPlan(
            archetype=archetype.id,
            family=family,
            blocks=initial_blocks,
            page=page,
            stakes=stakes,
            urgency=urgency,
            confidence=confidence,
        )
        return self._apply_all_rules(plan, state)

    def _validate_and_index_answers(
        self, state: PlannerState, answers: Sequence[DecisionAnswer]
    ) -> None:
        """Validates that `answers` matches `state.batch.questions` and indexes by ID."""
        expected_ids = {q.id for q in state.batch.questions}
        by_id: dict[str, DecisionAnswer] = {}
        for ans in answers:
            if ans.question_id not in expected_ids:
                raise A2uiValidationError(
                    f"Unknown question id {ans.question_id!r} in answers."
                )
            by_id[ans.question_id] = ans
        missing = [q.id for q in state.batch.questions if q.id not in by_id]
        if missing:
            raise A2uiValidationError(
                f"Missing answers for batch questions: {missing}."
            )
        state.answers_by_id = by_id
        state.trace = []

    def _best_eligible_family(
        self,
        fam_ans: DecisionAnswer,
        eligible_fams: set[str],
        default_family: str,
    ) -> str:
        """Selects the highest-probability family in `eligible_fams`."""
        eligible_ranked = [
            (fam_id, fam_prob)
            for fam_id, fam_prob in fam_ans.distribution.probabilities.items()
            if fam_id in eligible_fams
        ]
        if eligible_ranked:
            return max(eligible_ranked, key=lambda kv: kv[1])[0]
        return default_family

    def _brief_pinned_family(self, brief: LayoutBrief | None) -> str | None:
        """Returns the first non-`none` family role pinned by `brief`, if any."""
        if brief is None:
            return None
        families = self._grammar.families()
        return next((r for r in brief.roles() if r != "none" and r in families), None)

    def _best_non_none_family(self, fam_ans: DecisionAnswer) -> tuple[str, float]:
        """Returns the highest-probability non-`none` family in `fam_ans`."""
        candidates = [
            (fam_id, fam_prob)
            for fam_id, fam_prob in fam_ans.distribution.probabilities.items()
            if fam_id != "none"
        ]
        if not candidates:
            return "none", 0.0
        return max(candidates, key=lambda kv: kv[1])

    def _is_family_rejected(
        self,
        chosen: str,
        prob: float,
        thresh: float,
        eligible_fams: set[str],
        pointers: Sequence[PointerSummary],
    ) -> bool:
        """Returns whether the top `family` answer must abstain."""
        if chosen == "none" or prob < thresh or not eligible_fams:
            return True
        return (
            chosen == "input"
            and chosen not in eligible_fams
            and not any(p.mutable_hint for p in pointers)
        )

    def _refine_specialized_family(
        self,
        chosen: str,
        eligible_fams: set[str],
        state: PlannerState,
    ) -> str:
        """Promotes `browse` (`chat`) or `act` (`result`) when `inspect` masks a 90%+ specialized archetype."""
        if chosen != "inspect":
            return chosen
        brw_ans = state.answers_by_id.get("archetype:browse")
        conv_ans = state.answers_by_id.get("gate:conversation")
        if (
            "browse" in eligible_fams
            and brw_ans is not None
            and brw_ans.top()[0] == "chat"
            and brw_ans.top()[1] >= 0.90
            and conv_ans is not None
            and conv_ans.yes >= 0.80
        ):
            return "browse"
        act_ans = state.answers_by_id.get("archetype:act")
        out_ans = state.answers_by_id.get("gate:outcome")
        if (
            "act" in eligible_fams
            and act_ans is not None
            and act_ans.top()[0] == "result"
            and act_ans.top()[1] >= 0.90
            and out_ans is not None
            and out_ans.yes >= 0.80
        ):
            return "act"
        return chosen

    def _read_family(self, state: PlannerState) -> str | None:
        """Resolves the winning family ID from `brief` or the `family` answer."""
        pinned_fam = self._brief_pinned_family(state.brief)
        if pinned_fam is not None and any(
            a.family == pinned_fam for a in state.eligible
        ):
            return pinned_fam
        q_map = {q.id: q for q in state.batch.questions}
        fam_q = q_map.get("family")
        fam_ans = state.answers_by_id.get("family")
        if fam_q is None or fam_ans is None:
            return state.eligible[0].family if state.eligible else None
        chosen, prob = fam_ans.top()
        if chosen == "none":
            chosen, prob = self._best_non_none_family(fam_ans)
        thresh = self.threshold("family")
        eligible_fams = {a.family for a in state.eligible}
        if self._is_family_rejected(
            chosen, prob, thresh, eligible_fams, state.pointers
        ):
            state.trace.append(
                DecisionRecord(
                    question=fam_q,
                    answer=fam_ans,
                    threshold=thresh,
                    outcome="no_family",
                )
            )
            return None
        if chosen not in eligible_fams:
            chosen = self._best_eligible_family(
                fam_ans, eligible_fams, state.eligible[0].family
            )
        chosen = self._refine_specialized_family(chosen, eligible_fams, state)
        state.trace.append(
            DecisionRecord(
                question=fam_q, answer=fam_ans, threshold=thresh, outcome=chosen
            )
        )
        return chosen

    def _read_stakes_and_urgency(self, state: PlannerState) -> tuple[float, float]:
        """Reads the expected `stakes` and `urgency` scores and records them."""
        q_map = {q.id: q for q in state.batch.questions}
        results: dict[str, float] = {"stakes": 0.0, "urgency": 0.0}
        for key in ("stakes", "urgency"):
            q_obj = q_map.get(key)
            ans = state.answers_by_id.get(key)
            if q_obj is not None and ans is not None:
                val = _expected_score(ans)
                results[key] = val
                state.trace.append(
                    DecisionRecord(question=q_obj, answer=ans, outcome=f"{val:.2f}")
                )
        return results["stakes"], results["urgency"]

    def _redirected_archetype(
        self,
        arch_q: DecisionQuestion,
        arch_ans: DecisionAnswer,
        fam_ans: DecisionAnswer,
        fam_archs: Sequence[LayoutArchetype],
        prob: float,
        thresh: float,
        state: PlannerState,
    ) -> tuple[LayoutArchetype, float]:
        """Selects the best eligible archetype in `fam_archs` after family redirection."""
        arch_ids = {a.id for a in fam_archs}
        non_none = [
            (opt, p)
            for opt, p in arch_ans.distribution.probabilities.items()
            if opt != "none" and opt in arch_ids
        ]
        best_id = (
            max(non_none, key=lambda kv: kv[1])[0] if non_none else fam_archs[0].id
        )
        best_prob = max(prob, fam_ans.top()[1])
        state.trace.append(
            DecisionRecord(
                question=arch_q,
                answer=arch_ans,
                threshold=thresh,
                outcome=best_id,
            )
        )
        return self._grammar.archetype(best_id), best_prob

    def _prefer_feed_for_scoped_action(
        self,
        chosen: str,
        prob: float,
        arch_ans: DecisionAnswer,
        fam_archs: Sequence[LayoutArchetype],
        actions: Sequence[ActionSpec],
    ) -> tuple[str, float]:
        """Selects `feed` over `compare` when a scoped item action requires `collection`."""
        if (
            chosen == "compare"
            and any(a.scope is not None for a in actions)
            and any(a.id == "feed" for a in fam_archs)
        ):
            feed_p = arch_ans.distribution.probabilities.get("feed", 0.0)
            if feed_p > 0.0:
                return "feed", max(prob, feed_p)
        return chosen, prob

    def _is_cumulative_no_fit(
        self,
        fam_ans: DecisionAnswer | None,
        arch_ans: DecisionAnswer,
        state: PlannerState,
    ) -> bool:
        """Checks whether cumulative two-stage `none` probability exceeds the no-fit limit."""
        pinned_fam = self._brief_pinned_family(state.brief)
        if pinned_fam is not None and any(
            a.family == pinned_fam for a in state.eligible
        ):
            return False
        fam_none = (
            fam_ans.distribution.probabilities.get("none", 0.0)
            if fam_ans is not None
            else 0.0
        )
        arch_none = arch_ans.distribution.probabilities.get("none", 0.0)
        combined_none = 1.0 - (1.0 - fam_none) * (1.0 - arch_none)
        return arch_none >= 0.22 and combined_none >= 0.32

    def _read_archetype(
        self, state: PlannerState, family: str
    ) -> tuple[LayoutArchetype | None, float]:
        """Resolves the winning `LayoutArchetype` within `family`."""
        q_id = f"archetype:{family}"
        q_map = {q.id: q for q in state.batch.questions}
        arch_q = q_map.get(q_id)
        arch_ans = state.answers_by_id.get(q_id)
        fam_archs = [a for a in state.eligible if a.family == family]
        if arch_q is None or arch_ans is None:
            return (fam_archs[0], 1.0) if fam_archs else (None, 0.0)
        chosen, prob = self._prefer_feed_for_scoped_action(
            *arch_ans.top(), arch_ans, fam_archs, state.actions
        )
        thresh = self.threshold("archetype")
        fam_ans = state.answers_by_id.get("family")
        if (
            chosen == "none"
            or prob < thresh
            or self._is_cumulative_no_fit(fam_ans, arch_ans, state)
        ):
            if fam_ans is not None and fam_ans.top()[0] != family and fam_archs:
                return self._redirected_archetype(
                    arch_q, arch_ans, fam_ans, fam_archs, prob, thresh, state
                )
            state.trace.append(
                DecisionRecord(
                    question=arch_q,
                    answer=arch_ans,
                    threshold=thresh,
                    outcome="no_archetype",
                )
            )
            return None, prob
        state.trace.append(
            DecisionRecord(
                question=arch_q,
                answer=arch_ans,
                threshold=thresh,
                outcome=chosen,
            )
        )
        return self._grammar.archetype(chosen), prob

    def _warn_unused_brief_blocks(
        self, state: PlannerState, archetype: LayoutArchetype
    ) -> None:
        """Records a trace warning for any brief block not allowed by `archetype`."""
        if state.brief is None:
            return
        allowed = set(archetype.block_ids())
        for role in state.brief.roles():
            if role in self._grammar.blocks and role not in allowed:
                state.trace.append(
                    DecisionRecord(
                        question=DecisionQuestion(
                            id=f"brief:{role}",
                            kind=QuestionKind.BOOLEAN,
                            prompt=f"Layout brief section {role!r}",
                            allow_none=False,
                        ),
                        outcome=f"warning:ignored_brief_block:{role}",
                    )
                )

    def _read_salience_scores(self, state: PlannerState) -> None:
        """Populates `state.salience_scores` from answers or fallback heuristics."""
        q_map = {q.id: q for q in state.batch.questions}
        scores: dict[str, float] = {}
        for idx, ptr in enumerate(state.pointers):
            q_id = f"salience:{ptr.path}"
            q_obj = q_map.get(q_id)
            ans = state.answers_by_id.get(q_id)
            if q_obj is not None and ans is not None:
                val = _expected_score(ans)
                scores[ptr.path] = val
                state.trace.append(
                    DecisionRecord(question=q_obj, answer=ans, outcome=f"{val:.2f}")
                )
            else:
                base = (
                    1.8
                    if ptr.semantic_type
                    in {"currency", "rating", "percent", "status", "bounded"}
                    else 1.0
                )
                scores[ptr.path] = base - idx * 0.001
        state.salience_scores = scores

    def _block_matches_gate_shape(self, spec: BlockSpec, state: PlannerState) -> bool:
        """Returns whether `spec` satisfies shape constraints or authored prose copy."""
        if self._block_shape_holds(spec, state.pointers, state.actions):
            return True
        return bool(
            spec.id == "prose" and state.copy is not None and state.copy.summary
        )

    def _gate_default_probability(
        self, ref: BlockRef, ans: DecisionAnswer | None
    ) -> float:
        """Returns `ans.yes` or the default prior (`0.8` required/expected, `0.0` optional)."""
        if ans is not None:
            return ans.yes
        return 0.8 if ref.requirement != "optional" else 0.0

    def _evaluate_single_block_gate(
        self,
        ref: BlockRef,
        q_map: Mapping[str, DecisionQuestion],
        pinned: set[str],
        state: PlannerState,
    ) -> PlannedBlock | None:
        """Evaluates the gate for one `BlockRef` and records its trace entry."""
        spec = self._grammar.block(ref.id)
        if not self._block_matches_gate_shape(spec, state):
            return None
        if ref.id in pinned:
            state.gate_probabilities[ref.id] = 1.0
            return PlannedBlock(block_id=ref.id, pattern=spec.pattern, probability=1.0)
        q_id = f"gate:{ref.id}"
        q_obj = q_map.get(q_id)
        ans = state.answers_by_id.get(q_id)
        prob = self._gate_default_probability(ref, ans)
        state.gate_probabilities[ref.id] = prob
        thresh = self.threshold(
            "optional" if ref.requirement == "optional" else "expected"
        )
        passed = prob >= thresh or (ref.id == "actions" and bool(state.actions))
        outcome = (
            "required_override (disagreement)"
            if (ref.requirement == "required" and prob < thresh)
            else ("include" if passed else "drop")
        )
        if q_obj is not None and ans is not None:
            state.trace.append(
                DecisionRecord(
                    question=q_obj, answer=ans, threshold=thresh, outcome=outcome
                )
            )
        return (
            PlannedBlock(block_id=ref.id, pattern=spec.pattern, probability=prob)
            if passed
            else None
        )

    def _read_gated_blocks(
        self, state: PlannerState, archetype: LayoutArchetype
    ) -> tuple[PlannedBlock, ...]:
        """Evaluates block gates for `archetype.blocks` and records trace entries."""
        q_map = {q.id: q for q in state.batch.questions}
        pinned = (
            {r for r in state.brief.roles() if r in self._grammar.blocks}
            if state.brief is not None
            else set()
        )
        active: list[PlannedBlock] = []
        for ref in archetype.blocks:
            if self._is_redundant_optional_fallback(ref, archetype):
                continue
            block = self._evaluate_single_block_gate(ref, q_map, pinned, state)
            if block is not None:
                active.append(block)
        return tuple(active)

    def _initial_page_bindings(
        self, state: PlannerState, archetype: LayoutArchetype
    ) -> PageBindings:
        """Builds initial `PageBindings` for `archetype` and records claimed title pointer."""
        state.page_claimed_pointers = set()
        if state.copy is not None and state.copy.title:
            title_binding = SlotBinding(literal=state.copy.title)
        else:
            title_ptr = _page_title_pointer(state.pointers)
            if title_ptr is not None:
                state.page_claimed_pointers.add(title_ptr.path)
                title_binding = SlotBinding(pointer=title_ptr.path)
            else:
                title_binding = SlotBinding(literal=state.intent)
        return PageBindings(
            title=title_binding,
            dialog=bool(archetype.frame.get("dialog", False)),
            sticky_actions=bool(archetype.frame.get("stickyActions", False)),
        )

    def _winning_entropy(self, plan: LayoutPlan, state: PlannerState) -> float:
        """Returns normalized Shannon entropy of the winning archetype or family answer."""
        arch_ans = state.answers_by_id.get(f"archetype:{plan.family}")
        if arch_ans is not None:
            return arch_ans.distribution.normalized_entropy()
        fam_ans = state.answers_by_id.get("family")
        if fam_ans is not None:
            return fam_ans.distribution.normalized_entropy()
        return 0.0

    def _orphan_pointer_share(self, plan: LayoutPlan, state: PlannerState) -> float:
        """Computes the share of final bound pointers placed by `no-orphaned-pointers`."""
        bound: set[str] = (
            set(plan.page.title.pointers())
            | set(plan.page.subtitle.pointers())
            | set(plan.page.mark.pointers())
        )
        for block in plan.blocks:
            bound.update(block.bindings.pointers())
        if not bound:
            return 0.0
        return len(state.orphan_pointers & bound) / len(bound)

    def _slot_instance_confidences(
        self,
        block: PlannedBlock,
        spec: BlockSpec,
        slot_name: str,
        slot_binding: SlotBinding,
        state: PlannerState,
    ) -> list[float]:
        """Collects confidence scores from `instance:<block>.*` answers for `slot_binding`."""
        prefix = f"instance:{block.block_id}."
        slot_ptrs = set(slot_binding.pointers())
        act_ids = {
            _button_meta(idx, item)[0] for idx, item in enumerate(slot_binding.items)
        }
        confs: list[float] = []
        for q_id, ans in state.answers_by_id.items():
            if not q_id.startswith(prefix):
                continue
            q_name, _, elem_key = q_id[len(prefix) :].partition(":")
            q_spec = spec.instance.get(q_name)
            if q_spec is None:
                continue
            if (
                elem_key not in slot_ptrs
                and elem_key != slot_name
                and elem_key not in act_ids
            ):
                continue
            if q_spec.kind is QuestionKind.BOOLEAN:
                confs.append(max(ans.yes, 1.0 - ans.yes))
            else:
                confs.append(ans.top()[1])
        return confs

    def _required_slot_weakness(
        self,
        block: PlannedBlock,
        spec: BlockSpec,
        slot_name: str,
        slot_spec: SlotSpec,
        state: PlannerState,
        inst_thresh: float,
    ) -> float:
        """Returns `[0.0, 1.0]` share of bindings on required `slot_name` below `inst_thresh`."""
        slot_binding = block.bindings.get(slot_name)
        if slot_binding is None or not slot_binding.bound:
            return 1.0
        if (
            slot_binding.pointer is None
            and not slot_binding.items
            and slot_spec.from_types != ("action",)
        ):
            return 1.0
        confs = self._slot_instance_confidences(
            block, spec, slot_name, slot_binding, state
        )
        if not confs:
            return 0.0
        return sum(1.0 for c in confs if c < inst_thresh) / len(confs)

    def _is_required_slot(self, spec: BlockSpec, slot_spec: SlotSpec) -> bool:
        """Returns whether `slot_spec` is an explicit or sole-slot required binding."""
        return (
            slot_spec.required
            or len(spec.slots) == 1
            or any(fs.required for fs in slot_spec.fields.values())
        )

    def _weak_required_slot_share(self, plan: LayoutPlan, state: PlannerState) -> float:
        """Computes the share of required slots bound below `thresholds.instance`."""
        inst_thresh = self.threshold("instance")
        ratios: list[float] = []
        for block in plan.blocks:
            spec = self._grammar.block(block.block_id)
            for slot_name, slot_spec in spec.slots.items():
                if self._is_required_slot(spec, slot_spec):
                    ratios.append(
                        self._required_slot_weakness(
                            block, spec, slot_name, slot_spec, state, inst_thresh
                        )
                    )
        return sum(ratios) / len(ratios) if ratios else 0.0

    def _finalize_planned_fit_score(
        self, plan: LayoutPlan, state: PlannerState
    ) -> PlanOutcome:
        """Computes, traces, and attaches `fit_score` onto `plan` and `PlanOutcome`."""
        arch_prob = plan.confidence
        entropy = self._winning_entropy(plan, state)
        orphan_share = self._orphan_pointer_share(plan, state)
        weak_share = self._weak_required_slot_share(plan, state)
        score = compute_fit_score(arch_prob, entropy, orphan_share, weak_share)
        self._record_fit_score(
            state,
            score,
            arch_prob=arch_prob,
            entropy=entropy,
            orphan_share=orphan_share,
            weak_share=weak_share,
        )
        scored_plan = replace(plan, fit_score=score)
        return PlanOutcome(plan=scored_plan, reason=PlanReason.PLANNED, fit_score=score)

    def _apply_all_rules(self, plan: LayoutPlan, state: PlannerState) -> PlanOutcome:
        """Runs the grammar `apply_<rule>` functions in pipeline order."""
        plan = apply_required_block_wins(plan, state)
        plan = apply_at_least(plan, state, self._grammar)
        plan = apply_fallback_must_end(plan, state, self._grammar, self._capabilities)
        plan = apply_catalog_eligibility(plan, state)
        plan = apply_pointer_once_per_region(plan, state, self)
        plan = apply_pictures_need_a_look(plan, state)
        plan = apply_leading_all_or_none(plan, state)
        plan = apply_actions_gate(
            plan,
            state,
            self.threshold("actionGateFloor"),
            self.threshold("actionGateCap"),
            conservativeness=self._config.conservativeness,
        )
        plan = apply_one_primary_action(plan, state)
        plan = apply_urgency_terse(plan, state, self._capabilities)
        plan = apply_no_orphaned_pointers(plan, state, self)
        plan = apply_no_empty_container(plan, state, self._grammar)
        plan = _attach_plan_action_metadata(plan, state)
        if state.action_gate_blocked:
            return PlanOutcome(plan=None, reason=PlanReason.ACTION_GATE)
        if state.required_block_missing or not plan.blocks:
            return PlanOutcome(plan=None, reason=PlanReason.REQUIRED_BLOCK_MISSING)
        return self._finalize_planned_fit_score(plan, state)

    def _apply_scoped_collection_knobs(
        self,
        spec: BlockSpec,
        bindings: BlockBindings,
        state: PlannerState,
        knobs: dict[str, str],
        *,
        actions_allowed: bool,
    ) -> None:
        """Attaches `trailing='button'` and `trailing.label` for scoped item actions."""
        if spec.id != "collection" or not actions_allowed:
            return
        scoped_act = _scoped_collection_action(bindings, state.actions)
        if scoped_act is not None:
            knobs["trailing"] = "button"
            knobs["trailing.label"] = scoped_act.label

    def _resolve_block_questions(
        self,
        spec: BlockSpec,
        bindings: BlockBindings,
        state: PlannerState,
        *,
        actions_allowed: bool,
        preset_knobs: Mapping[str, str],
    ) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
        """Resolves measures, anatomy knobs, and instance answers for `spec`."""
        by_path = {p.path: p for p in state.pointers}
        knobs = {
            **preset_knobs,
            **_compute_block_measures(spec, bindings, by_path),
        }
        q_map = {q.id: q for q in state.batch.questions}
        for knob, q_spec in spec.anatomy.items():
            derived = state.derived_anatomy.get(
                (spec.id, knob)
            ) or _derive_anatomy_from_hints(q_spec, bindings, by_path)
            if derived is not None:
                knobs[knob] = derived
                continue
            q_id = f"anatomy:{spec.id}.{knob}"
            chosen = self._resolve_single_anatomy(
                knob,
                q_spec,
                q_map.get(q_id),
                state.answers_by_id.get(q_id),
                bindings,
                state,
                actions_allowed=actions_allowed,
            )
            if chosen is not None:
                knobs[knob] = chosen
        self._apply_scoped_collection_knobs(
            spec, bindings, state, knobs, actions_allowed=actions_allowed
        )
        instances = self._resolve_block_instances(spec, bindings, state)
        if spec.id in {"banner", "outcome"}:
            for elem_map in instances.values():
                if "tone" in elem_map:
                    knobs.setdefault("tone", elem_map["tone"])
        return knobs, instances

    def _resolve_choice_anatomy(
        self,
        q_spec: QuestionSpec,
        q_obj: DecisionQuestion | None,
        ans: DecisionAnswer | None,
        bindings: BlockBindings,
        state: PlannerState,
        actions_allowed: bool,
    ) -> str | None:
        """Selects the highest-ranked choice option whose `requires` hold."""
        if ans is None:
            ranked = list(q_spec.options)
        else:
            picked, _ = ans.top()
            other_opts = [
                opt
                for opt, _ in sorted(
                    ans.distribution.probabilities.items(),
                    key=lambda item: -item[1],
                )
                if opt != "none" and opt != picked
            ]
            ranked = [picked] + other_opts

        for opt in ranked:
            reqs = q_spec.requires.get(opt, ())
            if _option_requirements_hold(
                reqs,
                bindings,
                self._capabilities,
                actions_allowed,
                state.pointers,
            ):
                if q_obj is not None and ans is not None:
                    state.trace.append(
                        DecisionRecord(question=q_obj, answer=ans, outcome=opt)
                    )
                return opt
        return ranked[0] if ranked else None

    def _resolve_single_anatomy(
        self,
        knob: str,
        q_spec: QuestionSpec,
        q_obj: DecisionQuestion | None,
        ans: DecisionAnswer | None,
        bindings: BlockBindings,
        state: PlannerState,
        *,
        actions_allowed: bool,
    ) -> str | None:
        """Resolves one anatomy knob answer with constraint-aware argmax."""
        if q_spec.kind is QuestionKind.BOOLEAN:
            val = "yes" if (ans is not None and ans.yes >= 0.5) else "no"
            if q_obj is not None and ans is not None:
                state.trace.append(
                    DecisionRecord(
                        question=q_obj, answer=ans, threshold=0.5, outcome=val
                    )
                )
            return val
        if q_spec.kind is QuestionKind.SCORE:
            score = _expected_score(ans) if ans is not None else 1.5
            val = (
                _prominence_level(score)
                if knob == "prominence"
                else str(int(round(score)))
            )
            if q_obj is not None and ans is not None:
                state.trace.append(
                    DecisionRecord(question=q_obj, answer=ans, outcome=val)
                )
            return val
        return self._resolve_choice_anatomy(
            q_spec,
            q_obj,
            ans,
            bindings,
            state,
            actions_allowed,
        )

    def _record_single_instance_answer(
        self,
        q_spec: QuestionSpec,
        q_obj: DecisionQuestion | None,
        ans: DecisionAnswer,
        thresh: float,
        state: PlannerState,
    ) -> str:
        """Evaluates one instance `DecisionAnswer` and appends a `DecisionRecord`."""
        is_bool = q_spec.kind is QuestionKind.BOOLEAN
        val = ("true" if ans.yes >= thresh else "false") if is_bool else ans.top()[0]
        if q_obj is not None:
            state.trace.append(
                DecisionRecord(
                    question=q_obj,
                    answer=ans,
                    threshold=thresh if is_bool else None,
                    outcome=val,
                )
            )
        return val

    def _resolve_block_instances(
        self,
        spec: BlockSpec,
        bindings: BlockBindings,
        state: PlannerState,
    ) -> dict[str, dict[str, str]]:
        """Reads instance answers for `spec` into an element-keyed mapping."""
        if spec.id == "actions":
            return self._resolve_actions_instances(bindings, state)
        q_map = {q.id: q for q in state.batch.questions}
        thresh = self.threshold("instance")
        instances: dict[str, dict[str, str]] = {}
        prefix = f"instance:{spec.id}."
        bound_ptrs = set(bindings.pointers())
        for q_id, ans in state.answers_by_id.items():
            if not q_id.startswith(prefix):
                continue
            q_name, _, elem_key = q_id[len(prefix) :].partition(":")
            q_spec = spec.instance.get(q_name)
            if q_spec is None or (
                elem_key.startswith("/") and elem_key not in bound_ptrs
            ):
                continue
            val = self._record_single_instance_answer(
                q_spec, q_map.get(q_id), ans, thresh, state
            )
            instances.setdefault(elem_key, {})[q_name] = val
        return instances

    def _read_primary_action_choice(
        self,
        target: str,
        q_map: Mapping[str, DecisionQuestion],
        state: PlannerState,
    ) -> str:
        """Reads the winning button option from `instance:actions.primary:<target>`."""
        prim_id = f"instance:actions.primary:{target}"
        prim_ans = state.answers_by_id.get(prim_id)
        if prim_ans is None:
            return ""
        chosen = prim_ans.top()[0]
        if prim_id in q_map:
            state.trace.append(
                DecisionRecord(
                    question=q_map[prim_id],
                    answer=prim_ans,
                    outcome=chosen,
                )
            )
        return chosen

    def _read_button_destructive_flag(
        self,
        act_id: str,
        idx: int,
        thresh: float,
        q_map: Mapping[str, DecisionQuestion],
        state: PlannerState,
    ) -> bool:
        """Reads `instance:actions.destructive:<act_id>` and appends a trace record."""
        dest_id = f"instance:actions.destructive:{act_id}"
        dest_ans = state.answers_by_id.get(dest_id)
        if dest_ans is None:
            dest_id = f"instance:actions.destructive:{idx}"
            dest_ans = state.answers_by_id.get(dest_id)
        if dest_ans is None:
            return False
        is_dest = dest_ans.yes >= thresh
        if dest_id in q_map:
            state.trace.append(
                DecisionRecord(
                    question=q_map[dest_id],
                    answer=dest_ans,
                    threshold=thresh,
                    outcome="true" if is_dest else "false",
                )
            )
        return is_dest

    def _resolve_single_button_flags(
        self,
        idx: int,
        item: Mapping[str, SlotBinding],
        chosen_prim: str,
        thresh: float,
        q_map: Mapping[str, DecisionQuestion],
        state: PlannerState,
    ) -> tuple[str, str, dict[str, str]]:
        """Computes `(act_id, label, instance_flags)` for a single action button."""
        act_id, label, style = _button_meta(idx, item)
        is_dest = style == ActionStyle.DESTRUCTIVE.value or (
            self._read_button_destructive_flag(act_id, idx, thresh, q_map, state)
        )
        if style == ActionStyle.PRIMARY.value:
            is_prim = True
        elif style in {
            ActionStyle.SECONDARY.value,
            ActionStyle.DESTRUCTIVE.value,
        }:
            is_prim = False
        else:
            is_prim = chosen_prim in {act_id, label, str(idx)}
        return (
            act_id,
            label,
            {
                "primary": "true" if is_prim else "false",
                "destructive": "true" if is_dest else "false",
            },
        )

    def _resolve_actions_instances(
        self,
        bindings: BlockBindings,
        state: PlannerState,
    ) -> dict[str, dict[str, str]]:
        """Resolves `actions.primary` and `actions.destructive` per button."""
        buttons = bindings.get("buttons")
        if buttons is None or not buttons.items:
            return {}
        q_map = {q.id: q for q in state.batch.questions}
        thresh = self.threshold("instance")
        chosen_prim = self._read_primary_action_choice("buttons", q_map, state)
        instances: dict[str, dict[str, str]] = {}
        for idx, item in enumerate(buttons.items):
            act_id, label, entry = self._resolve_single_button_flags(
                idx, item, chosen_prim, thresh, q_map, state
            )
            instances[str(idx)] = entry
            instances[act_id] = entry
            instances[label] = entry
        return instances


_MAX_SALIENCE_QUESTIONS = 20


def _single_apply_condition_holds(
    key: str,
    req: Any,
    item: Mapping[str, SlotBinding],
    ptr: PointerSummary | None,
) -> bool:
    """Checks one `(key, req)` entry of an item question's `applies_when`."""
    if req == "bound":
        return key in item and item[key].bound
    allowed = {req} if isinstance(req, str) else set(req)
    return ptr is not None and ptr.semantic_type in allowed


def _item_instance_applies(
    q_spec: QuestionSpec,
    item: Mapping[str, SlotBinding],
    ptr: PointerSummary | None,
) -> bool:
    """Checks `q_spec.applies_when` for one item in `headline` or `form`."""
    return all(
        _single_apply_condition_holds(k, req, item, ptr)
        for k, req in q_spec.applies_when.items()
    )
