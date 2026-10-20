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

"""Multi-stage local decision-model A2UI surface synthesizer."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
import re
from typing import Any, cast

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import CatalogSchemaHelper
from a2ui.parser.messages import to_message_models
from a2ui.utils.validation import validate_payload

from .backends import DecisionBackend
from .catalog_graph import CatalogDecisionGraph
from .models import (
    ComponentNodeSpec,
    ComponentSlot,
    DecisionDistribution,
    DecisionQuery,
    SlotKind,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
)
from .payload_inspector import (
    PointerSummary,
    PointerValueType,
    inspect_payload_pointers,
)
from .template_registry import TemplateRegistry

_CAMEL_RE = re.compile(r"([a-z0-9])([A-Z])")
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _is_v10(protocol_version: str) -> bool:
    """Returns whether `protocol_version` targets A2UI v1.0 or later."""
    clean = protocol_version.lstrip("v")
    return clean == "1" or clean.startswith("1.")


def _wire_version(protocol_version: str) -> str:
    """Returns the canonical A2UI wire envelope version string."""
    return "v1.0" if _is_v10(protocol_version) else "v0.9"


def _make_data_binding(path: str, *, is_v10: bool) -> dict[str, str]:
    """Creates a protocol-versioned A2UI DataBinding dictionary."""
    return {"@path": path} if is_v10 else {"path": path}


def _passes_calibration_gate(
    dist: DecisionDistribution, config: SynthesisConfig
) -> bool:
    """Returns whether `dist` satisfies the calibration and logit-margin gate."""
    if dist.calibrated:
        return True
    return (dist.top_logit_margin or 0.0) >= config.uncalibrated_min_logit_margin


def _tokenize_identifier(text: str) -> set[str]:
    """Splits camelCase, PascalCase, and path segments into lowercase tokens."""
    expanded = _CAMEL_RE.sub(r"\1 \2", text)
    return set(_TOKEN_RE.findall(expanded.lower()))


def _pointer_matches_slot_type(ptr: PointerSummary, slot_type: str | None) -> bool:
    """Returns whether a pointer's value type is compatible with `slot_type`."""
    if slot_type is None or slot_type == "any":
        return True
    return ptr.value_type == slot_type


def _best_pointer_by_tokens(
    candidates: Sequence[PointerSummary], slot_tokens: set[str]
) -> PointerSummary:
    """Returns the pointer in `candidates` with the highest token overlap."""
    return max(
        candidates,
        key=lambda p: len(slot_tokens & _tokenize_identifier(p.path)),
    )


def _select_required_pointer(
    slot: ComponentSlot,
    compatible: Sequence[PointerSummary],
    unused: Sequence[PointerSummary],
    used_paths: set[str],
    *,
    relative: bool,
) -> str:
    """Selects a pointer path (or fallback path) for a required DATA_VALUE slot."""
    pool = unused if unused else compatible
    if not pool:
        return slot.name if relative else f"/{slot.name}"
    chosen = _best_pointer_by_tokens(pool, _tokenize_identifier(slot.name))
    used_paths.add(chosen.path)
    return chosen.path


def _select_optional_pointer(
    slot: ComponentSlot,
    unused: Sequence[PointerSummary],
    used_paths: set[str],
) -> str | None:
    """Selects an unused pointer path for an optional DATA_VALUE slot, or None."""
    if not unused:
        return None
    slot_tokens = _tokenize_identifier(slot.name)
    if slot.value_type == "any":
        matched = [
            p
            for p in unused
            if (slot_tokens & _tokenize_identifier(p.path)) or p.value_type == "object"
        ]
        if not matched:
            return None
        chosen = max(
            matched,
            key=lambda p: len(slot_tokens & _tokenize_identifier(p.path)),
        )
        used_paths.add(chosen.path)
        return chosen.path
    chosen = _best_pointer_by_tokens(unused, slot_tokens)
    used_paths.add(chosen.path)
    return chosen.path


