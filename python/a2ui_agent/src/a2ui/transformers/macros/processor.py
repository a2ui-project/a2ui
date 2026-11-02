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

from __future__ import annotations

from collections.abc import Sequence as AbcSequence
from enum import Enum
import types
from typing import Any, Literal, Sequence, Union, get_args, get_origin
import unicodedata

from pydantic import BaseModel

from a2ui.builder import v0_9 as builder_v0_9
from a2ui.builder import v1_0 as builder_v1_0
from a2ui.builder.core import (
    ComponentBuilderNode,
    ComponentRef,
    flatten_component_tree,
)
from a2ui.transformers.macros.macro import (
    MacroVersionFamily,
    _ACCESSIBILITY_TYPES,
    _ACTION_TYPES,
    _CHECK_RULE_TYPES,
    _DATA_BINDING_TYPES,
    _DYNAMIC_CHILD_LIST_TYPES,
    _FUNCTION_CALL_TYPES,
    _MacroMetadata,
    _MacroProtocolError,
    _V0_9_MODEL_TYPES,
    _V1_0_MODEL_TYPES,
    _is_single_child_slot_type,
    _is_type_from,
    _normalize_version_family,
    _unwrap_annotated,
    _validate_v1_0_macro_name,
)


def _is_component_sequence_type(t: Any) -> bool:
    t = _unwrap_annotated(t)
    origin = get_origin(t)
    args = get_args(t)
    if origin in (Union, types.UnionType):
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
        return _is_single_child_slot_type(args[0])
    return False


def _is_check_rule_sequence_type(t: Any) -> bool:
    t = _unwrap_annotated(t)
    origin = get_origin(t)
    args = get_args(t)
    if origin in (Union, types.UnionType):
        non_none = [a for a in args if a is not type(None)]
        return any(_is_check_rule_sequence_type(a) for a in non_none)
    if (
        origin in (list, Sequence, AbcSequence, tuple, set)
        or (
            isinstance(origin, type)
            and issubclass(origin, (list, tuple, set, AbcSequence))
        )
    ) and args:
        return _is_type_from(args[0], _CHECK_RULE_TYPES)
    return False


def _is_dict_only_type(t: Any) -> bool:
    t = _unwrap_annotated(t)
    origin = get_origin(t)
    if origin in (Union, types.UnionType):
        non_none = [a for a in get_args(t) if a is not type(None)]
        return bool(non_none) and all(_is_dict_only_type(a) for a in non_none)
    return t is dict or origin is dict or (isinstance(t, type) and issubclass(t, dict))


def _rejects_dict_value(t: Any) -> bool:
    """Returns True when annotation ``t`` exclusively permits scalar, slot, or sequence values (never a dict)."""
    t = _unwrap_annotated(t)
    if t is Any or t is object:
        return False
    origin = get_origin(t)
    if origin in (Union, types.UnionType):
        non_none = [a for a in get_args(t) if a is not type(None)]
        return bool(non_none) and all(_rejects_dict_value(a) for a in non_none)
    if origin is Literal:
        return all(not isinstance(arg, dict) for arg in get_args(t))
    if origin in (list, Sequence, AbcSequence, tuple, set) or (
        isinstance(origin, type) and issubclass(origin, (list, tuple, set, AbcSequence))
    ):
        return True
    if t in (list, Sequence, AbcSequence, tuple, set):
        return True
    if _is_single_child_slot_type(t):
        return True
    return isinstance(t, type) and issubclass(t, (bool, int, float, str, Enum))


