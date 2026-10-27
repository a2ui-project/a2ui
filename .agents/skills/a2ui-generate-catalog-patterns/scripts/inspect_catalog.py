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

"""Structural catalog inspector for `patterns.json` and `templates.json` authoring."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import re
from typing import Any, Literal

from a2ui.inference_formats.decision import (
    BlockSpec,
    ComponentNodeSpec,
    SlotKind,
    SlotSpec,
)

from _common import LoadedCatalog, render_markdown_table

_CAMEL_BOUNDARY_RE = re.compile(r"([a-z0-9])([A-Z])")

_NUMERIC_TYPES: frozenset[str] = frozenset({
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
    "distance",
})

_IMAGE_KEYWORDS: frozenset[str] = frozenset(
    {"image", "figure", "photo", "picture", "avatar", "icon", "src", "img"}
)
_MEDIA_KEYWORDS: frozenset[str] = frozenset(
    {"video", "audio", "media", "player", "poster"}
)


@dataclass(frozen=True)
class ComponentSummary:
    """Structural summary of one component in a catalog."""

    name: str
    description: str
    is_container: bool
    has_child_list: bool
    child_slots: tuple[str, ...]
    data_slots: Mapping[str, str]
    enum_slots: Mapping[str, tuple[str, ...]]
    action_slots: tuple[str, ...]
    required: tuple[str, ...]
    supports_checks: bool


@dataclass(frozen=True)
class BlockCandidates:
    """Candidate components in the catalog for one layout grammar block."""

    block_id: str
    pattern: str
    fallback: tuple[str, ...]
    slot_requirements: Mapping[str, str]
    candidates: tuple[str, ...]
    partial: Mapping[str, tuple[str, ...]]


@dataclass(frozen=True)
class TemplateCandidate:
    """Candidate monolithic component for a `SurfaceTemplate` in `templates.json`."""

    component: str
    suggested_template_id: str
    description: str
    required_slots: Mapping[str, str]
    optional_slots: Mapping[str, str]
    suggested_required_pointers: tuple[str, ...]
    is_mutable: bool


@dataclass(frozen=True)
class InspectReport:
    """Complete structural inspection report for a custom catalog."""

    catalog_id: str
    protocol_version: str
    target_dir: str
    recommended_files: tuple[str, ...]
    mode: Literal["composable", "fixed_surface", "hybrid"]
    page_candidates: tuple[str, ...]
    components: tuple[ComponentSummary, ...]
    blocks: tuple[BlockCandidates, ...]
    template_candidates: tuple[TemplateCandidate, ...]
    notes: tuple[str, ...]


def _to_snake_case(name: str) -> str:
    """Converts a PascalCase or camelCase identifier to `snake_case`."""
    s1 = _CAMEL_BOUNDARY_RE.sub(r"\1_\2", name)
    return re.sub(r"[^a-zA-Z0-9]+", "_", s1).strip("_").lower()


def summarize_component(spec: ComponentNodeSpec) -> ComponentSummary:
    """Folds `spec.slots` by `SlotKind` into a `ComponentSummary`."""
    child_slots: list[str] = []
    has_child_list = False
    data_slots: dict[str, str] = {}
    enum_slots: dict[str, tuple[str, ...]] = {}
    action_slots: list[str] = []
    required: list[str] = []

    for slot in spec.slots:
        if slot.required:
            required.append(slot.name)
        if slot.kind in (
            SlotKind.CHILD,
            SlotKind.CHILD_LIST,
            SlotKind.NAMED_CHILD_ARRAY,
        ):
            child_slots.append(slot.name)
            if slot.kind in (SlotKind.CHILD_LIST, SlotKind.NAMED_CHILD_ARRAY):
                has_child_list = True
        elif slot.kind is SlotKind.ACTION:
            action_slots.append(slot.name)
        elif slot.kind is SlotKind.STATIC_ENUM:
            enum_slots[slot.name] = tuple(slot.enum_values)
        elif slot.kind is SlotKind.DATA_VALUE:
            data_slots[slot.name] = slot.value_type or "any"

    return ComponentSummary(
        name=spec.name,
        description=spec.description,
        is_container=spec.is_container,
        has_child_list=has_child_list,
        child_slots=tuple(child_slots),
        data_slots=data_slots,
        enum_slots=enum_slots,
        action_slots=tuple(action_slots),
        required=tuple(required),
        supports_checks=spec.supports_checks,
    )


def _classify_slot_need(slot: SlotSpec) -> str:
    """Maps one `SlotSpec` to a concise structural capability label."""
    from_set = set(slot.from_types)
    if "action" in from_set:
        return "action"
    if "mutable" in from_set or slot.mutable:
        return "mutable string"
    if slot.repeat and ("array" in from_set or "object" in from_set):
        return "children"
    if "boolean" in from_set and len(from_set) == 1:
        return "boolean"
    if from_set and from_set <= _NUMERIC_TYPES:
        return "number"
    return "string"


def _record_field_slot_needs(reqs: dict[str, str], name: str, slot: SlotSpec) -> None:
    """Records structural needs for a slot that defines nested `fields`."""
    if slot.repeat and ("array" in slot.from_types or "object" in slot.from_types):
        reqs[name] = "children"
    elif "action" in slot.from_types:
        reqs[name] = "action"
    elif "mutable" in slot.from_types or slot.mutable:
        reqs[name] = "mutable string"
    for field_name, field_spec in slot.fields.items():
        if field_spec.required:
            reqs[f"{name}.{field_name}"] = _classify_slot_need(field_spec)


def slot_requirements(block: BlockSpec) -> dict[str, str]:
    """Maps a grammar block's slots (and required nested item fields) to structural needs."""
    reqs: dict[str, str] = {}
    for name, slot in block.slots.items():
        if slot.fields:
            _record_field_slot_needs(reqs, name, slot)
        elif slot.required or len(block.slots) == 1 or slot.mutable:
            reqs[name] = _classify_slot_need(slot)
    return reqs


