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

"""JSON Pointer payload inspector for local decision-model A2UI synthesis."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Literal, cast

from .models import SemanticType
from .semantic_types import classify_array_field, classify_scalar, humanize_key

PointerValueType = Literal["string", "number", "boolean", "array", "object"]

_FALLBACK_KEY_TYPES: Mapping[str, str] = {
    "name": "name",
    "rating": "rating",
    "stars": "rating",
    "score": "rating",
    "amount": "currency",
    "price": "currency",
    "pricefrom": "currency",
    "fee": "currency",
    "cost": "currency",
    "total": "currency",
    "status": "status",
    "state": "status",
    "health": "status",
    "arrives": "date",
    "date": "date",
    "due": "date",
    "skipforward": "duration",
    "uptimehours": "integer",
    "duration": "duration",
    "about": "long_text",
    "description": "long_text",
    "summary": "long_text",
    "body": "long_text",
}
_FALLBACK_IMAGE_ELEMENT_KEYS: frozenset[str] = frozenset(
    {"url", "image", "photo", "thumbnail", "avatar"}
)


def _infer_image_key_hint(low_key: str) -> str | None:
    """Returns a framing key hint if `low_key` names an image role."""
    for token in ("logo", "icon", "avatar", "photo", "image"):
        if token in low_key:
            return token
    return None


def _infer_fallback_semantics(
    key: str,
    value_type: PointerValueType,
    raw_hints: Mapping[str, Any],
) -> tuple[SemanticType, dict[str, Any]]:
    """Infers fallback semantic type and hints from `key` and coarse `value_type`."""
    hints = dict(raw_hints)
    if value_type in {"array", "object", "boolean"}:
        return SemanticType(value_type), hints
    low = key.lower()
    img_hint = _infer_image_key_hint(low)
    if img_hint is not None:
        hints.setdefault("keyHint", img_hint)
        return SemanticType.IMAGE_URL, hints
    mapped = _FALLBACK_KEY_TYPES.get(low)
    if mapped is not None:
        hints.setdefault("keyHint", low)
        if mapped == "long_text":
            hints.setdefault("wordCount", 36)
            hints.setdefault("length", "blurb")
        return SemanticType(mapped), hints
    if value_type == "number":
        return SemanticType.NUMBER, hints
    return SemanticType.STRING, hints


def _infer_fallback_array_elements(
    path: str,
    element_keys: tuple[str, ...],
    sample_pointers: tuple[str, ...],
) -> tuple[dict[str, SemanticType], tuple[str, ...]]:
    """Infers element semantic types and image sample pointers from `element_keys`."""
    elem_sem: dict[str, SemanticType] = {}
    samples = list(sample_pointers)
    for ek in element_keys:
        is_img = ek.lower() in _FALLBACK_IMAGE_ELEMENT_KEYS
        elem_sem[ek] = SemanticType.IMAGE_URL if is_img else SemanticType.STRING
        sample_path = f"{path}/0/{ek}"
        if is_img and sample_path not in samples:
            samples.append(sample_path)
    return elem_sem, tuple(samples)


@dataclass(frozen=True)
class PointerSummary:
    """Structural summary of a bindable JSON Pointer path in a data payload.

    `value_type` is the coarse JSON type; `semantic_type` and the fields after
    it are the semantic view the archetype grammar binds slots against. They
    default so callers that only know the coarse type keep working.

    Attributes:
        path: RFC 6901 JSON Pointer path in the payload.
        value_type: Coarse JSON value type at `path`.
        cardinality: Number of elements for containers, or 1 for scalars.
        element_keys: Escaped field names observed across object elements of an
            array.
        sample_type_by_key: Coarse value type for each key in `element_keys`.
        mutable_hint: Whether the pointer or a parent path is user-editable.
        semantic_type: Fine-grained `SemanticType` classification for `path`.
        hints: Detector hints such as `wordCount`, `unit`, `currency`, `min`,
            and `max`.
        key: Last pointer segment, unescaped; derived from `path` when empty.
        label: Humanized display label derived from `key`.
        parent: Parent JSON Pointer (``""`` for top-level keys); derived when
            None.
        element_semantic_types: Mapping from array element key to its
            `SemanticType`.
        sample_pointers: Element-level pointers offered to single-value slots,
            such as ``"/photos/0/url"``.
    """

    path: str
    value_type: PointerValueType
    cardinality: int
    element_keys: tuple[str, ...] = ()
    sample_type_by_key: dict[str, str] = field(default_factory=dict, hash=False)
    mutable_hint: bool = False
    semantic_type: SemanticType = field(default=cast(SemanticType, None))
    hints: Mapping[str, Any] = field(default_factory=dict, hash=False)
    key: str = ""
    label: str = ""
    parent: str | None = None
    element_semantic_types: Mapping[str, SemanticType] = field(
        default_factory=dict, hash=False
    )
    sample_pointers: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        was_unlabeled = not self.label
        semantic_type_unset = self.semantic_type is None
        object.__setattr__(self, "element_keys", tuple(self.element_keys))
        object.__setattr__(self, "sample_type_by_key", dict(self.sample_type_by_key))
        object.__setattr__(self, "hints", dict(self.hints))
        object.__setattr__(
            self,
            "semantic_type",
            SemanticType.STRING
            if semantic_type_unset
            else SemanticType(self.semantic_type),
        )
        object.__setattr__(
            self,
            "element_semantic_types",
            {k: SemanticType(v) for k, v in self.element_semantic_types.items()},
        )
        object.__setattr__(self, "sample_pointers", tuple(self.sample_pointers))
        if not self.key or self.parent is None:
            parent, key = split_pointer(self.path)
            if not self.key:
                object.__setattr__(self, "key", key)
            if self.parent is None:
                object.__setattr__(self, "parent", parent)
        if was_unlabeled:
            self._apply_fallback_defaults(infer_semantic_type=semantic_type_unset)

    def _apply_fallback_defaults(self, *, infer_semantic_type: bool = True) -> None:
        """Populates fallback semantics and humanized label on value-less summaries."""
        if infer_semantic_type and self.semantic_type is SemanticType.STRING:
            sem_type, hints = _infer_fallback_semantics(
                self.key, self.value_type, self.hints
            )
            object.__setattr__(self, "semantic_type", sem_type)
            object.__setattr__(self, "hints", hints)
        if (
            self.value_type == "array"
            and self.element_keys
            and not self.element_semantic_types
        ):
            elem_sem, samples = _infer_fallback_array_elements(
                self.path, self.element_keys, self.sample_pointers
            )
            object.__setattr__(self, "element_semantic_types", elem_sem)
            object.__setattr__(self, "sample_pointers", samples)
        object.__setattr__(self, "label", humanize_key(self.key))


def _escape_pointer_segment(key: str) -> str:
    """Escapes a single JSON object key for an RFC 6901 JSON Pointer."""
    return key.replace("~", "~0").replace("/", "~1")


def _unescape_pointer_segment(segment: str) -> str:
    """Reverses `_escape_pointer_segment` for a single pointer segment."""
    return segment.replace("~1", "/").replace("~0", "~")


def split_pointer(path: str) -> tuple[str, str]:
    """Splits a JSON Pointer into its parent pointer and unescaped last key.

    ``"/a/b~1c"`` becomes ``("/a", "b/c")``; a relative key such as ``"name"``
    becomes ``("", "name")``; the root pointer ``""`` becomes ``("", "")``.

    Args:
        path: RFC 6901 JSON Pointer or relative key string.

    Returns:
        A ``(parent_pointer, unescaped_last_key)`` pair.
    """
    if "/" not in path:
        return "", _unescape_pointer_segment(path)
    parent, _, last = path.rpartition("/")
    return parent, _unescape_pointer_segment(last)


def _classify_value_type(value: Any) -> PointerValueType | None:
    """Classifies a Python runtime value into an A2UI JSON Pointer value type."""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, Mapping):
        return "object"
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return "array"
    return None


def _is_mutable_path(path: str, mutable_paths: set[str]) -> bool:
    """Returns whether `path` or any of its parent prefixes is in `mutable_paths`."""
    if not mutable_paths:
        return False
    if "/" in mutable_paths or path in mutable_paths:
        return True
    for candidate in mutable_paths:
        prefix = candidate.rstrip("/")
        if prefix and path.startswith(f"{prefix}/"):
            return True
    return False


def _record_element_mapping(
    item: Mapping[str, Any],
    element_keys: list[str],
    sample_type_by_key: dict[str, str],
    values_by_key: dict[str, list[Any]],
    siblings_by_key: dict[str, list[Mapping[str, Any]]],
) -> None:
    """Records RFC 6901-escaped keys, coarse types, and column values from a dict item."""
    for raw_key, raw_val in item.items():
        key = _escape_pointer_segment(str(raw_key))
        if key not in element_keys:
            element_keys.append(key)
        if key not in sample_type_by_key:
            val_type = _classify_value_type(raw_val)
            if val_type is not None:
                sample_type_by_key[key] = val_type
        values_by_key.setdefault(key, []).append(raw_val)
        siblings_by_key.setdefault(key, []).append(item)


def _compute_element_semantics(
    path: str,
    items: Sequence[Any],
    unescaped_key: str,
    element_keys: Sequence[str],
    values_by_key: Mapping[str, Sequence[Any]],
    siblings_by_key: Mapping[str, Sequence[Mapping[str, Any]]],
) -> tuple[dict[str, SemanticType], tuple[str, ...]]:
    """Computes `element_semantic_types` and `sample_pointers` for an array node."""
    element_semantic_types: dict[str, SemanticType] = {}
    sample_pointers: list[str] = []
    for key in element_keys:
        raw_field = _unescape_pointer_segment(key)
        sem = classify_array_field(
            values_by_key.get(key, ()),
            raw_field,
            siblings_per_item=siblings_by_key.get(key),
        )
        element_semantic_types[key] = sem
        if sem == SemanticType.IMAGE_URL:
            sample_pointers.append(f"{path}/0/{key}")

    if not element_keys and items:
        scalar_sem = classify_array_field(items, unescaped_key)
        if scalar_sem == SemanticType.IMAGE_URL:
            sample_pointers.append(f"{path}/0")

    return element_semantic_types, tuple(sample_pointers)


def _summarize_array(
    path: str, items: Sequence[Any], is_mutable: bool
) -> PointerSummary:
    """Builds a PointerSummary for an array node without recursing into indices."""
    element_keys: list[str] = []
    sample_type_by_key: dict[str, str] = {}
    values_by_key: dict[str, list[Any]] = {}
    siblings_by_key: dict[str, list[Mapping[str, Any]]] = {}
    for item in items:
        if isinstance(item, Mapping):
            _record_element_mapping(
                item,
                element_keys,
                sample_type_by_key,
                values_by_key,
                siblings_by_key,
            )

    _, unescaped_key = split_pointer(path)
    element_semantic_types, sample_pointers = _compute_element_semantics(
        path,
        items,
        unescaped_key,
        element_keys,
        values_by_key,
        siblings_by_key,
    )
    sem_type = SemanticType.ARRAY if items else SemanticType.EMPTY
    return PointerSummary(
        path=path,
        value_type="array",
        cardinality=len(items),
        element_keys=tuple(element_keys),
        sample_type_by_key=sample_type_by_key,
        mutable_hint=is_mutable,
        semantic_type=sem_type,
        key=unescaped_key,
        label=humanize_key(unescaped_key),
        element_semantic_types=element_semantic_types,
        sample_pointers=sample_pointers,
    )


_GROUP_LABEL_PRIORITY: tuple[str, ...] = (
    "title",
    "name",
    "category",
    "section",
    "heading",
    "group",
    "label",
    "type",
    "subject",
)
_GROUP_SUBTITLE_KEYS: frozenset[str] = frozenset({"description", "subtitle", "summary"})


def _is_mapping_sequence(value: Any) -> bool:
    """Returns whether `value` is a non-empty sequence containing mapping items."""
    return (
        isinstance(value, Sequence)
        and not isinstance(value, (str, bytes, bytearray))
        and any(isinstance(el, Mapping) for el in value)
    )


def _is_sequence_or_missing(elem: Mapping[str, Any], key: str) -> bool:
    """Returns whether `key` is absent or holds a non-string sequence in `elem`."""
    if key not in elem:
        return True
    val = elem[key]
    return isinstance(val, Sequence) and not isinstance(val, (str, bytes, bytearray))


_NON_WRAPPER_ELEMENT_TYPES: frozenset[SemanticType] = frozenset({
    SemanticType.IMAGE_URL,
    SemanticType.MEDIA_OBJECT,
    SemanticType.CURRENCY,
    SemanticType.RATING,
    SemanticType.OBJECT,
})


def _is_group_wrapper_summary(
    summary: PointerSummary, mapping_items: Sequence[Mapping[str, Any]], inner_key: str
) -> bool:
    """Returns whether `summary` represents section headers wrapping nested item arrays."""
    esc_inner = _escape_pointer_segment(inner_key)
    other_keys = [k for k in summary.element_keys if k != esc_inner]
    if len(other_keys) > 4:
        return False
    if any(
        isinstance(el.get(k), Mapping)
        for el in mapping_items
        for k in el
        if str(k) != inner_key
    ):
        return False
    return not any(
        summary.element_semantic_types.get(k) in _NON_WRAPPER_ELEMENT_TYPES
        for k in other_keys
    )


def _detect_group_inner_key(
    items: Sequence[Any], summary: PointerSummary
) -> str | None:
    """Finds a nested array-of-mappings key when `items` represents grouped sections."""
    mapping_items = [el for el in items if isinstance(el, Mapping)]
    if not mapping_items:
        return None
    candidates: list[str] = []
    for el in mapping_items:
        for key, val in el.items():
            skey = str(key)
            if _is_mapping_sequence(val) and skey not in candidates:
                candidates.append(skey)
    return next(
        (
            c
            for c in candidates
            if all(_is_sequence_or_missing(el, c) for el in mapping_items)
            and _is_group_wrapper_summary(summary, mapping_items, c)
        ),
        None,
    )


def _is_group_text_scalar(val: Any) -> bool:
    """Returns whether `val` is a non-empty string usable as a section label."""
    return isinstance(val, str) and bool(val.strip())


def _pick_group_label_key(elem: Mapping[str, Any], inner_key: str) -> str | None:
    """Chooses the best scalar label key from one group element mapping."""
    lower_map = {str(k).lower(): str(k) for k in elem if str(k) != inner_key}
    for pref in _GROUP_LABEL_PRIORITY:
        orig = lower_map.get(pref)
        if orig is not None and _is_group_text_scalar(elem.get(orig)):
            return orig
    for key, val in elem.items():
        skey = str(key)
        low = skey.lower()
        if skey != inner_key and low != "id" and not low.endswith("id"):
            if _is_group_text_scalar(val):
                return skey
    return None


def _pick_group_subtitle_key(
    elem: Mapping[str, Any], inner_key: str, label_key: str | None
) -> str | None:
    """Chooses an optional short subtitle/description key from a group element."""
    for key, val in elem.items():
        skey = str(key)
        if skey not in (inner_key, label_key) and (
            skey.lower() in _GROUP_SUBTITLE_KEYS and _is_group_text_scalar(val)
        ):
            return skey
    return None


def _summarize_grouped_sections(
    path: str,
    items: Sequence[Any],
    inner_key: str,
    is_mutable: bool,
) -> list[PointerSummary]:
    """Builds `PointerSummary` entries for non-empty inner mapping arrays under `path`."""
    sections: list[PointerSummary] = []
    esc_inner = _escape_pointer_segment(inner_key)
    for idx, elem in enumerate(items):
        if not isinstance(elem, Mapping):
            continue
        inner_val = elem.get(inner_key)
        if not _is_mapping_sequence(inner_val):
            continue
        section_path = f"{path}/{idx}/{esc_inner}"
        base = _summarize_array(
            section_path, cast(Sequence[Any], inner_val), is_mutable
        )
        label_key = _pick_group_label_key(elem, inner_key)
        subtitle_key = _pick_group_subtitle_key(elem, inner_key, label_key)
        hints: dict[str, str] = {
            **base.hints,
            "groupParent": path,
            "groupIndex": str(idx),
            "groupInnerKey": esc_inner,
        }
        sec_label = base.label
        if label_key is not None:
            esc_lbl = _escape_pointer_segment(label_key)
            lbl_val = str(elem[label_key]).strip()
            hints["groupLabelKey"] = esc_lbl
            hints["groupLabelPointer"] = f"{path}/{idx}/{esc_lbl}"
            hints["groupLabel"] = lbl_val
            sec_label = lbl_val
        if subtitle_key is not None:
            esc_sub = _escape_pointer_segment(subtitle_key)
            hints["groupSubtitlePointer"] = f"{path}/{idx}/{esc_sub}"
            hints["groupSubtitle"] = str(elem[subtitle_key]).strip()
        sections.append(
            replace(base, hints=hints, label=sec_label, parent=f"{path}/{idx}")
        )
    return sections


def _summarize_mapping_node(
    path: str,
    value: Mapping[str, Any],
    raw_key: str,
    is_mutable: bool,
) -> PointerSummary:
    """Builds a `PointerSummary` for a nested mapping (empty or non-empty)."""
    sem_type = SemanticType.OBJECT if value else SemanticType.EMPTY
    return PointerSummary(
        path=path,
        value_type="object",
        cardinality=len(value),
        mutable_hint=is_mutable,
        semantic_type=sem_type,
        key=raw_key,
        label=humanize_key(raw_key),
    )


def _append_sequence_pointers(
    path: str,
    value: Sequence[Any],
    is_mutable: bool,
    out: list[PointerSummary],
) -> None:
    """Appends `PointerSummary` entries for `value`, including grouped section arrays."""
    parent_summary = _summarize_array(path, value, is_mutable)
    inner_key = _detect_group_inner_key(value, parent_summary)
    sections = (
        _summarize_grouped_sections(path, value, inner_key, is_mutable)
        if inner_key is not None
        else []
    )
    if inner_key is not None and sections:
        parent_hints = {
            **parent_summary.hints,
            "hasGroupedSections": "true",
            "groupInnerKey": _escape_pointer_segment(inner_key),
        }
        out.append(replace(parent_summary, hints=parent_hints))
        out.extend(sections)
        return
    out.append(parent_summary)


def _traverse_mapping(
    node: Mapping[str, Any],
    prefix: str,
    mutable_set: set[str],
    out: list[PointerSummary],
) -> None:
    """Recursively walks `node` and appends `PointerSummary` entries to `out`."""
    for raw_key, value in node.items():
        raw_key_str = str(raw_key)
        path = f"{prefix}/{_escape_pointer_segment(raw_key_str)}"
        is_mutable = _is_mutable_path(path, mutable_set)
        if isinstance(value, Mapping):
            out.append(_summarize_mapping_node(path, value, raw_key_str, is_mutable))
            if value:
                _traverse_mapping(value, path, mutable_set, out)
            continue
        if isinstance(value, Sequence) and not isinstance(
            value, (str, bytes, bytearray)
        ):
            _append_sequence_pointers(path, value, is_mutable, out)
            continue
        scalar_type = _classify_value_type(value)
        if scalar_type is None:
            continue
        sem_type, hints = classify_scalar(value, raw_key_str, siblings=node)
        out.append(
            PointerSummary(
                path=path,
                value_type=scalar_type,
                cardinality=1,
                mutable_hint=is_mutable,
                semantic_type=sem_type,
                hints=hints,
                key=raw_key_str,
                label=humanize_key(raw_key_str),
            )
        )


def inspect_payload_pointers(
    payload: Mapping[str, Any],
    *,
    mutable_paths: Collection[str] = (),
) -> list[PointerSummary]:
    """Extracts RFC 6901 JSON Pointer summaries from a structured data payload.

    Args:
        payload: Root mapping representing the surface data model.
        mutable_paths: JSON Pointer paths (or parent prefixes) that are
            user-editable.

    Returns:
        A list of `PointerSummary` entries in traversal order.
    """
    results: list[PointerSummary] = []
    mutable_set = {str(p) for p in mutable_paths}
    _traverse_mapping(payload, "", mutable_set, results)
    return results
