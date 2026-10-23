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

"""Layout archetype grammar: typed model, JSON loader, and lint.

The grammar is authored as ``catalogs/decision/v1/archetypes.json`` and
vendored under this package's ``assets/`` directory. `ArchetypeGrammar.from_json`
validates a grammar against the bundled JSON Schema, parses it into frozen
dataclasses, and runs the lint checks the grammar itself lists; any failure
raises `GrammarError`.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
import functools
from importlib import resources
import json
import re
import sys
from typing import Any, Literal

from jsonschema import Draft202012Validator

from a2ui.core import A2uiValidationError

from .models import QuestionKind

if sys.version_info >= (3, 11):
    from importlib.resources.abc import Traversable
else:  # pragma: no cover - Python 3.10 only
    from importlib.abc import Traversable

Requirement = Literal["required", "expected", "optional"]
"""How strongly an archetype wants a block: ``!``, bare, or ``?`` in its list."""

Range = tuple[int | None, int | None]
"""An inclusive ``(min, max)`` pair where None leaves that end open."""

ABSTRACT_PATTERNS: tuple[str, ...] = (
    "page",
    "banner",
    "picture",
    "media",
    "filters",
    "headline",
    "chart",
    "facts",
    "prose",
    "collection",
    "comparison",
    "steps",
    "timeline",
    "conversation",
    "compose",
    "map",
    "form",
    "groups",
    "actions",
    "outcome",
)
"""Abstract pattern names a catalog pattern file may implement."""

FALLBACK_TERMINALS: tuple[str, ...] = (
    "repeat-in-parent",
    "first-item",
    "prose",
    "facts",
)
"""Fallback entries that need no catalog pattern of their own."""

CAPABILITY_FLAGS: tuple[str, ...] = ("actions_allowed",)
"""Planner flags a question's `requires` entry may name."""

_ASSETS_PACKAGE = "a2ui.inference_formats.decision"
_PLACEHOLDER_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
_PATTERN_KNOB_RE = re.compile(r"^([a-z_]+):([a-z_]+)$")
_PATTERN_VARIANT_RE = re.compile(r"^pattern:([a-z_]+)\.([a-z_]+)$")


class GrammarError(A2uiValidationError):
    """An archetype grammar failed schema validation or lint."""


def asset_path(*parts: str) -> Traversable:
    """Returns the bundled asset at ``assets/<parts...>`` inside this package."""
    path = resources.files(_ASSETS_PACKAGE) / "assets"
    for part in parts:
        path = path / part
    return path


def load_asset(*parts: str) -> Any:
    """Loads and decodes the bundled JSON asset at ``assets/<parts...>``."""
    with asset_path(*parts).open("r", encoding="utf-8") as handle:
        return json.load(handle)


@functools.cache
def _archetype_schema_validator() -> Draft202012Validator:
    """The validator for the bundled ``archetype_definition.json``."""
    schema = load_asset("archetype_definition.json")
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _parse_range(raw: Sequence[Any] | None) -> Range | None:
    """Parses a ``[min, max]`` list (either end may be null) into a `Range`."""
    if raw is None:
        return None
    low, high = raw
    return (None if low is None else int(low), None if high is None else int(high))


@dataclass(frozen=True)
class ShapeFilter:
    """Deterministic payload pre-filter on an archetype or block.

    All fields are optional; an empty filter matches every payload.
    """

    pointers: tuple[str, ...] = ()
    """Semantic types of which at least one pointer must exist."""
    array_length: Range | None = None
    element_types: tuple[str, ...] = ()
    element_keys: tuple[str, ...] = ()
    mutable: bool | None = None
    prose_length: tuple[str, ...] = ()
    count: Range | None = None
    """Bounds on how many pointers match `pointers`."""
    actions_allowed: bool | None = None

    @property
    def is_empty(self) -> bool:
        """Whether the filter places no constraint at all."""
        return self == ShapeFilter()

    @classmethod
    def from_json(cls, raw: Mapping[str, Any] | None) -> ShapeFilter:
        """Parses the ``shape`` object of an archetype or block."""
        if not raw:
            return cls()
        return cls(
            pointers=tuple(raw.get("pointers", ())),
            array_length=_parse_range(raw.get("arrayLength")),
            element_types=tuple(raw.get("elementTypes", ())),
            element_keys=tuple(raw.get("elementKeys", ())),
            mutable=raw.get("mutable"),
            prose_length=tuple(raw.get("proseLength", ())),
            count=_parse_range(raw.get("count")),
            actions_allowed=raw.get("actions_allowed"),
        )


