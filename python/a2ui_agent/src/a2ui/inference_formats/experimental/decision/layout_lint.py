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

"""Post-expansion and plan-level lint for archetype-planned A2UI surfaces."""

from __future__ import annotations

from collections.abc import Collection, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from a2ui.core import A2uiValidationError

from .models import LayoutPlan, PlannedBlock, SlotBinding, _WireEnum

_LABEL_PROPERTIES: frozenset[str] = frozenset({
    "label",
    "accessibility",
    "checks",
    "@accessibility",
    "@checks",
    "action",
    "description",
})
_META_PROPERTIES: frozenset[str] = frozenset({
    "id",
    "component",
    "catalogId",
    "@catalogId",
    "variant",
    "checks",
    "@checks",
    "accessibility",
    "@accessibility",
    "metadata",
    "@metadata",
    "action",
})


class LintCode(_WireEnum):
    """Rule a `LintFinding` reports against."""

    EMPTY_CONTAINER = "empty_container"
    MISSING_COMPONENT = "missing_component"
    MULTIPLE_PRIMARY_BUTTONS = "multiple_primary_buttons"
    DUPLICATE_POINTER_BINDING = "duplicate_pointer_binding"
    EMPTY_AUTHORED_TEXT = "empty_authored_text"
    MULTIPLE_REELS = "multiple_reels"


class LintSeverity(_WireEnum):
    """Whether a `LintFinding` blocks output (`ERROR`) or only advises (`WARNING`)."""

    ERROR = "error"
    WARNING = "warning"


@dataclass(frozen=True)
class LintFinding:
    """One violation or warning detected by `lint_components`.

    Attributes:
        code: The `LintCode` identifying the violated rule.
        message: Human-readable explanation of the finding.
        component_id: Identifier of the offending component or block, if applicable.
        severity: Whether the finding blocks output (`ERROR`) or advises (`WARNING`).
    """

    code: LintCode
    message: str
    component_id: str | None = None
    severity: LintSeverity = LintSeverity.ERROR

    def __post_init__(self) -> None:
        object.__setattr__(self, "code", LintCode(self.code))
        object.__setattr__(self, "severity", LintSeverity(self.severity))


def _mapping_has_known_id(mapping: Mapping[str, Any], known_ids: set[str]) -> bool:
    """Returns whether any string value in `mapping` names an ID in `known_ids`."""
    return any(isinstance(v, str) and v in known_ids for v in mapping.values())


def _value_looks_like_child_slot(val: Any, known_ids: set[str]) -> bool:
    """Returns whether `val` carries a component ID reference or template child list."""
    if isinstance(val, str):
        return val in known_ids
    if isinstance(val, Mapping):
        return "componentId" in val
    if isinstance(val, Sequence) and not isinstance(val, (str, bytes)):
        return any(
            (isinstance(el, str) and el in known_ids)
            or (isinstance(el, Mapping) and _mapping_has_known_id(el, known_ids))
            for el in val
        )
    return False


def _infer_child_slot_keys(
    components: Sequence[Mapping[str, Any]], known_ids: set[str]
) -> frozenset[str]:
    """Infers child-slot property names by scanning component ID references."""
    return frozenset(
        k
        for comp in components
        for k, val in comp.items()
        if k not in _META_PROPERTIES and _value_looks_like_child_slot(val, known_ids)
    )


def _sequence_slot_refs(
    items: Sequence[Any], known_ids: set[str]
) -> tuple[list[str], bool]:
    """Extracts child IDs and emptiness from a sequence child slot."""
    if not items:
        return [], True
    refs: list[str] = []
    for el in items:
        if isinstance(el, str) and el:
            refs.append(el)
        elif isinstance(el, Mapping):
            refs.extend(v for v in el.values() if isinstance(v, str) and v in known_ids)
    return refs, not refs


def _slot_value_refs(val: Any, known_ids: set[str]) -> tuple[list[str], bool]:
    """Returns ``(referenced_ids, is_empty)`` for one child-slot value."""
    if isinstance(val, str):
        return ([val], False) if val else ([], True)
    if isinstance(val, Mapping):
        target = val.get("componentId")
        if isinstance(target, str) and target:
            return [target], False
        return [], True
    if isinstance(val, Sequence) and not isinstance(val, (str, bytes)):
        return _sequence_slot_refs(val, known_ids)
    return [], False


