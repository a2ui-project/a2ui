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

"""Catalog pattern libraries, template directive expansion, and archetype eligibility."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
import copy
from dataclasses import dataclass, field
import functools
import json
import re
from typing import Any

from jsonschema import Draft202012Validator

from a2ui.core import A2uiValidationError, CatalogApi

from .archetypes import (
    ArchetypeGrammar,
    BlockSpec,
    FALLBACK_TERMINALS,
    LayoutArchetype,
    MeasureSpec,
    ShapeFilter,
    asset_path,
    load_asset,
)
from .bindings import is_v10 as _is_v10
from .bindings import make_data_binding, make_function_call
from .catalog_graph import CatalogDecisionGraph
from .models import (
    BlockBindings,
    PageBindings,
    PatternCapabilities,
    SlotBinding,
)
from .payload_inspector import PointerSummary

_PLACEHOLDER_RE = re.compile(r"\{([A-Za-z0-9_$.]+)\}")
_SLUG_RE = re.compile(r"[^a-zA-Z0-9_]+")
_HEADING_LINE_RE = re.compile(r"^\s*#{1,6}\s")

_OMIT = object()


class PatternError(A2uiValidationError):
    """Raised when a catalog pattern file fails schema validation or expansion."""


@dataclass(frozen=True)
class PatternVariant:
    """One knob-selected component template tree within a catalog pattern."""

    when: Mapping[str, tuple[str, ...]] = field(default_factory=dict, hash=False)
    root: str = ""
    components: tuple[Mapping[str, Any], ...] = ()
    note: str = ""

    def matches(self, knobs: Mapping[str, str]) -> bool:
        """Returns whether every condition in `when` matches `knobs`."""
        if not self.when:
            return False
        return all(knobs.get(k) in allowed for k, allowed in self.when.items())


def _normalize_when(raw: Mapping[str, Any] | None) -> dict[str, tuple[str, ...]]:
    """Normalizes a variant ``when`` mapping into string-tuple values."""
    if not raw:
        return {}
    out: dict[str, tuple[str, ...]] = {}
    for key, val in raw.items():
        if isinstance(val, str):
            out[key] = (val,)
        elif isinstance(val, Sequence):
            out[key] = tuple(str(x) for x in val)
    return out


@dataclass(frozen=True)
class CatalogPattern:
    """How a catalog draws one abstract layout pattern."""

    name: str
    slots: tuple[str, ...]
    knobs: Mapping[str, tuple[str, ...]] = field(default_factory=dict, hash=False)
    variants: tuple[PatternVariant, ...] = ()
    field_variants: Mapping[str, Mapping[str, Any]] = field(
        default_factory=dict, hash=False
    )
    note: str = ""

    def select_variant(self, knobs: Mapping[str, str]) -> PatternVariant:
        """Returns the first matching `PatternVariant` for `knobs`, or the default."""
        for variant in self.variants:
            if variant.matches(knobs):
                return variant
        for variant in self.variants:
            if not variant.when:
                return variant
        return self.variants[0]

    def supports_variant(self, variant_name: str) -> bool:
        """Returns whether `variant_name` is supported by knobs, variants, or fields."""
        if variant_name in self.field_variants:
            return True
        if any(variant_name in vals for vals in self.knobs.values()):
            return True
        return any(
            variant_name in vals for v in self.variants for vals in v.when.values()
        )

    @classmethod
    def from_json(cls, name: str, raw: Mapping[str, Any]) -> CatalogPattern:
        """Parses one entry from a pattern file's ``patterns`` mapping."""
        knobs = {k: tuple(str(x) for x in v) for k, v in raw.get("knobs", {}).items()}
        raw_variants = raw.get("variants")
        if isinstance(raw_variants, Sequence) and raw_variants:
            variants = tuple(
                PatternVariant(
                    when=_normalize_when(v.get("when")),
                    root=str(v["root"]),
                    components=tuple(copy.deepcopy(c) for c in v["components"]),
                    note=str(v.get("note", "")),
                )
                for v in raw_variants
            )
        else:
            variants = (
                PatternVariant(
                    when={},
                    root=str(raw["root"]),
                    components=tuple(copy.deepcopy(c) for c in raw["components"]),
                    note=str(raw.get("note", "")),
                ),
            )
        field_variants = {
            k: copy.deepcopy(dict(v)) for k, v in raw.get("fieldVariants", {}).items()
        }
        return cls(
            name=name,
            slots=tuple(str(s) for s in raw.get("slots", ())),
            knobs=knobs,
            variants=variants,
            field_variants=field_variants,
            note=str(raw.get("note", "")),
        )


@functools.cache
def _pattern_validator() -> Draft202012Validator:
    """Returns the cached JSON Schema validator for ``pattern_definition.json``."""
    return Draft202012Validator(load_asset("pattern_definition.json"))


@dataclass(frozen=True)
class PatternRef:
    """A pattern name with an optional variant, written ``name:variant``."""

    name: str
    variant: str | None = None

    @classmethod
    def parse(cls, text: str) -> PatternRef:
        """Parses ``name`` or ``name:variant``; a second colon is part of the variant."""
        name, sep, variant = text.partition(":")
        return cls(name=name, variant=variant if sep else None)

    def __str__(self) -> str:
        return self.name if self.variant is None else f"{self.name}:{self.variant}"


@dataclass(frozen=True)
class ResolvedPattern:
    """The pattern a block will draw with, after walking its fallback chain."""

    pattern: str
    knobs: Mapping[str, str] = field(default_factory=dict, hash=False)
    """Knob values implied by a ``name:variant`` fallback entry."""


def _split_pattern_query(name: str, variant: str | None) -> tuple[str, str | None]:
    """Normalizes ``(name, variant)`` where `name` may itself be ``name:variant``."""
    if variant is not None:
        return name, variant
    ref = PatternRef.parse(name)
    return ref.name, ref.variant


class PatternLibrary(PatternCapabilities):
    """Pattern definitions loaded for one catalog (or versioned catalog family)."""

    def __init__(
        self,
        catalog_ids: Sequence[str] | str,
        patterns: Mapping[str, CatalogPattern],
        *,
        version: str = "1",
    ) -> None:
        if isinstance(catalog_ids, str):
            ids: tuple[str, ...] = (catalog_ids,) if catalog_ids else ()
        else:
            ids = tuple(str(c) for c in catalog_ids if c)
        self.catalog_ids: tuple[str, ...] = ids
        self.catalog_id: str = ids[0] if ids else ""
        self.version: str = version
        self.patterns: Mapping[str, CatalogPattern] = dict(patterns)

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> PatternLibrary:
        """Validates `data` against ``pattern_definition.json`` and returns a library."""
        if not isinstance(data, Mapping):
            raise PatternError("Pattern library JSON must be an object.")
        errors = sorted(
            _pattern_validator().iter_errors(data),
            key=lambda e: [str(p) for p in e.absolute_path],
        )
        if errors:
            first = errors[0]
            loc = "/".join(str(p) for p in first.absolute_path) or "<root>"
            raise PatternError(f"Invalid pattern definition at {loc}: {first.message}")
        raw_patterns = data["patterns"]
        parsed = {
            name: CatalogPattern.from_json(name, spec)
            for name, spec in raw_patterns.items()
        }
        return cls(
            tuple(data["catalogIds"]),
            parsed,
            version=str(data.get("version", "1")),
        )

    def has_pattern(self, name: str, variant: str | None = None) -> bool:
        """Whether `name` (and `variant`, when given) is defined; implements `PatternCapabilities`."""
        base, sub = _split_pattern_query(name, variant)
        pat = self.patterns.get(base)
        if pat is None:
            return False
        if sub is None:
            return True
        return pat.supports_variant(sub)

    def get(self, pattern: str) -> CatalogPattern | None:
        """Returns the `CatalogPattern` named `pattern`, or None."""
        base, _ = _split_pattern_query(pattern, None)
        return self.patterns.get(base)


@functools.cache
def _bundled_pattern_libraries() -> Mapping[str, PatternLibrary]:
    """Loads and indexes all bundled ``assets/patterns/*.json`` files by ``catalogId``."""
    by_catalog_id: dict[str, PatternLibrary] = {}
    patterns_dir = asset_path("patterns")
    for entry in sorted(patterns_dir.iterdir(), key=lambda p: p.name):
        if not entry.name.endswith(".json"):
            continue
        raw = json.loads(entry.read_text(encoding="utf-8"))
        lib = PatternLibrary.from_json(raw)
        for cat_id in lib.catalog_ids:
            by_catalog_id[cat_id] = lib
    return by_catalog_id