@dataclass(frozen=True)
class BlockRef:
    """A block named by an archetype, with the requirement its mark encodes."""

    id: str
    requirement: Requirement

    @classmethod
    def parse(cls, mark: str) -> BlockRef:
        """Parses ``name!`` (required), ``name?`` (optional), or ``name`` (expected)."""
        if mark.endswith("!"):
            return cls(id=mark[:-1], requirement="required")
        if mark.endswith("?"):
            return cls(id=mark[:-1], requirement="optional")
        return cls(id=mark, requirement="expected")

    @property
    def mark(self) -> str:
        """The ``name!`` / ``name?`` / ``name`` form."""
        suffix = {"required": "!", "optional": "?", "expected": ""}[self.requirement]
        return f"{self.id}{suffix}"


@dataclass(frozen=True)
class LayoutArchetype:
    """An ordered list of blocks that together serve one family of intent."""

    id: str
    family: str
    criteria: str
    blocks: tuple[BlockRef, ...]
    shape: ShapeFilter = field(default_factory=ShapeFilter)
    at_least: int = 1
    frame: Mapping[str, Any] = field(default_factory=dict, hash=False)

    def block_ids(self) -> tuple[str, ...]:
        """Block ids in render order."""
        return tuple(ref.id for ref in self.blocks)

    def requirement_of(self, block_id: str) -> Requirement | None:
        """The requirement of `block_id` in this archetype, or None if absent."""
        for ref in self.blocks:
            if ref.id == block_id:
                return ref.requirement
        return None

    def required_block_ids(self) -> tuple[str, ...]:
        """Ids of the blocks marked ``!``."""
        return tuple(ref.id for ref in self.blocks if ref.requirement == "required")

    @classmethod
    def from_json(cls, raw: Mapping[str, Any]) -> LayoutArchetype:
        """Parses one entry of the grammar's ``archetypes`` list."""
        return cls(
            id=raw["id"],
            family=raw["family"],
            criteria=raw["criteria"],
            blocks=tuple(BlockRef.parse(mark) for mark in raw["blocks"]),
            shape=ShapeFilter.from_json(raw.get("shape")),
            at_least=int(raw.get("atLeast", 1)),
            frame=dict(raw.get("frame", {})),
        )


@dataclass(frozen=True)
class QuestionSpec:
    """A question template from the grammar, before placeholders are filled."""

    kind: QuestionKind
    question: str
    options: Mapping[str, str] = field(default_factory=dict, hash=False)
    """`CHOICE`: option id to description."""
    levels: tuple[str, ...] = ()
    """`SCORE`: ordered level descriptions."""
    requires: Mapping[str, tuple[str, ...]] = field(default_factory=dict, hash=False)
    """Option id to the slots, knob options, pattern variants, or flags it needs."""
    applies_when: Mapping[str, Any] = field(default_factory=dict, hash=False)
    derived_when: Mapping[str, Any] = field(default_factory=dict, hash=False)
    options_from: str | None = None
    """`CHOICE`: a slot path whose bound values become the options."""
    allow_none: bool = True
    yes: str = ""
    """`BOOLEAN`: the criteria text for a yes answer."""
    no: str = ""
    per_pointer: bool = False
    """`SCORE` salience: asked once per candidate pointer."""
    select: Mapping[str, float] = field(default_factory=dict, hash=False)
    """Salience selection rule: ``min``, ``max``, ``aboveLevel``."""
    note: str = ""

    def placeholders(self) -> tuple[str, ...]:
        """Names inside ``{braces}`` in the question text, in order."""
        return tuple(_PLACEHOLDER_RE.findall(self.question))

    def option_ids(self) -> tuple[str, ...]:
        """Option ids for `CHOICE` questions, level labels for `SCORE`."""
        if self.kind is QuestionKind.SCORE:
            return self.levels
        return tuple(self.options)

    @classmethod
    def from_json(cls, raw: Mapping[str, Any]) -> QuestionSpec:
        """Parses a question object of any kind."""
        return cls(
            kind=QuestionKind(raw["kind"]),
            question=raw["question"],
            options=dict(raw.get("options", {})),
            levels=tuple(raw.get("levels", ())),
            requires={k: tuple(v) for k, v in raw.get("requires", {}).items()},
            applies_when=dict(raw.get("appliesWhen", {})),
            derived_when=dict(raw.get("derivedWhen", {})),
            options_from=raw.get("optionsFrom"),
            allow_none=bool(raw.get("allowNone", True)),
            yes=raw.get("yes", ""),
            no=raw.get("no", ""),
            per_pointer=bool(raw.get("perPointer", False)),
            select={k: float(v) for k, v in raw.get("select", {}).items()},
            note=raw.get("note", ""),
        )