def _component_child_refs(
    comp: Mapping[str, Any],
    slot_keys: frozenset[str],
    known_ids: set[str],
) -> tuple[list[str], bool]:
    """Returns ``(referenced_ids, has_empty_slot)`` across `slot_keys` on `comp`."""
    refs: list[str] = []
    empty = False
    for key in slot_keys:
        if key not in comp:
            continue
        sub_refs, sub_empty = _slot_value_refs(comp[key], known_ids)
        refs.extend(sub_refs)
        empty = empty or sub_empty
    return refs, empty


def _check_containers_and_references(
    components: Sequence[Mapping[str, Any]],
    child_slot_keys: Collection[str] | None = None,
) -> list[LintFinding]:
    """Checks that no child-bearing slot is empty and every referenced ID exists."""
    known_ids = {str(c.get("id", "")) for c in components if c.get("id")}
    slot_keys = (
        frozenset(child_slot_keys)
        if child_slot_keys is not None
        else _infer_child_slot_keys(components, known_ids)
    )
    findings: list[LintFinding] = []
    for comp in components:
        comp_id = str(comp.get("id", ""))
        refs, is_empty = _component_child_refs(comp, slot_keys, known_ids)
        if is_empty:
            findings.append(
                LintFinding(
                    code=LintCode.EMPTY_CONTAINER,
                    message=f"Container {comp_id!r} has zero children.",
                    component_id=comp_id or None,
                )
            )
        for ref in refs:
            if ref not in known_ids:
                findings.append(
                    LintFinding(
                        code=LintCode.MISSING_COMPONENT,
                        message=(
                            f"Component {comp_id!r} references unknown child {ref!r}."
                        ),
                        component_id=comp_id or None,
                    )
                )
    return findings


def _plan_primary_actions_in_block(block: PlannedBlock) -> list[str]:
    """Returns primary action identifiers configured on `block`."""
    buttons = block.bindings.get("buttons")
    if buttons is None or not buttons.items:
        return []
    primaries: list[str] = []
    for idx, item in enumerate(buttons.items):
        act_slot = item.get("action")
        lbl_slot = item.get("label")
        act_id = (
            str(act_slot.literal)
            if act_slot is not None and act_slot.literal is not None
            else ""
        )
        lbl = (
            str(lbl_slot.literal)
            if lbl_slot is not None and lbl_slot.literal is not None
            else ""
        )
        inst = (
            block.instances.get(str(idx))
            or block.instances.get(act_id)
            or block.instances.get(lbl)
            or {}
        )
        if inst.get("primary") == "true":
            primaries.append(act_id or lbl or f"{block.block_id}_{idx}")
    return primaries


def _check_primary_actions(
    components: Sequence[Mapping[str, Any]],
    plan: LayoutPlan | None,
) -> list[LintFinding]:
    """Checks that at most one primary action exists on the surface."""
    primaries: list[str] = []
    if plan is not None:
        for block in plan.blocks:
            primaries.extend(_plan_primary_actions_in_block(block))
    if not primaries:
        primaries = [
            str(c.get("id", ""))
            for c in components
            if "action" in c and c.get("variant") == "primary"
        ]
    if len(primaries) <= 1:
        return []
    return [
        LintFinding(
            code=LintCode.MULTIPLE_PRIMARY_BUTTONS,
            message=(
                f"Action {target!r} is an extra primary action; at most one"
                f" primary action is allowed on a surface (found {primaries})."
            ),
            component_id=target or None,
        )
        for target in primaries[1:]
    ]


def _extract_direct_pointer(node: Mapping[str, Any]) -> tuple[bool, str | None]:
    """Checks for a function call or direct ``@path`` binding on `node`."""
    if "@call" in node:
        return True, None
    path = node.get("@path")
    if isinstance(path, str) and path.startswith("/"):
        return True, path
    return False, None


def _collect_value_pointers(node: Any) -> list[str]:
    """Collects absolute JSON Pointers from data-binding dicts under `node`."""
    if isinstance(node, Mapping):
        handled, path = _extract_direct_pointer(node)
        if handled:
            return [path] if path is not None else []
        found: list[str] = []
        for val in node.values():
            found.extend(_collect_value_pointers(val))
        return found
    if isinstance(node, Sequence) and not isinstance(node, (str, bytes)):
        found = []
        for item in node:
            found.extend(_collect_value_pointers(item))
        return found
    return []


def _component_value_pointers(comp: Mapping[str, Any]) -> list[str]:
    """Returns non-label data-binding pointers bound on a single component."""
    pointers: list[str] = []
    for key, val in comp.items():
        if key in {"id", "component", "children"} or key in _LABEL_PROPERTIES:
            continue
        pointers.extend(_collect_value_pointers(val))
    return pointers