class MergedPatternLibrary(PatternCapabilities):
    """Pattern libraries merged across multiple catalogs, primary catalog winning."""

    def __init__(self, libraries: Sequence[PatternLibrary]) -> None:
        self.libraries: tuple[PatternLibrary, ...] = tuple(libraries)
        merged: dict[str, CatalogPattern] = {}
        owners: dict[str, str] = {}
        cat_ids: list[str] = []
        for lib in self.libraries:
            for cid in lib.catalog_ids:
                if cid and cid not in cat_ids:
                    cat_ids.append(cid)
            for name, pat in lib.patterns.items():
                if name not in merged:
                    merged[name] = pat
                    owners[name] = lib.catalog_id
        self.catalog_ids: tuple[str, ...] = tuple(cat_ids)
        self.patterns: Mapping[str, CatalogPattern] = merged
        self._owners: Mapping[str, str] = owners

    @classmethod
    def for_catalogs(cls, catalogs: Sequence[CatalogApi]) -> MergedPatternLibrary:
        """Loads the bundled pattern libraries for `catalogs`, in catalog priority order.

        A catalog with no bundled pattern file contributes an empty library, so
        the merged result always lists every catalog id.
        """
        bundled = _bundled_pattern_libraries()
        matched: list[PatternLibrary] = []
        for catalog in catalogs:
            cat_id = catalog.catalog_id
            lib = bundled.get(cat_id)
            if lib is not None:
                matched.append(
                    PatternLibrary(
                        (cat_id, *lib.catalog_ids),
                        lib.patterns,
                        version=lib.version,
                    )
                )
            else:
                matched.append(PatternLibrary((cat_id,), {}))
        return cls(matched)

    def has_pattern(self, name: str, variant: str | None = None) -> bool:
        """Whether any constituent library defines `name` (and `variant`)."""
        base, sub = _split_pattern_query(name, variant)
        pat = self.patterns.get(base)
        if pat is None:
            return False
        return True if sub is None else pat.supports_variant(sub)

    def get(self, pattern: str) -> CatalogPattern | None:
        """Returns the highest-priority `CatalogPattern` for `pattern`, or None."""
        base, _ = _split_pattern_query(pattern, None)
        return self.patterns.get(base)

    def owner_catalog_id(self, pattern: str) -> str | None:
        """Returns the ``catalogId`` of the library that won `pattern`."""
        base, _ = _split_pattern_query(pattern, None)
        return self._owners.get(base)


def _find_knob_in_variants(
    variants: Sequence[PatternVariant], variant: str
) -> dict[str, str] | None:
    """Searches `variants` for a `when` clause matching `variant`."""
    for v in variants:
        for knob_name, values in v.when.items():
            if variant in values:
                return {knob_name: variant}
    return None


def _knob_for_variant(
    library: PatternCapabilities, pattern_name: str, variant: str
) -> dict[str, str]:
    """Finds the knob name on `pattern_name` that accepts `variant`."""
    getter = getattr(library, "get", None)
    pat = getter(pattern_name) if callable(getter) else None
    if not isinstance(pat, CatalogPattern):
        return {"layout": variant}
    for knob_name, values in pat.knobs.items():
        if variant in values:
            return {knob_name: variant}
    return _find_knob_in_variants(pat.variants, variant) or {"layout": variant}


def resolve_fallback_pattern(
    block: BlockSpec, library: PatternCapabilities
) -> ResolvedPattern | None:
    """Walks `block.pattern` and `block.fallback` against `library`.

    Returns the first entry `library` can draw, or ``None`` if no entry in the
    chain is supported.
    """
    candidates: list[str] = [block.pattern]
    for fb in block.fallback:
        if fb not in candidates:
            candidates.append(fb)
    for entry in candidates:
        ref = PatternRef.parse(entry)
        if not library.has_pattern(ref.name, ref.variant):
            continue
        if ref.variant is None:
            return ResolvedPattern(pattern=ref.name)
        return ResolvedPattern(
            pattern=ref.name,
            knobs=_knob_for_variant(library, ref.name, ref.variant),
        )
    return None


# --- Eligibility & Shape Evaluation ---

_IMAGE_KEY_HINTS = frozenset({
    "image",
    "img",
    "photo",
    "picture",
    "thumbnail",
    "thumb",
    "avatar",
    "logo",
    "icon",
    "poster",
})
_CURRENCY_KEY_HINTS = frozenset({
    "amount",
    "price",
    "cost",
    "fee",
    "total",
    "subtotal",
    "rate",
    "balance",
    "currency",
    "usd",
    "eur",
})
_STATUS_KEY_HINTS = frozenset({"status", "state", "health", "phase", "stage"})
_TIME_KEY_HINTS = frozenset(
    {"date", "time", "datetime", "timestamp", "arrives", "created", "updated"}
)
_DURATION_KEY_HINTS = frozenset(
    {"duration", "uptime", "elapsed", "latency", "ttl", "skipforward"}
)
_RATING_KEY_HINTS = frozenset({"rating", "score", "stars"})
_LONG_TEXT_KEY_HINTS = frozenset(
    {"about", "summary", "description", "body", "bio", "notes", "detail"}
)
_LOCATION_KEY_HINTS = frozenset(
    {"address", "coordinates", "coords", "lat", "lng", "latitude", "longitude"}
)

_NUMERIC_FAMILY = frozenset({
    "number",
    "integer",
    "count",
    "currency",
    "percent",
    "percentage",
    "ratio",
    "quantity",
    "rating",
    "bounded",
    "duration",
})
_STRING_FAMILY = frozenset({
    "string",
    "long_text",
    "markdown",
    "code",
    "name",
    "title",
    "identifier",
    "email",
    "phone",
    "url",
    "image_url",
    "video_url",
    "audio_url",
    "document_url",
    "place_name",
    "address",
    "date",
    "time",
    "datetime",
    "duration",
    "relative_time",
    "date_range",
    "enum",
    "status",
    "color",
})


def _key_tokens(key: str) -> set[str]:
    """Splits a camelCase or snake_case key into lowercase tokens."""
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", key)
    return {t for t in re.split(r"[^a-zA-Z0-9]+", spaced.lower()) if t}


_NUMERIC_TOKEN_HINTS: tuple[tuple[frozenset[str], str], ...] = (
    (_RATING_KEY_HINTS, "rating"),
    (_CURRENCY_KEY_HINTS, "currency"),
    (_DURATION_KEY_HINTS, "duration"),
)
_STRING_TOKEN_HINTS: tuple[tuple[frozenset[str], str], ...] = (
    (_IMAGE_KEY_HINTS, "image_url"),
    (_STATUS_KEY_HINTS, "status"),
    (_CURRENCY_KEY_HINTS, "currency"),
    (_TIME_KEY_HINTS, "date"),
    (_LONG_TEXT_KEY_HINTS, "long_text"),
    (_LOCATION_KEY_HINTS, "address"),
)


def _infer_by_key_table(
    tokens: set[str],
    table: Sequence[tuple[frozenset[str], str]],
    default: str,
) -> str:
    """Returns the first semantic type from `table` whose hint tokens match `tokens`."""
    for hints, sem_type in table:
        if tokens & hints:
            return sem_type
    return default


def _infer_fallback_semantic_type(ptr: PointerSummary) -> str:
    """Infers a fallback semantic type when `ptr.semantic_type` is not populated."""
    if ptr.semantic_type and ptr.semantic_type != "string":
        return ptr.semantic_type
    tokens = _key_tokens(ptr.key or ptr.path.rsplit("/", 1)[-1])
    if ptr.value_type in ("array", "object", "boolean"):
        return ptr.value_type
    if ptr.value_type == "number":
        return _infer_by_key_table(tokens, _NUMERIC_TOKEN_HINTS, "number")
    return _infer_by_key_table(tokens, _STRING_TOKEN_HINTS, ptr.value_type)


def _pointer_type_tags(ptr: PointerSummary) -> set[str]:
    """Returns all semantic and value type tags matched by `ptr`."""
    sem = _infer_fallback_semantic_type(ptr)
    tags = {ptr.value_type, sem, ptr.semantic_type}
    if "percent" in tags or "percentage" in tags:
        tags.update(("percent", "percentage"))
    if sem in _NUMERIC_FAMILY or ptr.value_type == "number":
        tags.add("number")
    if sem in _STRING_FAMILY and ptr.value_type == "string":
        tags.add("string")
    if ptr.value_type == "array" and ptr.sample_pointers:
        if "image_url" in ptr.element_semantic_types.values():
            tags.add("image_url")
    return tags


def _key_hint_element_tags(element_keys: Sequence[str]) -> set[str]:
    """Infers element semantic tags from `element_keys` tokens."""
    all_tokens: set[str] = set()
    for k in element_keys:
        all_tokens.update(_key_tokens(k))
    tags: set[str] = {"object"}
    if all_tokens & _IMAGE_KEY_HINTS:
        tags.add("image_url")
    if all_tokens & _TIME_KEY_HINTS:
        tags.add("datetime")
    return tags


def _array_element_tags(ptr: PointerSummary) -> set[str]:
    """Returns element type tags for an array `PointerSummary`."""
    tags: set[str] = set()
    if ptr.element_keys:
        tags.update(_key_hint_element_tags(ptr.element_keys))
    tags.update(ptr.sample_type_by_key.values())
    tags.update(ptr.element_semantic_types.values())
    return tags or {"string"}