def _select_pointer_for_slot(
    slot: ComponentSlot,
    pointers: Sequence[PointerSummary],
    used_paths: set[str],
    *,
    relative: bool,
) -> str | None:
    """Selects a JSON Pointer path for `slot` from `pointers`."""
    compatible = [p for p in pointers if _pointer_matches_slot_type(p, slot.value_type)]
    unused = [p for p in compatible if p.path not in used_paths]
    if slot.required:
        return _select_required_pointer(
            slot, compatible, unused, used_paths, relative=relative
        )
    return _select_optional_pointer(slot, unused, used_paths)


def _select_enum_value(slot: ComponentSlot, intent: str) -> str | None:
    """Selects an enum literal matching `intent` or defaults to the first value."""
    if not slot.enum_values:
        return None
    intent_lower = intent.lower()
    for val in slot.enum_values:
        if val.lower() in intent_lower:
            return val
    return slot.enum_values[0]


def _is_binding_ref(ref: Any) -> bool:
    """Returns whether `ref` is a JSON Schema `$ref` to a bindable type."""
    return isinstance(ref, str) and ("DataBinding" in ref or "Dynamic" in ref)


def _schema_allows_binding(schema: Mapping[str, Any]) -> bool:
    """Returns whether `schema` accepts an A2UI `DataBinding` object."""
    if _is_binding_ref(schema.get("$ref")):
        return True
    for key in ("oneOf", "anyOf", "allOf"):
        sub_list = schema.get(key)
        if isinstance(sub_list, list) and any(
            isinstance(s, Mapping) and _schema_allows_binding(s) for s in sub_list
        ):
            return True
    return False


def _default_arg_value(
    param_name: str,
    param_schema: Mapping[str, Any],
    pointers: Sequence[PointerSummary],
    *,
    is_v10: bool,
    relative: bool,
) -> Any:
    """Builds a schema-valid argument value for a check function parameter."""
    if _schema_allows_binding(param_schema):
        if pointers:
            chosen = _best_pointer_by_tokens(pointers, _tokenize_identifier(param_name))
            path = chosen.path
        else:
            path = param_name if relative else f"/{param_name}"
        return _make_data_binding(path, is_v10=is_v10)
    prim_type = param_schema.get("type")
    if prim_type in ("number", "integer"):
        return 1
    if prim_type == "boolean":
        return True
    if prim_type == "array":
        return []
    if prim_type == "object":
        return {}
    return "valid"


def _find_function_helper(
    helpers: Mapping[str, CatalogSchemaHelper],
    fn_name: str,
    preferred_catalog_id: str,
) -> tuple[str | None, CatalogSchemaHelper | None]:
    """Finds the catalog ID and schema helper defining `fn_name`."""
    preferred = helpers.get(preferred_catalog_id)
    if preferred is not None and fn_name in preferred.functions:
        return preferred_catalog_id, preferred
    for cat_id, helper in helpers.items():
        if fn_name in helper.functions:
            return cat_id, helper
    return None, None


def _build_checks(
    graph: CatalogDecisionGraph,
    comp_spec: ComponentNodeSpec,
    pointers: Sequence[PointerSummary],
    *,
    is_v10: bool,
    relative: bool,
) -> list[dict[str, Any]]:
    """Builds validation check rules for checkable components."""
    check_fns = graph.checkable_functions()
    if not comp_spec.supports_checks or not check_fns:
        return []
    helpers: Mapping[str, CatalogSchemaHelper] = graph.helpers()
    chosen_fn = check_fns[0]
    for fn_name in check_fns:
        cat_id, _ = _find_function_helper(helpers, fn_name, comp_spec.catalog_id)
        if cat_id == comp_spec.catalog_id:
            chosen_fn = fn_name
            break
    fn_cat_id, helper = _find_function_helper(helpers, chosen_fn, comp_spec.catalog_id)
    args: dict[str, Any] = {}
    if helper is not None:
        for param_name in helper.get_function_properties(chosen_fn):
            p_schema = helper.get_function_property_schema(chosen_fn, param_name)
            args[param_name] = _default_arg_value(
                param_name,
                p_schema or {},
                pointers,
                is_v10=is_v10,
                relative=relative,
            )
    call_key = "@call" if is_v10 else "call"
    condition: dict[str, Any] = {call_key: chosen_fn, "args": args}
    if graph.surface_catalog_id is None and fn_cat_id is not None:
        condition["catalogId"] = fn_cat_id
    return [{
        "condition": condition,
        "message": (
            f"{chosen_fn[0].upper() + chosen_fn[1:] if chosen_fn else ''} check failed"
        ),
    }]