def _component_tokens(comp: ComponentSummary) -> set[str]:
    """Returns lowercase keyword tokens from a component's name, slots, and description."""
    raw = " ".join([comp.name, comp.description, *comp.data_slots.keys()])
    expanded = _CAMEL_BOUNDARY_RE.sub(r"\1 \2", raw).lower()
    return set(re.findall(r"[a-z0-9]+", expanded))


def _matches_media_block(comp: ComponentSummary, block_id: str) -> bool | None:
    """Checks keyword matches when `block_id` is `'picture'` or `'media'`."""
    if block_id == "picture":
        return bool(_component_tokens(comp) & _IMAGE_KEYWORDS) and bool(comp.data_slots)
    if block_id == "media":
        return bool(_component_tokens(comp) & _MEDIA_KEYWORDS) and bool(comp.data_slots)
    return None


def _can_satisfy_need(comp: ComponentSummary, need: str, *, block_id: str) -> bool:
    """Returns whether `comp` can structurally satisfy `need` for `block_id`."""
    if need == "children":
        return comp.has_child_list
    if need == "action":
        return bool(comp.action_slots)
    if need == "mutable string":
        return comp.supports_checks or (
            "value" in comp.data_slots and not comp.action_slots
        )
    media_match = _matches_media_block(comp, block_id)
    if media_match is not None:
        return media_match
    if need in ("number", "boolean"):
        allowed = (need, "string", "any")
        return any(t in allowed for t in comp.data_slots.values())
    return bool(comp.data_slots) or bool(comp.child_slots)


def block_candidates(
    block: BlockSpec,
    components: Sequence[ComponentSummary],
    *,
    has_page_container: bool = True,
) -> BlockCandidates:
    """Finds full and partial component candidates for `block`."""
    reqs = slot_requirements(block)
    if not has_page_container:
        return BlockCandidates(
            block_id=block.id,
            pattern=block.pattern,
            fallback=block.fallback,
            slot_requirements=reqs,
            candidates=(),
            partial={},
        )

    distinct_needs = sorted(set(reqs.values()))
    full: list[str] = []
    partial: dict[str, tuple[str, ...]] = {}
    scalar_reqs = [k for k, v in reqs.items() if v in ("string", "number")]

    for comp in components:
        unmet = [
            need
            for need in distinct_needs
            if not _can_satisfy_need(comp, need, block_id=block.id)
        ]
        if (
            not unmet
            and len(scalar_reqs) >= 2
            and not comp.is_container
            and len(comp.data_slots) < len(scalar_reqs)
        ):
            unmet.append("multiple_data_slots")
        if not unmet:
            full.append(comp.name)
        elif len(unmet) < len(distinct_needs):
            partial[comp.name] = tuple(unmet)

    return BlockCandidates(
        block_id=block.id,
        pattern=block.pattern,
        fallback=block.fallback,
        slot_requirements=reqs,
        candidates=tuple(full),
        partial=partial,
    )