@dataclass(frozen=True)
class SlotSpec:
    """What a block slot accepts and how the deterministic binder fills it."""

    name: str
    from_types: tuple[str, ...]
    """Accepted semantic types, most preferred first; ``any`` accepts scalars."""
    required: bool = False
    repeat: bool = False
    max: int | None = None
    prefer: tuple[str, ...] = ()
    """Key hints that break ties among compatible pointers."""
    avoid_keys: tuple[str, ...] = ()
    sibling: tuple[str, ...] = ()
    """Sibling keys of the bound pointer this slot may be filled from."""
    order_by: str | None = None
    mutable: bool = False
    fields: Mapping[str, SlotSpec] = field(default_factory=dict, hash=False)
    """Per-element slots of a repeated slot."""
    element_types: tuple[str, ...] = ()
    default: Any = None
    note: str = ""

    def field_names(self) -> tuple[str, ...]:
        """This slot's name followed by every nested field name, depth first."""
        names = [self.name]
        for sub in self.fields.values():
            names.extend(sub.field_names())
        return tuple(names)

    @classmethod
    def from_json(cls, name: str, raw: Mapping[str, Any]) -> SlotSpec:
        """Parses one ``slots`` or ``fields`` entry."""
        return cls(
            name=name,
            from_types=tuple(raw["from"]),
            required=bool(raw.get("required", False)),
            repeat=bool(raw.get("repeat", False)),
            max=raw.get("max"),
            prefer=tuple(raw.get("prefer", ())),
            avoid_keys=tuple(raw.get("avoidKeys", ())),
            sibling=tuple(raw.get("sibling", ())),
            order_by=raw.get("orderBy"),
            mutable=bool(raw.get("mutable", False)),
            fields=_parse_slots(raw.get("fields", {})),
            element_types=tuple(raw.get("elementTypes", ())),
            default=raw.get("default"),
            note=raw.get("note", ""),
        )


def _parse_slots(raw: Mapping[str, Any]) -> dict[str, SlotSpec]:
    """Parses a ``slots`` or ``fields`` mapping, preserving order."""
    return {name: SlotSpec.from_json(name, spec) for name, spec in raw.items()}


def _parse_questions(raw: Mapping[str, Any]) -> dict[str, QuestionSpec]:
    """Parses an ``anatomy``, ``instance``, or ``job`` mapping."""
    return {name: QuestionSpec.from_json(spec) for name, spec in raw.items()}


