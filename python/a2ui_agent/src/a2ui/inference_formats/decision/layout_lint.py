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

"""Post-expansion component lint for archetype-planned A2UI surfaces."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import re
from typing import Any

from a2ui.core import A2uiValidationError

from .models import LayoutPlan, _WireEnum

_HEADING_PREFIX_RE = re.compile(r"^(#{1,6})\s")
_HEADING_VARIANT_LEVELS: dict[str, int] = {
    "h1": 1,
    "h2": 2,
    "h3": 3,
    "h4": 4,
    "h5": 5,
    "h6": 6,
}
_CONTAINER_TYPES: frozenset[str] = frozenset(
    {"Row", "Column", "Card", "List", "Modal", "Tabs"}
)
_LABEL_PROPERTIES: frozenset[str] = frozenset(
    {"label", "accessibility", "checks", "action", "description"}
)


class LintCode(_WireEnum):
    """Structural rule a `LintFinding` reports against."""

    EMPTY_CONTAINER = "empty_container"
    MISSING_COMPONENT = "missing_component"
    MULTIPLE_PRIMARY_BUTTONS = "multiple_primary_buttons"
    DUPLICATE_POINTER_BINDING = "duplicate_pointer_binding"
    HEADING_AFTER_BODY = "heading_after_body"
    MULTIPLE_REELS = "multiple_reels"


class LintSeverity(_WireEnum):
    """Whether a `LintFinding` blocks output (`ERROR`) or only advises (`WARNING`)."""

    ERROR = "error"
    WARNING = "warning"


@dataclass(frozen=True)
class LintFinding:
    """One violation or warning detected by `lint_components`."""

    code: LintCode
    message: str
    component_id: str | None = None
    severity: LintSeverity = LintSeverity.ERROR

    def __post_init__(self) -> None:
        object.__setattr__(self, "code", LintCode(self.code))
        object.__setattr__(self, "severity", LintSeverity(self.severity))


def _unpack_component(
    comp: Mapping[str, Any],
) -> tuple[str, str, Mapping[str, Any]]:
    """Extracts ``(id, component_type, properties)`` from v0.9 or v1.0 component dicts."""
    comp_id = str(comp.get("id", ""))
    raw_type = comp.get("component")
    if isinstance(raw_type, str):
        return comp_id, raw_type, comp
    if isinstance(raw_type, Mapping) and len(raw_type) == 1:
        comp_type, props = next(iter(raw_type.items()))
        if isinstance(props, Mapping):
            return comp_id, str(comp_type), props
    return comp_id, "", comp


def _non_empty_strings(items: Any) -> list[str]:
    """Returns non-empty string elements from a sequence, or an empty list."""
    if not isinstance(items, Sequence) or isinstance(items, (str, bytes)):
        return []
    return [item for item in items if isinstance(item, str) and item]


def _template_target_id(mapping: Mapping[str, Any]) -> str:
    """Extracts a template `componentId` or `component` from a `children` mapping."""
    template = mapping.get("template")
    source = template if isinstance(template, Mapping) else mapping
    target = source.get("componentId") or source.get("component")
    return str(target) if isinstance(target, str) else ""


def _extract_child_list_ids(children: Any) -> tuple[list[str], bool]:
    """Returns ``(referenced_ids, has_any_child_slot)`` from a ``children`` value."""
    direct = _non_empty_strings(children)
    if direct:
        return direct, True
    if not isinstance(children, Mapping):
        return [], False
    if "explicitList" in children:
        explicit = _non_empty_strings(children.get("explicitList"))
        return explicit, bool(explicit)
    target = _template_target_id(children)
    return ([target] if target else []), bool(target)


def _tab_child_ids(tab_items: Any) -> list[str]:
    """Extracts child IDs from a `Tabs.tabItems` sequence."""
    if not isinstance(tab_items, Sequence) or isinstance(tab_items, (str, bytes)):
        return []
    return [
        str(tab["child"])
        for tab in tab_items
        if isinstance(tab, Mapping)
        and isinstance(tab.get("child"), str)
        and tab["child"]
    ]


def _referenced_child_ids(
    comp_type: str, props: Mapping[str, Any]
) -> tuple[list[str], bool]:
    """Returns ``(referenced_ids, is_non_empty)`` for a component's child slots."""
    refs = [
        str(props[key])
        for key in ("child", "entryPointChild", "contentChild")
        if isinstance(props.get(key), str) and props.get(key)
    ]
    refs.extend(_tab_child_ids(props.get("tabItems")))
    list_ids, has_children = _extract_child_list_ids(props.get("children"))
    refs.extend(list_ids)
    if comp_type in {"Row", "Column", "List"}:
        return refs, has_children
    if comp_type in {"Card", "Tabs", "Modal"}:
        return refs, bool(refs)
    return refs, True