def _in_bounds(val: int, bounds: tuple[int | None, int | None] | None) -> bool:
    """Returns whether `val` lies within inclusive `(low, high)` `bounds`."""
    if bounds is None:
        return True
    low, high = bounds
    return (low is None or val >= low) and (high is None or val <= high)


def _array_matches_shape(ptr: PointerSummary, shape: ShapeFilter) -> bool:
    """Returns whether an array pointer `ptr` satisfies array constraints on `shape`."""
    if ptr.value_type != "array":
        return False
    if not _in_bounds(ptr.cardinality, shape.array_length):
        return False
    if shape.element_types and not (
        _array_element_tags(ptr) & set(shape.element_types)
    ):
        return False
    if shape.element_keys:
        wanted = {k.lower() for k in shape.element_keys}
        actual = {k.lower() for k in ptr.element_keys}
        if not (wanted & actual):
            return False
    return True


def _prose_length_matches(
    wanted_levels: tuple[str, ...],
    pointers: Sequence[PointerSummary],
    measure: MeasureSpec | None,
) -> bool:
    """Returns whether any pointer's word count falls in `wanted_levels`."""
    if measure is None:
        return False
    for ptr in pointers:
        word_count = ptr.hints.get("wordCount")
        if isinstance(word_count, (int, float)):
            if measure.level_for(float(word_count)) in wanted_levels:
                return True
    return False


def _mutable_matches(mutable: bool | None, pointers: Sequence[PointerSummary]) -> bool:
    """Returns whether `pointers` satisfy the `mutable` filter."""
    if mutable is None:
        return True
    has_mutable = any(p.mutable_hint for p in pointers)
    return has_mutable if mutable else not has_mutable


def _pointer_count_matches(
    shape: ShapeFilter, pointers: Sequence[PointerSummary]
) -> bool:
    """Returns whether `pointers` satisfy `shape.pointers` and `shape.count`."""
    if shape.pointers:
        wanted = set(shape.pointers)
        matching = [p for p in pointers if _pointer_type_tags(p) & wanted]
        return bool(matching) and _in_bounds(len(matching), shape.count)
    if shape.count is not None:
        scalars = [p for p in pointers if p.value_type not in ("array", "object")]
        return _in_bounds(len(scalars), shape.count)
    return True


def _has_array_constraint(shape: ShapeFilter) -> bool:
    """Returns whether `shape` requires at least one matching array pointer."""
    return bool(
        shape.array_length is not None
        or shape.element_types
        or shape.element_keys
        or "array" in shape.pointers
    )


def _shape_matches(
    shape: ShapeFilter,
    pointers: Sequence[PointerSummary],
    prose_measure: MeasureSpec | None,
) -> bool:
    """Evaluates a `ShapeFilter` against `pointers`."""
    if shape.is_empty:
        return True
    if not _mutable_matches(shape.mutable, pointers):
        return False
    if shape.prose_length and not _prose_length_matches(
        shape.prose_length, pointers, prose_measure
    ):
        return False
    if _has_array_constraint(shape) and not any(
        _array_matches_shape(p, shape) for p in pointers
    ):
        return False
    return _pointer_count_matches(shape, pointers)


def _criteria_pattern_satisfied(
    archetype: LayoutArchetype, library: PatternCapabilities
) -> bool:
    """Checks any ``pattern:<name>:<variant>`` requirement in `archetype.criteria`."""
    for match in re.finditer(
        r"pattern:([a-z_]+)(?::([A-Za-z0-9_]+))?", archetype.criteria
    ):
        pat_name, variant = match.group(1), match.group(2)
        if not library.has_pattern(pat_name, variant):
            return False
    return True


def _block_is_viable(
    block: BlockSpec,
    library: PatternCapabilities,
    pointers: Sequence[PointerSummary],
    prose_measure: MeasureSpec | None,
) -> bool:
    """Returns whether `block` resolves to a pattern and passes its shape filter."""
    if resolve_fallback_pattern(block, library) is None:
        return False
    return _shape_matches(block.shape, pointers, prose_measure)


def _archetype_is_eligible(
    archetype: LayoutArchetype,
    grammar: ArchetypeGrammar,
    library: PatternCapabilities,
    pointers: Sequence[PointerSummary],
    prose_measure: MeasureSpec | None,
) -> bool:
    """Returns whether `archetype` is eligible for `library` and `pointers`."""
    if not _criteria_pattern_satisfied(archetype, library):
        return False
    if not _shape_matches(archetype.shape, pointers, prose_measure):
        return False
    for req_id in archetype.required_block_ids():
        block = grammar.blocks.get(req_id)
        if block is None or not _block_is_viable(
            block, library, pointers, prose_measure
        ):
            return False
    viable_count = sum(
        1
        for ref in archetype.blocks
        if (b := grammar.blocks.get(ref.id)) is not None
        and _block_is_viable(b, library, pointers, prose_measure)
    )
    return viable_count >= archetype.at_least


def _shape_signature(pointers: Sequence[PointerSummary]) -> tuple[Any, ...]:
    """Builds a hashable cache signature from `pointers`."""
    return tuple(
        (
            p.path,
            p.value_type,
            p.semantic_type,
            p.cardinality,
            p.mutable_hint,
            p.element_keys,
            tuple(sorted(p.sample_type_by_key.items())),
            tuple(sorted(p.element_semantic_types.items())),
            p.hints.get("wordCount"),
            p.sample_pointers,
        )
        for p in pointers
    )


def eligible_archetypes(
    grammar: ArchetypeGrammar,
    library: PatternCapabilities,
    pointers: Sequence[PointerSummary],
) -> tuple[LayoutArchetype, ...]:
    """Returns the archetypes in `grammar` eligible for `library` and `pointers`.

    Pure: callers that evaluate the same payload shape repeatedly should
    memoize on `shape_signature(pointers)` themselves.
    """
    if not pointers:
        return ()
    prose_block = grammar.blocks.get("prose")
    prose_measure = (
        prose_block.measures.get("length") if prose_block is not None else None
    )
    return tuple(
        arch
        for arch in grammar.archetypes
        if _archetype_is_eligible(arch, grammar, library, pointers, prose_measure)
    )


def shape_signature(pointers: Sequence[PointerSummary]) -> tuple[Any, ...]:
    """Builds a hashable key capturing everything eligibility depends on."""
    return _shape_signature(pointers)


# --- Pattern Expansion ---


@dataclass(frozen=True)
class _ExpansionScope:
    """Context carried while expanding one pattern or `$repeat` item."""

    block_id: str
    id_prefix: str
    bindings: BlockBindings
    knobs: Mapping[str, str]
    instances: Mapping[str, str]
    field_variants: Mapping[str, Mapping[str, Any]]
    block_roots: tuple[str, ...] = ()
    item_fields: Mapping[str, SlotBinding] = field(default_factory=dict)
    item_index: int | None = None
    item_pointer: str | None = None
    in_template_repeat: bool = False
    is_v10: bool = True


def _lookup_slot(scope: _ExpansionScope, slot_path: str) -> SlotBinding | None:
    """Looks up `slot_path` (e.g. ``headline`` or ``categories.selected``) in `scope`."""
    if slot_path in scope.item_fields:
        return scope.item_fields[slot_path]
    direct = scope.bindings.get(slot_path)
    if direct is not None:
        return direct
    if "." in slot_path:
        parent_name, child_name = slot_path.split(".", 1)
        if child_name in scope.item_fields:
            return scope.item_fields[child_name]
        parent = scope.bindings.get(parent_name)
        if parent is not None and child_name in parent.fields:
            return parent.fields[child_name]
    for binding in scope.bindings.slots.values():
        if slot_path in binding.fields:
            return binding.fields[slot_path]
    return None


def _slot_is_bound(scope: _ExpansionScope, slot_path: str) -> bool:
    """Returns whether `slot_path` is bound in `scope`."""
    binding = _lookup_slot(scope, slot_path)
    return binding is not None and binding.bound


def _escape_markdown_inline(text: str, *, in_heading: bool) -> str:
    """Escapes newlines and heading `#` characters before interpolating into `$text`."""
    cleaned = text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    if in_heading or "#" in cleaned:
        cleaned = cleaned.replace("#", r"\#")
    return cleaned


def _eval_text_directive(template: str, scope: _ExpansionScope) -> Any:
    """Evaluates a ``$text`` string with ``{slot}`` and ``{$index1}`` placeholders."""
    in_heading = bool(_HEADING_LINE_RE.match(template))
    has_pointer = False

    def _replace(match: re.Match[str]) -> str:
        nonlocal has_pointer
        token = match.group(1)
        if token == "$index1":
            return str((scope.item_index or 0) + 1)
        binding = _lookup_slot(scope, token)
        if binding is None or not binding.bound:
            return ""
        if binding.pointer:
            has_pointer = True
            return f"${{{binding.pointer}}}"
        if binding.literal is not None:
            return _escape_markdown_inline(str(binding.literal), in_heading=in_heading)
        return ""

    interpolated = _PLACEHOLDER_RE.sub(_replace, template)
    if has_pointer:
        return make_function_call(
            "formatString", {"value": interpolated}, is_v10=scope.is_v10
        )
    return interpolated


