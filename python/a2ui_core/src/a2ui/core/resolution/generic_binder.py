# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum
from functools import cache
from typing import Any, Callable, Final
from ..common import Subscription
from ..schema._dynamic_types import dynamic_literal_kinds
from ..schema.common_types_schema import get_all_dynamic_type_names
from .component_context import ComponentContext


class BehaviorType(str, Enum):
    """Runtime behavior type classification for component properties."""

    DYNAMIC = "DYNAMIC"
    ACTION = "ACTION"
    STRUCTURAL = "STRUCTURAL"
    CHECKABLE = "CHECKABLE"
    STATIC = "STATIC"
    OBJECT = "OBJECT"
    ARRAY = "ARRAY"


@dataclass(frozen=True)
class BehaviorNode:
    """Represents a classification node in the schema behavior tree."""

    type: BehaviorType
    shape: dict[str, BehaviorNode] | None = None
    element: BehaviorNode | None = None


CHECKABLE_REF_NAMES: Final[frozenset[str]] = frozenset({"Checkable", "CheckRule"})
ACTION_REF_NAMES: Final[frozenset[str]] = frozenset({"Action"})
STRUCTURAL_REF_NAMES: Final[frozenset[str]] = frozenset({
    "ChildList",
    "ComponentId",
    "Child",
    "TemplateChildList",
})


@cache
def _dynamic_ref_names() -> frozenset[str]:
    """Returns the defs that bind to dynamic values.

    These are `DataBinding` plus every dynamic value def (e.g. `DynamicString`)
    identified structurally in the generated common_types schemas.
    """
    return frozenset({"DataBinding"}) | get_all_dynamic_type_names()


def _extract_ref_name(ref: str | None) -> str:
    """Extracts target definition name from a $ref URI or pointer."""
    if not ref or not isinstance(ref, str):
        return ""
    hash_idx = ref.rfind("#")
    target = ref[hash_idx + 1 :] if hash_idx != -1 else ref
    parts = [p for p in target.split("/") if p]
    return parts[-1] if parts else ""


def _localize_branch_refs(node: Any) -> Any:
    """Rewrites the `$ref`s of a union branch as local `#/$defs/<name>` pointers.

    Catalogs may reference shared types across documents (e.g.
    `common_types.json#/$defs/DataBinding`); dynamic unions are recognized by
    local refs.
    """
    if isinstance(node, list):
        return [_localize_branch_refs(item) for item in node]
    if not isinstance(node, dict):
        return node
    return {
        k: (
            f"#/$defs/{_extract_ref_name(v)}"
            if k == "$ref" and isinstance(v, str)
            else _localize_branch_refs(v)
        )
        for k, v in node.items()
    }


def _is_dynamic_def(def_schema: Any) -> bool:
    """Returns whether a def is a dynamic value union (e.g. `DynamicDate`).

    Such a def accepts a `DataBinding`, a `FunctionCall`, and literal values.
    """
    if not isinstance(def_schema, Mapping):
        return False
    items = def_schema.get("oneOf", def_schema.get("anyOf"))
    if not isinstance(items, list):
        return False
    return dynamic_literal_kinds(_localize_branch_refs(items)) is not None


_SPECIAL_BEHAVIORS: Final[frozenset[BehaviorType]] = frozenset({
    BehaviorType.CHECKABLE,
    BehaviorType.ACTION,
    BehaviorType.STRUCTURAL,
    BehaviorType.DYNAMIC,
})


def _merge_all_of_branch(
    branch: Any,
    defs: Mapping[str, Any],
    merged_shape: dict[str, BehaviorNode],
) -> BehaviorNode | None:
    """Merges one allOf branch into merged_shape and returns any special BehaviorNode."""
    if not isinstance(branch, dict):
        return None
    if _extract_ref_name(branch.get("$ref")) == "Checkable":
        merged_shape["checks"] = BehaviorNode(BehaviorType.CHECKABLE)
        return BehaviorNode(BehaviorType.CHECKABLE)
    node = classify_schema_behavior(branch, defs)
    if node.type == BehaviorType.OBJECT and node.shape:
        merged_shape.update(node.shape)
        return None
    return node if node.type in _SPECIAL_BEHAVIORS else None