def _coerce_action(
    value: dict[str, Any], *, use_v1_0: bool = False
) -> builder_v0_9.Action | builder_v1_0.Action:
    """Builds an Action from the shapes inference output uses for one.

    Four spellings show up in practice and all mean the same thing: the wire
    form ``{"event": {"name": ...}}``, the abbreviated
    ``{"event": "name", "userMessage": ..., "context": ...}``, a bare event
    body ``{"name": ..., "context": ..., "userMessage": ...}``, and a bare
    function call ``{"@call": ...}`` (v1.0) or ``{"call": ...}`` (v0.9).
    Anything else - notably ``{"functionCall": ...}`` - is already the wire
    form and is handed to Pydantic to validate.
    """
    has_fc = bool({"functionCall", "function_call"} & value.keys())
    inner = value.get("event")
    if use_v1_0:
        if isinstance(inner, str) and not has_fc:
            event_payload = {k: v for k, v in value.items() if k != "event"}
            event_payload["name"] = inner
            return builder_v1_0.Action(
                event=builder_v1_0.ActionEvent.model_validate(event_payload)
            )
        if not ({"event", "functionCall", "function_call"} & value.keys()):
            if "@call" in value:
                return builder_v1_0.Action(
                    function_call=builder_v1_0.FunctionCall.model_validate(value)
                )
            return builder_v1_0.Action(
                event=builder_v1_0.ActionEvent.model_validate(value)
            )
        return builder_v1_0.Action.model_validate(value)

    if isinstance(inner, str) and not has_fc:
        event_payload = {k: v for k, v in value.items() if k != "event"}
        event_payload["name"] = inner
        return builder_v0_9.Action(
            event=builder_v0_9.ActionEvent.model_validate(event_payload)
        )
    if not ({"event", "functionCall", "function_call"} & value.keys()):
        if "call" in value:
            return builder_v0_9.Action(
                function_call=builder_v0_9.FunctionCall.model_validate(value)
            )
        return builder_v0_9.Action(event=builder_v0_9.ActionEvent.model_validate(value))
    return builder_v0_9.Action.model_validate(value)


def _collect_node_versions(
    obj: Any,
    out: set[MacroVersionFamily],
    seen: set[int],
) -> None:
    """Collects protocol version families of builder nodes and protocol models in a returned tree."""
    if isinstance(obj, ComponentRef) or isinstance(
        obj, (str, bytes, int, float, bool, type(None))
    ):
        return
    obj_id = id(obj)
    if obj_id in seen:
        return
    seen.add(obj_id)

    if isinstance(obj, ComponentBuilderNode):
        out.add("1.0" if isinstance(obj, builder_v1_0.ComponentBuilderNode) else "0.9")
        for val in obj.__dict__.values():
            _collect_node_versions(val, out, seen)
        extra = getattr(obj, "__pydantic_extra__", None)
        if isinstance(extra, dict):
            for val in extra.values():
                _collect_node_versions(val, out, seen)
    elif isinstance(obj, BaseModel):
        if isinstance(obj, _V1_0_MODEL_TYPES):
            out.add("1.0")
        elif isinstance(obj, _V0_9_MODEL_TYPES):
            out.add("0.9")
        for val in obj.__dict__.values():
            _collect_node_versions(val, out, seen)
    elif isinstance(obj, dict):
        for val in obj.values():
            _collect_node_versions(val, out, seen)
    elif isinstance(obj, AbcSequence):
        for item in obj:
            _collect_node_versions(item, out, seen)