def _literal_to_str(val: Any) -> str:
    """Formats a literal slot value as a lowercase boolean or string."""
    return str(val).lower() if isinstance(val, bool) else str(val)


def _item_identity_tokens(scope: _ExpansionScope) -> list[str]:
    """Returns pointer, label, and index tokens identifying the current item."""
    tokens: list[str] = []
    if scope.item_pointer:
        tokens.append(scope.item_pointer)
    label_slot = scope.item_fields.get("label")
    if label_slot is not None:
        if label_slot.literal is not None:
            tokens.append(str(label_slot.literal))
        if label_slot.pointer:
            tokens.append(label_slot.pointer)
    if scope.item_index is not None:
        tokens.append(str(scope.item_index))
    return tokens


def _instance_key_candidates(scope: _ExpansionScope, key: str) -> list[str]:
    """Builds candidate instance lookup keys in priority order."""
    candidates: list[str] = []
    for token in _item_identity_tokens(scope):
        candidates.extend((
            f"{key}:{token}",
            f"{scope.block_id}.{key}:{token}",
            f"instance:{scope.block_id}.{key}:{token}",
        ))
    candidates.extend((
        key,
        f"{scope.block_id}.{key}",
        f"instance:{scope.block_id}.{key}",
    ))
    return candidates


def _flatten_instances(
    instances: Mapping[str, Mapping[str, str]] | None,
) -> dict[str, str]:
    """Flattens `{elem_key: {q_name: val}}` into ``q_name:elem_key`` lookup keys."""
    if not instances:
        return {}
    flat: dict[str, str] = {}
    for outer_key, outer_val in instances.items():
        for inner_key, inner_val in outer_val.items():
            val_str = str(inner_val)
            flat[f"{inner_key}:{outer_key}"] = val_str
            flat.setdefault(f"{outer_key}:{inner_key}", val_str)
    return flat


def _resolve_instance_candidate(scope: _ExpansionScope, key: str) -> str | None:
    """Looks up `key` in `scope.instances` across all candidate key forms."""
    for cand in _instance_key_candidates(scope, key):
        if cand in scope.instances:
            raw = scope.instances[cand]
            if key == "primary" and raw not in ("true", "false"):
                return "true" if _matches_item_identity(scope, raw) else "false"
            return raw
    return None


def _lookup_instance_or_knob(scope: _ExpansionScope, key: str) -> str | None:
    """Looks up `key` across `item_fields`, `instances`, `knobs`, and `bindings`."""
    item_slot = scope.item_fields.get(key)
    if item_slot is not None and item_slot.literal is not None:
        return _literal_to_str(item_slot.literal)
    inst_val = _resolve_instance_candidate(scope, key)
    if inst_val is not None:
        return inst_val
    if key in scope.knobs:
        return scope.knobs[key]
    slot = _lookup_slot(scope, key)
    if slot is not None and slot.literal is not None:
        return _literal_to_str(slot.literal)
    return None


def _matches_item_identity(scope: _ExpansionScope, target: str) -> bool:
    """Returns whether `target` matches the current item's index, pointer, or label."""
    if scope.item_index is not None and target == str(scope.item_index):
        return True
    if scope.item_pointer and target == scope.item_pointer:
        return True
    label_slot = scope.item_fields.get("label")
    if label_slot is not None and (
        label_slot.literal == target or label_slot.pointer == target
    ):
        return True
    return False


def _is_self_author(scope: _ExpansionScope) -> bool:
    """Returns whether the current message item belongs to the `self` author."""
    self_author = scope.knobs.get("self") or scope.instances.get("self")
    if not self_author or self_author == "none":
        return False
    if self_author in ("true", "yes"):
        return True
    for author_key in ("author", "sender", "from"):
        slot = scope.item_fields.get(author_key)
        if slot is not None and slot.literal is not None:
            return str(slot.literal) == self_author
    return False


def _eval_map_directive(directive: Mapping[str, Any], scope: _ExpansionScope) -> Any:
    """Evaluates a ``$map`` directive against knobs, instances, or slot literals."""
    key = str(directive["$map"])
    options = {k: v for k, v in directive.items() if not k.startswith("$")}
    val = _lookup_instance_or_knob(scope, key)
    if val is not None and val in options:
        return options[val]
    if "$default" in directive:
        return directive["$default"]
    if "neutral" in options:
        return options["neutral"]
    return next(iter(options.values()), "")


def _slugify_event_name(raw: str) -> str:
    """Converts a button label or pointer into a clean action event name."""
    slug = _SLUG_RE.sub("_", raw.strip().lower()).strip("_")
    return slug or "action"


def _resolve_event_name(raw_name: str, scope: _ExpansionScope) -> str:
    """Resolves an ``$event`` slot or literal name into a clean event name."""
    slot = _lookup_slot(scope, raw_name)
    if slot is not None and slot.literal is not None:
        return _slugify_event_name(str(slot.literal))
    if slot is not None and slot.pointer:
        return _slugify_event_name(slot.pointer.rsplit("/", 1)[-1])
    return raw_name


def _resolve_event_context(
    raw_ctx: Any, scope: _ExpansionScope
) -> dict[str, Any] | None:
    """Resolves the optional ``context`` mapping on an ``$event`` directive."""
    if not isinstance(raw_ctx, Mapping):
        return None
    if raw_ctx.get("$item") is True:
        if not scope.item_pointer:
            return None
        return {"item": make_data_binding(scope.item_pointer, is_v10=scope.is_v10)}
    ctx_out: dict[str, Any] = {}
    for k, v in raw_ctx.items():
        resolved = _eval_property_value(v, scope)
        if resolved is not _OMIT and resolved is not None:
            ctx_out[k] = resolved
    return ctx_out or None


def _eval_event_directive(
    directive: Mapping[str, Any], scope: _ExpansionScope
) -> dict[str, Any]:
    """Evaluates an ``$event`` directive into an A2UI ``{"event": ...}`` dict."""
    event_body: dict[str, Any] = {
        "name": _resolve_event_name(str(directive["$event"]), scope)
    }
    ctx = _resolve_event_context(directive.get("context"), scope)
    if ctx is not None:
        event_body["context"] = ctx
    return {"event": event_body}


def _eval_slot_directive(directive: Mapping[str, Any], scope: _ExpansionScope) -> Any:
    """Evaluates a ``$slot`` directive into a data binding, literal, or default."""
    slot_name = str(directive["$slot"])
    binding = _lookup_slot(scope, slot_name)
    if binding is not None and binding.bound:
        if binding.pointer:
            return make_data_binding(binding.pointer, is_v10=scope.is_v10)
        if binding.literal is not None:
            return copy.deepcopy(binding.literal)
    if "$default" in directive:
        return copy.deepcopy(directive["$default"])
    return _OMIT


def _eval_if_instance_directive(
    directive: Mapping[str, Any], scope: _ExpansionScope
) -> Any:
    """Evaluates an ``$ifInstance`` conditional property directive."""
    conds = directive["$ifInstance"]
    if not isinstance(conds, Mapping):
        return _OMIT
    for key, expected in conds.items():
        actual = _lookup_instance_or_knob(scope, key)
        exp_str = _literal_to_str(expected)
        act_norm = "true" if actual in ("true", "yes", "1") else (actual or "false")
        if act_norm != exp_str:
            return _OMIT
    return _eval_property_value(directive.get("value"), scope)


def _eval_by_instance_value(
    directive: Mapping[str, Any], scope: _ExpansionScope
) -> Any:
    """Evaluates a ``$byInstance`` value mapping on a component property."""
    key = str(directive["$byInstance"])
    options = {k: v for k, v in directive.items() if not k.startswith("$")}
    val = _lookup_instance_or_knob(scope, key)
    if val is not None and val in options:
        return options[val]
    if "false" in options:
        return options["false"]
    return next(iter(options.values()), _OMIT)


def _eval_knob_value_directive(
    directive: Mapping[str, Any], scope: _ExpansionScope
) -> Any:
    """Evaluates a ``$knobValue`` directive."""
    val = _lookup_instance_or_knob(scope, str(directive["$knobValue"]))
    return val if val is not None else copy.deepcopy(directive.get("$default", ""))


def _eval_if_self_directive(
    directive: Mapping[str, Any], scope: _ExpansionScope
) -> Any:
    """Evaluates an ``$ifSelf`` directive."""
    branch = "true" if _is_self_author(scope) else "false"
    return directive["$ifSelf"].get(branch, _OMIT)