@dataclass(frozen=True)
class MeasureSpec:
    """A value computed from a bound slot, never asked, that patterns vary by."""

    name: str
    derived_from: str
    """A ``slot.hints.<hint>`` path into the bound pointer's summary."""
    levels: Mapping[str, Range] = field(hash=False)
    """Level name to its inclusive-exclusive ``[low, high)`` range, in order."""
    note: str = ""

    def level_for(self, value: float) -> str | None:
        """The level whose range contains `value`, or None."""
        for name, (low, high) in self.levels.items():
            if (low is None or value >= low) and (high is None or value < high):
                return name
        return None

    @classmethod
    def from_json(cls, name: str, raw: Mapping[str, Any]) -> MeasureSpec:
        """Parses one ``measures`` entry."""
        levels: dict[str, Range] = {}
        for level, bounds in raw["levels"].items():
            parsed = _parse_range(bounds)
            if parsed is not None:
                levels[level] = parsed
        return cls(
            name=name,
            derived_from=raw["derivedFrom"],
            levels=levels,
            note=raw.get("note", ""),
        )


@dataclass(frozen=True)
class BlockSpec:
    """One block of the grammar: its pattern, questions, slots, and fallbacks."""

    id: str
    pattern: str
    shape: ShapeFilter = field(default_factory=ShapeFilter)
    gate: QuestionSpec | None = None
    salience: QuestionSpec | None = None
    anatomy: Mapping[str, QuestionSpec] = field(default_factory=dict, hash=False)
    instance: Mapping[str, QuestionSpec] = field(default_factory=dict, hash=False)
    measures: Mapping[str, MeasureSpec] = field(default_factory=dict, hash=False)
    slots: Mapping[str, SlotSpec] = field(default_factory=dict, hash=False)
    fallback: tuple[str, ...] = ()

    def slot_names(self) -> tuple[str, ...]:
        """Every slot and nested field name a placeholder may refer to."""
        names: list[str] = []
        for slot in self.slots.values():
            names.extend(slot.field_names())
        return tuple(names)

    def questions(self) -> Iterator[tuple[str, QuestionSpec]]:
        """Yields ``(label, question)`` for the gate, salience, anatomy, and instance."""
        if self.gate is not None:
            yield "gate", self.gate
        if self.salience is not None:
            yield "salience", self.salience
        for name, question in self.anatomy.items():
            yield f"anatomy.{name}", question
        for name, question in self.instance.items():
            yield f"instance.{name}", question

    @classmethod
    def from_json(cls, raw: Mapping[str, Any]) -> BlockSpec:
        """Parses one entry of the grammar's ``blocks`` list."""
        gate = raw.get("gate")
        salience = raw.get("salience")
        return cls(
            id=raw["id"],
            pattern=raw["pattern"],
            shape=ShapeFilter.from_json(raw.get("shape")),
            gate=QuestionSpec.from_json(gate) if gate else None,
            salience=QuestionSpec.from_json(salience) if salience else None,
            anatomy=_parse_questions(raw.get("anatomy", {})),
            instance=_parse_questions(raw.get("instance", {})),
            measures={
                name: MeasureSpec.from_json(name, spec)
                for name, spec in raw.get("measures", {}).items()
            },
            slots=_parse_slots(raw.get("slots", {})),
            fallback=tuple(raw["fallback"]),
        )


@dataclass(frozen=True)
class Rule:
    """A prose rule the planner implements; kept for traces and documentation."""

    id: str
    rule: str


def _lint_unique_ids(
    archetypes: Sequence[LayoutArchetype], blocks: Sequence[BlockSpec]
) -> list[str]:
    """Archetype ids and block ids must each be unique."""
    findings: list[str] = []
    for label, ids in (
        ("archetype", [a.id for a in archetypes]),
        ("block", [b.id for b in blocks]),
    ):
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        for dup in duplicates:
            findings.append(f"Duplicate {label} id {dup!r}.")
    return findings


def _lint_archetype_anchor(archetypes: Sequence[LayoutArchetype]) -> list[str]:
    """Every archetype has at least one required or expected block."""
    return [
        f"Archetype {a.id!r} has no required or expected block."
        for a in archetypes
        if all(ref.requirement == "optional" for ref in a.blocks)
    ]


