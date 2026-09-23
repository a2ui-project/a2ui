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

from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Final
from ..common import Subscription
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
DYNAMIC_REF_NAMES: Final[frozenset[str]] = frozenset({
    "DataBinding",
    "DynamicString",
    "DynamicNumber",
    "DynamicBoolean",
    "DynamicStringList",
    "DynamicValue",
})


def _extract_ref_name(ref: str | None) -> str:
    """Extracts target definition name from a $ref URI or pointer."""
    if not ref or not isinstance(ref, str):
        return ""
    hash_idx = ref.rfind("#")
    target = ref[hash_idx + 1 :] if hash_idx != -1 else ref
    parts = [p for p in target.split("/") if p]
    return parts[-1] if parts else ""


def _classify_combiners(schema: dict[str, Any]) -> BehaviorNode | None:
    """Classifies oneOf/anyOf/allOf combiners into a BehaviorNode if recognized."""
    for comb in ("oneOf", "anyOf", "allOf"):
        branches = schema.get(comb)
        if isinstance(branches, list):
            for branch in branches:
                if isinstance(branch, dict):
                    node = classify_schema_behavior(branch)
                    if node.type in (
                        BehaviorType.CHECKABLE,
                        BehaviorType.ACTION,
                        BehaviorType.STRUCTURAL,
                        BehaviorType.DYNAMIC,
                    ):
                        return node
    return None


def _classify_container(schema: dict[str, Any]) -> BehaviorNode | None:
    """Classifies object or array schemas into structured BehaviorNodes."""
    schema_type = schema.get("type")
    if schema_type == "array" or "items" in schema:
        items = schema.get("items")
        elem_node = (
            classify_schema_behavior(items)
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
                k: classify_schema_behavior(v)
                for k, v in props.items()
                if isinstance(v, dict)
            }
            return BehaviorNode(BehaviorType.OBJECT, shape=shape)

    return None


def classify_schema_behavior(schema: Any) -> BehaviorNode:
    """Classifies a JSON Schema dictionary into a runtime BehaviorNode."""
    if not isinstance(schema, dict):
        return BehaviorNode(BehaviorType.STATIC)

    ref = schema.get("$ref")
    if isinstance(ref, str):
        ref_name = _extract_ref_name(ref)
        if ref_name in CHECKABLE_REF_NAMES:
            return BehaviorNode(BehaviorType.CHECKABLE)
        if ref_name in ACTION_REF_NAMES:
            return BehaviorNode(BehaviorType.ACTION)
        if ref_name in STRUCTURAL_REF_NAMES:
            return BehaviorNode(BehaviorType.STRUCTURAL)
        if ref_name in DYNAMIC_REF_NAMES or ref_name.startswith("Dynamic"):
            return BehaviorNode(BehaviorType.DYNAMIC)

    combiner = _classify_combiners(schema)
    if combiner is not None:
        return combiner

    container = _classify_container(schema)
    if container is not None:
        return container

    return BehaviorNode(BehaviorType.STATIC)


