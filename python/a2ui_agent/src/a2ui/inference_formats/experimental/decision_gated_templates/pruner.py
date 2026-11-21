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

"""Metadata extraction and deterministic component-graph pruning for gated templates."""

from __future__ import annotations

from collections import deque
from collections.abc import Collection, Mapping, Sequence
import copy
from typing import Any

from a2ui.core import A2uiCatalogError

from .models import (
    GATE_EXTENSION_KEY,
    VARIANT_EXTENSION_KEY,
    GateSpec,
    VariantGroupSpec,
    VariantOption,
)

_ROOT_ID = "root"
_REQUIRED_SINGLE_CHILD_KEYS: tuple[str, ...] = ("child", "trigger", "content")


def _get_extensions(component: Mapping[str, Any]) -> Mapping[str, Any]:
    """Returns the `@metadata.extensions` mapping for `component`, or empty."""
    metadata = component.get("@metadata")
    if not isinstance(metadata, Mapping):
        return {}
    extensions = metadata.get("extensions")
    if not isinstance(extensions, Mapping):
        return {}
    return extensions


def _parse_gate_extension(comp_id: str, raw: Any) -> GateSpec:
    """Validates and parses one `a2ui_gate` extension dict."""
    if not isinstance(raw, Mapping):
        raise A2uiCatalogError(
            f"Component '{comp_id}' has invalid '{GATE_EXTENSION_KEY}' extension:"
            " expected a mapping."
        )
    condition = raw.get("condition")
    if not isinstance(condition, str) or not condition.strip():
        raise A2uiCatalogError(
            f"Component '{comp_id}' '{GATE_EXTENSION_KEY}.condition' must be a"
            " non-empty string."
        )
    threshold_raw = raw.get("threshold", 0.5)
    if isinstance(threshold_raw, bool) or not isinstance(threshold_raw, (int, float)):
        raise A2uiCatalogError(
            f"Component '{comp_id}' '{GATE_EXTENSION_KEY}.threshold' must be a number."
        )
    threshold = float(threshold_raw)
    if not (0.0 <= threshold <= 1.0):
        raise A2uiCatalogError(
            f"Component '{comp_id}' '{GATE_EXTENSION_KEY}.threshold' must be in"
            f" [0.0, 1.0], got {threshold}."
        )
    return GateSpec(
        component_id=comp_id,
        condition=condition.strip(),
        threshold=threshold,
    )


def _parse_variant_extension(
    comp_id: str, raw: Any
) -> tuple[str, str, str, str | None, bool, float]:
    """Validates and parses one `a2ui_variant` extension dict."""
    if not isinstance(raw, Mapping):
        raise A2uiCatalogError(
            f"Component '{comp_id}' has invalid '{VARIANT_EXTENSION_KEY}' extension:"
            " expected a mapping."
        )
    group = raw.get("group")
    name = raw.get("name")
    description = raw.get("description")
    if not isinstance(group, str) or not group.strip():
        raise A2uiCatalogError(
            f"Component '{comp_id}' '{VARIANT_EXTENSION_KEY}.group' must be a"
            " non-empty string."
        )
    if not isinstance(name, str) or not name.strip():
        raise A2uiCatalogError(
            f"Component '{comp_id}' '{VARIANT_EXTENSION_KEY}.name' must be a"
            " non-empty string."
        )
    if not isinstance(description, str) or not description.strip():
        raise A2uiCatalogError(
            f"Component '{comp_id}' '{VARIANT_EXTENSION_KEY}.description' must be a"
            " non-empty string."
        )
    prompt_raw = raw.get("prompt")
    if prompt_raw is not None and (
        not isinstance(prompt_raw, str) or not prompt_raw.strip()
    ):
        raise A2uiCatalogError(
            f"Component '{comp_id}' '{VARIANT_EXTENSION_KEY}.prompt' must be a"
            " non-empty string when provided."
        )
    allow_none_raw = raw.get("allowNone", False)
    if not isinstance(allow_none_raw, bool):
        raise A2uiCatalogError(
            f"Component '{comp_id}' '{VARIANT_EXTENSION_KEY}.allowNone' must be a bool."
        )
    min_conf_raw = raw.get("minConfidence", 0.0)
    if isinstance(min_conf_raw, bool) or not isinstance(min_conf_raw, (int, float)):
        raise A2uiCatalogError(
            f"Component '{comp_id}' '{VARIANT_EXTENSION_KEY}.minConfidence' must be"
            " a number."
        )
    min_conf = float(min_conf_raw)
    if not (0.0 <= min_conf <= 1.0):
        raise A2uiCatalogError(
            f"Component '{comp_id}' '{VARIANT_EXTENSION_KEY}.minConfidence' must be"
            f" in [0.0, 1.0], got {min_conf}."
        )
    return (
        group.strip(),
        name.strip(),
        description.strip(),
        prompt_raw.strip() if isinstance(prompt_raw, str) else None,
        allow_none_raw,
        min_conf,
    )