def _check_duplicate_pointers(
    components: Sequence[Mapping[str, Any]],
) -> list[LintFinding]:
    """Checks that no absolute pointer is bound twice as a non-label value."""
    seen: dict[str, str] = {}
    findings: list[LintFinding] = []
    for comp in components:
        comp_id = str(comp.get("id", ""))
        for pointer in _component_value_pointers(comp):
            first_id = seen.get(pointer)
            if first_id is not None and first_id != comp_id:
                findings.append(
                    LintFinding(
                        code=LintCode.DUPLICATE_POINTER_BINDING,
                        message=(
                            f"Pointer {pointer!r} is bound in both {first_id!r}"
                            f" and {comp_id!r}."
                        ),
                        component_id=comp_id or None,
                    )
                )
            else:
                seen[pointer] = comp_id
    return findings


def _iter_slot_bindings(
    owner: str, slots: Mapping[str, SlotBinding]
) -> Iterator[tuple[str, SlotBinding]]:
    """Yields ``(location, binding)`` across `slots` and repeated `items`."""
    for slot_name, binding in slots.items():
        yield f"{owner}.{slot_name}", binding
        for idx, item in enumerate(binding.items):
            yield from _iter_slot_bindings(f"{owner}.{slot_name}[{idx}]", item)


def _check_authored_text(plan: LayoutPlan | None) -> list[LintFinding]:
    """Checks that authored literal text bindings on `plan` are non-empty."""
    if plan is None:
        return []
    pairs: list[tuple[str, SlotBinding]] = [
        ("page.title", plan.page.title),
        ("page.subtitle", plan.page.subtitle),
    ]
    for block in plan.blocks:
        pairs.extend(_iter_slot_bindings(block.block_id, block.bindings.slots))
    return [
        LintFinding(
            code=LintCode.EMPTY_AUTHORED_TEXT,
            message=f"Authored text at {loc!r} must not be empty or whitespace.",
            component_id=loc.split(".", 1)[0],
        )
        for loc, binding in pairs
        if isinstance(binding.literal, str) and not binding.literal.strip()
    ]


def _check_single_reel(plan: LayoutPlan | None) -> list[LintFinding]:
    """Checks that at most one horizontal reel block exists in `plan`."""
    if plan is None:
        return []
    reel_ids = [
        b.block_id
        for b in plan.blocks
        if b.variant_knobs.get("layout") == "reel" or b.pattern == "reel"
    ]
    if len(reel_ids) <= 1:
        return []
    return [
        LintFinding(
            code=LintCode.MULTIPLE_REELS,
            message=(
                f"Surface has multiple horizontal reels ({reel_ids}); at most"
                " one reel is allowed."
            ),
            component_id=block_id,
        )
        for block_id in reel_ids[1:]
    ]


def lint_components(
    components: Sequence[Mapping[str, Any]],
    plan: LayoutPlan | None = None,
    *,
    raise_on_error: bool = False,
    child_slot_keys: Collection[str] | None = None,
) -> tuple[LintFinding, ...]:
    """Runs structural and plan-level layout lint checks.

    Args:
        components: Expanded A2UI v1.0 component dicts.
        plan: Optional `LayoutPlan` providing block bindings, instances, and knobs.
        raise_on_error: When True, raises `A2uiValidationError` if any finding
            has `LintSeverity.ERROR`.
        child_slot_keys: Optional collection of child-slot property names from
            `CatalogDecisionGraph`. When None, child slots are inferred by
            scanning component ID references and template child-list mappings.

    Returns:
        A tuple of `LintFinding` objects (empty when clean).

    Raises:
        A2uiValidationError: If `raise_on_error` is True and any finding has
            `LintSeverity.ERROR`.
    """
    findings: list[LintFinding] = []
    findings.extend(_check_containers_and_references(components, child_slot_keys))
    findings.extend(_check_primary_actions(components, plan))
    findings.extend(_check_duplicate_pointers(components))
    findings.extend(_check_authored_text(plan))
    findings.extend(_check_single_reel(plan))
    if raise_on_error:
        errors = [f for f in findings if f.severity is LintSeverity.ERROR]
        if errors:
            summary = "; ".join(f"{f.code}: {f.message}" for f in errors)
            raise A2uiValidationError(f"Layout component lint failed: {summary}")
    return tuple(findings)