def _bind_non_child_slots(
    comp: dict[str, Any],
    spec: ComponentNodeSpec,
    intent: str,
    pointers: Sequence[PointerSummary],
    *,
    is_v10: bool,
    relative: bool,
) -> None:
    """Binds DATA_VALUE, STATIC_ENUM, and ACTION slots on `comp` in place."""
    used_paths: set[str] = set()
    selected_paths: dict[str, str | None] = {}
    data_slots = [s for s in spec.slots if s.kind == SlotKind.DATA_VALUE]
    for slot in sorted(data_slots, key=lambda s: not s.required):
        selected_paths[slot.name] = _select_pointer_for_slot(
            slot, pointers, used_paths, relative=relative
        )
    for slot in spec.slots:
        if slot.kind == SlotKind.DATA_VALUE:
            path = selected_paths.get(slot.name)
            if path is not None:
                comp[slot.name] = _make_data_binding(path, is_v10=is_v10)
        elif slot.kind == SlotKind.STATIC_ENUM:
            enum_val = _select_enum_value(slot, intent)
            if enum_val is not None:
                comp[slot.name] = enum_val
        elif slot.kind == SlotKind.ACTION:
            comp[slot.name] = {"event": {"name": slot.name}}


def _relative_pointers_for_array(
    array_ptr: PointerSummary | None,
    fallback_pointers: Sequence[PointerSummary],
) -> list[PointerSummary]:
    """Builds relative `PointerSummary` entries for a repeating `ChildList`."""
    if array_ptr is not None and array_ptr.element_keys:
        return [
            PointerSummary(
                path=key,
                value_type=cast(
                    PointerValueType,
                    array_ptr.sample_type_by_key.get(key, "string"),
                ),
                cardinality=1,
                mutable_hint=array_ptr.mutable_hint,
            )
            for key in array_ptr.element_keys
        ]
    return [
        PointerSummary(
            path=p.path.rsplit("/", 1)[-1] or p.path.lstrip("/"),
            value_type=p.value_type,
            cardinality=1,
            mutable_hint=p.mutable_hint,
        )
        for p in fallback_pointers
        if p.value_type != "array"
    ]


def _best_leaf_by_pointer_overlap(
    candidates: Sequence[ComponentNodeSpec],
    pointers: Sequence[PointerSummary],
) -> ComponentNodeSpec:
    """Selects the leaf component whose DATA_VALUE slots best match `pointers`."""
    ptr_types = {p.value_type for p in pointers}
    return max(
        candidates,
        key=lambda c: sum(
            1
            for s in c.slots
            if s.kind == SlotKind.DATA_VALUE and s.value_type in ptr_types
        ),
    )