def _eval_text_wrapper(directive: Mapping[str, Any], scope: _ExpansionScope) -> Any:
    """Evaluates a ``$text`` mapping directive."""
    return _eval_text_directive(str(directive["$text"]), scope)


_DIRECTIVE_HANDLERS = {
    "$slot": _eval_slot_directive,
    "$text": _eval_text_wrapper,
    "$map": _eval_map_directive,
    "$event": _eval_event_directive,
    "$knobValue": _eval_knob_value_directive,
    "$ifSelf": _eval_if_self_directive,
    "$ifInstance": _eval_if_instance_directive,
    "$byInstance": _eval_by_instance_value,
}


def _eval_mapping_property(raw: Mapping[str, Any], scope: _ExpansionScope) -> Any:
    """Evaluates a mapping property value or template directive."""
    for key, handler in _DIRECTIVE_HANDLERS.items():
        if key in raw:
            return handler(raw, scope)
    if "call" in raw and "args" in raw:
        args = _eval_property_value(raw["args"], scope)
        return make_function_call(
            str(raw["call"]),
            args if isinstance(args, Mapping) else {},
            is_v10=scope.is_v10,
        )
    out: dict[str, Any] = {}
    for k, v in raw.items():
        resolved = _eval_property_value(v, scope)
        if resolved is not _OMIT:
            out[k] = resolved
    return out


def _eval_property_value(raw: Any, scope: _ExpansionScope) -> Any:
    """Recursively evaluates template directives inside a component property value."""
    if isinstance(raw, list):
        items = [_eval_property_value(x, scope) for x in raw]
        return [x for x in items if x is not _OMIT]
    if isinstance(raw, Mapping):
        return _eval_mapping_property(raw, scope)
    return raw


def _knob_cond_passes(if_knob: Mapping[str, Any], knobs: Mapping[str, str]) -> bool:
    """Returns whether every knob condition in `if_knob` is met by `knobs`."""
    for knob_name, allowed in if_knob.items():
        actual = knobs.get(knob_name)
        allowed_set = (
            {allowed} if isinstance(allowed, str) else {str(x) for x in allowed}
        )
        if actual not in allowed_set:
            return False
    return True


def _infer_media_from_target(target: str, options: Mapping[str, str]) -> str:
    """Infers a media semantic type from a lowercased literal or pointer string."""
    if any(ext in target for ext in (".mp3", ".wav", ".ogg", "audio", "podcast")):
        if "audio_url" in options:
            return "audio_url"
    if "long_text" in options and len(target.split()) >= 15:
        return "long_text"
    return "default" if "default" in options else next(iter(options.keys()), "")


def _infer_slot_media_type(
    binding: SlotBinding | None, options: Mapping[str, str]
) -> str:
    """Infers the semantic type key (e.g. ``video_url`` or ``audio_url``) for `$byType`."""
    if binding is not None:
        if binding.semantic_type and binding.semantic_type in options:
            return binding.semantic_type
        target = (
            f"{binding.semantic_type or ''}"
            f" {binding.literal or binding.pointer or ''}".lower()
        )
        return _infer_media_from_target(target, options)
    if "default" in options:
        return "default"
    return next(iter(options.keys()), "")


def _resolve_by_type_child(
    entry: Mapping[str, Any], scope: _ExpansionScope, prefix_fn: Any
) -> list[str]:
    """Resolves a ``$byType`` child entry into a single-element prefixed ID list."""
    by_type = entry.get("$byType")
    if not isinstance(by_type, str):
        return []
    options = {k: str(v) for k, v in entry.items() if not k.startswith("$")}
    slot = _lookup_slot(scope, by_type)
    chosen_type = _lookup_instance_or_knob(
        scope, f"{by_type}.type"
    ) or _infer_slot_media_type(slot, options)
    chosen_id = options.get(chosen_type) or next(iter(options.values()), None)
    return [prefix_fn(chosen_id)] if chosen_id else []


def _child_conditions_pass(entry: Mapping[str, Any], scope: _ExpansionScope) -> bool:
    """Returns whether `$if` and `$ifKnob` guards on `entry` pass."""
    if "$if" in entry and not _slot_is_bound(scope, str(entry["$if"])):
        return False
    if "$ifKnob" in entry and not _knob_cond_passes(entry["$ifKnob"], scope.knobs):
        return False
    return True


def _resolve_child_entry(
    entry: Any, scope: _ExpansionScope, prefix_fn: Any
) -> list[str]:
    """Resolves one entry in a container's ``children`` list into prefixed child IDs."""
    if isinstance(entry, str):
        return [prefix_fn(entry)]
    if not isinstance(entry, Mapping):
        return []
    if entry.get("$blocks") is True:
        return list(scope.block_roots)
    if not _child_conditions_pass(entry, scope):
        return []
    if "$ifSelf" in entry:
        branch = "true" if _is_self_author(scope) else "false"
        chosen = entry["$ifSelf"].get(branch)
        return [prefix_fn(str(chosen))] if chosen else []
    if "$byType" in entry:
        return _resolve_by_type_child(entry, scope, prefix_fn)
    child_id = entry.get("id")
    return [prefix_fn(str(child_id))] if isinstance(child_id, str) else []


def _normalize_options_list(raw: Any) -> list[dict[str, Any]]:
    """Normalizes `ChoicePicker.options` into ``[{"label": ..., "value": ...}]``."""
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if isinstance(item, Mapping) and "label" in item and "value" in item:
            out.append({"label": item["label"], "value": str(item["value"])})
        else:
            text = str(item)
            out.append({"label": text, "value": text})
    return out


_VALID_ICON_NAMES = frozenset({
    "accountCircle",
    "add",
    "arrowBack",
    "arrowForward",
    "attachFile",
    "calendarToday",
    "call",
    "camera",
    "check",
    "close",
    "delete",
    "download",
    "edit",
    "event",
    "error",
    "fastForward",
    "favorite",
    "favoriteOff",
    "folder",
    "help",
    "home",
    "info",
    "locationOn",
    "lock",
    "lockOpen",
    "mail",
    "menu",
    "moreVert",
    "moreHoriz",
    "notificationsOff",
    "notifications",
    "pause",
    "payment",
    "person",
    "phone",
    "photo",
    "print",
    "refresh",
    "rewind",
    "search",
    "send",
    "settings",
    "share",
    "shoppingCart",
    "skipNext",
    "skipPrevious",
    "star",
    "starHalf",
    "starOff",
    "upload",
    "visibility",
    "visibilityOff",
    "volumeDown",
    "volumeMute",
    "volumeOff",
    "volumeUp",
    "warning",
})


def _coerce_text(comp: dict[str, Any]) -> None:
    """Normalizes `Text.text`."""
    text_val = comp.get("text")
    if text_val is None:
        comp["text"] = ""
    elif isinstance(text_val, (int, float, bool)):
        comp["text"] = str(text_val)


def _coerce_icon(comp: dict[str, Any]) -> None:
    """Normalizes `Icon.name` against `BasicCatalog` `IconName` enum values."""
    name_val = comp.get("name")
    if name_val is None or (
        isinstance(name_val, str) and name_val not in _VALID_ICON_NAMES
    ):
        comp["name"] = "info"


def _coerce_checkbox(comp: dict[str, Any]) -> None:
    """Normalizes `CheckBox` `label` and `value` properties."""
    comp.setdefault("label", "")
    if "value" not in comp or isinstance(comp["value"], str):
        comp["value"] = bool(comp.get("value"))


def _coerce_choice_picker(comp: dict[str, Any]) -> None:
    """Normalizes `ChoicePicker` `options` and `value` properties."""
    comp["options"] = _normalize_options_list(comp.get("options"))
    val = comp.get("value")
    if val is None:
        comp["value"] = []
    elif isinstance(val, Mapping):
        return
    elif isinstance(val, list):
        comp["value"] = [str(x) for x in val]
    else:
        comp["value"] = [str(val)]


def _coerce_slider(comp: dict[str, Any]) -> None:
    """Normalizes `Slider` `min`, `max`, and `value` properties."""
    if not isinstance(comp.get("min"), (int, float)) or isinstance(
        comp.get("min"), bool
    ):
        comp["min"] = 0
    if not isinstance(comp.get("max"), (int, float)) or isinstance(
        comp.get("max"), bool
    ):
        comp["max"] = 100
    val = comp.get("value")
    if isinstance(val, Mapping):
        return
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        try:
            comp["value"] = float(str(val))
        except (TypeError, ValueError):
            comp["value"] = 0


def _coerce_text_field(comp: dict[str, Any]) -> None:
    """Normalizes `TextField` `label` property."""
    comp.setdefault("label", "")


def _coerce_datetime_input(comp: dict[str, Any]) -> None:
    """Normalizes `DateTimeInput` `value` property."""
    comp.setdefault("value", "")