def _classify_all_of(
    schema: dict[str, Any], defs: Mapping[str, Any], all_of: list[Any]
) -> BehaviorNode | None:
    """Classifies an allOf combiner into a merged OBJECT or special BehaviorNode."""
    merged_shape: dict[str, BehaviorNode] = {}
    first_special: BehaviorNode | None = None
    for branch in all_of:
        special = _merge_all_of_branch(branch, defs, merged_shape)
        if special is not None and first_special is None:
            first_special = special
    own_props = schema.get("properties")
    if isinstance(own_props, dict):
        for k, v in own_props.items():
            if isinstance(v, dict):
                merged_shape[k] = classify_schema_behavior(v, defs)
    if merged_shape:
        return BehaviorNode(BehaviorType.OBJECT, shape=merged_shape)
    return first_special


def _classify_combiners(
    schema: dict[str, Any], defs: Mapping[str, Any]
) -> BehaviorNode | None:
    """Classifies oneOf/anyOf/allOf combiners into a BehaviorNode if recognized."""
    one_of = schema.get("oneOf")
    any_of = schema.get("anyOf")
    branches = (one_of if isinstance(one_of, list) else []) + (
        any_of if isinstance(any_of, list) else []
    )
    for branch in branches:
        if isinstance(branch, dict):
            node = classify_schema_behavior(branch, defs)
            if node.type in _SPECIAL_BEHAVIORS:
                return node

    all_of = schema.get("allOf")
    if isinstance(all_of, list):
        return _classify_all_of(schema, defs, all_of)

    return None


def _classify_container(
    schema: dict[str, Any], defs: Mapping[str, Any]
) -> BehaviorNode | None:
    """Classifies object or array schemas into structured BehaviorNodes."""
    schema_type = schema.get("type")
    if schema_type == "array" or "items" in schema:
        items = schema.get("items")
        elem_node = (
            classify_schema_behavior(items, defs)
            if isinstance(items, dict)
            else BehaviorNode(BehaviorType.STATIC)
        )
        if elem_node.type == BehaviorType.CHECKABLE:
            return BehaviorNode(BehaviorType.CHECKABLE)
        return BehaviorNode(BehaviorType.ARRAY, element=elem_node)

    if schema_type == "object" or "properties" in schema:
        props = schema.get("properties")
        if isinstance(props, dict):
            if "componentId" in props and ("path" in props or "dataBinding" in props):
                return BehaviorNode(BehaviorType.STRUCTURAL)
            if "explicitList" in props or "template" in props:
                return BehaviorNode(BehaviorType.STRUCTURAL)
            if "condition" in props:
                return BehaviorNode(BehaviorType.CHECKABLE)
            shape = {
                k: classify_schema_behavior(v, defs)
                for k, v in props.items()
                if isinstance(v, dict)
            }
            return BehaviorNode(BehaviorType.OBJECT, shape=shape)

    return None


def classify_schema_behavior(
    schema: Any, defs: Mapping[str, Any] | None = None
) -> BehaviorNode:
    """Classifies a JSON Schema dictionary into a runtime BehaviorNode.

    Args:
        schema: The schema to classify.
        defs: The `$defs` that `$ref`s resolve against. Defaults to the
            schema's own `$defs`.
    """
    if not isinstance(schema, dict):
        return BehaviorNode(BehaviorType.STATIC)
    if defs is None:
        own_defs = schema.get("$defs")
        defs = own_defs if isinstance(own_defs, Mapping) else {}

    ref = schema.get("$ref")
    if isinstance(ref, str):
        ref_name = _extract_ref_name(ref)
        if ref_name in CHECKABLE_REF_NAMES:
            return BehaviorNode(BehaviorType.CHECKABLE)
        if ref_name in ACTION_REF_NAMES:
            return BehaviorNode(BehaviorType.ACTION)
        if ref_name in STRUCTURAL_REF_NAMES:
            return BehaviorNode(BehaviorType.STRUCTURAL)
        if ref_name in _dynamic_ref_names():
            return BehaviorNode(BehaviorType.DYNAMIC)
        # A catalog-defined dynamic def (e.g. `DynamicDate`) is recognized by
        # the shape of the def it references.
        if "$defs/" in ref and _is_dynamic_def(defs.get(ref_name)):
            return BehaviorNode(BehaviorType.DYNAMIC)

    combiner = _classify_combiners(schema, defs)
    if combiner is not None:
        return combiner

    container = _classify_container(schema, defs)
    if container is not None:
        return container

    return BehaviorNode(BehaviorType.STATIC)