def extract_gates_and_variants(
    components: Sequence[Mapping[str, Any]],
) -> tuple[tuple[GateSpec, ...], tuple[VariantGroupSpec, ...]]:
    """Extracts and validates all `a2ui_gate` and `a2ui_variant` declarations.

    Raises:
        A2uiCatalogError: If `root` is missing or gated, if a component declares
            both a gate and a variant, if duplicate component or variant names
            occur, or if any extension dict is malformed.
    """
    seen_ids: set[str] = set()
    gates: list[GateSpec] = []
    variant_options_by_group: dict[str, list[VariantOption]] = {}
    variant_meta_by_group: dict[str, tuple[str | None, bool, float]] = {}

    for comp in components:
        comp_id = comp.get("id")
        if not isinstance(comp_id, str) or not comp_id:
            raise A2uiCatalogError("Every template component must have a string 'id'.")
        if comp_id in seen_ids:
            raise A2uiCatalogError(f"Duplicate component id '{comp_id}' in template.")
        seen_ids.add(comp_id)

        extensions = _get_extensions(comp)
        has_gate = GATE_EXTENSION_KEY in extensions
        has_variant = VARIANT_EXTENSION_KEY in extensions
        if not has_gate and not has_variant:
            continue
        if comp_id == _ROOT_ID:
            raise A2uiCatalogError(
                f"Root component '{_ROOT_ID}' cannot carry '{GATE_EXTENSION_KEY}' or"
                f" '{VARIANT_EXTENSION_KEY}'."
            )
        if has_gate and has_variant:
            raise A2uiCatalogError(
                f"Component '{comp_id}' cannot declare both '{GATE_EXTENSION_KEY}' and"
                f" '{VARIANT_EXTENSION_KEY}'."
            )
        if has_gate:
            gates.append(_parse_gate_extension(comp_id, extensions[GATE_EXTENSION_KEY]))
            continue

        group, name, desc, prompt, allow_none, min_conf = _parse_variant_extension(
            comp_id, extensions[VARIANT_EXTENSION_KEY]
        )
        existing_options = variant_options_by_group.setdefault(group, [])
        if any(opt.name == name for opt in existing_options):
            raise A2uiCatalogError(
                f"Duplicate variant name '{name}' in variant group '{group}'."
            )
        existing_meta = variant_meta_by_group.get(group)
        if existing_meta is None:
            variant_meta_by_group[group] = (prompt, allow_none, min_conf)
        else:
            prev_prompt, prev_allow_none, prev_min_conf = existing_meta
            if prev_allow_none != allow_none:
                raise A2uiCatalogError(
                    f"Variant group '{group}' has conflicting 'allowNone' settings."
                )
            if prev_min_conf != min_conf:
                raise A2uiCatalogError(
                    f"Variant group '{group}' has conflicting 'minConfidence' settings."
                )
            if (
                prev_prompt is not None
                and prompt is not None
                and prev_prompt != prompt
            ):
                raise A2uiCatalogError(
                    f"Variant group '{group}' has conflicting 'prompt' settings."
                )
            if prev_prompt is None and prompt is not None:
                variant_meta_by_group[group] = (prompt, prev_allow_none, prev_min_conf)
        existing_options.append(
            VariantOption(component_id=comp_id, name=name, description=desc)
        )

    if _ROOT_ID not in seen_ids:
        raise A2uiCatalogError(
            f"Gated template must contain a '{_ROOT_ID}' component."
        )

    variant_groups: list[VariantGroupSpec] = []
    for group, options in variant_options_by_group.items():
        if len(options) < 2 and not variant_meta_by_group[group][1]:
            raise A2uiCatalogError(
                f"Variant group '{group}' must define at least 2 options unless"
                " allowNone=True."
            )
        prompt, allow_none, min_conf = variant_meta_by_group[group]
        variant_groups.append(
            VariantGroupSpec(
                group=group,
                prompt=prompt or f"Select the best variant for '{group}'.",
                options=tuple(options),
                allow_none=allow_none,
                min_confidence=min_conf,
            )
        )

    return tuple(gates), tuple(variant_groups)


