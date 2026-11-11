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

from collections.abc import Mapping, Sequence as AbcSequence
import types
from typing import (
    Any,
    Sequence,
    Union,
    get_args,
    get_origin,
    get_type_hints,
)
import unicodedata

from pydantic import AliasChoices, BaseModel, ValidationError

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
    _is_single_child_slot_type,
    _is_type_from,
    _normalize_version_family,
    _type_version_family,
    _unwrap_annotated,
    _validate_v1_0_macro_name,
)

_DEDICATED_MODEL_TYPES: tuple[type, ...] = (
    *_DATA_BINDING_TYPES,
    *_FUNCTION_CALL_TYPES,
    *_ACTION_TYPES,
    *_DYNAMIC_CHILD_LIST_TYPES,
    *_CHECK_RULE_TYPES,
    *_ACCESSIBILITY_TYPES,
    ComponentBuilderNode,
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
    if t is builder_v1_0.Extensions:
        return True
    origin = get_origin(t)
    if origin in (Union, types.UnionType):
        non_none = [a for a in get_args(t) if a is not type(None)]
        return bool(non_none) and all(_is_dict_only_type(a) for a in non_none)
    return (
        t in (dict, Mapping)
        or origin in (dict, Mapping)
        or (isinstance(t, type) and issubclass(t, Mapping))
        or (isinstance(origin, type) and issubclass(origin, Mapping))
    )


def _coerce_action(
    value: dict[str, Any], *, use_v1_0: bool = False
) -> builder_v0_9.Action | builder_v1_0.Action:
    """Builds an Action from the shapes inference output uses for one.

    On v1.0, accepts wire ``{"@action": {"name": ...}}`` /
    ``{"@functionCall": ...}``, legacy ``{"event": ...}`` /
    ``{"functionCall": ...}``, abbreviated ``{"@action"|"event": "name", ...}``,
    bare event bodies ``{"name": ..., "context": ...}``, and bare function
    calls ``{"@call": ...}``.
    """
    if use_v1_0:
        has_fc = bool({"@functionCall", "functionCall", "function_call"} & value.keys())
        # TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
        inner = value.get("@action")
        inner_key = "@action" if "@action" in value else None
        if inner_key is None and "event" in value:
            inner = value.get("event")
            inner_key = "event"
        if isinstance(inner, str) and inner_key is not None and not has_fc:
            event_payload = {k: v for k, v in value.items() if k != inner_key}
            event_payload["name"] = inner
            return builder_v1_0.Action(
                event=builder_v1_0.ActionEvent.model_validate(event_payload)
            )
        if not (
            {"@action", "event", "@functionCall", "functionCall", "function_call"}
            & value.keys()
        ):
            if "@call" in value:
                return builder_v1_0.Action(
                    function_call=builder_v1_0.FunctionCall.model_validate(value)
                )
            return builder_v1_0.Action(
                event=builder_v1_0.ActionEvent.model_validate(value)
            )
        return builder_v1_0.Action.model_validate(value)

    has_fc = bool({"functionCall", "function_call"} & value.keys())
    inner = value.get("event")
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


def _sequence_element_type(t: Any) -> Any | None:
    """Extracts the element type ``E`` from ``Sequence[E]`` / ``list[E]`` (or an Optional/Union containing one)."""
    t = _unwrap_annotated(t)
    origin = get_origin(t)
    args = get_args(t)
    if origin in (Union, types.UnionType):
        for branch in args:
            if branch is type(None):
                continue
            elem = _sequence_element_type(branch)
            if elem is not None:
                return elem
        return None
    if (
        origin in (list, Sequence, AbcSequence, tuple, set)
        or (
            isinstance(origin, type)
            and issubclass(origin, (list, tuple, set, AbcSequence))
        )
    ) and args:
        return args[0]
    return None


def _dict_value_type(t: Any) -> Any | None:
    """Extracts the value type ``V`` from ``dict[str, V]`` / ``Mapping[str, V]`` (or an Optional/Union containing one)."""
    t = _unwrap_annotated(t)
    if t is builder_v1_0.Extensions or t in (dict, Mapping):
        return Any
    origin = get_origin(t)
    args = get_args(t)
    if origin in (Union, types.UnionType):
        val_types: list[Any] = []
        for branch in args:
            if branch is type(None):
                continue
            val_t = _dict_value_type(branch)
            if val_t is not None:
                if _unwrap_annotated(val_t) is Any:
                    return Any
                val_types.append(val_t)
        if not val_types:
            return None
        if len(val_types) == 1:
            return val_types[0]
        return Union[tuple(val_types)]
    if origin in (dict, Mapping) or (
        isinstance(origin, type) and issubclass(origin, Mapping)
    ):
        if len(args) == 2 and _unwrap_annotated(args[0]) is str:
            return args[1]
        return Any
    return None


def _structured_model_branches(t: Any) -> list[type[BaseModel]]:
    """Returns non-dedicated Pydantic ``BaseModel`` branches (such as ``TabItem`` or ``IconNameSvgPath``)."""
    t = _unwrap_annotated(t)
    origin = get_origin(t)
    if origin in (Union, types.UnionType):
        out: list[type[BaseModel]] = []
        for branch in get_args(t):
            if branch is not type(None):
                out.extend(_structured_model_branches(branch))
        return out
    if (
        isinstance(t, type)
        and issubclass(t, BaseModel)
        and not issubclass(t, _DEDICATED_MODEL_TYPES)
    ):
        return [t]
    return []


def _union_permits_arbitrary_dict(t: Any) -> bool:
    """Returns True if ``t`` or any of its union branches admits a ``dict`` / ``Mapping`` / ``Extensions``."""
    t = _unwrap_annotated(t)
    if t is Any or t is object or t is builder_v1_0.Extensions:
        return True
    origin = get_origin(t)
    if origin in (Union, types.UnionType):
        return any(
            _union_permits_arbitrary_dict(b) for b in get_args(t) if b is not type(None)
        )
    return (
        t in (dict, Mapping)
        or origin in (dict, Mapping)
        or (isinstance(t, type) and issubclass(t, Mapping))
        or (isinstance(origin, type) and issubclass(origin, Mapping))
    )


def _coerce_base_model(
    value: dict[str, Any],
    model_cls: type[BaseModel],
    *,
    use_v1_0: bool,
    param_name: str,
    macro_name: str,
) -> BaseModel:
    """Coerces nested wire fields (such as ``Child`` IDs or ``@path`` bindings) before validating ``model_cls``."""
    try:
        hints = get_type_hints(model_cls, include_extras=True)
    except Exception:
        hints = {}

    key_to_field_type: dict[str, Any] = {}
    for f_name, f_info in model_cls.model_fields.items():
        f_type = hints.get(f_name, f_info.annotation)
        key_to_field_type[f_name] = f_type
        if isinstance(f_info.alias, str):
            key_to_field_type[f_info.alias] = f_type
        if isinstance(f_info.serialization_alias, str):
            key_to_field_type[f_info.serialization_alias] = f_type
        val_alias = f_info.validation_alias
        if isinstance(val_alias, str):
            key_to_field_type[val_alias] = f_type
        elif isinstance(val_alias, AliasChoices):
            for choice in val_alias.choices:
                if isinstance(choice, str):
                    key_to_field_type[choice] = f_type

    coerced_payload: dict[str, Any] = {}
    for k, v in value.items():
        if k in key_to_field_type:
            coerced_payload[k] = _coerce_value(
                v,
                key_to_field_type[k],
                use_v1_0=use_v1_0,
                param_name=f"{param_name}.{k}",
                macro_name=macro_name,
            )
        else:
            coerced_payload[k] = v
    return model_cls.model_validate(coerced_payload)


def _coerce_value(
    p_val: Any,
    t: Any,
    *,
    use_v1_0: bool,
    param_name: str,
    macro_name: str,
) -> Any:
    """Recursively coerces an incoming JSON wire argument to the builder AST type declared by ``t``."""
    raw_t = _unwrap_annotated(t)
    is_any = raw_t is Any
    binding_key = "@path" if use_v1_0 else "path"
    call_key = "@call" if use_v1_0 else "call"

    # 1. Coerce single child slot from {"@child": id} (v1.0) or bare string ID
    if _is_single_child_slot_type(raw_t):
        if (
            use_v1_0
            and isinstance(p_val, dict)
            and set(p_val.keys()) == {"@child"}
            and isinstance(p_val["@child"], str)
        ):
            return ComponentRef(id=p_val["@child"])
        # TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
        if isinstance(p_val, str):
            return ComponentRef(id=p_val)

    # 2. Coerce child slot list from {"@child": [...]} (v1.0) or sequence of IDs
    if _is_component_sequence_type(raw_t):
        if (
            use_v1_0
            and isinstance(p_val, dict)
            and set(p_val.keys()) == {"@child"}
            and isinstance(p_val["@child"], list)
        ):
            return [
                ComponentRef(id=x) if isinstance(x, str) else x for x in p_val["@child"]
            ]
        # TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
        if isinstance(p_val, (list, tuple)):
            return [ComponentRef(id=x) if isinstance(x, str) else x for x in p_val]

    # 3. Coerce DynamicChildList dictionary:
    # v1.0 wire {"@child": "...", "@path": "/..."}, or legacy bare {"componentId": "...", "path": "/..."}
    # TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
    is_at_tpl = (
        use_v1_0
        and isinstance(p_val, dict)
        and set(p_val.keys()) == {"@child", "@path"}
    )
    is_bare_tpl = isinstance(p_val, dict) and (
        "componentId" in p_val or "template" in p_val
    )
    if (
        isinstance(p_val, dict)
        and not _is_dict_only_type(raw_t)
        and not isinstance(p_val, _DYNAMIC_CHILD_LIST_TYPES)
        and (
            (
                _is_type_from(raw_t, _DYNAMIC_CHILD_LIST_TYPES)
                and (is_at_tpl or is_bare_tpl)
            )
            or (
                is_any
                and (
                    set(p_val.keys()) == {"@child", "@path"}
                    or set(p_val.keys())
                    == ({"path", "componentId"} if use_v1_0 else {"path", "template"})
                )
                and all(isinstance(v, str) and bool(v) for v in p_val.values())
            )
        )
    ):
        dcl_cls = (
            builder_v1_0.DynamicChildList if use_v1_0 else builder_v0_9.DynamicChildList
        )
        dcl_payload = dict(p_val)
        tmpl_key = (
            "@child"
            if "@child" in dcl_payload
            else ("componentId" if "componentId" in dcl_payload else "template")
        )
        tmpl = dcl_payload.get(tmpl_key)
        if isinstance(tmpl, str):
            dcl_payload[tmpl_key] = ComponentRef(id=tmpl)
        return dcl_cls.model_validate(dcl_payload)

    # 4. Coerce DataBinding dictionary: {"@path": "/..."} (v1.0) or {"path": "/..."} (v0.9)
    if (
        isinstance(p_val, dict)
        and set(p_val.keys()) == {binding_key}
        and isinstance(p_val[binding_key], str)
        and not isinstance(p_val, _DATA_BINDING_TYPES)
        and (_is_type_from(raw_t, _DATA_BINDING_TYPES) or is_any)
        and not _is_dict_only_type(raw_t)
    ):
        path_val = p_val[binding_key]
        if use_v1_0:
            return builder_v1_0.DataBinding.model_validate({"path": path_val})
        return builder_v0_9.DataBinding(path=path_val)

    # 5. Coerce Action shorthands.
    #
    # Action itself deliberately has no string shorthand: a before-validator
    # accepting one would be invisible to a type checker. Inference output is
    # not type-checked, though, so the shorthands an LLM naturally emits are
    # mapped here instead.
    if isinstance(p_val, str) and _is_type_from(raw_t, _ACTION_TYPES):
        if use_v1_0:
            return builder_v1_0.Action(event=builder_v1_0.ActionEvent(name=p_val))
        return builder_v0_9.Action(event=builder_v0_9.ActionEvent(name=p_val))
    if (
        isinstance(p_val, dict)
        and _is_type_from(raw_t, _ACTION_TYPES)
        and not isinstance(p_val, _ACTION_TYPES)
    ):
        return _coerce_action(p_val, use_v1_0=use_v1_0)

    # 6. Coerce FunctionCall dictionary: {"@call": "...", ...} (v1.0) or {"call": "...", ...} (v0.9)
    if (
        isinstance(p_val, dict)
        and call_key in p_val
        and not isinstance(p_val, _FUNCTION_CALL_TYPES)
        and (_is_type_from(raw_t, _FUNCTION_CALL_TYPES) or is_any)
        and not _is_dict_only_type(raw_t)
    ):
        if use_v1_0:
            return builder_v1_0.FunctionCall.model_validate(p_val)
        return builder_v0_9.FunctionCall.model_validate(p_val)

    # 7. Coerce CheckRule or Sequence[CheckRule]
    if (
        isinstance(p_val, dict)
        and _is_type_from(raw_t, _CHECK_RULE_TYPES)
        and not isinstance(p_val, _CHECK_RULE_TYPES)
    ):
        cr_cls = builder_v1_0.CheckRule if use_v1_0 else builder_v0_9.CheckRule
        return cr_cls.model_validate(p_val)
    if isinstance(p_val, (list, tuple)) and _is_check_rule_sequence_type(raw_t):
        cr_cls = builder_v1_0.CheckRule if use_v1_0 else builder_v0_9.CheckRule
        return [
            cr_cls.model_validate(x)
            if isinstance(x, dict) and not isinstance(x, _CHECK_RULE_TYPES)
            else x
            for x in p_val
        ]

    # 8. Coerce AccessibilityAttributes
    if (
        isinstance(p_val, dict)
        and _is_type_from(raw_t, _ACCESSIBILITY_TYPES)
        and not isinstance(p_val, _ACCESSIBILITY_TYPES)
    ):
        a11y_cls = (
            builder_v1_0.AccessibilityAttributes
            if use_v1_0
            else builder_v0_9.AccessibilityAttributes
        )
        return a11y_cls.model_validate(p_val)

    # 9. Coerce structured Pydantic sub-models (e.g. TabItem, ChoicePickerOption, IconNameSvgPath, ActionEvent)
    if isinstance(p_val, dict):
        model_branches = _structured_model_branches(raw_t)
        if model_branches and not isinstance(p_val, tuple(model_branches)):
            last_err: ValidationError | TypeError | None = None
            for branch_cls in model_branches:
                try:
                    return _coerce_base_model(
                        p_val,
                        branch_cls,
                        use_v1_0=use_v1_0,
                        param_name=param_name,
                        macro_name=macro_name,
                    )
                except (ValidationError, TypeError) as err:
                    last_err = err
            if last_err is not None and not _union_permits_arbitrary_dict(raw_t):
                raise last_err

    # 10. Recursively coerce typed sequences (e.g. Sequence[TabItem], Sequence[ChoicePickerOption])
    if isinstance(p_val, (list, tuple)):
        elem_t = _sequence_element_type(raw_t)
        if elem_t is not None and _unwrap_annotated(elem_t) is not Any:
            return [
                _coerce_value(
                    item,
                    elem_t,
                    use_v1_0=use_v1_0,
                    param_name=f"{param_name}[{idx}]",
                    macro_name=macro_name,
                )
                for idx, item in enumerate(p_val)
            ]

    # 11. Recursively coerce typed string-keyed dictionaries (e.g. dict[str, Child], dict[str, DynamicString])
    if isinstance(p_val, dict):
        val_t = _dict_value_type(raw_t)
        if val_t is not None and _unwrap_annotated(val_t) is not Any:
            return {
                k: _coerce_value(
                    v,
                    val_t,
                    use_v1_0=use_v1_0,
                    param_name=f"{param_name}[{k!r}]",
                    macro_name=macro_name,
                )
                for k, v in p_val.items()
            }

    if isinstance(p_val, dict) and not _union_permits_arbitrary_dict(raw_t):
        raise TypeError(
            f"Parameter '{param_name}' of macro '{macro_name}' expects {t}, got dict."
        )

    return p_val


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
        fam = _type_version_family(type(obj))
        if fam is not None:
            out.add(fam)
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

        # Coerce parameters from incoming JSON values to rich builder AST types
        coerced_args: dict[str, Any] = {}
        for p_name, p_val in args.items():
            if p_name in meta.parameters:
                p_meta = meta.parameters[p_name]
                coerced_args[p_name] = _coerce_value(
                    p_val,
                    p_meta.type_hint,
                    use_v1_0=use_v1_0,
                    param_name=p_name,
                    macro_name=macro_name,
                )
            else:
                coerced_args[p_name] = p_val

        # Execute macro layout function
        result = meta.func(**coerced_args)

        if isinstance(result, (str, bytes)):
            raise TypeError(
                f"Macro '{macro_name}' must return a ComponentBuilderNode, got"
                f" {type(result).__name__}."
            )
        if isinstance(result, AbcSequence):
            if len(result) != 1 or not isinstance(result[0], ComponentBuilderNode):
                raise TypeError(
                    f"Macro '{macro_name}' must return a single root"
                    f" ComponentBuilderNode, got sequence of length {len(result)}."
                )
            root_node: ComponentBuilderNode = result[0]
        elif isinstance(result, ComponentBuilderNode):
            root_node = result
        else:
            raise TypeError(
                f"Macro '{macro_name}' must return a ComponentBuilderNode, got"
                f" {type(result).__name__}."
            )

        node_versions: set[MacroVersionFamily] = set()
        _collect_node_versions(root_node, node_versions, set())
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
        flattened = flatten_component_tree(root_node, root_id=root_id)
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
