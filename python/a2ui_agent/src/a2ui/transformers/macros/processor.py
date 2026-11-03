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

"""Runtime expansion processor for A2UI macros."""

import types
from collections.abc import Sequence as AbcSequence
from typing import Any, Optional, Sequence, Union, get_args, get_origin

from a2ui.builder import v0_9 as _v0_9, v1_0 as _v1_0
from a2ui.builder.core import (
    ComponentBuilderNode,
    ComponentRef,
    flatten_component_tree,
)
from a2ui.builder.v0_9 import (
    AccessibilityAttributes,
    Action,
    ActionEvent,
    DataBinding,
)
from a2ui.transformers.macros.macro import _MacroMetadata

_ACTION_TYPES = (Action, _v1_0.Action)
_ACCESSIBILITY_TYPES = (AccessibilityAttributes, _v1_0.AccessibilityAttributes)
_DATA_BINDING_TYPES = (DataBinding, _v1_0.DataBinding)


def _uses_v1_0(meta: _MacroMetadata) -> bool:
    ret = meta.return_type
    if isinstance(ret, type) and issubclass(ret, _v1_0.ComponentBuilderNode):
        return True
    for param in meta.parameters.values():
        t = param.type_hint
        if t in (
            _v1_0.Action,
            _v1_0.AccessibilityAttributes,
            _v1_0.DataBinding,
            _v1_0.DynamicString,
            _v1_0.DynamicNumber,
            _v1_0.DynamicBoolean,
            _v1_0.DynamicStringList,
            _v1_0.DynamicValue,
        ):
            return True
    return False


def _is_component_type(t: Any) -> bool:
    origin = get_origin(t)
    args = get_args(t)
    if origin is Union or (hasattr(types, "UnionType") and origin is types.UnionType):
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            return _is_component_type(non_none[0])
        return any(_is_component_type(a) for a in non_none)
    if t in (ComponentBuilderNode, ComponentRef):
        return True
    if isinstance(t, type) and issubclass(t, ComponentBuilderNode):
        return True
    return False


def _is_component_sequence_type(t: Any) -> bool:
    origin = get_origin(t)
    args = get_args(t)
    if origin is Union or (hasattr(types, "UnionType") and origin is types.UnionType):
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            return _is_component_sequence_type(non_none[0])
        return any(_is_component_sequence_type(a) for a in non_none)
    if (
        origin in (list, Sequence, AbcSequence, tuple, set)
        or (
            isinstance(origin, type)
            and issubclass(origin, (list, tuple, set, AbcSequence))
        )
    ) and args:
        return _is_component_type(args[0])
    return False


def _is_action_type(t: Any) -> bool:
    origin = get_origin(t)
    args = get_args(t)
    if origin is Union or (hasattr(types, "UnionType") and origin is types.UnionType):
        non_none = [a for a in args if a is not type(None)]
        return any(_is_action_type(a) for a in non_none)
    if t in _ACTION_TYPES:
        return True
    if isinstance(t, type) and issubclass(t, _ACTION_TYPES):
        return True
    return False


def _is_accessibility_type(t: Any) -> bool:
    origin = get_origin(t)
    args = get_args(t)
    if origin is Union or (hasattr(types, "UnionType") and origin is types.UnionType):
        non_none = [a for a in args if a is not type(None)]
        return any(_is_accessibility_type(a) for a in non_none)
    if t in _ACCESSIBILITY_TYPES:
        return True
    if isinstance(t, type) and issubclass(t, _ACCESSIBILITY_TYPES):
        return True
    return False


def _coerce_action(
    value: dict[str, Any],
    action_cls: Any = Action,
    action_event_cls: Any = ActionEvent,
) -> Any:
    """Builds an Action from the shapes inference output uses for one.

    Three forms show up in practice and all mean the same thing: the wire
    form ``{"event": {"name": ...}}``, the abbreviated ``{"event": "name"}``,
    and a bare event body ``{"name": ..., "context": ...}``. Anything else -
    notably ``{"functionCall": ...}`` - is already the wire form and is handed
    to Pydantic to validate.
    """
    inner = value.get("event")
    if isinstance(inner, str):
        return action_cls(event=action_event_cls(name=inner))
    if not {"event", "functionCall", "function_call"} & value.keys():
        return action_cls(event=action_event_cls.model_validate(value))
    return action_cls.model_validate(value)


