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
    semantic_type: str = "string"
    """A `SemanticType` value; the payload inspector populates it."""
    hints: Mapping[str, Any] = field(default_factory=dict, hash=False)
    """Detector hints such as `wordCount`, `unit`, `currency`, `min`, `max`."""
    key: str = ""
    """The last pointer segment, unescaped; derived from `path` when empty."""
    label: str = ""
    """Humanized key for display."""
    parent: str | None = None
    """The parent pointer (``""`` for top-level keys); derived when None."""
    element_semantic_types: Mapping[str, str] = field(default_factory=dict, hash=False)
    """For arrays: element key to its `SemanticType` value."""
    sample_pointers: tuple[str, ...] = ()
    """Element-level pointers offered to single-value slots, e.g. ``/photos/0/url``."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "element_keys", tuple(self.element_keys))
        object.__setattr__(self, "sample_type_by_key", dict(self.sample_type_by_key))
        object.__setattr__(self, "hints", dict(self.hints))
        object.__setattr__(
            self, "element_semantic_types", dict(self.element_semantic_types)
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
) -> None:
    """Records RFC 6901-escaped keys and sample types from an array dict element."""
    for raw_key, raw_val in item.items():
        key = _escape_pointer_segment(str(raw_key))
        if key not in element_keys:
            element_keys.append(key)
        if key not in sample_type_by_key:
            val_type = _classify_value_type(raw_val)
            if val_type is not None:
                sample_type_by_key[key] = val_type


def _summarize_array(
    path: str, items: Sequence[Any], is_mutable: bool
) -> PointerSummary:
    """Builds a PointerSummary for an array node without recursing into indices."""
    element_keys: list[str] = []
    sample_type_by_key: dict[str, str] = {}
    for item in items:
        if isinstance(item, Mapping):
            _record_element_mapping(item, element_keys, sample_type_by_key)
    return PointerSummary(
        path=path,
        value_type="array",
        cardinality=len(items),
        element_keys=tuple(element_keys),
        sample_type_by_key=sample_type_by_key,
        mutable_hint=is_mutable,
    )


def _traverse_mapping(
    node: Mapping[str, Any],
    prefix: str,
    mutable_set: set[str],
    out: list[PointerSummary],
) -> None:
    """Recursively walks `node` and appends `PointerSummary` entries to `out`."""
    for raw_key, value in node.items():
        segment = _escape_pointer_segment(str(raw_key))
        path = f"{prefix}/{segment}"
        is_mutable = _is_mutable_path(path, mutable_set)
        if isinstance(value, Mapping):
            if not value:
                out.append(
                    PointerSummary(
                        path=path,
                        value_type="object",
                        cardinality=0,
                        mutable_hint=is_mutable,
                    )
                )
            else:
                _traverse_mapping(value, path, mutable_set, out)
            continue
        if isinstance(value, Sequence) and not isinstance(
            value, (str, bytes, bytearray)
        ):
            out.append(_summarize_array(path, value, is_mutable))
            continue
        scalar_type = _classify_value_type(value)
        if scalar_type is not None:
            out.append(
                PointerSummary(
                    path=path,
                    value_type=scalar_type,
                    cardinality=1,
                    mutable_hint=is_mutable,
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