class _MacroProcessor:
    """Executes registered macros and flattens them into standard A2UI components."""

    def __init__(
        self,
        macros: dict[str, _MacroMetadata] | None = None,
        *,
        default_version_family: MacroVersionFamily | None = None,
    ):
        self._macros = macros or {}
        self.default_version_family = default_version_family

    def has_macro(self, macro_name: str) -> bool:
        """Checks if a macro is registered by name."""
        return macro_name in self._macros

    def get_macro(self, macro_name: str) -> _MacroMetadata | None:
        """Returns the registered macro metadata for ``macro_name``, or None."""
        return self._macros.get(macro_name)

    def expand(
        self,
        macro_name: str,
        args: dict[str, Any],
        instance_id: str | None = None,
        *,
        protocol_version: str | None = None,
    ) -> list[dict[str, Any]]:
        """Executes a macro by name with provided arguments and returns flat component dicts.

        Args:
            macro_name: The registered macro function name.
            args: Keyword arguments for the macro invocation.
            instance_id: The ID assigned to this macro component instance (becomes root component ID).
            protocol_version: Optional envelope protocol version (e.g. ``"1.0"``).

        Returns:
            List of standard A2UI component dictionaries ready for updateComponents.
        """
        root_id = instance_id
        meta = self._macros.get(macro_name)
        if meta is None:
            raise KeyError(f"Macro '{macro_name}' is not registered.")

        env_family: MacroVersionFamily | None = (
            _normalize_version_family(protocol_version)
            if protocol_version is not None
            else self.default_version_family
        )
        if (
            meta.target_version is not None
            and env_family is not None
            and meta.target_version != env_family
        ):
            raise _MacroProtocolError(
                f"Cannot expand v{meta.target_version} macro '{macro_name}' under"
                f" A2UI protocol {protocol_version or env_family}."
            )
        effective_family: MacroVersionFamily | None = meta.target_version or env_family
        use_v1_0 = effective_family == "1.0"
        binding_key = "@path" if use_v1_0 else "path"
        call_key = "@call" if use_v1_0 else "call"

        # Coerce parameters from incoming JSON values to rich builder AST types
        coerced_args: dict[str, Any] = {}
        for p_name, p_val in args.items():
            if p_name in meta.parameters:
                p_meta = meta.parameters[p_name]
                t = p_meta.type_hint
                is_any = _unwrap_annotated(t) is Any

                # 1. Coerce single child slot from string ID to ComponentRef
                if isinstance(p_val, str) and _is_single_child_slot_type(t):
                    coerced_args[p_name] = ComponentRef(id=p_val)

                # 2. Coerce child slot list from sequence of IDs to ComponentRefs
                elif isinstance(p_val, (list, tuple)) and _is_component_sequence_type(
                    t
                ):
                    coerced_args[p_name] = [
                        ComponentRef(id=x) if isinstance(x, str) else x for x in p_val
                    ]

                # 3. Coerce DynamicChildList dictionary: {"path": "/...", "componentId": "..."}
                elif (
                    isinstance(p_val, dict)
                    and (_is_type_from(t, _DYNAMIC_CHILD_LIST_TYPES) or is_any)
                    and not _is_dict_only_type(t)
                    and ("componentId" in p_val or "template" in p_val)
                    and not isinstance(p_val, _DYNAMIC_CHILD_LIST_TYPES)
                ):
                    dcl_cls = (
                        builder_v1_0.DynamicChildList
                        if use_v1_0
                        else builder_v0_9.DynamicChildList
                    )
                    dcl_payload = dict(p_val)
                    tmpl_key = (
                        "componentId" if "componentId" in dcl_payload else "template"
                    )
                    tmpl = dcl_payload.get(tmpl_key)
                    if isinstance(tmpl, str):
                        dcl_payload[tmpl_key] = ComponentRef(id=tmpl)
                    coerced_args[p_name] = dcl_cls.model_validate(dcl_payload)

                # 4. Coerce DataBinding dictionary: {"@path": "/..."} (v1.0) or {"path": "/..."} (v0.9)
                elif (
                    isinstance(p_val, dict)
                    and set(p_val.keys()) == {binding_key}
                    and isinstance(p_val[binding_key], str)
                    and not isinstance(p_val, _DATA_BINDING_TYPES)
                    and (_is_type_from(t, _DATA_BINDING_TYPES) or is_any)
                    and not _is_dict_only_type(t)
                ):
                    path_val = p_val[binding_key]
                    if use_v1_0:
                        coerced_args[p_name] = builder_v1_0.DataBinding.model_validate(
                            {"path": path_val}
                        )
                    else:
                        coerced_args[p_name] = builder_v0_9.DataBinding(path=path_val)

                # 5. Coerce Action shorthands.
                #
                # Action itself deliberately has no string shorthand: a
                # before-validator accepting one would be invisible to a type
                # checker. Inference output is not type-checked, though, so the
                # shorthands an LLM naturally emits are mapped here instead.
                elif isinstance(p_val, str) and _is_type_from(t, _ACTION_TYPES):
                    if use_v1_0:
                        coerced_args[p_name] = builder_v1_0.Action(
                            event=builder_v1_0.ActionEvent(name=p_val)
                        )
                    else:
                        coerced_args[p_name] = builder_v0_9.Action(
                            event=builder_v0_9.ActionEvent(name=p_val)
                        )
                elif (
                    isinstance(p_val, dict)
                    and _is_type_from(t, _ACTION_TYPES)
                    and not isinstance(p_val, _ACTION_TYPES)
                ):
                    coerced_args[p_name] = _coerce_action(p_val, use_v1_0=use_v1_0)

                # 6. Coerce FunctionCall dictionary: {"@call": "...", ...} (v1.0) or {"call": "...", ...} (v0.9)
                elif (
                    isinstance(p_val, dict)
                    and call_key in p_val
                    and not isinstance(p_val, _FUNCTION_CALL_TYPES)
                    and (_is_type_from(t, _FUNCTION_CALL_TYPES) or is_any)
                    and not _is_dict_only_type(t)
                ):
                    if use_v1_0:
                        coerced_args[p_name] = builder_v1_0.FunctionCall.model_validate(
                            p_val
                        )
                    else:
                        coerced_args[p_name] = builder_v0_9.FunctionCall.model_validate(
                            p_val
                        )

                # 7. Coerce CheckRule or Sequence[CheckRule]
                elif (
                    isinstance(p_val, dict)
                    and _is_type_from(t, _CHECK_RULE_TYPES)
                    and not isinstance(p_val, _CHECK_RULE_TYPES)
                ):
                    cr_cls = (
                        builder_v1_0.CheckRule if use_v1_0 else builder_v0_9.CheckRule
                    )
                    coerced_args[p_name] = cr_cls.model_validate(p_val)
                elif isinstance(p_val, (list, tuple)) and _is_check_rule_sequence_type(
                    t
                ):
                    cr_cls = (
                        builder_v1_0.CheckRule if use_v1_0 else builder_v0_9.CheckRule
                    )
                    coerced_args[p_name] = [
                        cr_cls.model_validate(x)
                        if isinstance(x, dict) and not isinstance(x, _CHECK_RULE_TYPES)
                        else x
                        for x in p_val
                    ]

                # 8. Coerce AccessibilityAttributes
                elif (
                    isinstance(p_val, dict)
                    and _is_type_from(t, _ACCESSIBILITY_TYPES)
                    and not isinstance(p_val, _ACCESSIBILITY_TYPES)
                ):
                    a11y_cls = (
                        builder_v1_0.AccessibilityAttributes
                        if use_v1_0
                        else builder_v0_9.AccessibilityAttributes
                    )
                    coerced_args[p_name] = a11y_cls.model_validate(p_val)

                elif isinstance(p_val, dict) and _rejects_dict_value(t):
                    raise TypeError(
                        f"Parameter '{p_name}' of macro '{macro_name}' expects {t},"
                        " got dict."
                    )

                else:
                    coerced_args[p_name] = p_val
            else:
                coerced_args[p_name] = p_val

        # Execute macro layout function
        result = meta.func(**coerced_args)

        if not isinstance(result, (ComponentBuilderNode, Sequence)):
            raise TypeError(
                f"Macro '{macro_name}' must return a ComponentBuilderNode or"
                f" Sequence of nodes, got {type(result)}."
            )

        node_versions: set[MacroVersionFamily] = set()
        _collect_node_versions(result, node_versions, set())
        if len(node_versions) > 1:
            raise _MacroProtocolError(
                f"Macro '{macro_name}' returned mixed A2UI v0.9 and v1.0 builder nodes."
            )
        if (
            effective_family is not None
            and node_versions
            and node_versions != {effective_family}
        ):
            emitted_family = next(iter(node_versions))
            raise _MacroProtocolError(
                f"Macro '{macro_name}' returned v{emitted_family} builder nodes,"
                f" expected v{effective_family}."
            )

        # Flatten into primitive components with ID namespacing and root stitching
        flattened = flatten_component_tree(result, root_id=root_id)
        if use_v1_0 or "1.0" in node_versions:
            _validate_v1_0_macro_name(macro_name)
            for comp in flattened:
                comp_name = comp.get("component") if isinstance(comp, dict) else None
                if (
                    isinstance(comp_name, str)
                    and unicodedata.normalize("NFKC", comp_name) == "Surface"
                ):
                    raise _MacroProtocolError(
                        f"Macro '{macro_name}' emitted reserved component name"
                        " 'Surface'."
                    )
        return flattened


__all__: list[str] = []
