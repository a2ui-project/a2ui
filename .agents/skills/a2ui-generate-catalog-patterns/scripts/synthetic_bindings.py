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

"""Synthetic slot bindings, knob products, and payloads for `PatternExpander` dry runs."""

from __future__ import annotations

from collections.abc import Sequence
import itertools
from typing import Any

from a2ui.inference_formats.decision import (
    ActionSpec,
    ActionStyle,
    BlockBindings,
    BlockSpec,
    CatalogPattern,
    PageBindings,
    QuestionKind,
    SemanticType,
    SlotBinding,
    SlotSpec,
)

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


def _first_semantic_type(from_types: Sequence[str]) -> SemanticType | None:
    """Returns the first entry in `from_types` that is a valid `SemanticType`.

    Args:
        from_types: Sequence of grammar slot source type names.

    Returns:
        The first matching `SemanticType` enum value, or `None` if `from_types`
        contains only grammar-level tokens (`"key"`, `"any"`, `"mutable"`, `"action"`).
    """
    for name in from_types:
        try:
            # Skip non-enum grammar tokens such as "key", "any", "mutable", and "action".
            return SemanticType(name)
        except ValueError:
            continue
    return None


def _scalar_sample_value(slot: SlotSpec, key: str, idx: int = 0) -> Any:
    """Returns a type-appropriate literal sample value for `slot`.

    Args:
        slot: Grammar slot specification describing allowed `from_types`.
        key: Slot or nested field name.
        idx: Zero-based item index when populating repeated items.

    Returns:
        A deterministic boolean, list, number, URL, or string sample value.
    """
    from_set = set(slot.from_types)
    if from_set == {"boolean"}:
        return idx == 0
    if "array" in from_set or key in ("options", "categories"):
        return [
            {"label": "Option A", "value": "a"},
            {"label": "Option B", "value": "b"},
        ]
    if from_set and from_set <= _NUMERIC_TYPES:
        if key == "min":
            return 0
        if key == "max":
            return 100
        return 42 if idx == 0 else 84
    if "image_url" in from_set:
        return "https://example.com/image.png"
    if "video_url" in from_set:
        return "https://example.com/video.mp4"
    if "audio_url" in from_set:
        return "https://example.com/audio.mp3"
    return f"Sample {key} {idx + 1}" if idx > 0 else f"Sample {key}"


def _repeat_item_count(block: BlockSpec) -> int:
    """Returns enough synthetic items to exercise every instance option on `block`.

    Args:
        block: Grammar block specification.

    Returns:
        The synthetic item count (at least 2, or the largest non-boolean instance option count).
    """
    max_opts = 2
    for q_spec in block.instance.values():
        if q_spec.kind is not QuestionKind.BOOLEAN:
            max_opts = max(max_opts, len(q_spec.option_ids()))
    return max_opts


def synthetic_actions(block: BlockSpec) -> tuple[ActionSpec, ...]:
    """Builds synthetic `ActionSpec` declarations for surface and item actions on `block`.

    Args:
        block: Grammar block specification.

    Returns:
        A tuple of synthetic `ActionSpec` instances matching the block's action slots.
    """
    if block.id == "actions":
        return (
            ActionSpec(
                id="confirm",
                label="Confirm",
                context={"target": "/action_target"},
                style=ActionStyle.PRIMARY,
            ),
            ActionSpec(
                id="cancel",
                label="Cancel",
                style=ActionStyle.SECONDARY,
            ),
        )
    if block.id == "compose":
        return (
            ActionSpec(
                id="send",
                label="Send",
                context={"draft": "/draft"},
                style=ActionStyle.PRIMARY,
            ),
        )
    if block.id == "groups":
        count = _repeat_item_count(block)
        return tuple(
            ActionSpec(
                id=f"open_group_row_{idx}",
                label=f"Setting {idx + 1}",
                scope="/groups",
                key="id",
            )
            for idx in range(count)
        )
    for name, slot in block.slots.items():
        if slot.repeat and "array" in slot.from_types:
            context_fields = {
                f_name: f_name
                for f_name in ("headline", "title", "label")
                if f_name in slot.fields
            }
            return (
                ActionSpec(
                    id=f"open_{name}_item",
                    label="Open",
                    scope=f"/{name}",
                    key="id",
                    context=context_fields,
                ),
            )
    return ()