def _check_containers_and_references(
    components: Sequence[Mapping[str, Any]],
) -> list[LintFinding]:
    """Checks that no container is empty and every referenced child ID exists."""
    known_ids = {str(c.get("id", "")) for c in components if c.get("id")}
    findings: list[LintFinding] = []
    for comp in components:
        comp_id, comp_type, props = _unpack_component(comp)
        refs, non_empty = _referenced_child_ids(comp_type, props)
        if comp_type in _CONTAINER_TYPES and not non_empty:
            findings.append(
                LintFinding(
                    code=LintCode.EMPTY_CONTAINER,
                    message=f"Container {comp_id!r} ({comp_type}) has zero children.",
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


def _check_primary_buttons(
    components: Sequence[Mapping[str, Any]],
) -> list[LintFinding]:
    """Checks that at most one Button has ``variant: primary``."""
    primaries: list[str] = []
    for comp in components:
        comp_id, comp_type, props = _unpack_component(comp)
        if comp_type == "Button" and props.get("variant") == "primary":
            primaries.append(comp_id)
    if len(primaries) <= 1:
        return []
    return [
        LintFinding(
            code=LintCode.MULTIPLE_PRIMARY_BUTTONS,
            message=(
                f"Button {comp_id!r} is an extra primary button; at most one"
                f" primary button is allowed (found {primaries})."
            ),
            component_id=comp_id or None,
        )
        for comp_id in primaries[1:]
    ]


def _extract_direct_pointer(
    node: Mapping[str, Any],
) -> tuple[bool, str | None]:
    """Checks for a function call or direct ``path``/``@path`` binding on `node`."""
    if "call" in node or "@call" in node:
        return True, None
    path = node.get("path") or node.get("@path")
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


def _component_value_pointers(props: Mapping[str, Any]) -> list[str]:
    """Returns non-label data-binding pointers bound on a single component."""
    pointers: list[str] = []
    for key, val in props.items():
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
        comp_id, _, props = _unpack_component(comp)
        for pointer in _component_value_pointers(props):
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


def _text_heading_level(props: Mapping[str, Any]) -> int | None:
    """Returns the heading level (1..6) of a Text component, or None for body text."""
    variant = str(props.get("variant", ""))
    if variant in _HEADING_VARIANT_LEVELS:
        return _HEADING_VARIANT_LEVELS[variant]
    text_val = props.get("text")
    raw_str = ""
    if isinstance(text_val, str):
        raw_str = text_val
    elif isinstance(text_val, Mapping):
        literal = text_val.get("literalString") or text_val.get("$text")
        if isinstance(literal, str):
            raw_str = literal
        else:
            args = text_val.get("args")
            if isinstance(args, Mapping) and isinstance(args.get("value"), str):
                raw_str = args["value"]
    match = _HEADING_PREFIX_RE.match(raw_str.lstrip())
    if match is not None:
        return len(match.group(1))
    return None


def _match_block_suffix(comp_id: str, block_id: str) -> str | None:
    """Returns the suffix after `block_id_` in `comp_id`, or `None`."""
    prefix = f"{block_id}_"
    if comp_id.startswith(prefix):
        return comp_id[len(prefix) :]
    if f"_{prefix}" in comp_id:
        return comp_id.split(f"_{prefix}", 1)[1]
    return None


def _block_group_for_id(comp_id: str, block_ids: Sequence[str]) -> str:
    """Maps a component id to its owning block (or unrolled item) group."""
    for block_id in block_ids:
        if comp_id == block_id:
            return block_id
        rest = _match_block_suffix(comp_id, block_id)
        if rest is not None:
            head = rest.split("_", 1)[0]
            return f"{block_id}_{head}" if head.isdigit() else block_id
    return "_surface"


def _check_heading_order(
    components: Sequence[Mapping[str, Any]],
    plan: LayoutPlan | None,
) -> list[LintFinding]:
    """Checks that headings precede body copy and do not invert levels within a block."""
    block_ids = plan.block_ids() if plan is not None else ()
    seen_body: dict[str, bool] = {}
    deepest_heading: dict[str, int] = {}
    findings: list[LintFinding] = []
    for comp in components:
        comp_id, comp_type, props = _unpack_component(comp)
        if comp_type != "Text":
            continue
        group = _block_group_for_id(comp_id, block_ids)
        level = _text_heading_level(props)
        if level is None:
            if props.get("variant") != "caption":
                seen_body[group] = True
            continue
        prev_level = deepest_heading.get(group)
        if seen_body.get(group, False) or (
            prev_level is not None and level < prev_level
        ):
            findings.append(
                LintFinding(
                    code=LintCode.HEADING_AFTER_BODY,
                    message=(
                        f"Heading {comp_id!r} (h{level}) appears after body copy"
                        f" or a deeper heading in block {group!r}."
                    ),
                    component_id=comp_id or None,
                )
            )
        deepest_heading[group] = max(prev_level or level, level)
    return findings


def _check_single_reel(
    components: Sequence[Mapping[str, Any]],
    plan: LayoutPlan | None,
) -> list[LintFinding]:
    """Checks that at most one horizontal reel exists on the surface."""
    reel_ids: list[str] = []
    for comp in components:
        comp_id, comp_type, props = _unpack_component(comp)
        if comp_type == "List" and props.get("direction") == "horizontal":
            reel_ids.append(comp_id)
    if not reel_ids and plan is not None:
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
            component_id=comp_id or None,
        )
        for comp_id in reel_ids[1:]
    ]