def _schema_defs(catalog: Any, schema: Any) -> dict[str, Any]:
    """Returns the defs that a component schema's `$ref`s resolve against.

    These are the catalog's defs, overridden by the schema's own `$defs`.
    """
    defs: dict[str, Any] = {}
    catalog_defs = getattr(catalog, "defs", None)
    if isinstance(catalog_defs, Mapping):
        defs.update(catalog_defs)
    own_defs = schema.get("$defs") if isinstance(schema, Mapping) else None
    if isinstance(own_defs, Mapping):
        defs.update(own_defs)
    return defs


def _classify_value_fallback(
    key: str, val: Any, at_least_v10: bool = False
) -> BehaviorNode:
    """Fallback classification derived dynamically from property key and value shapes."""
    if key == "checks" or (
        isinstance(val, list)
        and val
        and isinstance(val[0], dict)
        and "condition" in val[0]
    ):
        return BehaviorNode(BehaviorType.CHECKABLE)

    if isinstance(val, dict):
        if "condition" in val:
            return BehaviorNode(BehaviorType.CHECKABLE)
        if "componentId" in val and ("path" in val or "dataBinding" in val):
            return BehaviorNode(BehaviorType.STRUCTURAL)
        if at_least_v10:
            if "@path" in val or "@call" in val:
                return BehaviorNode(BehaviorType.DYNAMIC)
        else:
            if "path" in val or "call" in val:
                return BehaviorNode(BehaviorType.DYNAMIC)
        if "event" in val or "functionCall" in val:
            return BehaviorNode(BehaviorType.ACTION)
        shape = {
            k: _classify_value_fallback(k, v, at_least_v10=at_least_v10)
            for k, v in val.items()
        }
        return BehaviorNode(BehaviorType.OBJECT, shape=shape)

    if isinstance(val, list):
        elem = (
            _classify_value_fallback("", val[0], at_least_v10=at_least_v10)
            if val
            else BehaviorNode(BehaviorType.STATIC)
        )
        return BehaviorNode(BehaviorType.ARRAY, element=elem)

    if isinstance(val, str) and "${" in val:
        return BehaviorNode(BehaviorType.DYNAMIC)

    return BehaviorNode(BehaviorType.STATIC)