def _build_groups_binding(block: BlockSpec) -> SlotBinding:
    """Builds synthetic nested group and row bindings for the `groups` block.

    Args:
        block: The `"groups"` grammar block specification.

    Returns:
        A `SlotBinding` containing one group with heterogeneous row bindings.
    """
    count = _repeat_item_count(block)
    row_actions = synthetic_actions(block)
    rows = tuple(
        {
            "label": SlotBinding(literal=f"Setting {idx + 1}"),
            "value": SlotBinding(
                pointer=f"/group_row_{idx}",
                semantic_type=(
                    SemanticType.BOOLEAN
                    if idx == 0
                    else (SemanticType.NUMBER if idx == 2 else SemanticType.STRING)
                ),
            ),
            "action": SlotBinding(literal=row_actions[idx]),
            "options": SlotBinding(
                literal=[
                    {"label": "Option A", "value": "a"},
                    {"label": "Option B", "value": "b"},
                ]
            ),
            "min": SlotBinding(literal=0),
            "max": SlotBinding(literal=100),
        }
        for idx in range(count)
    )
    group0 = {
        "heading": SlotBinding(literal="Preferences"),
        "rows": SlotBinding(items=rows),
    }
    return SlotBinding(items=(group0,))


def _build_comparison_binding(slot: SlotSpec) -> SlotBinding:
    """Builds synthetic `options` bindings with nested `attributes` and `fields` for `comparison`.

    Args:
        slot: The `"options"` slot specification from the `"comparison"` grammar block.

    Returns:
        A `SlotBinding` providing both template `fields` and unrolled `items` so direct
        `comparison` patterns and `collection` fallback patterns can expand without error.
    """
    fields = {
        f_name: SlotBinding(
            pointer=f_name,
            semantic_type=_first_semantic_type(f_spec.from_types),
        )
        for f_name, f_spec in slot.fields.items()
    }
    attr_items = (
        {
            "label": SlotBinding(literal="Tier"),
            "value": SlotBinding(literal="Pro"),
        },
    )
    items = tuple(
        {
            "headline": SlotBinding(literal=f"Option {idx + 1}"),
            "picture": SlotBinding(literal="https://example.com/opt.png"),
            "highlight": SlotBinding(literal="$29"),
            "attributes": SlotBinding(items=attr_items),
        }
        for idx in range(2)
    )
    return SlotBinding(pointer="/options", fields=fields, items=items)


def _build_scalar_repeated_binding(block: BlockSpec, slot: SlotSpec) -> SlotBinding:
    """Builds unrolled item mappings for scalar-repeated slots (`headline`, `facts`, `form`, `actions`).

    Args:
        block: Grammar block owning `slot`.
        slot: Repeated slot specification whose items unroll over object keys or actions.

    Returns:
        A `SlotBinding` populated with unrolled `items` dictionaries.
    """
    if "action" in slot.from_types:
        actions = synthetic_actions(block)
        return SlotBinding(
            pointer=f"/{slot.name}",
            items=tuple(
                {
                    "id": SlotBinding(literal=spec.id),
                    "label": SlotBinding(literal=spec.label),
                    "action": SlotBinding(literal=spec),
                }
                for spec in actions
            ),
        )
    count = _repeat_item_count(block)
    items: list[dict[str, SlotBinding]] = []
    for idx in range(count):
        item_map: dict[str, SlotBinding] = {}
        for f_name, f_spec in slot.fields.items():
            if "key" in f_spec.from_types:
                item_map[f_name] = SlotBinding(literal=f"Item {idx + 1}")
            elif f_name in ("options", "min", "max"):
                item_map[f_name] = SlotBinding(
                    literal=_scalar_sample_value(f_spec, f_name, idx)
                )
            else:
                item_map[f_name] = SlotBinding(
                    pointer=f"/{slot.name}_{idx}_{f_name}",
                    semantic_type=_first_semantic_type(f_spec.from_types),
                )
        items.append(item_map)
    return SlotBinding(pointer=f"/{slot.name}", items=tuple(items))