class _MacroProcessor:
    """Executes registered macros and flattens them into standard A2UI components."""

    def __init__(self, macros: Optional[dict[str, _MacroMetadata]] = None):
        self._macros = macros or {}

    def has_macro(self, macro_name: str) -> bool:
        """Checks if a macro is registered by name."""
        return macro_name in self._macros

    def expand(
        self,
        macro_name: str,
        args: dict[str, Any],
        instance_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Executes a macro by name with provided arguments and returns flat component dicts.

        Args:
            macro_name: The registered macro function name.
            args: Keyword arguments for the macro invocation.
            instance_id: The ID assigned to this macro component instance (becomes root component ID).

        Returns:
            List of standard A2UI component dictionaries ready for surfaceUpdate.
        """
        root_id = instance_id
        meta = self._macros.get(macro_name)
        if meta is None:
            raise KeyError(f"Macro '{macro_name}' is not registered.")

        is_v1_0 = _uses_v1_0(meta)
        data_binding_cls = _v1_0.DataBinding if is_v1_0 else DataBinding
        action_cls = _v1_0.Action if is_v1_0 else Action
        action_event_cls = _v1_0.ActionEvent if is_v1_0 else ActionEvent
        accessibility_cls = (
            _v1_0.AccessibilityAttributes if is_v1_0 else AccessibilityAttributes
        )

        # Coerce parameters from incoming JSON values to rich builder AST types
        coerced_args: dict[str, Any] = {}
        for p_name, p_val in args.items():
            if p_name in meta.parameters:
                p_meta = meta.parameters[p_name]
                t = p_meta.type_hint

                # 1. Coerce single child slot from string ID to ComponentRef
                if isinstance(p_val, str) and _is_component_type(t):
                    coerced_args[p_name] = ComponentRef(id=p_val)

                # 2. Coerce child slot list from sequence of IDs to ComponentRefs
                elif isinstance(p_val, (list, tuple)) and _is_component_sequence_type(
                    t
                ):
                    coerced_args[p_name] = [
                        ComponentRef(id=x) if isinstance(x, str) else x for x in p_val
                    ]

                # 3. Coerce DataBinding dictionary: {"path": "/..."} or {"@path": "/..."}
                elif (
                    isinstance(p_val, dict)
                    and ("path" in p_val or "@path" in p_val)
                    and len(p_val) == 1
                    and not isinstance(p_val, _DATA_BINDING_TYPES)
                ):
                    path_val = p_val["path"] if "path" in p_val else p_val["@path"]
                    coerced_args[p_name] = data_binding_cls(path=path_val)

                # 4. Coerce Action shorthands.
                #
                # Action itself deliberately has no string shorthand: a
                # before-validator accepting one would be invisible to a type
                # checker. Inference output is not type-checked, though, so the
                # shorthands an LLM naturally emits are mapped here instead.
                elif isinstance(p_val, str) and _is_action_type(t):
                    coerced_args[p_name] = action_cls(
                        event=action_event_cls(name=p_val)
                    )
                elif (
                    isinstance(p_val, dict)
                    and _is_action_type(t)
                    and not isinstance(p_val, _ACTION_TYPES)
                ):
                    coerced_args[p_name] = _coerce_action(
                        p_val,
                        action_cls=action_cls,
                        action_event_cls=action_event_cls,
                    )

                # 5. Coerce AccessibilityAttributes
                elif (
                    isinstance(p_val, dict)
                    and _is_accessibility_type(t)
                    and not isinstance(p_val, _ACCESSIBILITY_TYPES)
                ):
                    coerced_args[p_name] = accessibility_cls(**p_val)

                else:
                    coerced_args[p_name] = p_val
            else:
                coerced_args[p_name] = p_val

        # Execute macro layout function
        result = meta.func(**coerced_args)

        if not isinstance(result, (ComponentBuilderNode, Sequence)):
            raise TypeError(
                f"Macro '{macro_name}' must return a ComponentBuilderNode or Sequence"
                f" of nodes, got {type(result)}."
            )

        # Flatten into primitive components with ID namespacing and root stitching
        return flatten_component_tree(result, root_id=root_id)


MacroProcessor = _MacroProcessor

__all__ = ["_MacroProcessor", "MacroProcessor"]