class DecisionSynthesizer:
    """Catalog-agnostic local decision-model A2UI surface synthesizer."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        backend: DecisionBackend,
        *,
        registry: TemplateRegistry | None = None,
        config: SynthesisConfig | None = None,
    ) -> None:
        self.graph = CatalogDecisionGraph(catalogs)
        self.backend = backend
        self.registry = registry if registry is not None else TemplateRegistry()
        self.config = config if config is not None else SynthesisConfig()

    async def synthesize(
        self,
        intent: str,
        payload: Mapping[str, Any],
        *,
        surface_id: str | None = None,
        mutable_paths: Collection[str] = (),
        config: SynthesisConfig | None = None,
    ) -> SynthesisOutput:
        """Synthesizes validated A2UI messages without mutating the template registry."""
        active_config = config if config is not None else self.config
        target_surface_id = (
            surface_id if surface_id is not None else active_config.default_surface_id
        )
        pointers = inspect_payload_pointers(payload, mutable_paths=mutable_paths)
        has_mutable = bool(mutable_paths) or any(p.mutable_hint for p in pointers)

        stage1_out = await self._try_template_stage(
            intent,
            payload,
            pointers,
            target_surface_id=target_surface_id,
            has_mutable=has_mutable,
            config=active_config,
        )
        if stage1_out is not None:
            return stage1_out

        return await self._synthesize_from_catalog(
            intent,
            payload,
            pointers,
            target_surface_id=target_surface_id,
            has_mutable=has_mutable,
            config=active_config,
        )

    async def _try_template_stage(
        self,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        target_surface_id: str,
        has_mutable: bool,
        config: SynthesisConfig,
    ) -> SynthesisOutput | None:
        """Executes Stage 1 template matching and risk-tiered confidence gating."""
        pointer_paths = [p.path for p in pointers]
        matching = self.registry.matching_templates(pointer_paths)
        if not matching:
            return None

        dist = await self.backend.predict(
            DecisionQuery(
                task="template_select",
                prompt=intent,
                candidates=tuple(t.template_id for t in matching),
                context={"pointers": pointer_paths},
            )
        )
        if not _passes_calibration_gate(dist, config):
            return None

        top_id, top_prob = dist.top_choice()
        template = self.registry.get(top_id)
        if template is None:
            return None

        threshold = (
            config.mutable_confidence_threshold
            if (has_mutable or template.is_mutable)
            else config.template_confidence_threshold
        )
        if top_prob < threshold:
            return None

        messages = template.render_messages(payload, surface_id=target_surface_id)
        tree_spec: dict[str, Any] = {"template_id": template.template_id}
        root_comp_name = template.root_component()
        if root_comp_name is not None:
            tree_spec["root_component"] = root_comp_name
        return SynthesisOutput(
            stage=SynthesisStage.TEMPLATE_SELECT,
            messages=messages,
            confidence=top_prob,
            entropy=dist.normalized_entropy(),
            selected_template_id=template.template_id,
            component_tree_spec=tree_spec,
        )

    async def _synthesize_from_catalog(
        self,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        target_surface_id: str,
        has_mutable: bool,
        config: SynthesisConfig,
    ) -> SynthesisOutput:
        """Executes Stage 2 catalog-guided synthesis or Stage 3 abstain fallback."""
        root_candidates = (
            (self.graph.leaf_candidates() or self.graph.root_candidates())
            if config.max_tree_depth <= 1
            else self.graph.root_candidates()
        )
        if not root_candidates:
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=0.0,
                entropy=0.0,
            )

        dist = await self.backend.predict(
            DecisionQuery(
                task="root_component",
                prompt=intent,
                candidates=tuple(c.name for c in root_candidates),
                context={
                    "pointers": [p.path for p in pointers],
                    "types": {p.path: p.value_type for p in pointers},
                },
            )
        )
        top_name, top_prob = dist.top_choice()
        entropy = dist.normalized_entropy()
        root_spec = self.graph.get_component(top_name)

        if (
            not _passes_calibration_gate(dist, config)
            or top_prob < config.abstain_threshold
            or root_spec is None
        ):
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=top_prob,
                entropy=entropy,
            )

        if self._should_wrap_in_switcher(dist, root_spec, entropy, config=config):
            return await self._synthesize_multi_view_switcher(
                intent,
                payload,
                pointers,
                dist,
                target_surface_id=target_surface_id,
                has_mutable=has_mutable,
                confidence=top_prob,
                entropy=entropy,
                config=config,
            )

        if not root_spec.is_container or config.max_tree_depth <= 1:
            return self._synthesize_leaf_fast_path(
                root_spec,
                intent,
                payload,
                pointers,
                target_surface_id=target_surface_id,
                has_mutable=has_mutable,
                confidence=top_prob,
                entropy=entropy,
                config=config,
            )

        return await self._synthesize_container_tree(
            root_spec,
            intent,
            payload,
            pointers,
            target_surface_id=target_surface_id,
            has_mutable=has_mutable,
            confidence=top_prob,
            entropy=entropy,
            config=config,
        )

    def _should_wrap_in_switcher(
        self,
        dist: DecisionDistribution,
        root_spec: ComponentNodeSpec,
        entropy: float,
        *,
        config: SynthesisConfig,
    ) -> bool:
        """Checks whether high-entropy multi-view switcher wrapping applies."""
        if config.max_tree_depth <= 1:
            return False
        if root_spec.is_multi_view_switcher:
            return False
        if not self.graph.multi_view_switchers():
            return False
        if entropy < (1.0 - config.entropy_switch_margin):
            return False
        viable_count = sum(1 for p in dist.probabilities.values() if p >= 0.25)
        return viable_count >= 2

    def _select_competing_views(
        self, dist: DecisionDistribution, switcher_name: str
    ) -> list[ComponentNodeSpec]:
        """Selects the top 2 non-switcher view specs from `dist`."""
        ranked = sorted(
            dist.probabilities.items(), key=lambda item: item[1], reverse=True
        )
        views: list[ComponentNodeSpec] = []
        for cand_name, _ in ranked:
            if cand_name == switcher_name:
                continue
            spec = self.graph.get_component(cand_name)
            if (
                spec is not None
                and not spec.is_multi_view_switcher
                and spec not in views
            ):
                views.append(spec)
            if len(views) == 2:
                return views
        for fallback in self.graph.root_candidates():
            if not fallback.is_multi_view_switcher and fallback not in views:
                views.append(fallback)
            if len(views) == 2:
                break
        return views

    def _switcher_requires_mutable_gate(
        self,
        switcher: ComponentNodeSpec,
        views: Sequence[ComponentNodeSpec],
        has_mutable: bool,
    ) -> bool:
        """Returns whether switcher synthesis requires the mutable threshold."""
        return (
            has_mutable
            or switcher.has_action_slot
            or any(v.has_action_slot for v in views)
        )

    async def _synthesize_multi_view_switcher(
        self,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        dist: DecisionDistribution,
        *,
        target_surface_id: str,
        has_mutable: bool,
        confidence: float,
        entropy: float,
        config: SynthesisConfig,
    ) -> SynthesisOutput:
        """Wraps competing candidate views in a multi-view switcher."""
        switcher = self.graph.multi_view_switchers()[0]
        max_views = min(2, config.max_children_per_container)
        views = self._select_competing_views(dist, switcher.name)[:max_views]
        if (
            self._switcher_requires_mutable_gate(switcher, views, has_mutable)
            and confidence < config.mutable_confidence_threshold
        ):
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=confidence,
                entropy=entropy,
            )

        is_v10 = _is_v10(self.graph.protocol_version)
        allow_actions = confidence >= config.mutable_confidence_threshold
        root_comp = self._init_component_dict(switcher, "root")
        _bind_non_child_slots(
            root_comp, switcher, intent, pointers, is_v10=is_v10, relative=False
        )

        child_components: list[dict[str, Any]] = []
        named_items: list[dict[str, Any]] = []
        array_slot = next(
            s for s in switcher.slots if s.kind == SlotKind.NAMED_CHILD_ARRAY
        )

        for idx, view_spec in enumerate(views, start=1):
            view_id = f"view_{idx}"
            built = await self._build_component_subtree(
                view_spec,
                view_id,
                intent,
                pointers,
                depth=2,
                allow_actions=allow_actions,
                config=config,
            )
            child_components.extend(built)
            item: dict[str, Any] = {}
            if array_slot.label_key is not None:
                item[array_slot.label_key] = view_spec.name
            if array_slot.child_id_key is not None:
                item[array_slot.child_id_key] = view_id
            named_items.append(item)

        root_comp[array_slot.name] = named_items
        checks = _build_checks(
            self.graph, switcher, pointers, is_v10=is_v10, relative=False
        )
        if checks:
            root_comp["checks"] = checks

        components = [root_comp, *child_components]
        messages = self._build_validated_messages(
            target_surface_id, components, payload
        )
        return SynthesisOutput(
            stage=SynthesisStage.CONTAINER_2PASS,
            messages=messages,
            confidence=confidence,
            entropy=entropy,
            component_tree_spec={
                "root_component": switcher.name,
                "views": [v.name for v in views],
                "components": components,
            },
        )

    def _synthesize_leaf_fast_path(
        self,
        root_spec: ComponentNodeSpec,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        target_surface_id: str,
        has_mutable: bool,
        confidence: float,
        entropy: float,
        config: SynthesisConfig,
    ) -> SynthesisOutput:
        """Executes Stage 2A 1-pass leaf component synthesis."""
        if (
            root_spec.has_action_slot or has_mutable
        ) and confidence < config.mutable_confidence_threshold:
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=confidence,
                entropy=entropy,
            )

        leaf_comp = self._build_leaf_dict(
            root_spec, "root", intent, pointers, relative=False
        )
        components = [leaf_comp]
        messages = self._build_validated_messages(
            target_surface_id, components, payload
        )
        return SynthesisOutput(
            stage=SynthesisStage.FAST_1PASS_LEAF,
            messages=messages,
            confidence=confidence,
            entropy=entropy,
            component_tree_spec={
                "root_component": root_spec.name,
                "components": components,
            },
        )

    async def _synthesize_container_tree(
        self,
        root_spec: ComponentNodeSpec,
        intent: str,
        payload: Mapping[str, Any],
        pointers: Sequence[PointerSummary],
        *,
        target_surface_id: str,
        has_mutable: bool,
        confidence: float,
        entropy: float,
        config: SynthesisConfig,
    ) -> SynthesisOutput:
        """Executes Stage 2B 2-pass container and child slot synthesis."""
        if (
            root_spec.has_action_slot or has_mutable
        ) and confidence < config.mutable_confidence_threshold:
            return SynthesisOutput(
                stage=SynthesisStage.ABSTAIN_FALLBACK,
                messages=[],
                confidence=confidence,
                entropy=entropy,
            )

        allow_actions = confidence >= config.mutable_confidence_threshold
        components = await self._build_component_subtree(
            root_spec,
            "root",
            intent,
            pointers,
            depth=1,
            allow_actions=allow_actions,
            config=config,
        )
        messages = self._build_validated_messages(
            target_surface_id, components, payload
        )
        return SynthesisOutput(
            stage=SynthesisStage.CONTAINER_2PASS,
            messages=messages,
            confidence=confidence,
            entropy=entropy,
            component_tree_spec={
                "root_component": root_spec.name,
                "components": components,
            },
        )

    def _init_component_dict(
        self, spec: ComponentNodeSpec, comp_id: str
    ) -> dict[str, Any]:
        """Creates a base component dictionary with `id`, `component`, and optional `catalogId`."""
        comp: dict[str, Any] = {"id": comp_id, "component": spec.name}
        if self.graph.surface_catalog_id is None:
            comp["catalogId"] = spec.catalog_id
        return comp

    def _build_leaf_dict(
        self,
        spec: ComponentNodeSpec,
        comp_id: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        relative: bool,
    ) -> dict[str, Any]:
        """Builds a single leaf component dictionary bound to `pointers`."""
        is_v10 = _is_v10(self.graph.protocol_version)
        comp = self._init_component_dict(spec, comp_id)
        _bind_non_child_slots(
            comp, spec, intent, pointers, is_v10=is_v10, relative=relative
        )
        checks = _build_checks(
            self.graph, spec, pointers, is_v10=is_v10, relative=relative
        )
        if checks:
            comp["checks"] = checks
        return comp

    def _coerce_to_leaf_if_depth_reached(
        self,
        spec: ComponentNodeSpec,
        pointers: Sequence[PointerSummary],
        *,
        depth: int,
        allow_actions: bool,
        config: SynthesisConfig,
    ) -> ComponentNodeSpec:
        """Replaces a container `spec` with a leaf when `depth` hits `max_tree_depth`."""
        if not spec.is_container or depth < config.max_tree_depth:
            return spec
        leaf_pool = [
            c
            for c in self.graph.leaf_candidates()
            if allow_actions or not c.has_action_slot
        ] or list(self.graph.leaf_candidates())
        if not leaf_pool:
            return spec
        return _best_leaf_by_pointer_overlap(leaf_pool, pointers)

    async def _build_component_subtree(
        self,
        spec: ComponentNodeSpec,
        comp_id: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        depth: int = 1,
        allow_actions: bool = True,
        config: SynthesisConfig,
    ) -> list[dict[str, Any]]:
        """Builds a component and any child components required by its container slots."""
        effective_spec = self._coerce_to_leaf_if_depth_reached(
            spec,
            pointers,
            depth=depth,
            allow_actions=allow_actions,
            config=config,
        )
        if not effective_spec.is_container:
            return [
                self._build_leaf_dict(
                    effective_spec, comp_id, intent, pointers, relative=False
                )
            ]

        is_v10 = _is_v10(self.graph.protocol_version)
        comp = self._init_component_dict(effective_spec, comp_id)
        _bind_non_child_slots(
            comp, effective_spec, intent, pointers, is_v10=is_v10, relative=False
        )

        children: list[dict[str, Any]] = []
        prefix = "" if comp_id == "root" else f"{comp_id}_"
        child_counter = 0

        for slot in effective_spec.slots:
            if not slot.required and len(children) >= config.max_children_per_container:
                continue
            if slot.kind == SlotKind.CHILD_LIST:
                child_counter += 1
                item_id = f"{prefix}item_{child_counter}"
                item_comp, array_path = await self._build_child_list_item(
                    effective_spec.name,
                    slot.name,
                    item_id,
                    intent,
                    pointers,
                    allow_actions=allow_actions,
                )
                comp[slot.name] = {"path": array_path, "componentId": item_id}
                children.append(item_comp)
            elif slot.kind == SlotKind.CHILD:
                child_counter += 1
                child_id = f"{prefix}child_{child_counter}"
                child_comp = await self._build_single_child(
                    effective_spec.name,
                    slot.name,
                    child_id,
                    intent,
                    pointers,
                    allow_actions=allow_actions,
                )
                comp[slot.name] = child_id
                children.append(child_comp)
            elif slot.kind == SlotKind.NAMED_CHILD_ARRAY:
                remaining = max(1, config.max_children_per_container - len(children))
                named_items, named_children = await self._build_named_child_array(
                    effective_spec.name,
                    slot,
                    prefix,
                    intent,
                    pointers,
                    max_items=remaining,
                    allow_actions=allow_actions,
                )
                comp[slot.name] = named_items
                children.extend(named_children)

        checks = _build_checks(
            self.graph, effective_spec, pointers, is_v10=is_v10, relative=False
        )
        if checks:
            comp["checks"] = checks

        return [comp, *children]

    async def _build_child_list_item(
        self,
        parent_name: str,
        slot_name: str,
        item_id: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        allow_actions: bool = True,
    ) -> tuple[dict[str, Any], str]:
        """Synthesizes a repeating leaf component for a `CHILD_LIST` slot."""
        array_ptr = next((p for p in pointers if p.value_type == "array"), None)
        array_path = array_ptr.path if array_ptr is not None else f"/{slot_name}"
        rel_pointers = _relative_pointers_for_array(array_ptr, pointers)
        item_spec = await self._choose_child_component(
            intent,
            slot_name,
            parent_name,
            rel_pointers,
            allow_actions=allow_actions,
        )
        item_comp = self._build_leaf_dict(
            item_spec, item_id, intent, rel_pointers, relative=True
        )
        return item_comp, array_path

    async def _build_single_child(
        self,
        parent_name: str,
        slot_name: str,
        child_id: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        allow_actions: bool = True,
    ) -> dict[str, Any]:
        """Synthesizes a scalar-bound leaf component for a `CHILD` slot."""
        scalar_ptrs = [p for p in pointers if p.value_type != "array"] or list(pointers)
        child_spec = await self._choose_child_component(
            intent,
            slot_name,
            parent_name,
            scalar_ptrs,
            allow_actions=allow_actions,
        )
        return self._build_leaf_dict(
            child_spec, child_id, intent, scalar_ptrs, relative=False
        )

    def _select_named_child_specs(
        self,
        parent_name: str,
        *,
        max_items: int,
        allow_actions: bool,
    ) -> list[ComponentNodeSpec]:
        """Selects up to `max_items` leaf specs for a `NAMED_CHILD_ARRAY` slot."""
        raw_leaves = [
            c
            for c in self.graph.leaf_candidates()
            if allow_actions or not c.has_action_slot
        ] or list(self.graph.leaf_candidates())
        if not raw_leaves:
            raw_leaves = [
                c for c in self.graph.root_candidates() if c.name != parent_name
            ]
        cap = min(2, max(1, max_items))
        return raw_leaves[:cap] if len(raw_leaves) >= cap else (raw_leaves * cap)[:cap]

    async def _build_named_child_array(
        self,
        parent_name: str,
        slot: ComponentSlot,
        prefix: str,
        intent: str,
        pointers: Sequence[PointerSummary],
        *,
        max_items: int = 2,
        allow_actions: bool = True,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Synthesizes child leaf views for a `NAMED_CHILD_ARRAY` slot."""
        scalar_ptrs = [p for p in pointers if p.value_type != "array"] or list(pointers)
        chosen_specs = self._select_named_child_specs(
            parent_name, max_items=max_items, allow_actions=allow_actions
        )
        items: list[dict[str, Any]] = []
        children: list[dict[str, Any]] = []
        for idx, child_spec in enumerate(chosen_specs, start=1):
            child_id = f"{prefix}view_{idx}"
            children.append(
                self._build_leaf_dict(
                    child_spec, child_id, intent, scalar_ptrs, relative=False
                )
            )
            entry: dict[str, Any] = {}
            if slot.label_key is not None:
                entry[slot.label_key] = f"{child_spec.name}_{idx}"
            if slot.child_id_key is not None:
                entry[slot.child_id_key] = child_id
            items.append(entry)
        return items, children

    async def _choose_child_component(
        self,
        intent: str,
        slot_name: str,
        parent_name: str,
        child_pointers: Sequence[PointerSummary],
        *,
        allow_actions: bool = True,
    ) -> ComponentNodeSpec:
        """Selects a leaf component for a container slot via backend or pointer fit."""
        raw_candidates = self.graph.leaf_candidates() or self.graph.root_candidates()
        filtered = [c for c in raw_candidates if allow_actions or not c.has_action_slot]
        candidates = tuple(filtered) if filtered else raw_candidates
        if len(candidates) == 1:
            return candidates[0]
        dist = await self.backend.predict(
            DecisionQuery(
                task="child_component",
                prompt=intent,
                candidates=tuple(c.name for c in candidates),
                context={
                    "parent": parent_name,
                    "slot": slot_name,
                    "pointers": [p.path for p in child_pointers],
                },
            )
        )
        top_name, top_prob = dist.top_choice()
        chosen = self.graph.get_component(top_name)
        if (
            chosen is not None
            and not chosen.is_container
            and top_prob > 0.0
            and chosen in candidates
        ):
            return chosen
        return _best_leaf_by_pointer_overlap(candidates, child_pointers)

    def _build_validated_messages(
        self,
        surface_id: str,
        components: list[dict[str, Any]],
        payload: Mapping[str, Any],
    ) -> list[AgentToRendererMessage]:
        """Builds and validates `createSurface`, `updateComponents`, and `updateDataModel`."""
        wire_ver = _wire_version(self.graph.protocol_version)
        create_body: dict[str, Any] = {"surfaceId": surface_id}
        if self.graph.surface_catalog_id is not None:
            create_body["catalogId"] = self.graph.surface_catalog_id

        raw_messages: list[dict[str, Any]] = [
            {"version": wire_ver, "createSurface": create_body},
            {
                "version": wire_ver,
                "updateComponents": {
                    "surfaceId": surface_id,
                    "components": components,
                },
            },
        ]
        if payload:
            raw_messages.append({
                "version": wire_ver,
                "updateDataModel": {
                    "surfaceId": surface_id,
                    "path": "/",
                    "value": dict(payload),
                },
            })
        models = to_message_models(raw_messages)
        validate_payload(self.graph.catalogs, models)
        return models
