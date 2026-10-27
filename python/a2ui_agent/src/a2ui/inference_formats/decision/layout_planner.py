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

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
import random
import re
from typing import Any

from a2ui.core import A2uiValidationError

from .archetypes import (
    ABSTRACT_PATTERNS,
    FALLBACK_TERMINALS,
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
    VarietyMode,
)
from .payload_inspector import PointerSummary, split_pointer
from .semantic_types import humanize_key

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
        del variant
        return name in ABSTRACT_PATTERNS


@dataclass
class PlannerState:
    """State carried from `LayoutPlanner.build_batch` into `read` and `needs_reask`."""

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
    seed: int | None = None
    rng: random.Random | None = None


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


def _normalize_pointers(
    pointers: Sequence[PointerSummary],
) -> tuple[PointerSummary, ...]:
    """Expands `pointers` with missing parent object and array sample pointers."""
    existing_paths = {p.path for p in pointers}
    excluded_parents = existing_paths | {
        p.path for p in pointers if p.value_type == "array"
    }
    result: list[PointerSummary] = []
    for ptr in pointers:
        parent = ptr.parent or ""
        if parent and parent not in excluded_parents:
            excluded_parents.add(parent)
            result.append(_build_parent_object_summary(parent, pointers))
        result.append(ptr)
        for sample in ptr.sample_pointers:
            if sample not in existing_paths:
                existing_paths.add(sample)
                result.append(_build_sample_pointer_summary(sample))
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
    if target == "action":
        return _is_action_pointer(ptr)
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


def _is_action_pointer(ptr: PointerSummary) -> bool:
    """Returns whether `ptr` represents an action list or button trigger."""
    low = ptr.key.lower()
    if low in {"actions", "buttons", "cta"}:
        return True
    return ptr.mutable_hint and ptr.value_type == "array" and not ptr.element_keys


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
    absorbed: set[str] = set()
    for ptr in pointers:
        absorbed.update(_absorbed_for_single_pointer(ptr, pointers, has_currency))
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