def _build_template_candidate(comp: ComponentSummary) -> TemplateCandidate:
    """Constructs a `TemplateCandidate` from a `ComponentSummary`."""
    req_set = set(comp.required)
    all_slots: dict[str, str] = {}
    for name, vtype in comp.data_slots.items():
        all_slots[name] = vtype
    for name in comp.enum_slots:
        all_slots[name] = "enum"
    for name in comp.action_slots:
        all_slots[name] = "action"

    required_slots = {k: v for k, v in all_slots.items() if k in req_set}
    optional_slots = {k: v for k, v in all_slots.items() if k not in req_set}
    req_Data_ptrs = tuple(
        f"/{name}"
        for name in comp.required
        if name in comp.data_slots or name in comp.enum_slots
    )
    if not req_Data_ptrs and comp.data_slots:
        first_data = next(iter(comp.data_slots))
        req_Data_ptrs = (f"/{first_data}",)

    return TemplateCandidate(
        component=comp.name,
        suggested_template_id=_to_snake_case(comp.name),
        description=comp.description,
        required_slots=required_slots,
        optional_slots=optional_slots,
        suggested_required_pointers=req_Data_ptrs,
        is_mutable=comp.supports_checks or bool(comp.action_slots and comp.data_slots),
    )


def extract_template_candidates(
    components: Sequence[ComponentSummary],
    *,
    has_page_container: bool,
) -> tuple[TemplateCandidate, ...]:
    """Identifies monolithic components suited for `SurfaceTemplate` entries in `templates.json`."""
    candidates: list[TemplateCandidate] = []
    for comp in components:
        if not has_page_container:
            if comp.data_slots or comp.action_slots:
                candidates.append(_build_template_candidate(comp))
        elif (
            not comp.is_container
            and bool(comp.action_slots)
            and len(comp.data_slots) >= 2
        ):
            candidates.append(_build_template_candidate(comp))
    return tuple(candidates)


def _collect_notes(
    mode: str,
    page_candidates: Sequence[str],
    components: Sequence[ComponentSummary],
    blocks: Sequence[BlockCandidates],
    template_candidates: Sequence[TemplateCandidate],
) -> tuple[str, ...]:
    """Builds actionable guidance notes for the skill agent."""
    notes: list[str] = []
    if mode == "fixed_surface":
        notes.append(
            "No child-list container found: this catalog operates in fixed_surface"
            " mode. Generate templates.json and sample_payloads.json so synthesis runs"
            " through Stage 1 TemplateRegistry selection or Stage 2B flat catalog"
            " synthesis."
        )
        return tuple(notes)

    if mode == "hybrid":
        names = ", ".join(t.component for t in template_candidates)
        notes.append(
            f"Hybrid catalog: composable containers ({', '.join(page_candidates)})"
            f" coexist with monolithic form/card components ({names}). Generate both"
            " patterns.json and templates.json plus sample_payloads.json."
        )

    by_id = {b.block_id: b for b in blocks}
    if "picture" in by_id and not by_id["picture"].candidates:
        notes.append(
            "No image-capable leaf component detected: picture block and visual"
            " collection variants (cards, grid, reel) will be omitted or fall back."
        )
    if "actions" in by_id and not by_id["actions"].candidates:
        notes.append(
            "No action trigger component detected: actions and compose blocks will be"
            " unavailable."
        )
    for b in blocks:
        if not b.candidates and b.partial and page_candidates:
            notes.append(
                f"Block '{b.block_id}' has no single-component match; compose it as a"
                f" molecule using {page_candidates[0]} plus leaf components."
            )
    return tuple(notes)


def inspect_catalog(loaded: LoadedCatalog) -> InspectReport:
    """Runs structural analysis on `loaded` and returns an `InspectReport`."""
    summaries = tuple(
        summarize_component(spec) for spec in loaded.graph.root_candidates()
    )
    page_candidates = tuple(
        c.name
        for c in summaries
        if c.has_child_list and not any(a in c.required for a in c.action_slots)
    )
    has_page = bool(page_candidates)
    blocks = tuple(
        block_candidates(block, summaries, has_page_container=has_page)
        for block in loaded.grammar.blocks.values()
    )
    templates = extract_template_candidates(summaries, has_page_container=has_page)

    if not has_page:
        mode: Literal["composable", "fixed_surface", "hybrid"] = "fixed_surface"
    elif templates:
        mode = "hybrid"
    else:
        mode = "composable"

    rec_files: list[str] = []
    if mode in ("composable", "hybrid"):
        rec_files.append(str(loaded.target_dir / "patterns.json"))
    if mode in ("fixed_surface", "hybrid"):
        rec_files.append(str(loaded.target_dir / "templates.json"))
    rec_files.append(str(loaded.target_dir / "sample_payloads.json"))

    notes = _collect_notes(mode, page_candidates, summaries, blocks, templates)
    return InspectReport(
        catalog_id=loaded.catalog.catalog_id,
        protocol_version=loaded.graph.protocol_version,
        target_dir=str(loaded.target_dir),
        recommended_files=tuple(rec_files),
        mode=mode,
        page_candidates=page_candidates,
        components=summaries,
        blocks=blocks,
        template_candidates=templates,
        notes=notes,
    )