_COMPONENT_COERCERS: Mapping[str, Callable[[dict[str, Any]], None]] = {
    "Text": _coerce_text,
    "Icon": _coerce_icon,
    "ChoicePicker": _coerce_choice_picker,
    "CheckBox": _coerce_checkbox,
    "Slider": _coerce_slider,
    "TextField": _coerce_text_field,
    "DateTimeInput": _coerce_datetime_input,
}


def _coerce_component_schema_types(
    comp: dict[str, Any], *, is_v10: bool = True
) -> None:
    """Ensures expanded component properties satisfy BasicCatalog schema types."""
    comp_type = str(comp.get("component", ""))
    if comp_type in ("Image", "Video", "AudioPlayer"):
        comp.setdefault("url", "")
        if comp_type == "Video" and not is_v10:
            comp.pop("posterUrl", None)
        return
    if comp_type == "Button":
        if not is_v10 and comp.get("variant") == "default":
            comp.pop("variant", None)
        return
    coercer = _COMPONENT_COERCERS.get(comp_type)
    if coercer is not None:
        coercer(comp)


def _order_repeat_items(
    items: Sequence[Mapping[str, SlotBinding]],
    order: str | None,
    scope: _ExpansionScope,
) -> list[tuple[int, Mapping[str, SlotBinding]]]:
    """Orders repeated items according to ``primaryLast`` or ``primaryFirst``."""
    indexed = list(enumerate(items))
    if order not in ("primaryLast", "primaryFirst"):
        return indexed

    def _is_primary(pair: tuple[int, Mapping[str, SlotBinding]]) -> bool:
        idx, fields = pair
        sub_scope = _ExpansionScope(
            block_id=scope.block_id,
            id_prefix=scope.id_prefix,
            bindings=scope.bindings,
            knobs=scope.knobs,
            instances=scope.instances,
            field_variants=scope.field_variants,
            item_fields=fields,
            item_index=idx,
            is_v10=scope.is_v10,
        )
        return _lookup_instance_or_knob(sub_scope, "primary") in (
            "true",
            "yes",
            "primary",
        )

    if order == "primaryLast":
        return [p for p in indexed if not _is_primary(p)] + [
            p for p in indexed if _is_primary(p)
        ]
    return [p for p in indexed if _is_primary(p)] + [
        p for p in indexed if not _is_primary(p)
    ]


def _coerce_repeat_entry(entry: Any) -> Mapping[str, SlotBinding]:
    """Converts one literal sequence element into a field-to-`SlotBinding` mapping."""
    if isinstance(entry, Mapping):
        return {
            k: v if isinstance(v, SlotBinding) else SlotBinding(literal=v)
            for k, v in entry.items()
        }
    text = str(entry)
    return {
        "label": SlotBinding(literal=text),
        "title": SlotBinding(literal=text),
        "headline": SlotBinding(literal=text),
        "value": SlotBinding(literal=entry),
    }


def _default_items_for_repeat(
    binding: SlotBinding | None,
) -> tuple[Mapping[str, SlotBinding], ...]:
    """Returns per-element field mappings when a repeated slot is unrolled."""
    if binding is None:
        return ()
    if binding.items:
        return binding.items
    if isinstance(binding.literal, Sequence) and not isinstance(
        binding.literal, (str, bytes)
    ):
        return tuple(_coerce_repeat_entry(e) for e in binding.literal)
    return ()


def _select_field_variant_template(
    by_instance_key: str,
    scope: _ExpansionScope,
) -> Mapping[str, Any]:
    """Selects a ``fieldVariants`` template from `scope` for `by_instance_key`."""
    choice = _lookup_instance_or_knob(scope, by_instance_key)
    if choice and choice in scope.field_variants:
        return scope.field_variants[choice]
    return next(iter(scope.field_variants.values()))


def _prefix_for_scope(scope: _ExpansionScope, local_id: str) -> str:
    """Prefixes `local_id` with `scope.id_prefix` if not already prefixed."""
    if not scope.id_prefix:
        return local_id
    if local_id == scope.id_prefix or local_id.startswith(f"{scope.id_prefix}_"):
        return local_id
    return f"{scope.id_prefix}_{local_id}"


def _ensure_template_emitted(
    local_id: str,
    target_id: str,
    templates_by_id: Mapping[str, Mapping[str, Any]],
    scope: _ExpansionScope,
    emitted: list[dict[str, Any]],
) -> None:
    """Expands `templates_by_id[local_id]` as `target_id` if not yet in `emitted`."""
    if local_id in templates_by_id and not any(
        c.get("id") == target_id for c in emitted
    ):
        _expand_inline_component(
            templates_by_id[local_id],
            target_id,
            templates_by_id,
            scope,
            emitted,
        )


def _expand_child_property(
    comp_dict: dict[str, Any],
    comp_id: str,
    val: Any,
    templates_by_id: Mapping[str, Mapping[str, Any]],
    scope: _ExpansionScope,
    emitted: list[dict[str, Any]],
) -> None:
    """Expands a single-child ``child`` property on `comp_dict`."""
    if isinstance(val, Mapping) and "component" in val:
        inline_id = f"{comp_id}_child"
        _expand_inline_component(val, inline_id, templates_by_id, scope, emitted)
        comp_dict["child"] = inline_id
    elif isinstance(val, str):
        target_id = _prefix_for_scope(scope, val)
        comp_dict["child"] = target_id
        _ensure_template_emitted(val, target_id, templates_by_id, scope, emitted)


def _expand_inline_component(
    raw_comp: Mapping[str, Any],
    comp_id: str,
    templates_by_id: Mapping[str, Mapping[str, Any]],
    scope: _ExpansionScope,
    emitted: list[dict[str, Any]],
) -> str:
    """Expands a single component template (and any inline child dicts) into `emitted`."""
    comp_dict: dict[str, Any] = {"id": comp_id}
    emitted_index = len(emitted)
    emitted.append(comp_dict)
    prefix_fn = functools.partial(_prefix_for_scope, scope)

    for key, val in raw_comp.items():
        if key == "id" or key.startswith("$"):
            continue
        if key == "child":
            _expand_child_property(
                comp_dict, comp_id, val, templates_by_id, scope, emitted
            )
        elif key == "children":
            _expand_children_property(
                comp_dict, comp_id, val, templates_by_id, scope, prefix_fn, emitted
            )
        else:
            resolved = _eval_property_value(val, scope)
            if resolved is not _OMIT:
                comp_dict[key] = resolved

    _coerce_component_schema_types(comp_dict, is_v10=scope.is_v10)
    emitted[emitted_index] = comp_dict
    return comp_id


def _infer_element_pointer(fields: Mapping[str, SlotBinding]) -> str | None:
    """Extracts a representative JSON pointer from an item's field bindings."""
    for key in ("value", "headline", "title", "label"):
        slot = fields.get(key)
        if slot is not None and slot.pointer:
            return slot.pointer
    for slot in fields.values():
        if slot.pointer:
            return slot.pointer
    return None


def _expand_template_child_list(
    comp_dict: dict[str, Any],
    binding: SlotBinding,
    tpl_local_id: str,
    templates_by_id: Mapping[str, Mapping[str, Any]],
    scope: _ExpansionScope,
    prefix_fn: Any,
    emitted: list[dict[str, Any]],
) -> None:
    """Emits a ``TemplateChildList`` (`{"path": ..., "componentId": ...}`) on `comp_dict`."""
    tpl_id = prefix_fn(tpl_local_id)
    rel_fields = {
        k: SlotBinding(
            pointer=v.pointer.lstrip("/") if v.pointer else None,
            literal=v.literal,
            fields=v.fields,
            items=v.items,
        )
        for k, v in binding.fields.items()
    }
    tpl_scope = _ExpansionScope(
        block_id=scope.block_id,
        id_prefix=scope.id_prefix,
        bindings=scope.bindings,
        knobs=scope.knobs,
        instances=scope.instances,
        field_variants=scope.field_variants,
        item_fields=rel_fields,
        item_pointer=binding.pointer,
        in_template_repeat=True,
        is_v10=scope.is_v10,
    )
    _ensure_template_emitted(tpl_local_id, tpl_id, templates_by_id, tpl_scope, emitted)
    comp_dict["children"] = {"path": binding.pointer, "componentId": tpl_id}