def lint_components(
    components: Sequence[Mapping[str, Any]],
    plan: LayoutPlan | None = None,
    *,
    raise_on_error: bool = False,
) -> tuple[LintFinding, ...]:
    """Runs post-expansion layout lint checks over `components`.

    Args:
        components: Expanded A2UI component dicts (v0.9 or v1.0 wire shape).
        plan: Optional `LayoutPlan` providing block grouping and knob context.
        raise_on_error: When True, raises `A2uiValidationError` if any finding
            has `LintSeverity.ERROR`.

    Returns:
        A tuple of `LintFinding` objects (empty when clean).

    Raises:
        A2uiValidationError: If `raise_on_error` is True and any finding has
            `LintSeverity.ERROR`.
    """
    findings: list[LintFinding] = []
    findings.extend(_check_containers_and_references(components))
    findings.extend(_check_primary_buttons(components))
    findings.extend(_check_duplicate_pointers(components))
    findings.extend(_check_heading_order(components, plan))
    findings.extend(_check_single_reel(components, plan))
    if raise_on_error:
        errors = [f for f in findings if f.severity is LintSeverity.ERROR]
        if errors:
            summary = "; ".join(f"{f.code}: {f.message}" for f in errors)
            raise A2uiValidationError(f"Layout component lint failed: {summary}")
    return tuple(findings)