def _child_ids_of(comp: Mapping[str, Any]) -> list[str]:
    """Returns all direct child component IDs referenced by `comp`."""
    refs: list[str] = []
    for key in _REQUIRED_SINGLE_CHILD_KEYS:
        val = comp.get(key)
        if isinstance(val, str):
            refs.append(val)
    children = comp.get("children")
    if isinstance(children, list):
        refs.extend(item for item in children if isinstance(item, str))
    elif isinstance(children, Mapping):
        tmpl_id = children.get("componentId")
        if isinstance(tmpl_id, str):
            refs.append(tmpl_id)
    tabs = comp.get("tabs")
    if isinstance(tabs, list):
        for tab in tabs:
            if isinstance(tab, Mapping) and isinstance(tab.get("child"), str):
                refs.append(str(tab["child"]))
    return refs


def _strip_gate_metadata(comp: dict[str, Any]) -> None:
    """Removes `a2ui_gate` and `a2ui_variant` from `@metadata.extensions` in place."""
    metadata = comp.get("@metadata")
    if not isinstance(metadata, dict):
        return
    extensions = metadata.get("extensions")
    if not isinstance(extensions, dict):
        return
    extensions.pop(GATE_EXTENSION_KEY, None)
    extensions.pop(VARIANT_EXTENSION_KEY, None)
    if not extensions:
        metadata.pop("extensions", None)
    if not metadata:
        comp.pop("@metadata", None)


def _clean_parent_references(
    comp: dict[str, Any], pruned: set[str]
) -> bool:
    """Cleans references to `pruned` IDs on `comp`; returns True if `comp` must be pruned."""
    for key in _REQUIRED_SINGLE_CHILD_KEYS:
        val = comp.get(key)
        if isinstance(val, str) and val in pruned:
            return True

    children = comp.get("children")
    if isinstance(children, list):
        comp["children"] = [
            cid for cid in children if not (isinstance(cid, str) and cid in pruned)
        ]
    elif isinstance(children, Mapping):
        tmpl_id = children.get("componentId")
        if isinstance(tmpl_id, str) and tmpl_id in pruned:
            return True

    tabs = comp.get("tabs")
    if isinstance(tabs, list):
        remaining_tabs = [
            tab
            for tab in tabs
            if not (isinstance(tab, Mapping) and tab.get("child") in pruned)
        ]
        if not remaining_tabs:
            return True
        comp["tabs"] = remaining_tabs

    return False


def prune_components(
    components: Sequence[Mapping[str, Any]],
    pruned_ids: Collection[str],
) -> tuple[list[dict[str, Any]], tuple[str, ...]]:
    """Prunes `pruned_ids`, cascades upward/downward, and strips gate metadata.

    Handles static `children` lists, `ChildList` template objects
    (`{"componentId", "path"}`), required single-child slots (`Card.child`,
    `Button.child`, `Modal.trigger`, `Modal.content`), and `Tabs.tabs`
    (`minItems: 1`). Unreachable descendants are dropped via BFS from `root`.

    Returns:
        `(surviving_components, all_pruned_ids)`. If `root` loses a required
        child during upward cascade, returns `([], all_component_ids)`.
    """
    copies: list[dict[str, Any]] = [copy.deepcopy(dict(c)) for c in components]
    all_ids = [str(c["id"]) for c in copies if isinstance(c.get("id"), str)]
    pruned: set[str] = set(pruned_ids)

    changed = True
    while changed:
        changed = False
        for comp in copies:
            comp_id = comp.get("id")
            if not isinstance(comp_id, str) or comp_id in pruned:
                continue
            if _clean_parent_references(comp, pruned):
                pruned.add(comp_id)
                changed = True

    if _ROOT_ID in pruned:
        return [], tuple(all_ids)

    by_id: dict[str, dict[str, Any]] = {
        str(c["id"]): c
        for c in copies
        if isinstance(c.get("id"), str) and str(c["id"]) not in pruned
    }

    reachable: set[str] = set()
    if _ROOT_ID in by_id:
        queue: deque[str] = deque([_ROOT_ID])
        while queue:
            cid = queue.popleft()
            if cid in reachable or cid not in by_id:
                continue
            reachable.add(cid)
            for child_id in _child_ids_of(by_id[cid]):
                if child_id in by_id and child_id not in reachable:
                    queue.append(child_id)

    surviving: list[dict[str, Any]] = []
    final_pruned: list[str] = []
    for comp in copies:
        comp_id = str(comp.get("id", ""))
        if comp_id in reachable:
            _strip_gate_metadata(comp)
            surviving.append(comp)
        else:
            final_pruned.append(comp_id)

    return surviving, tuple(final_pruned)