def _bind_scalar_slot(
    slot: SlotSpec,
    pointers: Sequence[PointerSummary],
    used: set[str],
    *,
    preferred_paths: Sequence[str] = (),
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
    return SlotBinding(pointer=best.path, semantic_type=best.semantic_type)


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
    preferred_names = {p.lower() for p in (*field_spec.prefer, field_name)}
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


def _bind_array_element_fields(
    arr_ptr: PointerSummary,
    fields: Mapping[str, SlotSpec],
) -> dict[str, SlotBinding]:
    """Binds relative per-element fields of a repeated array-backed slot."""
    bound_fields: dict[str, SlotBinding] = {}
    used_keys: set[str] = set()
    req_fields = tuple((k, v) for k, v in fields.items() if v.required)
    opt_fields = tuple((k, v) for k, v in fields.items() if not v.required)
    _bind_element_field_pass(arr_ptr, req_fields, bound_fields, used_keys, min_score=0)
    for cutoff in (10, 0):
        _bind_element_field_pass(
            arr_ptr, opt_fields, bound_fields, used_keys, min_score=cutoff
        )
    return bound_fields


def _unroll_array_items(
    ptr: PointerSummary, fields: Mapping[str, SlotBinding]
) -> tuple[dict[str, SlotBinding], ...]:
    """Unrolls `fields` into indexed element bindings across `ptr.cardinality`."""
    return tuple(
        {
            f_name: SlotBinding(
                pointer=(
                    f"{ptr.path}/{idx}/{f_bind.pointer}"
                    if f_bind.pointer
                    else f"{ptr.path}/{idx}"
                ),
                semantic_type=f_bind.semantic_type,
            )
            for f_name, f_bind in fields.items()
            if f_bind.bound
        }
        for idx in range(ptr.cardinality)
    )


def _bind_array_repeated_slot(
    block_id: str,
    slot: SlotSpec,
    pointers: Sequence[PointerSummary],
    used: set[str],
) -> SlotBinding:
    """Binds a repeated slot whose `from_types` is ``('array',)``."""
    for ptr in pointers:
        if ptr.path in used or ptr.value_type != "array" or ptr.cardinality <= 0:
            continue
        if _is_action_pointer(ptr):
            continue
        fields = _bind_array_element_fields(ptr, slot.fields)
        if all(
            not f_spec.required or f_name in fields
            for f_name, f_spec in slot.fields.items()
        ):
            items = (
                _unroll_array_items(ptr, fields)
                if (block_id == "steps" or not ptr.element_keys)
                else ()
            )
            return SlotBinding(pointer=ptr.path, fields=fields, items=items)
    return SlotBinding()


def _labels_from_sequence(raw: Any) -> list[str]:
    """Extracts string labels from a runtime sequence of strings or mappings."""
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return []
    labels: list[str] = []
    for item in raw:
        if isinstance(item, Mapping):
            val = item.get("label") or item.get("title") or item.get("name") or ""
            labels.append(str(val))
        else:
            labels.append(str(item))
    return labels


def _action_button_labels(
    ptr: PointerSummary,
    payload: Mapping[str, Any],
    intent: str,
    max_buttons: int | None,
) -> list[str]:
    """Extracts button label strings for an action pointer."""
    labels = _labels_from_sequence(_resolve_pointer_value(payload, ptr.path))
    if not labels:
        labels = _labels_from_sequence(
            ptr.hints.get("values") or ptr.hints.get("items")
        )
    if not labels and ptr.cardinality == 2 and "send" in intent.lower():
        labels = ["Send", "Cancel"]
    if not labels:
        labels = [str(i) for i in range(max(ptr.cardinality, 1))]
    return labels[:max_buttons] if max_buttons is not None else labels


def _bind_actions_slot(
    slot: SlotSpec,
    pointers: Sequence[PointerSummary],
    used: set[str],
    payload: Mapping[str, Any],
    intent: str,
) -> SlotBinding:
    """Binds the `actions.buttons` repeated slot from an action array pointer."""
    for ptr in pointers:
        if ptr.path in used or not _is_action_pointer(ptr):
            continue
        labels = _action_button_labels(ptr, payload, intent, slot.max)
        items = tuple({"label": SlotBinding(literal=lbl)} for lbl in labels if lbl)
        if items:
            return SlotBinding(pointer=ptr.path, items=items)
    return SlotBinding()


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


def _build_scalar_item_mapping(
    ptr: PointerSummary,
    slot: SlotSpec,
    pointers: Sequence[PointerSummary],
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
                item[f_name] = SlotBinding(pointer=sib.path)
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
    items = tuple(_build_scalar_item_mapping(ptr, slot, pointers) for ptr in selected)
    return SlotBinding(items=items)


def _resolve_block_pattern(
    spec: BlockSpec, capabilities: PatternCapabilities
) -> tuple[str, dict[str, str]] | None:
    """Walks `spec.fallback` against `capabilities`, returning ``(pattern, preset_knobs)``."""
    candidates = (spec.pattern, *spec.fallback)
    for entry in candidates:
        if entry in FALLBACK_TERMINALS:
            return entry, {}
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


def apply_pointer_once_per_region(
    plan: LayoutPlan,
    state: PlannerState,
    planner: LayoutPlanner,
) -> LayoutPlan:
    """Rule `pointer-once-per-region`: blocks claim pointers in archetype order."""
    used: set[str] = set(state.page_claimed_pointers)
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
        )
        bindings = _apply_authored_prose_summary(block.block_id, bindings, state)
        used.update(bindings.pointers())
        knobs, instances = planner._resolve_block_questions(
            spec,
            bindings,
            state,
            actions_allowed=plan.actions_allowed,
            preset_knobs=block.variant_knobs,
            rng=state.rng,
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
    pointers: Sequence[PointerSummary], claimed: set[str]
) -> bool:
    """Returns whether `pointers` has an unclaimed non-action, non-image array."""
    return any(
        p.value_type == "array"
        and p.cardinality > 0
        and not _is_action_pointer(p)
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
    if planner.config.threshold_overrides or (
        present_ids & {"collection", "steps", "comparison"}
    ):
        return
    if not _has_uncovered_data_array(state.pointers, claimed):
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
    )
    if not col_bindings.is_bound("items"):
        return
    col_knobs, col_inst = planner._resolve_block_questions(
        col_spec,
        col_bindings,
        state,
        actions_allowed=plan.actions_allowed,
        preset_knobs=col_preset,
        rng=state.rng,
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
    claimed.update(col_bindings.pointers())
    present_ids.add("collection")


def _uncovered_scalar_fact_pointers(
    state: PlannerState,
    claimed: set[str],
    *,
    allow_prose_fallback: bool,
) -> list[PointerSummary]:
    """Returns unclaimed top-level scalar pointers eligible for `facts` recovery."""
    prose_types = {"long_text", "markdown", "code"}
    return [
        p
        for p in state.pointers
        if not p.parent
        and p.value_type in {"string", "number", "boolean"}
        and not _is_nested_mutable_setting(p, state.pointers)
        and not _is_pointer_covered(p.path, claimed)
        and (
            p.semantic_type not in _NON_FACT_SEMANTIC_TYPES
            or (allow_prose_fallback and p.semantic_type in prose_types)
        )
    ]


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
        rng=state.rng,
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
    """Recovers unclaimed top-level scalar or array pointers into `facts` or `collection`."""
    claimed: set[str] = (
        set(state.page_claimed_pointers)
        | set(plan.page.title.pointers())
        | set(plan.page.subtitle.pointers())
        | set(plan.page.mark.pointers())
        | _collect_absorbed_siblings(state.pointers)
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
    uncovered_scalars = _uncovered_scalar_fact_pointers(
        state, claimed, allow_prose_fallback=allow_prose_fallback
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
    block: PlannedBlock, required_ids: set[str], state: PlannerState
) -> PlannedBlock | None:
    """Applies the `actions_allowed == False` gate to one `PlannedBlock`."""
    if block.block_id in {"actions", "compose"}:
        if block.block_id in required_ids and block.bindings.pointers():
            state.action_gate_blocked = True
        return None
    if block.block_id == "filters":
        return None
    if (
        block.block_id == "collection"
        and block.variant_knobs.get("trailing") == "button"
    ):
        return replace(block, variant_knobs={**block.variant_knobs, "trailing": "none"})
    if block.block_id == "groups":
        return replace(block, instances=_degrade_group_instances(block.instances))
    return block


def apply_actions_gate(
    plan: LayoutPlan,
    state: PlannerState,
    floor: float,
    cap: float,
) -> LayoutPlan:
    """Rule `actions-gate`: computes `actions_allowed` and gates interactive blocks.

    The gate is ``floor + (cap - floor) * stakes / 3``; `floor` and `cap` are
    the grammar's ``actionGateFloor`` and ``actionGateCap`` thresholds.
    """
    gate = floor + (cap - floor) * (plan.stakes / 3.0)
    allowed = plan.confidence >= gate
    plan = replace(plan, actions_allowed=allowed)
    if allowed:
        return plan
    archetype = state.selected_archetype
    required_ids = set(archetype.required_block_ids()) if archetype else set()
    updated: list[PlannedBlock] = []
    for block in plan.blocks:
        gated = _gate_single_block(block, required_ids, state)
        if gated is not None:
            updated.append(gated)
    return replace(plan, blocks=tuple(updated))


def _extract_button_records(
    raw_items: Sequence[Mapping[str, SlotBinding]],
    instances: Mapping[str, Mapping[str, str]],
    stakes: float,
) -> list[tuple[Mapping[str, SlotBinding], str, bool, bool]]:
    """Builds ``(item, label, is_primary, is_destructive)`` tuples for action buttons."""
    records: list[tuple[Mapping[str, SlotBinding], str, bool, bool]] = []
    seen_primary = False
    for idx, item in enumerate(raw_items):
        label = str(item["label"].literal or idx)
        inst = instances.get(label) or instances.get(str(idx)) or {}
        is_dest = inst.get("destructive") == "true"
        is_prim = (
            inst.get("primary") == "true"
            and not seen_primary
            and not (stakes >= 2.0 and is_dest)
        )
        if is_prim:
            seen_primary = True
        records.append((item, label, is_prim, is_dest))
    return records


def _reorder_and_enforce_actions(block: PlannedBlock, stakes: float) -> PlannedBlock:
    """Enforces at most one primary button and demotes/reorders destructive buttons."""
    buttons = block.bindings.get("buttons")
    if buttons is None or not buttons.items:
        return block
    records = _extract_button_records(buttons.items, block.instances, stakes)
    sort_idx = 3 if (stakes >= 2.0 and any(r[3] for r in records)) else 2
    records.sort(key=lambda r: (1 if r[sort_idx] else 0))
    new_items = tuple(r[0] for r in records)
    new_instances: dict[str, dict[str, str]] = {}
    for idx, (_, label, is_prim, is_dest) in enumerate(records):
        entry = {
            "primary": "true" if is_prim else "false",
            "destructive": "true" if is_dest else "false",
        }
        new_instances[str(idx)] = entry
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
    prose_req = (
        archetype.requirement_of("prose") == "required"
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


class LayoutPlanner:
    """Speculative single-batch layout planner for archetype-driven A2UI synthesis."""

    def __init__(
        self,
        grammar: ArchetypeGrammar | None = None,
        config: SynthesisConfig | None = None,
        *,
        capabilities: PatternCapabilities | None = None,
    ) -> None:
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
        """The `SynthesisConfig` governing pair budgets and threshold overrides."""
        return self._config

    def threshold(self, name: str) -> float:
        """The effective threshold `name`: a `config.threshold_overrides` entry, else the grammar's.

        Raises:
            KeyError: If neither the overrides nor the grammar define `name`.
        """
        override = self._config.threshold_overrides.get(name)
        return override if override is not None else self._grammar.threshold(name)

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
    ) -> BlockBindings:
        """Deterministically binds `spec.slots` against `pointers` excluding `used`."""
        norm_pointers = _normalize_pointers(pointers)
        local_used = set(used)
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
            )
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
    ) -> SlotBinding:
        """Dispatches binding for a single `SlotSpec`."""
        if not slot.repeat:
            return _bind_scalar_slot(
                slot, pointers, used, preferred_paths=preferred_paths
            )
        if slot.from_types == ("action",):
            return _bind_actions_slot(slot, pointers, used, payload, intent)
        if slot.from_types == ("object",):
            return _bind_groups_slot(pointers, used)
        if slot.from_types == ("array",):
            return _bind_array_repeated_slot(spec.id, slot, pointers, used)
        return _bind_scalar_repeated_slot(
            spec.id,
            slot,
            pointers,
            used,
            salience_scores,
            spec.salience,
        )

    def _is_required_block_viable(
        self,
        req_id: str,
        pointers: Sequence[PointerSummary],
        base_used: set[str],
    ) -> bool:
        """Returns whether required block `req_id` resolves and binds on `pointers`."""
        spec = self._grammar.block(req_id)
        if _resolve_block_pattern(spec, self._capabilities) is None:
            return False
        if not _matches_shape(spec.shape, pointers):
            return False
        bindings = self.bind_slots(spec, pointers, set(base_used))
        return _block_has_required_bindings(
            PlannedBlock(block_id=req_id, pattern=spec.pattern, bindings=bindings),
            spec,
        )

    def _default_eligible(
        self, pointers: Sequence[PointerSummary]
    ) -> tuple[LayoutArchetype, ...]:
        """Filters `grammar.archetypes` by shape, catalog support, and required slots."""
        page_ptr = _page_title_pointer(pointers)
        base_used = {page_ptr.path} if page_ptr is not None else set()
        return tuple(
            arch
            for arch in self._grammar.archetypes
            if _matches_shape(arch.shape, pointers)
            and all(
                self._is_required_block_viable(req_id, pointers, base_used)
                for req_id in arch.required_block_ids()
            )
        )

    def _satisfied_block_count(
        self, arch: LayoutArchetype, pointers: Sequence[PointerSummary]
    ) -> int:
        """Counts how many blocks in `arch` satisfy their shape filter on `pointers`."""
        page_ptr = _page_title_pointer(pointers)
        base_used = {page_ptr.path} if page_ptr is not None else set()
        count = 0
        for ref in arch.blocks:
            spec = self._grammar.block(ref.id)
            if spec.shape.is_empty:
                bindings = self.bind_slots(spec, pointers, set(base_used))
                if _block_has_required_bindings(
                    PlannedBlock(
                        block_id=ref.id, pattern=spec.pattern, bindings=bindings
                    ),
                    spec,
                ):
                    count += 1
            elif spec.id == "actions":
                if any(_is_action_pointer(p) for p in pointers):
                    count += 1
            elif _matches_shape(spec.shape, pointers):
                count += 1
        return count

    def prior_archetypes(
        self,
        eligible: Sequence[LayoutArchetype],
        pointers: Sequence[PointerSummary],
        brief: LayoutBrief | None = None,
    ) -> tuple[LayoutArchetype, ...]:
        """Orders `eligible` archetypes by brief pin first, then satisfied block shapes."""
        norm = _normalize_pointers(pointers)
        pinned_families = (
            {r for r in brief.roles() if r in self._grammar.families()}
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
            is_pinned = 0
            if arch.family in pinned_families:
                is_pinned = 2
            elif pinned_blocks and pinned_blocks.issubset(set(arch.block_ids())):
                is_pinned = 1
            satisfied = self._satisfied_block_count(arch, norm)
            return (-is_pinned, -satisfied, grammar_order.get(arch.id, 999))

        return tuple(sorted(eligible, key=_sort_key))

    def build_batch(
        self,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        eligible: Sequence[LayoutArchetype] | None = None,
        brief: LayoutBrief | None = None,
        payload: Mapping[str, Any] | None = None,
        copy: AuthoredCopy | None = None,
    ) -> tuple[DecisionBatch, PlannerState]:
        """Builds a speculative `DecisionBatch` and `PlannerState` for one surface.

        Args:
            intent: The author's natural-language intent.
            pointers: Payload pointer summaries from `inspect_payload_pointers`.
            eligible: Archetypes to consider; defaults to those whose shape and
                required blocks the payload satisfies.
            brief: Optional `LayoutBrief` pinning roles to pointers.
            payload: The payload itself, used to read action labels and
                option values; questions degrade to key-derived text without it.
            copy: Optional authored title and summary strings supplied in the
                decision block.
        """
        norm_pointers = _normalize_pointers(pointers)
        elig = (
            tuple(eligible)
            if eligible is not None
            else self._default_eligible(norm_pointers)
        )
        prior = self.prior_archetypes(elig, norm_pointers, brief)
        state = PlannerState(
            intent=intent,
            pointers=norm_pointers,
            eligible=elig,
            prior_archetypes=tuple(a.id for a in prior),
            brief=brief,
            batch=DecisionBatch(shared_context={}, questions=()),
            payload=dict(payload) if payload is not None else {},
            copy=copy,
        )
        questions: list[DecisionQuestion] = []
        self._append_job_questions(questions, state)
        self._append_archetype_questions(questions, state)
        self._append_gate_and_anatomy_questions(questions, state)
        self._append_salience_questions(questions, state)
        self._append_instance_questions(questions, state, prior[:2])
        batch = DecisionBatch(
            shared_context={
                "intent": intent,
                "pointers": [p.path for p in norm_pointers],
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
    ) -> tuple[DecisionBatch, PlannerState]:
        """Builds Stage 1 (`family`, `stakes`, `urgency`, and `archetype:*`) of a two-stage batch."""
        norm_pointers = _normalize_pointers(pointers)
        elig = (
            tuple(eligible)
            if eligible is not None
            else self._default_eligible(norm_pointers)
        )
        prior = self.prior_archetypes(elig, norm_pointers, brief)
        state = PlannerState(
            intent=intent,
            pointers=norm_pointers,
            eligible=elig,
            prior_archetypes=tuple(a.id for a in prior),
            brief=brief,
            batch=DecisionBatch(shared_context={}, questions=()),
            payload=dict(payload) if payload is not None else {},
            copy=copy,
        )
        questions: list[DecisionQuestion] = []
        self._append_job_questions(questions, state)
        self._append_archetype_questions(questions, state)
        batch = DecisionBatch(
            shared_context={
                "intent": intent,
                "pointers": [p.path for p in norm_pointers],
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
        """Returns family roles pinned by `state.brief`."""
        if state.brief is None:
            return []
        return [r for r in state.brief.roles() if r in self._grammar.families()]

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
                    allow_none=fam_spec.allow_none,
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
                if _matches_shape(spec.shape, state.pointers):
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
            )
            for knob, q_spec in spec.anatomy.items():
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
        headline_types = self._grammar.block("headline").slots["items"].from_types
        facts_types = self._grammar.block("facts").slots["rows"].from_types
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
        sal_spec = self._grammar.block("headline").salience
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
                if not spec.instance or not _matches_shape(spec.shape, state.pointers):
                    continue
                bindings = self.bind_slots(
                    spec,
                    state.pointers,
                    set(base_used),
                    payload=state.payload,
                    intent=state.intent,
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
        display = str(val) if val is not None else ptr_path.lstrip("/")
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

    def _build_actions_instance_questions(
        self, spec: BlockSpec, bindings: BlockBindings
    ) -> list[DecisionQuestion]:
        """Builds `actions.primary` and `actions.destructive` instance questions."""
        buttons = bindings.get("buttons")
        if buttons is None or not buttons.items:
            return []
        ptr_path = buttons.pointer or "/actions"
        labels = tuple(
            str(item["label"].literal or idx) for idx, item in enumerate(buttons.items)
        )
        built: list[DecisionQuestion] = []
        prim_spec = spec.instance.get("primary")
        if prim_spec is not None and labels:
            built.append(
                DecisionQuestion(
                    id=f"instance:actions.primary:{ptr_path}",
                    kind=QuestionKind.CHOICE,
                    prompt=prim_spec.question,
                    options=labels,
                    allow_none=prim_spec.allow_none,
                )
            )
        dest_spec = spec.instance.get("destructive")
        if dest_spec is not None:
            for idx, label in enumerate(labels):
                built.append(
                    DecisionQuestion(
                        id=f"instance:actions.destructive:{idx}",
                        kind=QuestionKind.BOOLEAN,
                        prompt=dest_spec.question.format(label=label),
                        context={"yes": dest_spec.yes, "no": dest_spec.no},
                        allow_none=False,
                    )
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

    def read(
        self,
        state: PlannerState,
        answers: Sequence[DecisionAnswer],
        *,
        seed: int | None = None,
    ) -> PlanOutcome:
        """Reads backend `answers` into a validated `PlanOutcome`."""
        state.seed = seed
        if self._config.variety is VarietyMode.NEAR_TOP:
            state.rng = random.Random(seed)
        else:
            state.rng = None
        self._validate_and_index_answers(state, answers)
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
        """Returns the first family role pinned by `brief`, if any."""
        if brief is None:
            return None
        families = self._grammar.families()
        return next((r for r in brief.roles() if r in families), None)

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

    def _read_family(self, state: PlannerState) -> str | None:
        """Resolves the winning family ID from `brief` or the `family` answer."""
        pinned_fam = self._brief_pinned_family(state.brief)
        if pinned_fam is not None:
            return pinned_fam
        q_map = {q.id: q for q in state.batch.questions}
        fam_q = q_map.get("family")
        fam_ans = state.answers_by_id.get("family")
        if fam_q is None or fam_ans is None:
            return state.eligible[0].family if state.eligible else None
        chosen, prob = fam_ans.top()
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
        chosen, prob = arch_ans.top()
        thresh = self.threshold("archetype")
        fam_ans = state.answers_by_id.get("family")
        if chosen == "none" or prob < thresh:
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
        if _matches_shape(spec.shape, state.pointers):
            return True
        return bool(
            spec.id == "prose" and state.copy is not None and state.copy.summary
        )

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
        prob = (
            ans.yes
            if ans is not None
            else (0.8 if ref.requirement != "optional" else 0.0)
        )
        state.gate_probabilities[ref.id] = prob
        thresh = self.threshold(
            "optional" if ref.requirement == "optional" else "expected"
        )
        passed = prob >= thresh
        outcome = (
            "required_override (disagreement)"
            if (ref.requirement == "required" and not passed)
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
        )
        plan = apply_one_primary_action(plan, state)
        plan = apply_urgency_terse(plan, state, self._capabilities)
        plan = apply_no_orphaned_pointers(plan, state, self)
        plan = apply_no_empty_container(plan, state, self._grammar)
        if state.action_gate_blocked:
            return PlanOutcome(plan=None, reason=PlanReason.ACTION_GATE)
        if state.required_block_missing or not plan.blocks:
            return PlanOutcome(plan=None, reason=PlanReason.REQUIRED_BLOCK_MISSING)
        return PlanOutcome(plan=plan, reason=PlanReason.PLANNED)

    def _pick_option(
        self,
        answer: DecisionAnswer,
        *,
        kind: str = "option",
        rng: random.Random | None = None,
    ) -> tuple[str, float]:
        """Picks a winning option from `answer` using ARGMAX or NEAR_TOP sampling."""
        if (
            self._config.variety is not VarietyMode.NEAR_TOP
            or rng is None
            or not answer.distribution.probabilities
        ):
            return answer.top()

        probs = {
            opt: prob
            for opt, prob in answer.distribution.probabilities.items()
            if opt != "none"
        }
        if not probs:
            return answer.top()

        top_opt, top_prob = max(probs.items(), key=lambda item: item[1])
        cutoff = top_prob - self._config.variety_margin
        near_top = [(opt, prob) for opt, prob in probs.items() if prob >= cutoff]
        if len(near_top) <= 1:
            return top_opt, top_prob

        candidates = [opt for opt, _ in near_top]
        weights = [prob for _, prob in near_top]
        chosen = rng.choices(candidates, weights=weights, k=1)[0]
        return chosen, probs[chosen]

    def _resolve_block_questions(
        self,
        spec: BlockSpec,
        bindings: BlockBindings,
        state: PlannerState,
        *,
        actions_allowed: bool,
        preset_knobs: Mapping[str, str],
        rng: random.Random | None = None,
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
                rng=rng,
            )
            if chosen is not None:
                knobs[knob] = chosen
        instances = self._resolve_block_instances(spec, bindings, state, rng=rng)
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
        *,
        rng: random.Random | None = None,
    ) -> str | None:
        """Selects the highest-ranked choice option whose `requires` hold."""
        if ans is None:
            ranked = list(q_spec.options)
        else:
            picked, _ = self._pick_option(ans, kind="anatomy", rng=rng)
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
        rng: random.Random | None = None,
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
            rng=rng,
        )

    def _record_single_instance_answer(
        self,
        q_spec: QuestionSpec,
        q_obj: DecisionQuestion | None,
        ans: DecisionAnswer,
        thresh: float,
        state: PlannerState,
        *,
        rng: random.Random | None = None,
    ) -> str:
        """Evaluates one instance `DecisionAnswer` and appends a `DecisionRecord`."""
        is_bool = q_spec.kind is QuestionKind.BOOLEAN
        val = (
            ("true" if ans.yes >= thresh else "false")
            if is_bool
            else self._pick_option(ans, kind="instance", rng=rng)[0]
        )
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
        *,
        rng: random.Random | None = None,
    ) -> dict[str, dict[str, str]]:
        """Reads instance answers for `spec` into an element-keyed mapping."""
        if spec.id == "actions":
            return self._resolve_actions_instances(bindings, state, rng=rng)
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
                q_spec, q_map.get(q_id), ans, thresh, state, rng=rng
            )
            instances.setdefault(elem_key, {})[q_name] = val
        return instances

    def _read_primary_action_choice(
        self,
        ptr_path: str,
        q_map: Mapping[str, DecisionQuestion],
        state: PlannerState,
        *,
        rng: random.Random | None = None,
    ) -> str:
        """Reads the winning button option from `instance:actions.primary:<ptr>`."""
        prim_id = f"instance:actions.primary:{ptr_path}"
        prim_ans = state.answers_by_id.get(prim_id)
        if prim_ans is None:
            return ""
        chosen = self._pick_option(prim_ans, kind="primary_action", rng=rng)[0]
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
        idx: int,
        thresh: float,
        q_map: Mapping[str, DecisionQuestion],
        state: PlannerState,
    ) -> bool:
        """Reads `instance:actions.destructive:<idx>` and appends a trace record."""
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

    def _resolve_actions_instances(
        self,
        bindings: BlockBindings,
        state: PlannerState,
        *,
        rng: random.Random | None = None,
    ) -> dict[str, dict[str, str]]:
        """Resolves `actions.primary` and `actions.destructive` per button."""
        buttons = bindings.get("buttons")
        if buttons is None or not buttons.items:
            return {}
        q_map = {q.id: q for q in state.batch.questions}
        thresh = self.threshold("instance")
        chosen_prim = self._read_primary_action_choice(
            buttons.pointer or "/actions", q_map, state, rng=rng
        )
        instances: dict[str, dict[str, str]] = {}
        for idx, item in enumerate(buttons.items):
            label = str(item["label"].literal or idx)
            is_dest = self._read_button_destructive_flag(idx, thresh, q_map, state)
            is_prim = chosen_prim in {label, str(idx)}
            entry = {
                "primary": "true" if is_prim else "false",
                "destructive": "true" if is_dest else "false",
            }
            instances[str(idx)] = entry
            instances[label] = entry
        return instances

    def needs_reask(
        self, plan: LayoutPlan, state: PlannerState
    ) -> tuple[DecisionQuestion, ...]:
        """Returns depended-on questions whose winning probability is below `reask_below`."""
        active_blocks = set(plan.block_ids())
        active_ptrs: set[str] = set()
        for block in plan.blocks:
            active_ptrs.update(block.bindings.pointers())
        reask: list[DecisionQuestion] = []
        for question in state.batch.questions:
            if not _question_affects_plan(
                question.id, plan.family, active_blocks, active_ptrs
            ):
                continue
            ans = state.answers_by_id.get(question.id)
            if ans is None:
                continue
            win_prob = (
                max(ans.yes, 1.0 - ans.yes)
                if question.kind is QuestionKind.BOOLEAN
                else ans.top()[1]
            )
            if win_prob < self.threshold("reask_below"):
                reask.append(question)
        return tuple(reask)


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


def _question_affects_plan(
    question_id: str,
    family: str,
    active_blocks: set[str],
    active_ptrs: set[str],
) -> bool:
    """Returns whether `question_id` governs a block or element present in `plan`."""
    if question_id in {"family", f"archetype:{family}"}:
        return True
    if question_id.startswith("anatomy:"):
        block_id = question_id[len("anatomy:") :].split(".", 1)[0]
        return block_id in active_blocks
    if question_id.startswith("instance:"):
        rest = question_id[len("instance:") :]
        block_id = rest.split(".", 1)[0]
        if block_id not in active_blocks:
            return False
        _, _, elem_key = rest.partition(":")
        if elem_key.startswith("/"):
            return elem_key in active_ptrs
        return True
    if question_id.startswith("gate:"):
        block_id = question_id[len("gate:") :]
        return block_id in active_blocks
    return False