class GenericBinder:
    """Headless Python equivalent of the client-side GenericBinder.

    Provides schema-driven reactive synchronization of component properties
    against the active DataModel, two-way setter generation, and CheckRule validation.
    """

    def __init__(
        self,
        context: ComponentContext,
        schema: dict[str, Any] | None = None,
        expand_templates: bool = False,
    ):
        self.context = context
        self.expand_templates = expand_templates
        self.data_listeners: list[Subscription] = []
        self.listeners: set[Callable[[dict[str, Any]], None]] = set()
        self.current_props: dict[str, Any] = {}
        self.comp_unsub: Callable[[], None] | None = None
        self._action_closures: dict[str, tuple[Any, Callable[[], Any]]] = {}

        resolved_schema = schema
        cat = context.component_model.catalog
        if resolved_schema is None and cat is not None:
            resolve_fn = getattr(cat, "resolved_component_schema", None)
            if callable(resolve_fn):
                resolved_schema = resolve_fn(context.component_model.type)
            if resolved_schema is None and hasattr(cat, "get_component"):
                comp_api = cat.get_component(context.component_model.type)
                if comp_api is not None:
                    resolved_schema = getattr(comp_api, "schema", None)
            if isinstance(resolved_schema, type) and hasattr(
                resolved_schema, "model_json_schema"
            ):
                resolved_schema = resolved_schema.model_json_schema()

        self.behavior_tree = (
            classify_schema_behavior(
                resolved_schema, _schema_defs(cat, resolved_schema)
            )
            if isinstance(resolved_schema, dict)
            else BehaviorNode(BehaviorType.OBJECT, shape={})
        )
        if self.behavior_tree.type != BehaviorType.OBJECT:
            self.behavior_tree = BehaviorNode(BehaviorType.OBJECT, shape={})

        sub = self.context.component_model.on_updated.subscribe(
            lambda _: self._rebuild_all_bindings()
        )
        self.comp_unsub = lambda: sub.unsubscribe()

        self._rebuild_all_bindings()

    @property
    def snapshot(self) -> dict[str, Any]:
        """Returns the current snapshot of resolved properties."""
        return self.current_props

    def _rebuild_all_bindings(self) -> None:
        for listener in self.data_listeners:
            listener.unsubscribe()
        self.data_listeners = []

        raw_props = self.context.component_model.properties or {}
        shape = self.behavior_tree.shape or {}

        resolved_props = self._bind_object(raw_props, shape, [], is_sync=False)
        self.current_props = resolved_props
        self._notify()

    def _bind_object(
        self,
        val_obj: dict[str, Any],
        shape: dict[str, BehaviorNode],
        path: list[str],
        is_sync: bool,
    ) -> dict[str, Any]:
        result: dict[str, Any] = {}

        ordered_items = sorted(
            val_obj.items(), key=lambda kv: (0 if kv[0] == "checks" else 1)
        )
        for k, v in ordered_items:
            child_behavior = shape.get(k) or _classify_value_fallback(
                k, v, at_least_v10=self.context.data_context.at_least_v10
            )
            result[k] = self._resolve_and_bind(
                v, child_behavior, result, k, [*path, k], is_sync
            )

        self._generate_two_way_setters(val_obj, shape, result)
        return result

    def _generate_two_way_setters(
        self,
        val_obj: dict[str, Any],
        shape: dict[str, BehaviorNode],
        result: dict[str, Any],
    ) -> None:
        candidate_keys = set(shape.keys()) | set(val_obj.keys())
        for k in candidate_keys:
            behavior = shape.get(k)
            raw_val = val_obj.get(k)
            is_dynamic = (
                behavior is not None and behavior.type == BehaviorType.DYNAMIC
            ) or (
                raw_val is not None
                and _classify_value_fallback(
                    k, raw_val, at_least_v10=self.context.data_context.at_least_v10
                ).type
                == BehaviorType.DYNAMIC
            )
            if is_dynamic and k:
                setter_name = f"set{k[0].upper() + k[1:]}"
                result[setter_name] = self._create_setter(raw_val)

    def _create_setter(self, raw_val: Any) -> Callable[[Any], None]:
        def setter(new_value: Any) -> None:
            if isinstance(raw_val, dict):
                binding_key = (
                    "@path" if self.context.data_context.at_least_v10 else "path"
                )
                path_val = raw_val.get(binding_key)
                if isinstance(path_val, str) and (
                    self.context.data_context.at_least_v10
                    or "componentId" not in raw_val
                ):
                    self.context.data_context.set(path_val, new_value)

        return setter

    def _resolve_and_bind(
        self,
        value: Any,
        behavior: BehaviorNode,
        parent_dict: dict[str, Any],
        key: str,
        path: list[str],
        is_sync: bool,
    ) -> Any:
        if value is None:
            return None

        if behavior.type == BehaviorType.DYNAMIC:
            return self._bind_dynamic_value(value, path, is_sync)

        if behavior.type == BehaviorType.ACTION:
            return self._bind_action(value, path)

        if behavior.type == BehaviorType.STRUCTURAL:
            return (
                self._bind_structural_template(value, path, is_sync)
                if self.expand_templates and isinstance(value, dict)
                else value
            )

        if behavior.type == BehaviorType.CHECKABLE:
            return self._bind_checkable(value, parent_dict, path, is_sync)

        if behavior.type == BehaviorType.ARRAY:
            return self._bind_array(value, behavior, path, is_sync)

        if behavior.type == BehaviorType.OBJECT and isinstance(value, dict):
            return self._bind_object(value, behavior.shape or {}, path, is_sync)

        return value

    def _bind_array(
        self,
        value: Any,
        behavior: BehaviorNode,
        path: list[str],
        is_sync: bool,
    ) -> Any:
        if not isinstance(value, list):
            return value
        elem_behavior = behavior.element or BehaviorNode(BehaviorType.STATIC)
        return [
            self._resolve_and_bind(
                item, elem_behavior, {}, str(i), [*path, str(i)], is_sync
            )
            for i, item in enumerate(value)
        ]

    def _bind_structural_template(
        self, value: dict[str, Any], path: list[str], is_sync: bool
    ) -> Any:
        template_obj = value.get("template") if "template" in value else value
        if not isinstance(template_obj, dict) or "componentId" not in template_obj:
            return value
        comp_id = template_obj.get("componentId")
        template_path = (
            template_obj.get("@path")
            if self.context.data_context.at_least_v10
            else template_obj.get("path") or template_obj.get("dataBinding")
        )
        if not isinstance(comp_id, str) or not isinstance(template_path, str):
            return value
        binding_expr = (
            {"@path": template_path}
            if self.context.data_context.at_least_v10
            else {"path": template_path}
        )

        def map_items(arr: Any) -> list[dict[str, Any]]:
            if not isinstance(arr, list):
                return []
            list_ctx = self.context.data_context.nested(template_path)
            return [
                {
                    "id": comp_id,
                    "basePath": list_ctx.nested(str(i)).path.rstrip("/") or "/",
                }
                for i in range(len(arr))
            ]

        def on_change(new_val: Any) -> None:
            self._update_deep_value(path, map_items(new_val))
            self._notify()

        bound = self.context.data_context.subscribe_dynamic_value(
            binding_expr, on_change
        )
        if not is_sync:
            self.data_listeners.append(bound)
        else:
            bound.unsubscribe()
        return map_items(bound.value)

    def _update_deep_value(self, path: list[str], new_value: Any) -> None:
        if not path:
            return
        curr: Any = self.current_props
        for seg in path[:-1]:
            if isinstance(curr, list) and seg.isdigit():
                idx = int(seg)
                if idx < len(curr):
                    curr = curr[idx]
                    continue
                return
            if isinstance(curr, dict) and seg in curr:
                curr = curr[seg]
                continue
            return
        last = path[-1]
        if isinstance(curr, list) and last.isdigit():
            idx = int(last)
            if idx < len(curr):
                curr[idx] = new_value
        elif isinstance(curr, dict):
            curr[last] = new_value

    def _bind_dynamic_value(self, value: Any, path: list[str], is_sync: bool) -> Any:
        def on_change(new_val: Any) -> None:
            self._update_deep_value(path, new_val)
            self._notify()

        bound = self.context.data_context.subscribe_dynamic_value(value, on_change)
        if not is_sync:
            self.data_listeners.append(bound)
        else:
            bound.unsubscribe()
        return bound.value

    def _bind_action(self, value: Any, path: list[str]) -> Callable[[], Any]:
        cache_key = "/".join(path)
        cached = self._action_closures.get(cache_key)
        if cached is not None and cached[0] == value:
            return cached[1]

        def closure() -> Any:
            if isinstance(value, dict):
                fc = (
                    value["functionCall"]
                    if isinstance(value.get("functionCall"), dict)
                    else value
                )
                call_name = fc.get("@call") or fc.get("call")
                if isinstance(call_name, str):
                    return self.context.data_context.resolve_dynamic_value(fc)
            resolved = self.context.data_context.resolve_action(value)
            return self.context.dispatch_action(resolved)

        self._action_closures[cache_key] = (value, closure)
        return closure

    @staticmethod
    def _process_rule_val(val: Any, fallback_msg: str | None) -> dict[str, Any]:
        from ..schema.v1_0.catalog_definition import ValidationResult

        is_obj = False
        if isinstance(val, dict):
            is_obj = "severity" in val or "code" in val
            raw = dict(val)
        elif hasattr(val, "valid"):
            is_obj = True
            raw = {
                k: getattr(val, k)
                for k in ("valid", "code", "message", "severity")
                if hasattr(val, k)
            }
        else:
            raw = {"valid": bool(val)}

        if not raw.get("valid") and not raw.get("message") and fallback_msg:
            raw["message"] = fallback_msg

        try:
            vr = ValidationResult.model_validate(raw)
            dumped = vr.model_dump(exclude_none=True)
        except Exception:
            dumped = {"valid": False, "message": fallback_msg or "Validation failed"}

        if not dumped.get("valid") and "severity" not in dumped:
            dumped["severity"] = "error"
        dumped["_is_obj"] = is_obj
        return dumped

    @staticmethod
    def _compute_validation_summary(
        rule_results: list[dict[str, Any]],
    ) -> tuple[bool, list[str], list[dict[str, Any]], dict[str, Any]]:
        failed_rules = [r for r in rule_results if not r["valid"]]
        error_rules = [
            r for r in failed_rules if r.get("severity", "error") == "error"
        ]
        is_valid = len(error_rules) == 0
        validation_errors = [r["message"] for r in error_rules if r.get("message")]
        validation_results = [
            {k: v for k, v in r.items() if k != "_is_obj"} for r in failed_rules
        ]
        if not failed_rules:
            return is_valid, validation_errors, validation_results, {"valid": True}
        first_res = {k: v for k, v in failed_rules[0].items() if k != "_is_obj"}
        if not failed_rules[0].get("_is_obj"):
            first_res.pop("severity", None)
        return is_valid, validation_errors, validation_results, first_res

    def _bind_checkable(
        self,
        value: Any,
        parent_dict: dict[str, Any],
        path: list[str],
        is_sync: bool,
    ) -> Any:
        rules = value if isinstance(value, list) else []
        rule_results: list[dict[str, Any]] = [
            {"valid": True, "message": "", "severity": "error"} for _ in rules
        ]
        parent_path = path[:-1]

        def _apply_validation_state(reactive: bool) -> None:
            (
                is_valid,
                validation_errors,
                validation_results,
                validation_result,
            ) = self._compute_validation_summary(rule_results)
            parent_dict["isValid"] = is_valid
            parent_dict["validationErrors"] = validation_errors
            parent_dict["validationResults"] = validation_results
            parent_dict["validationResult"] = validation_result
            if reactive:
                self._update_deep_value([*parent_path, "isValid"], is_valid)
                self._update_deep_value(
                    [*parent_path, "validationErrors"], validation_errors
                )
                self._update_deep_value(
                    [*parent_path, "validationResults"], validation_results
                )
                self._update_deep_value(
                    [*parent_path, "validationResult"], validation_result
                )
                self._notify()

        for idx, rule in enumerate(rules):
            condition = rule
            message = "Validation failed"
            if isinstance(rule, dict):
                condition = rule.get("condition", rule)
                message = rule.get("message", "Validation failed")

            rule_results[idx]["message"] = message

            def make_on_change(i: int, fallback: str) -> Callable[[Any], None]:
                def on_change(new_val: Any) -> None:
                    rule_results[i] = self._process_rule_val(new_val, fallback)
                    _apply_validation_state(reactive=True)

                return on_change

            bound = self.context.data_context.subscribe_dynamic_value(
                condition, make_on_change(idx, message)
            )
            if not is_sync:
                self.data_listeners.append(bound)
            else:
                bound.unsubscribe()

            rule_results[idx] = self._process_rule_val(bound.value, message)

        _apply_validation_state(reactive=False)
        return value

    def _notify(self) -> None:
        for listener in list(self.listeners):
            try:
                listener(self.current_props)
            except Exception:
                pass

    def subscribe(self, listener: Callable[[dict[str, Any]], None]) -> Subscription:
        """Registers a listener to receive resolved updates to the component properties."""
        self.listeners.add(listener)
        listener(self.current_props)
        return Subscription(lambda: self.listeners.discard(listener))

    def dispose(self) -> None:
        """Cleans up all active subscriptions."""
        if self.comp_unsub is not None:
            self.comp_unsub()
            self.comp_unsub = None
        for listener in self.data_listeners:
            listener.unsubscribe()
        self.data_listeners = []
        self.listeners.clear()
        self._action_closures.clear()