def report_to_dict(report: InspectReport) -> dict[str, Any]:
    """Serializes `report` to a JSON-compatible dictionary."""
    return {
        "catalogId": report.catalog_id,
        "protocolVersion": report.protocol_version,
        "targetDir": report.target_dir,
        "recommendedFiles": list(report.recommended_files),
        "mode": report.mode,
        "pageCandidates": list(report.page_candidates),
        "components": [
            {
                "name": c.name,
                "description": c.description,
                "isContainer": c.is_container,
                "hasChildList": c.has_child_list,
                "childSlots": list(c.child_slots),
                "dataSlots": dict(c.data_slots),
                "enumSlots": {k: list(v) for k, v in c.enum_slots.items()},
                "actionSlots": list(c.action_slots),
                "required": list(c.required),
                "supportsChecks": c.supports_checks,
            }
            for c in report.components
        ],
        "blocks": [
            {
                "blockId": b.block_id,
                "pattern": b.pattern,
                "fallback": list(b.fallback),
                "slotRequirements": dict(b.slot_requirements),
                "candidates": list(b.candidates),
                "partial": {k: list(v) for k, v in b.partial.items()},
            }
            for b in report.blocks
        ],
        "templateCandidates": [
            {
                "component": t.component,
                "suggestedTemplateId": t.suggested_template_id,
                "description": t.description,
                "requiredSlots": dict(t.required_slots),
                "optionalSlots": dict(t.optional_slots),
                "suggestedRequiredPointers": list(t.suggested_required_pointers),
                "isMutable": t.is_mutable,
            }
            for t in report.template_candidates
        ],
        "notes": list(report.notes),
    }


def _component_row(comp: ComponentSummary) -> list[str]:
    """Formats one `ComponentSummary` row for the Markdown table."""
    return [
        f"`{comp.name}`",
        "yes" if comp.is_container else "no",
        ", ".join(comp.child_slots) or "-",
        ", ".join(f"{k}:{v}" for k, v in comp.data_slots.items()) or "-",
        ", ".join(comp.action_slots) or "-",
        "yes" if comp.supports_checks else "no",
    ]


def _template_candidate_row(tpl: TemplateCandidate) -> list[str]:
    """Formats one `TemplateCandidate` row for the Markdown table."""
    return [
        f"`{tpl.component}`",
        f"`{tpl.suggested_template_id}`",
        ", ".join(f"`{p}`" for p in tpl.suggested_required_pointers) or "-",
        "yes" if tpl.is_mutable else "no",
        ", ".join(f"{k}:{v}" for k, v in tpl.required_slots.items()) or "-",
    ]


def _block_candidate_row(block: BlockCandidates) -> list[str]:
    """Formats one `BlockCandidates` row for the Markdown table."""
    return [
        f"`{block.block_id}`",
        f"`{block.pattern}`",
        ", ".join(f"{k} ({v})" for k, v in block.slot_requirements.items()) or "-",
        ", ".join(f"`{c}`" for c in block.candidates) or "compose / fallback",
        ", ".join(block.fallback),
    ]


def report_to_markdown(report: InspectReport) -> str:
    """Renders `report` as a human- and agent-readable Markdown summary."""
    lines: list[str] = [
        f"# Catalog Inspection: `{report.catalog_id}`",
        "",
        f"- **Protocol Version**: `{report.protocol_version}`",
        f"- **Synthesis Mode**: `{report.mode}`",
        f"- **Target Output Directory**: `{report.target_dir}`",
        (
            "- **Recommended Files**:"
            f" {', '.join(f'`{p}`' for p in report.recommended_files)}"
        ),
        (
            "- **Page Container Candidates**:"
            f" {', '.join(f'`{p}`' for p in report.page_candidates) or 'none'}"
        ),
        "",
        "## Components",
        "",
        render_markdown_table(
            [
                "Component",
                "Container",
                "Child Slots",
                "Data Slots",
                "Action Slots",
                "Checkable",
            ],
            [_component_row(c) for c in report.components],
        ),
    ]

    if report.template_candidates:
        lines.extend([
            "",
            "## Surface Template Candidates (Stage 1)",
            "",
            render_markdown_table(
                [
                    "Component",
                    "Template ID",
                    "Suggested Required Pointers",
                    "Mutable",
                    "Required Slots",
                ],
                [_template_candidate_row(t) for t in report.template_candidates],
            ),
        ])

    lines.extend([
        "",
        "## Layout Grammar Block Candidates (Stage 2A)",
        "",
        render_markdown_table(
            [
                "Block",
                "Pattern",
                "Slot Needs",
                "Direct Candidates",
                "Fallback Chain",
            ],
            [_block_candidate_row(b) for b in report.blocks],
        ),
    ])

    if report.notes:
        lines.extend(["", "## Notes", ""])
        for note in report.notes:
            lines.append(f"- {note}")

    return "\n".join(lines) + "\n"