def _classify_value_fallback(key: str, val: Any) -> BehaviorNode:
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
        if "path" in val or "call" in val:
            return BehaviorNode(BehaviorType.DYNAMIC)
        if "event" in val or "functionCall" in val:
            return BehaviorNode(BehaviorType.ACTION)
        shape = {k: _classify_value_fallback(k, v) for k, v in val.items()}
        return BehaviorNode(BehaviorType.OBJECT, shape=shape)

    if isinstance(val, list):
        elem = (
            _classify_value_fallback("", val[0])
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
    ):
        self.context = context
        self.data_listeners: list[Subscription] = []
        self.listeners: set[Callable[[dict[str, Any]], None]] = set()
        self.current_props: dict[str, Any] = {}
        self.comp_unsub: Callable[[], None] | None = None
        self._action_closures: dict[str, tuple[Any, Callable[[], None]]] = {}

        resolved_schema = schema
        cat = context.component_model.catalog
        if (
            resolved_schema is None
            and cat is not None
            and hasattr(cat, "get_component")
        ):
            comp_api = cat.get_component(context.component_model.type)
            if comp_api is not None:
                resolved_schema = getattr(comp_api, "schema", None)

        self.behavior_tree = (
            classify_schema_behavior(resolved_schema)
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

        for k, v in val_obj.items():
            child_behavior = shape.get(k) or _classify_value_fallback(k, v)
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
                and _classify_value_fallback(k, raw_val).type == BehaviorType.DYNAMIC
            )
            if is_dynamic and k:
                setter_name = f"set{k[0].upper() + k[1:]}"
                result[setter_name] = self._create_setter(raw_val)

    def _create_setter(self, raw_val: Any) -> Callable[[Any], None]:
        def setter(new_value: Any) -> None:
            if isinstance(raw_val, dict) and "path" in raw_val:
                path_val = raw_val["path"]
                if isinstance(path_val, str):
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
            return value

        if behavior.type == BehaviorType.CHECKABLE:
            return self._bind_checkable(value, parent_dict, is_sync)

        if behavior.type == BehaviorType.ARRAY:
            if not isinstance(value, list):
                return value
            elem_behavior = behavior.element or BehaviorNode(BehaviorType.STATIC)
            return [
                self._resolve_and_bind(
                    item, elem_behavior, {}, str(i), [*path, str(i)], is_sync
                )
                for i, item in enumerate(value)
            ]

        if behavior.type == BehaviorType.OBJECT:
            if not isinstance(value, dict):
                return value
            return self._bind_object(value, behavior.shape or {}, path, is_sync)

        return value

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

    def _bind_action(self, value: Any, path: list[str]) -> Callable[[], None]:
        cache_key = "/".join(path)
        cached = self._action_closures.get(cache_key)
        if cached is not None and cached[0] == value:
            return cached[1]

        def closure() -> None:
            resolved = self.context.data_context.resolve_action(value)
            self.context.dispatch_action(resolved)

        self._action_closures[cache_key] = (value, closure)
        return closure

    def _bind_checkable(
        self, value: Any, parent_dict: dict[str, Any], is_sync: bool
    ) -> Any:
        rules = value if isinstance(value, list) else []
        rule_results: list[dict[str, Any]] = [
            {"valid": True, "message": ""} for _ in rules
        ]

        from ..schema.v1_0.catalog_definition import ValidationResult

        def _process_rule_val(val: Any, fallback_msg: str | None) -> dict[str, Any]:
            if isinstance(val, dict):
                raw = dict(val)
            elif hasattr(val, "valid"):
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
                return vr.model_dump(exclude_none=True)
            except Exception:
                return {"valid": False, "message": fallback_msg or "Validation failed"}

        def update_validation_state() -> None:
            failed_rules = [r for r in rule_results if not r["valid"]]
            parent_dict["isValid"] = len(failed_rules) == 0
            parent_dict["validationErrors"] = [
                r["message"] for r in failed_rules if r.get("message")
            ]
            parent_dict["validationResult"] = (
                failed_rules[0] if failed_rules else {"valid": True}
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
                    rule_results[i] = _process_rule_val(new_val, fallback)
                    update_validation_state()

                return on_change

            bound = self.context.data_context.subscribe_dynamic_value(
                condition, make_on_change(idx, message)
            )
            if not is_sync:
                self.data_listeners.append(bound)
            else:
                bound.unsubscribe()

            rule_results[idx] = _process_rule_val(bound.value, message)

        initial_failed = [r for r in rule_results if not r["valid"]]
        parent_dict["isValid"] = len(initial_failed) == 0
        parent_dict["validationErrors"] = [
            r["message"] for r in initial_failed if r.get("message")
        ]
        parent_dict["validationResult"] = (
            initial_failed[0] if initial_failed else {"valid": True}
        )
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
