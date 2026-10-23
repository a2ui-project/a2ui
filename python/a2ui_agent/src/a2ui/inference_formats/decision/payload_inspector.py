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
from dataclasses import dataclass, field
from typing import Any, Literal

from .models import SemanticType
from .semantic_types import classify_array_field, classify_scalar, humanize_key

PointerValueType = Literal["string", "number", "boolean", "array", "object"]


@dataclass(frozen=True)
class PointerSummary:
    """Structural summary of a bindable JSON Pointer path in a data payload.

    `value_type` is the coarse JSON type; `semantic_type` and the fields after
    it are the semantic view the archetype grammar binds slots against. They
    default so callers that only know the coarse type keep working.
    """

    path: str
    value_type: PointerValueType
    cardinality: int
    element_keys: tuple[str, ...] = ()
    sample_type_by_key: dict[str, str] = field(default_factory=dict, hash=False)
    mutable_hint: bool = False
    semantic_type: SemanticType = SemanticType.STRING
    """The payload inspector populates it; plain strings are coerced."""
    hints: Mapping[str, Any] = field(default_factory=dict, hash=False)
    """Detector hints such as `wordCount`, `unit`, `currency`, `min`, `max`."""
    key: str = ""
    """The last pointer segment, unescaped; derived from `path` when empty."""
    label: str = ""
    """Humanized key for display."""
    parent: str | None = None
    """The parent pointer (``""`` for top-level keys); derived when None."""
    element_semantic_types: Mapping[str, SemanticType] = field(
        default_factory=dict, hash=False
    )
    """For arrays: element key to its `SemanticType`."""
    sample_pointers: tuple[str, ...] = ()
    """Element-level pointers offered to single-value slots, e.g. ``/photos/0/url``."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "element_keys", tuple(self.element_keys))
        object.__setattr__(self, "sample_type_by_key", dict(self.sample_type_by_key))
        object.__setattr__(self, "hints", dict(self.hints))
        object.__setattr__(self, "semantic_type", SemanticType(self.semantic_type))
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


def _traverse_mapping(
    node: Mapping[str, Any],
    prefix: str,
    mutable_set: set[str],
    out: list[PointerSummary],
) -> None:
    """Recursively walks `node` and appends `PointerSummary` entries to `out`."""
    for raw_key, value in node.items():
        raw_key_str = str(raw_key)
        segment = _escape_pointer_segment(raw_key_str)
        path = f"{prefix}/{segment}"
        is_mutable = _is_mutable_path(path, mutable_set)
        if isinstance(value, Mapping):
            out.append(_summarize_mapping_node(path, value, raw_key_str, is_mutable))
            if value:
                _traverse_mapping(value, path, mutable_set, out)
            continue
        if isinstance(value, Sequence) and not isinstance(
            value, (str, bytes, bytearray)
        ):
            out.append(_summarize_array(path, value, is_mutable))
            continue
        scalar_type = _classify_value_type(value)
        if scalar_type is not None:
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
      payload: The root dictionary representing the surface data model.
      mutable_paths: Collection of JSON Pointer paths (or parent prefixes) that
        are mutable or user-editable.

    Returns:
      A list of `PointerSummary` entries in traversal order.
    """
    results: list[PointerSummary] = []
    mutable_set = {str(p) for p in mutable_paths}
    _traverse_mapping(payload, "", mutable_set, results)
    return results