def _lint_block_ids_exist(
    archetypes: Sequence[LayoutArchetype], blocks: Mapping[str, BlockSpec]
) -> list[str]:
    """Every block id used in an archetype exists in blocks."""
    return [
        f"Archetype {a.id!r} names unknown block {ref.id!r}."
        for a in archetypes
        for ref in a.blocks
        if ref.id not in blocks
    ]


def _is_valid_fallback(entry: str) -> bool:
    """Whether `entry` is a pattern name, a ``pattern:knob`` form, or a terminal."""
    if entry in FALLBACK_TERMINALS or entry in ABSTRACT_PATTERNS:
        return True
    match = _PATTERN_KNOB_RE.match(entry)
    return match is not None and match.group(1) in ABSTRACT_PATTERNS


def _lint_fallbacks(blocks: Mapping[str, BlockSpec]) -> list[str]:
    """Every fallback entry is a pattern name, a ``pattern:knob`` form, or a terminal."""
    findings = [
        f"Block {block.id!r} pattern {block.pattern!r} is not an abstract pattern."
        for block in blocks.values()
        if block.pattern not in ABSTRACT_PATTERNS
    ]
    findings.extend(
        f"Block {block.id!r} fallback entry {entry!r} is not a pattern name,"
        " pattern:knob form, or terminal."
        for block in blocks.values()
        for entry in block.fallback
        if not _is_valid_fallback(entry)
    )
    return findings


def _lint_placeholders(blocks: Mapping[str, BlockSpec]) -> list[str]:
    """Every ``{placeholder}`` and ``appliesWhen`` key names a slot or field."""
    findings: list[str] = []
    for block in blocks.values():
        known = set(block.slot_names())
        for label, question in block.questions():
            unknown = [p for p in question.placeholders() if p not in known]
            unknown.extend(k for k in question.applies_when if k not in known)
            findings.extend(
                f"Block {block.id!r} question {label!r} refers to {name!r}, which"
                " is not a slot or field of that block."
                for name in unknown
            )
    return findings


def _is_valid_requirement(entry: str, block: BlockSpec) -> bool:
    """Whether a `requires` entry names a slot, knob option, pattern variant, or flag."""
    if entry in CAPABILITY_FLAGS or entry in block.slot_names():
        return True
    if _PATTERN_VARIANT_RE.match(entry) is not None:
        return _PATTERN_VARIANT_RE.sub(r"\1", entry) in ABSTRACT_PATTERNS
    knob, _, option = entry.partition(":")
    if option:
        question = block.anatomy.get(knob)
        return question is not None and option in question.option_ids()
    return any(entry in q.option_ids() for q in block.anatomy.values())


def _lint_requires(blocks: Mapping[str, BlockSpec]) -> list[str]:
    """Every `requires` entry names a slot, a knob option, a pattern variant, or a flag."""
    return [
        f"Block {block.id!r} question {label!r} option {option!r} requires"
        f" {entry!r}, which is not a slot, knob option, pattern variant, or"
        " capability flag."
        for block in blocks.values()
        for label, question in block.questions()
        for option, entries in question.requires.items()
        for entry in entries
        if not _is_valid_requirement(entry, block)
    ]


def _lint_options_from(blocks: Mapping[str, BlockSpec]) -> list[str]:
    """Every `optionsFrom` path starts at a slot or field of the block."""
    return [
        f"Block {block.id!r} question {label!r} optionsFrom"
        f" {question.options_from!r} does not start at a slot of that block."
        for block in blocks.values()
        for label, question in block.questions()
        if question.options_from is not None
        and question.options_from.split(".", 1)[0] not in block.slot_names()
    ]


def lint_grammar(
    archetypes: Sequence[LayoutArchetype],
    blocks: Sequence[BlockSpec],
    *,
    families: Sequence[str] = (),
) -> list[str]:
    """Runs every lint check and returns the findings (empty when clean)."""
    by_id = {b.id: b for b in blocks}
    findings = _lint_unique_ids(archetypes, blocks)
    if families:
        allowed_families = set(families)
        findings.extend(
            f"Archetype {a.id!r} references unknown family {a.family!r}."
            for a in archetypes
            if a.family not in allowed_families
        )
    findings.extend(_lint_archetype_anchor(archetypes))
    findings.extend(_lint_block_ids_exist(archetypes, by_id))
    findings.extend(_lint_fallbacks(by_id))
    findings.extend(_lint_placeholders(by_id))
    findings.extend(_lint_requires(by_id))
    findings.extend(_lint_options_from(by_id))
    return findings