def _build_array_repeat_binding(
    block: BlockSpec, name: str, slot: SlotSpec
) -> SlotBinding:
    """Builds a template-mode array `SlotBinding` with synthetic item `ActionSpec`s.

    Args:
        block: Grammar block owning `slot`.
        name: Slot name on the block.
        slot: Repeated array slot specification.

    Returns:
        A `SlotBinding` with root pointer `/{name}` and relative `fields` bindings.
    """
    item_actions = synthetic_actions(block)
    item_action = item_actions[0] if item_actions else None
    fields: dict[str, SlotBinding] = {"id": SlotBinding(pointer="id")}
    for f_name, f_spec in slot.fields.items():
        if "action" in f_spec.from_types and item_action is not None:
            fields[f_name] = SlotBinding(literal=item_action)
        else:
            fields[f_name] = SlotBinding(
                pointer=f_name,
                semantic_type=_first_semantic_type(f_spec.from_types),
            )
    if item_action is not None and "action" not in fields:
        fields["action"] = SlotBinding(literal=item_action)
    return SlotBinding(pointer=f"/{name}", fields=fields)


def _attach_compose_action(block: BlockSpec, slots: dict[str, SlotBinding]) -> None:
    """Binds a synthetic `ActionSpec` for the `compose` block.

    Args:
        block: Grammar block being bound.
        slots: Mutable slot binding mapping to update in place when `block.id == "compose"`.
    """
    if block.id != "compose":
        return
    compose_actions = synthetic_actions(block)
    if compose_actions:
        slots["action"] = SlotBinding(literal=compose_actions[0])


def synthetic_block_bindings(block: BlockSpec) -> BlockBindings:
    """Constructs synthetic `BlockBindings` covering all slots of `block`.

    Args:
        block: Grammar block specification to bind.

    Returns:
        A `BlockBindings` instance ready for `PatternExpander.expand_block`.
    """
    if block.id == "groups":
        return BlockBindings(slots={"groups": _build_groups_binding(block)})
    if block.id == "comparison":
        return BlockBindings(
            slots={"options": _build_comparison_binding(block.slots["options"])}
        )

    slots: dict[str, SlotBinding] = {}
    for name, slot in block.slots.items():
        if slot.repeat and "array" in slot.from_types:
            slots[name] = _build_array_repeat_binding(block, name, slot)
        elif slot.repeat:
            slots[name] = _build_scalar_repeated_binding(block, slot)
        elif name == "categories":
            slots[name] = SlotBinding(literal=_scalar_sample_value(slot, name, 0))
            slots["categories.selected"] = SlotBinding(literal=["a"])
        else:
            slots[name] = SlotBinding(
                pointer=f"/{name}",
                semantic_type=_first_semantic_type(slot.from_types),
            )
    _attach_compose_action(block, slots)
    return BlockBindings(slots=slots)


def synthetic_page_bindings() -> PageBindings:
    """Constructs synthetic `PageBindings` with title, subtitle, and mark bound.

    Returns:
        A `PageBindings` instance referencing `/page_title`, `/page_subtitle`, and `/page_mark`.
    """
    return PageBindings(
        title=SlotBinding(pointer="/page_title", semantic_type=SemanticType.TITLE),
        subtitle=SlotBinding(
            pointer="/page_subtitle", semantic_type=SemanticType.STRING
        ),
        mark=SlotBinding(pointer="/page_mark", semantic_type=SemanticType.IMAGE_URL),
    )


