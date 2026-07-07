# Copyright 2026 Google LLC
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

import copy
from typing import Any, Callable, Dict, List, Set
from ..common import Subscription
from .component_context import ComponentContext


class GenericBinder:
    """
    Headless Python equivalent of the client-side GenericBinder.
    Provides reactive synchronization of component properties against the active DataModel,
    including on-the-fly evaluation of CheckRule validation logic.
    """

    def __init__(self, context: ComponentContext):
        self.context = context
        self.data_listeners: List[Subscription] = []
        self.listeners: Set[Callable[[Dict[str, Any]], None]] = set()
        self.current_props: Dict[str, Any] = {}
        self.comp_unsub: Any = None

        # Subscribe to component model updates
        sub = self.context.component_model.on_updated.subscribe(
            lambda _: self._rebuild_all_bindings()
        )
        self.comp_unsub = lambda: sub.unsubscribe()

        self._rebuild_all_bindings()

    def _rebuild_all_bindings(self) -> None:
        # Clean up existing data subscriptions
        for listener in self.data_listeners:
            listener.unsubscribe()
        self.data_listeners = []

        raw_props = self.context.component_model.properties
        resolved_props = {}

        # 1. Resolve and bind standard properties
        for k, v in raw_props.items():
            if k != "checks":
                resolved_props[k] = self._bind_property(k, v)

        # 2. Establish active current_props dictionary
        self.current_props = resolved_props

        # 3. Bind checks directly into active current_props
        if "checks" in raw_props:
            checks_val = raw_props["checks"]
            self.current_props["checks"] = checks_val
            self._bind_checks(checks_val)

        self._notify()

    def _bind_property(self, key: str, value: Any) -> Any:
        """Resolves a value and sets up reactive subscriptions if it is dynamic."""
        # Handle Dynamic Binding dicts (e.g. {"path": "/user/name"})
        is_dynamic = (
            isinstance(value, dict)
            and "path" in value
            and isinstance(value["path"], str)
        )
        # Also check for complex function expressions
        is_func = (
            isinstance(value, dict)
            and "call" in value
            and isinstance(value["call"], str)
        )
        # Also check if it's an interpolatable string containing ${...}
        is_interpolatable = isinstance(value, str) and "${" in value

        if is_dynamic or is_func or is_interpolatable:

            def on_change(new_val: Any) -> None:
                self.current_props[key] = new_val
                self._notify()

            bound = self.context.data_context.subscribe_dynamic_value(value, on_change)
            self.data_listeners.append(bound)
            return bound.value

        # Recurse into dictionary/object properties
        if isinstance(value, dict):
            resolved_dict = {}
            for sub_key, sub_val in value.items():
                # For nested dictionary paths, let's just evaluate them synchronously in headless
                resolved_dict[sub_key] = (
                    self.context.data_context.resolve_dynamic_value(sub_val)
                )
            return resolved_dict

        # Recurse into arrays/lists
        if isinstance(value, list):
            return [
                self.context.data_context.resolve_dynamic_value(item) for item in value
            ]

        return value

    def _bind_checks(self, checks: Any) -> None:
        """Sets up reactive validation evaluation for CheckRules."""
        rules = checks if isinstance(checks, list) else []
        if not rules:
            self.current_props["isValid"] = True
            self.current_props["validationErrors"] = []
            return

        rule_results = [{"valid": True, "message": ""} for _ in rules]

        def update_validation_state() -> None:
            errors = [r["message"] for r in rule_results if not r["valid"]]
            self.current_props["isValid"] = len(errors) == 0
            self.current_props["validationErrors"] = errors
            self._notify()

        for index, rule in enumerate(rules):
            condition = rule
            message = "Validation failed"
            if isinstance(rule, dict):
                condition = rule.get("condition", rule)
                message = rule.get("message", "Validation failed")

            rule_results[index]["message"] = message

            def on_rule_change(new_val: Any, idx: int = index) -> None:
                rule_results[idx]["valid"] = bool(new_val)
                update_validation_state()

            bound = self.context.data_context.subscribe_dynamic_value(
                condition, on_rule_change
            )
            self.data_listeners.append(bound)
            rule_results[index]["valid"] = bool(bound.value)

        # Calculate initial validation state
        initial_errors = [r["message"] for r in rule_results if not r["valid"]]
        self.current_props["isValid"] = len(initial_errors) == 0
        self.current_props["validationErrors"] = initial_errors

    def _notify(self) -> None:
        for listener in list(self.listeners):
            try:
                listener(self.current_props)
            except Exception:
                pass

    def subscribe(self, listener: Callable[[Dict[str, Any]], None]) -> Subscription:
        """Registers a listener to receive resolved updates to the component properties."""
        self.listeners.add(listener)
        listener(self.current_props)
        return Subscription(lambda: self.listeners.discard(listener))

    def dispose(self) -> None:
        """Cleans up all active subscriptions."""
        if self.comp_unsub:
            self.comp_unsub()
            self.comp_unsub = None
        for listener in self.data_listeners:
            listener.unsubscribe()
        self.data_listeners = []
        self.listeners = set()