def _expand_single_repeat_item(
    out_idx: int,
    orig_idx: int,
    item_fields: Mapping[str, SlotBinding],
    parent_id: str,
    comp_target: Any,
    binding: SlotBinding | None,
    templates_by_id: Mapping[str, Mapping[str, Any]],
    scope: _ExpansionScope,
    prefix_fn: Any,
    emitted: list[dict[str, Any]],
) -> str:
    """Expands one unrolled item in a `$repeat` container and returns its component ID."""
    elem_ptr = _infer_element_pointer(item_fields) or (
        f"{binding.pointer}/{orig_idx}" if binding and binding.pointer else None
    )
    if isinstance(comp_target, Mapping) and "$byInstance" in comp_target:
        item_scope = _ExpansionScope(
            block_id=scope.block_id,
            id_prefix=f"{parent_id}_{out_idx}",
            bindings=scope.bindings,
            knobs=scope.knobs,
            instances=scope.instances,
            field_variants=scope.field_variants,
            item_fields=item_fields,
            item_index=orig_idx,
            item_pointer=elem_ptr,
            is_v10=scope.is_v10,
        )
        fv_template = _select_field_variant_template(
            str(comp_target["$byInstance"]), item_scope
        )
        item_comp_id = f"{parent_id}_item_{out_idx}"
        return _expand_inline_component(
            fv_template, item_comp_id, templates_by_id, item_scope, emitted
        )

    tpl_local_id = str(comp_target)
    item_comp_id = f"{prefix_fn(tpl_local_id)}_{out_idx}"
    base_prefix = scope.id_prefix or scope.block_id
    item_scope_prefixed = _ExpansionScope(
        block_id=scope.block_id,
        id_prefix=f"{base_prefix}_{out_idx}",
        bindings=scope.bindings,
        knobs=scope.knobs,
        instances=scope.instances,
        field_variants=scope.field_variants,
        item_fields=item_fields,
        item_index=orig_idx,
        item_pointer=elem_ptr,
        is_v10=scope.is_v10,
    )
    return _expand_inline_component(
        templates_by_id[tpl_local_id],
        item_comp_id,
        templates_by_id,
        item_scope_prefixed,
        emitted,
    )


def _fallback_unrolled_items(
    binding: SlotBinding | None,
) -> tuple[Mapping[str, SlotBinding], ...]:
    """Returns fallback single-item fields when `$repeat` has no explicit items."""
    if binding is not None and binding.fields:
        return (binding.fields,)
    return (
        {
            "label": SlotBinding(literal="Item"),
            "title": SlotBinding(literal="Item"),
            "headline": SlotBinding(literal="Item"),
            "value": SlotBinding(literal=""),
        },
    )


def _expand_repeat_children(
    comp_dict: dict[str, Any],
    parent_id: str,
    repeat_spec: Mapping[str, Any],
    templates_by_id: Mapping[str, Mapping[str, Any]],
    scope: _ExpansionScope,
    prefix_fn: Any,
    emitted: list[dict[str, Any]],
) -> None:
    """Expands a ``{"$repeat": ...}`` ``children`` directive on `comp_dict`."""
    slot_name = str(repeat_spec["$repeat"])
    binding = _lookup_slot(scope, slot_name)
    comp_target = repeat_spec["component"]
    unrolled_items = _default_items_for_repeat(binding)

    if (
        not unrolled_items
        and binding is not None
        and binding.pointer
        and isinstance(comp_target, str)
    ):
        _expand_template_child_list(
            comp_dict,
            binding,
            comp_target,
            templates_by_id,
            scope,
            prefix_fn,
            emitted,
        )
        return

    items_to_expand = unrolled_items or _fallback_unrolled_items(binding)
    order = scope.knobs.get("order") or repeat_spec.get("order")
    ordered = _order_repeat_items(items_to_expand, str(order) if order else None, scope)
    comp_dict["children"] = [
        _expand_single_repeat_item(
            out_idx,
            orig_idx,
            item_fields,
            parent_id,
            comp_target,
            binding,
            templates_by_id,
            scope,
            prefix_fn,
            emitted,
        )
        for out_idx, (orig_idx, item_fields) in enumerate(ordered)
    ]


def _find_matching_template_id(
    cid: str,
    templates_by_id: Mapping[str, Mapping[str, Any]],
    prefix_fn: Any,
) -> str | None:
    """Finds the template key in `templates_by_id` that maps to `cid`."""
    for tid in templates_by_id:
        if prefix_fn(tid) == cid or tid == cid:
            return tid
    return None


def _expand_children_property(
    comp_dict: dict[str, Any],
    comp_id: str,
    raw_children: Any,
    templates_by_id: Mapping[str, Mapping[str, Any]],
    scope: _ExpansionScope,
    prefix_fn: Any,
    emitted: list[dict[str, Any]],
) -> None:
    """Expands a ``children`` list or ``$repeat`` object on `comp_dict`."""
    if isinstance(raw_children, Mapping) and "$repeat" in raw_children:
        _expand_repeat_children(
            comp_dict,
            comp_id,
            raw_children,
            templates_by_id,
            scope,
            prefix_fn,
            emitted,
        )
        return
    if not isinstance(raw_children, Sequence) or isinstance(raw_children, (str, bytes)):
        return
    child_ids: list[str] = []
    for idx, entry in enumerate(raw_children):
        if isinstance(entry, Mapping) and "component" in entry:
            inline_id = f"{comp_id}_child_{idx}"
            _expand_inline_component(entry, inline_id, templates_by_id, scope, emitted)
            child_ids.append(inline_id)
            continue
        for cid in _resolve_child_entry(entry, scope, prefix_fn):
            child_ids.append(cid)
            local_match = _find_matching_template_id(cid, templates_by_id, prefix_fn)
            if local_match is not None:
                _ensure_template_emitted(
                    local_match, cid, templates_by_id, scope, emitted
                )
    comp_dict["children"] = child_ids


def _is_container_now_empty(
    comp: dict[str, Any],
    by_id: Mapping[str, dict[str, Any]],
    preserve_ids: set[str],
) -> bool:
    """Updates container child references and returns whether the container is empty."""
    ctype = comp.get("component")
    if ctype in ("Row", "Column", "List"):
        children = comp.get("children")
        if isinstance(children, list):
            comp["children"] = [x for x in children if x in by_id or x in preserve_ids]
            return not comp["children"]
    elif ctype == "Card":
        child = comp.get("child")
        return child not in by_id and child not in preserve_ids
    return False


def _drop_empty_non_root_containers(
    by_id: dict[str, dict[str, Any]],
    root_id: str,
    preserve_ids: set[str],
) -> set[str]:
    """Iteratively removes empty non-root containers from `by_id`."""
    removed_all: set[str] = set()
    while True:
        empty_ids = {
            cid
            for cid, comp in list(by_id.items())
            if cid != root_id and _is_container_now_empty(comp, by_id, preserve_ids)
        }
        if not empty_ids:
            break
        for eid in empty_ids:
            by_id.pop(eid, None)
        removed_all.update(empty_ids)
    return removed_all


def _referenced_children(comp: Mapping[str, Any]) -> list[str]:
    """Returns direct child component IDs referenced by `comp`."""
    refs: list[str] = []
    child = comp.get("child")
    if isinstance(child, str):
        refs.append(child)
    children = comp.get("children")
    if isinstance(children, list):
        refs.extend(str(x) for x in children if isinstance(x, str))
    elif isinstance(children, Mapping):
        tpl_id = children.get("componentId")
        if isinstance(tpl_id, str):
            refs.append(tpl_id)
    return refs


def _collect_reachable_ids(
    by_id: Mapping[str, dict[str, Any]], root_id: str
) -> set[str]:
    """Returns component IDs reachable from `root_id`."""
    reachable: set[str] = set()
    queue = [root_id]
    while queue:
        curr = queue.pop(0)
        if curr in reachable or curr not in by_id:
            continue
        reachable.add(curr)
        queue.extend(_referenced_children(by_id[curr]))
    return reachable