def _schema_findings(data: Mapping[str, Any]) -> list[str]:
    """Formats schema validation errors as ``path: message`` strings."""
    errors = sorted(
        _archetype_schema_validator().iter_errors(data),
        key=lambda err: list(map(str, err.absolute_path)),
    )
    return [
        f"/{'/'.join(str(p) for p in err.absolute_path)}: {err.message}"
        for err in errors
    ]


@dataclass(frozen=True)
class ArchetypeGrammar:
    """A validated, linted archetype grammar."""

    version: str
    thresholds: Mapping[str, float] = field(hash=False)
    job: Mapping[str, QuestionSpec] = field(hash=False)
    archetypes: tuple[LayoutArchetype, ...]
    blocks: Mapping[str, BlockSpec] = field(hash=False)
    rules: tuple[Rule, ...] = ()
    lint: tuple[str, ...] = ()

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> ArchetypeGrammar:
        """Validates `data` against the schema, parses it, and lints it.

        Raises:
            GrammarError: On any schema violation or lint finding; the message
                lists every finding.
        """
        findings = _schema_findings(data)
        if findings:
            raise GrammarError(
                "Archetype grammar failed schema validation:\n  "
                + "\n  ".join(findings)
            )
        job = _parse_questions(data["job"])
        archetypes = tuple(LayoutArchetype.from_json(a) for a in data["archetypes"])
        blocks = tuple(BlockSpec.from_json(b) for b in data["blocks"])
        findings = lint_grammar(
            archetypes, blocks, families=tuple(job["family"].options)
        )
        if findings:
            raise GrammarError(
                "Archetype grammar failed lint:\n  " + "\n  ".join(findings)
            )
        return cls(
            version=str(data["version"]),
            thresholds={k: float(v) for k, v in data["thresholds"].items()},
            job=job,
            archetypes=archetypes,
            blocks={b.id: b for b in blocks},
            rules=tuple(
                Rule(id=r["id"], rule=r["rule"]) for r in data.get("rules", ())
            ),
            lint=tuple(data.get("lint", ())),
        )

    @classmethod
    def default(cls) -> ArchetypeGrammar:
        """The grammar bundled with this package, loaded once and cached."""
        return _default_grammar()

    def archetype(self, archetype_id: str) -> LayoutArchetype:
        """The archetype with `archetype_id`.

        Raises:
            KeyError: If no archetype has that id.
        """
        for archetype in self.archetypes:
            if archetype.id == archetype_id:
                return archetype
        raise KeyError(archetype_id)

    def block(self, block_id: str) -> BlockSpec:
        """The block with `block_id`.

        Raises:
            KeyError: If no block has that id.
        """
        return self.blocks[block_id]

    def families(self) -> tuple[str, ...]:
        """Family ids in the order the family question lists them."""
        return tuple(self.job["family"].options)

    def archetypes_in(self, family: str) -> tuple[LayoutArchetype, ...]:
        """Archetypes of `family` in grammar order."""
        return tuple(a for a in self.archetypes if a.family == family)

    def brief_roles(self) -> tuple[str, ...]:
        """Role names a `LayoutBrief` may use: family ids, then block ids."""
        return self.families() + tuple(self.blocks)

    def threshold(self, name: str) -> float:
        """The threshold `name` (``family``, ``expected``, ``actionGateFloor``, ...).

        Raises:
            KeyError: If the grammar defines no such threshold.
        """
        return self.thresholds[name]


@functools.cache
def _default_grammar() -> ArchetypeGrammar:
    """Loads ``assets/archetypes.json`` once per process."""
    return ArchetypeGrammar.from_json(load_asset("archetypes.json"))