def synthetic_instances(
    block: BlockSpec, bindings: BlockBindings
) -> dict[str, dict[str, str]]:
    """Constructs per-item and block-level instance answers for `block`.

    Args:
        block: Grammar block specification defining `block.instance` questions.
        bindings: Synthetic block bindings (unused, retained for call-site symmetry).

    Returns:
        A mapping from item index (or block ID) to question-ID/option-ID answers that
        cycles through every declared option across repeated items.
    """
    del bindings
    if block.id == "actions":
        return {
            "0": {"primary": "confirm", "destructive": "false"},
            "1": {"primary": "confirm", "destructive": "false"},
            "confirm": {"primary": "confirm", "destructive": "false"},
            "cancel": {"primary": "confirm", "destructive": "false"},
            "Confirm": {"primary": "confirm", "destructive": "false"},
            "Cancel": {"primary": "confirm", "destructive": "false"},
        }
    count = _repeat_item_count(block)
    instances: dict[str, dict[str, str]] = {
        **{str(idx): {} for idx in range(count)},
        block.id: {},
    }
    for q_name, q_spec in block.instance.items():
        if q_spec.kind is QuestionKind.BOOLEAN:
            opts: tuple[str, ...] = ("false", "true")
        else:
            opts = q_spec.option_ids() or ("default",)
        for idx in range(count):
            instances[str(idx)][q_name] = opts[idx % len(opts)]
        instances[block.id][q_name] = opts[0]
    return instances


def knob_combinations(
    pattern: CatalogPattern, *, limit: int = 64
) -> tuple[tuple[dict[str, str], ...], bool]:
    """Enumerates the Cartesian product of `pattern.knobs` with `{}` first.

    Args:
        pattern: Catalog pattern definition whose declared `knobs` are enumerated.
        limit: Maximum number of knob combinations to return before truncating.

    Returns:
        A `(combinations, truncated)` pair where `combinations` always starts with `{}`
        to test default `$knobValue` fallbacks and `truncated` indicates whether the
        product exceeded `limit`.
    """
    if not pattern.knobs:
        return (({},), False)
    keys = list(pattern.knobs.keys())
    value_lists = [list(pattern.knobs[k]) for k in keys]
    # Include the empty knob dict first to exercise default $knobValue fallbacks.
    combos: list[dict[str, str]] = [{}]
    truncated = False
    for prod in itertools.product(*value_lists):
        if len(combos) >= limit:
            truncated = True
            break
        combos.append(dict(zip(keys, prod, strict=True)))
    return (tuple(combos), truncated)


def _populate_slot_payload(
    payload: dict[str, Any], block: BlockSpec, name: str, slot: SlotSpec
) -> None:
    """Populates synthetic payload values for one `SlotSpec`.

    Args:
        payload: Mutable payload dictionary to populate.
        block: Grammar block owning `slot`.
        name: Slot name on the block.
        slot: Grammar slot specification.
    """
    if slot.repeat and "array" in slot.from_types:
        base_elem = {
            f_name: _scalar_sample_value(f_spec, f_name, 0)
            for f_name, f_spec in slot.fields.items()
            if "action" not in f_spec.from_types
        }
        elem0 = {"id": "item_1", **base_elem}
        elem1 = {"id": "item_2", **base_elem}
        payload[name] = [elem0, elem1]
        return
    if slot.repeat:
        count = _repeat_item_count(block)
        for idx in range(count):
            for f_name, f_spec in slot.fields.items():
                payload[f"{name}_{idx}_{f_name}"] = _scalar_sample_value(
                    f_spec, f_name, idx
                )
        return
    payload[name] = _scalar_sample_value(slot, name, 0)


def synthetic_payload(block: BlockSpec) -> dict[str, Any]:
    """Builds a synthetic data model matching `synthetic_block_bindings(block)`.

    Args:
        block: Grammar block specification whose bound pointers need sample values.

    Returns:
        A dictionary suitable for `updateDataModel` payload validation.
    """
    count = _repeat_item_count(block)
    payload: dict[str, Any] = {
        "page_title": "Sample Page Title",
        "page_subtitle": "Sample Page Subtitle",
        "page_mark": "https://example.com/logo.png",
        "action_target": "sample_target",
    }
    for idx in range(count):
        payload[f"group_row_{idx}"] = (
            True if idx == 0 else (50 if idx == 2 else f"Value {idx}")
        )
    for name, slot in block.slots.items():
        _populate_slot_payload(payload, block, name, slot)
    return payload