def _prune_empty_containers(
    components: list[dict[str, Any]],
    root_id: str,
    *,
    preserve_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Removes non-root empty containers and unreachable components."""
    preserved = preserve_ids or set()
    by_id = {str(c["id"]): c for c in components if "id" in c}
    removed_ids = _drop_empty_non_root_containers(by_id, root_id, preserved)

    root_comp = by_id.get(root_id)
    if root_comp is not None and isinstance(root_comp.get("children"), list):
        root_comp["children"] = [
            x for x in root_comp["children"] if x in by_id or x in preserved
        ]

    reachable = _collect_reachable_ids(by_id, root_id)
    return [c for c in components if c.get("id") in reachable]


def _remap_field_dict(
    fields: Mapping[str, SlotBinding], field_map: Mapping[str, str]
) -> dict[str, SlotBinding]:
    """Copies `fields` and aliases any `src -> dst` keys in `field_map`."""
    remapped = dict(fields)
    for src, dst in field_map.items():
        if src in remapped and dst not in remapped:
            remapped[dst] = remapped[src]
    return remapped


def _remap_slot_binding(
    binding: SlotBinding, field_map: Mapping[str, str]
) -> SlotBinding:
    """Returns `binding` with `field_map` applied to both `fields` and `items`."""
    return SlotBinding(
        pointer=binding.pointer,
        literal=binding.literal,
        fields=_remap_field_dict(binding.fields, field_map),
        items=tuple(_remap_field_dict(it, field_map) for it in binding.items),
        semantic_type=binding.semantic_type,
    )


def _adapt_comparison_slots(slots: dict[str, SlotBinding]) -> None:
    """Remaps `comparison` `options` into `collection` `items`."""
    if "options" in slots and "items" not in slots:
        slots["items"] = _remap_slot_binding(
            slots["options"], {"badge": "meta", "highlight": "meta"}
        )


def _adapt_timeline_slots(slots: dict[str, SlotBinding], target_pattern: str) -> None:
    """Remaps `timeline` `events` into `steps` or `collection` `items`."""
    if "events" in slots and "items" not in slots:
        field_map = (
            {"title": "headline", "detail": "supporting", "time": "meta"}
            if target_pattern == "collection"
            else {}
        )
        slots["items"] = _remap_slot_binding(slots["events"], field_map)


def _adapt_map_slots(slots: dict[str, SlotBinding]) -> None:
    """Remaps `map` `location` and `label` slots into `facts` `rows`."""
    if "rows" in slots:
        return
    loc = slots.get("location") or SlotBinding(literal="")
    lbl = slots.get("label") or SlotBinding(literal="Location")
    slots["rows"] = SlotBinding(items=({"label": lbl, "value": loc},))


_DIRECT_SLOT_REMAPS: dict[tuple[str, str], tuple[str, str]] = {
    ("chart", "headline"): ("series", "items"),
    ("chart", "collection"): ("series", "items"),
    ("headline", "facts"): ("items", "rows"),
}


def _adapt_fallback_bindings(
    source_pattern: str, target_pattern: str, bindings: BlockBindings
) -> BlockBindings:
    """Remaps slot names when `source_pattern` degrades to `target_pattern`."""
    if source_pattern == target_pattern:
        return bindings
    slots = dict(bindings.slots)
    pair = (source_pattern, target_pattern)
    if pair == ("comparison", "collection"):
        _adapt_comparison_slots(slots)
    elif source_pattern == "timeline" and target_pattern in ("steps", "collection"):
        _adapt_timeline_slots(slots, target_pattern)
    elif pair in _DIRECT_SLOT_REMAPS:
        src_slot, dst_slot = _DIRECT_SLOT_REMAPS[pair]
        if src_slot in slots and dst_slot not in slots:
            slots[dst_slot] = slots[src_slot]
    elif pair == ("map", "facts"):
        _adapt_map_slots(slots)
    return BlockBindings(slots=slots)


def _compute_root_id(prefix: str, root_local_id: str) -> str:
    """Computes the surface or block root component ID for `prefix`."""
    if prefix == "root":
        return "root"
    if root_local_id == prefix or root_local_id.startswith(f"{prefix}_"):
        return root_local_id
    return f"{prefix}_{root_local_id}"


def _page_knobs(page: PageBindings, active_knobs: dict[str, str]) -> None:
    """Adds the frame knobs implied by `page` to `active_knobs`."""
    if page.dialog:
        active_knobs.setdefault("dialog", "yes")
    if page.sticky_actions:
        active_knobs.setdefault("stickyActions", "yes")


class PatternExpander:
    """Expands catalog pattern templates into flat, validated A2UI component dicts."""

    def __init__(
        self,
        library: PatternLibrary | MergedPatternLibrary,
        graph: CatalogDecisionGraph,
        *,
        grammar: ArchetypeGrammar | None = None,
        protocol_version: str | None = None,
    ) -> None:
        """Creates an expander.

        Args:
            library: Patterns to expand from.
            graph: The catalog graph; supplies the protocol version by default.
            grammar: Grammar consulted for fallback chains; defaults to
                `ArchetypeGrammar.default()`.
            protocol_version: A2UI protocol version the emitted components
                target (``"0.9"``, ``"1.0"``, ...); defaults to
                `graph.protocol_version`.
        """
        self.library = library
        self.graph = graph
        self.grammar = grammar if grammar is not None else ArchetypeGrammar.default()
        self.protocol_version: str = (
            protocol_version
            if protocol_version is not None
            else str(graph.protocol_version)
        )
        self.is_v10 = _is_v10(self.protocol_version)

    def _resolve_block_pattern(
        self,
        block_id: str,
        pattern: str,
        base_pattern: str,
        bindings: BlockBindings,
        active_knobs: dict[str, str],
    ) -> tuple[CatalogPattern, BlockBindings]:
        """Resolves `base_pattern` (or its fallback chain) from `self.library`."""
        cat_pattern = self.library.get(base_pattern)
        if cat_pattern is not None:
            return cat_pattern, bindings
        block_spec = self.grammar.blocks.get(block_id) or self.grammar.blocks.get(
            base_pattern
        )
        if block_spec is not None:
            resolved = resolve_fallback_pattern(block_spec, self.library)
            if resolved is not None:
                for k, v in resolved.knobs.items():
                    active_knobs.setdefault(k, v)
                adapted = _adapt_fallback_bindings(
                    base_pattern, resolved.pattern, bindings
                )
                cat_pattern = self.library.get(resolved.pattern)
                if cat_pattern is not None:
                    return cat_pattern, adapted
        raise PatternError(
            f"Pattern {pattern!r} for block {block_id!r} is not available."
        )

    def expand_block(
        self,
        block_id: str,
        pattern: str,
        bindings: BlockBindings,
        knobs: Mapping[str, str] | None = None,
        instances: Mapping[str, Mapping[str, str]] | None = None,
        id_prefix: str = "",
    ) -> list[dict[str, Any]]:
        """Expands one block pattern into flat A2UI component dicts.

        Args:
            block_id: Grammar block id; prefixes every emitted component id.
            pattern: Pattern name, optionally ``name:variant``.
            bindings: Slot bindings for the block.
            knobs: Anatomy knob values selecting the pattern variant.
            instances: Per-element instance answers in the
                `PlannedBlock.instances` shape: element key to a mapping of
                question name to option.
            id_prefix: Overrides `block_id` as the component id prefix.
        """
        active_knobs: dict[str, str] = dict(knobs or {})
        active_instances = _flatten_instances(instances)
        base_pattern, inline_variant = _split_pattern_query(pattern, None)
        if inline_variant is not None:
            active_knobs.update(
                _knob_for_variant(self.library, base_pattern, inline_variant)
            )

        cat_pattern, effective_bindings = self._resolve_block_pattern(
            block_id, pattern, base_pattern, bindings, active_knobs
        )
        variant = cat_pattern.select_variant(active_knobs)
        prefix = id_prefix or block_id
        templates_by_id = {str(c["id"]): c for c in variant.components if "id" in c}
        root_id = _compute_root_id(prefix, variant.root)
        scope = _ExpansionScope(
            block_id=block_id,
            id_prefix=prefix,
            bindings=effective_bindings,
            knobs=active_knobs,
            instances=active_instances,
            field_variants=cat_pattern.field_variants,
            is_v10=self.is_v10,
        )
        emitted: list[dict[str, Any]] = []
        _expand_inline_component(
            templates_by_id[variant.root],
            root_id,
            templates_by_id,
            scope,
            emitted,
        )
        return _prune_empty_containers(emitted, root_id)

    def expand_page(
        self,
        page: PageBindings,
        block_roots: Sequence[str] = (),
        *,
        knobs: Mapping[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        """Expands the `page` pattern with ``root`` as the surface root component id.

        Args:
            page: Title, subtitle, mark, and frame flags for the page.
            block_roots: Root component ids of the expanded blocks, in order.
            knobs: Extra page knobs; `page.dialog` and `page.sticky_actions`
                set ``dialog`` and ``stickyActions`` unless given here.
        """
        active_knobs: dict[str, str] = dict(knobs or {})
        _page_knobs(page, active_knobs)
        title_slot, subtitle_slot, mark_slot = page.title, page.subtitle, page.mark
        cat_pattern = self.library.get("page")
        if cat_pattern is None:
            raise PatternError("Pattern 'page' is not available in the library.")
        variant = cat_pattern.select_variant(active_knobs)
        templates_by_id = {str(c["id"]): c for c in variant.components if "id" in c}
        bindings = BlockBindings(
            slots={
                "title": title_slot,
                "subtitle": subtitle_slot,
                "mark": mark_slot,
            }
        )
        scope = _ExpansionScope(
            block_id="page",
            id_prefix="",
            bindings=bindings,
            knobs=active_knobs,
            instances={},
            field_variants=cat_pattern.field_variants,
            block_roots=tuple(block_roots),
            is_v10=self.is_v10,
        )
        emitted: list[dict[str, Any]] = []
        _expand_inline_component(
            templates_by_id[variant.root],
            "root",
            templates_by_id,
            scope,
            emitted,
        )
        if not title_slot.bound and (
            mark_slot.bound or subtitle_slot.bound or block_roots
        ):
            emitted = [c for c in emitted if c.get("id") != "page_title"]
        return _prune_empty_containers(emitted, "root", preserve_ids=set(block_roots))


__all__ = [
    "CatalogPattern",
    "MergedPatternLibrary",
    "PatternError",
    "PatternExpander",
    "PatternLibrary",
    "PatternRef",
    "PatternVariant",
    "ResolvedPattern",
    "eligible_archetypes",
    "resolve_fallback_pattern",
    "shape_signature",
]
