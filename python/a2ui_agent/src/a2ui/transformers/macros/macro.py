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

from __future__ import annotations

from collections.abc import Callable, Sequence as AbcSequence
from dataclasses import dataclass, field
from enum import Enum
import inspect
import types
from typing import (
    Annotated,
    Any,
    Literal,
    Sequence,
    Union,
    get_args,
    get_origin,
    get_type_hints,
)
import unicodedata

from a2ui.builder import v0_9 as builder_v0_9
from a2ui.builder import v1_0 as builder_v1_0
from a2ui.builder.core import (
    ComponentBuilderNode,
    ComponentRef,
)
from a2ui.core import A2uiValidationError

_DATA_BINDING_TYPES: tuple[type, ...] = (
    builder_v0_9.DataBinding,
    builder_v1_0.DataBinding,
)
_FUNCTION_CALL_TYPES: tuple[type, ...] = (
    builder_v0_9.FunctionCall,
    builder_v1_0.FunctionCall,
)
_ACTION_TYPES: tuple[type, ...] = (
    builder_v0_9.Action,
    builder_v1_0.Action,
)
_CHECK_RULE_TYPES: tuple[type, ...] = (
    builder_v0_9.CheckRule,
    builder_v1_0.CheckRule,
)
_ACCESSIBILITY_TYPES: tuple[type, ...] = (
    builder_v0_9.AccessibilityAttributes,
    builder_v1_0.AccessibilityAttributes,
)
_DYNAMIC_CHILD_LIST_TYPES: tuple[type, ...] = (
    builder_v0_9.DynamicChildList,
    builder_v1_0.DynamicChildList,
)
_DYNAMIC_VALUE_ALIASES: tuple[Any, ...] = (
    builder_v0_9.DynamicValue,
    builder_v1_0.DynamicValue,
)
_DYNAMIC_STRING_LIST_ALIASES: tuple[Any, ...] = (
    builder_v0_9.DynamicStringList,
    builder_v1_0.DynamicStringList,
)
_DYNAMIC_STRING_ALIASES: tuple[Any, ...] = (
    builder_v0_9.DynamicString,
    builder_v1_0.DynamicString,
)
_DYNAMIC_NUMBER_ALIASES: tuple[Any, ...] = (
    builder_v0_9.DynamicNumber,
    builder_v1_0.DynamicNumber,
)
_DYNAMIC_BOOLEAN_ALIASES: tuple[Any, ...] = (
    builder_v0_9.DynamicBoolean,
    builder_v1_0.DynamicBoolean,
)

_V1_0_MODULE_PREFIXES: tuple[str, ...] = (
    "a2ui.builder.v1_0",
    "a2ui.core.schema.v1_0",
)
_V0_9_MODULE_PREFIXES: tuple[str, ...] = (
    "a2ui.builder.v0_9",
    "a2ui.core.schema.v0_9",
)


def _unwrap_annotated(t: Any) -> Any:
    """Strips typing.Annotated wrappers (such as Pydantic StrictStr/StrictInt) to the underlying type."""
    while get_origin(t) is Annotated:
        args = get_args(t)
        if not args:
            break
        t = args[0]
    return t


def _is_type_from(t: Any, target_types: tuple[type, ...]) -> bool:
    """Returns True if ``t`` or any of its union branches is in or subclasses ``target_types``."""
    t = _unwrap_annotated(t)
    origin = get_origin(t)
    if origin in (Union, types.UnionType):
        non_none = [a for a in get_args(t) if a is not type(None)]
        return any(_is_type_from(a, target_types) for a in non_none)
    if t in target_types:
        return True
    return isinstance(t, type) and issubclass(t, target_types)


def _has_module_prefix(t: Any, prefixes: tuple[str, ...]) -> bool:
    """Returns True if ``t`` or any nested type argument originates from ``prefixes``."""
    t = _unwrap_annotated(t)
    mod = getattr(t, "__module__", None)
    if isinstance(mod, str) and mod.startswith(prefixes):
        return True
    return any(_has_module_prefix(arg, prefixes) for arg in get_args(t))


def _uses_v1_0_annotation(t: Any) -> bool | None:
    """Returns True if ``t`` explicitly uses v1.0 types, False if v0.9, or None if version-neutral."""
    if _has_module_prefix(t, _V1_0_MODULE_PREFIXES):
        return True
    if _has_module_prefix(t, _V0_9_MODULE_PREFIXES):
        return False
    return None


def _detect_macro_v1_0(
    func: Callable[..., Any],
    parameters: dict[str, _MacroParameter],
    return_type: Any,
) -> bool:
    """Determines whether a macro function targets A2UI v1.0 via annotations or referenced globals."""
    ret_ver = _uses_v1_0_annotation(return_type)
    if ret_ver is not None:
        return ret_ver
    for p in parameters.values():
        p_ver = _uses_v1_0_annotation(p.type_hint)
        if p_ver is not None:
            return p_ver

    code = getattr(func, "__code__", None)
    func_globals = getattr(func, "__globals__", None)
    if code is not None and isinstance(func_globals, dict):
        names_to_check = set(code.co_names)
        for name in names_to_check:
            val = func_globals.get(name)
            if isinstance(val, types.ModuleType):
                if val.__name__.startswith(_V1_0_MODULE_PREFIXES):
                    return True
                if val.__name__.startswith(_V0_9_MODULE_PREFIXES):
                    return False
            else:
                mod = getattr(val, "__module__", None)
                if isinstance(mod, str):
                    if mod.startswith(_V1_0_MODULE_PREFIXES):
                        return True
                    if mod.startswith(_V0_9_MODULE_PREFIXES):
                        return False
    return False


def _is_single_child_slot_type(t: Any) -> bool:
    """Returns True if ``t`` represents a single child component slot (ComponentBuilderNode, ComponentRef, or Child)."""
    t = _unwrap_annotated(t)
    if t in (ComponentBuilderNode, ComponentRef) or (
        isinstance(t, type) and issubclass(t, ComponentBuilderNode)
    ):
        return True
    origin = get_origin(t)
    if origin in (Union, types.UnionType):
        non_none = [a for a in get_args(t) if a is not type(None)]
        return bool(non_none) and all(_is_single_child_slot_type(a) for a in non_none)
    return False


def _is_child_list_slot_type(t: Any) -> bool:
    """Returns True if ``t`` represents a child list slot (Sequence[Child], DynamicChildList, or ChildList)."""
    t = _unwrap_annotated(t)
    if t in _DYNAMIC_CHILD_LIST_TYPES or (
        isinstance(t, type) and issubclass(t, _DYNAMIC_CHILD_LIST_TYPES)
    ):
        return True
    origin = get_origin(t)
    args = get_args(t)
    if (
        origin in (list, Sequence, AbcSequence, tuple, set)
        and args
        and _is_single_child_slot_type(args[0])
    ):
        return True
    if origin in (Union, types.UnionType):
        non_none = [a for a in args if a is not type(None)]
        return (
            bool(non_none)
            and all(
                _is_child_list_slot_type(a) or _is_single_child_slot_type(a)
                for a in non_none
            )
            and any(_is_child_list_slot_type(a) for a in non_none)
        )
    return False


def _to_pascal_case(s: str) -> str:
    """Converts a snake_case or identifier string to PascalCase."""
    if not s:
        return s
    if s[0].isupper() and "_" not in s:
        return s
    return "".join(word.capitalize() for word in s.split("_") if word)


def _parse_docstring(
    doc: str | None,
) -> tuple[str | None, dict[str, str]]:
    """Extracts top description and per-argument descriptions from Google/Sphinx style docstrings."""
    if not doc:
        return None, {}

    cleaned = inspect.cleandoc(doc)
    lines = cleaned.splitlines()

    main_lines: list[str] = []
    param_descriptions: dict[str, str] = {}

    in_args = False
    current_param: str | None = None
    current_desc: list[str] = []

    for line in lines:
        stripped = line.strip()
        lowered = stripped.lower()

        # Handle Sphinx style ":param name: description"
        if stripped.startswith((":param ", ":parameter ")):
            if current_param:
                param_descriptions[current_param] = " ".join(current_desc).strip()
                current_param = None
                current_desc = []
            parts = stripped.split(":", 2)
            if len(parts) >= 3:
                p_name = parts[1].strip().split()[-1]
                p_desc = parts[2].strip()
                if p_name.isidentifier():
                    param_descriptions[p_name] = p_desc
            continue

        if stripped.startswith((":type ", ":return:", ":returns:", ":rtype:")):
            continue

        if lowered in ("args:", "arguments:", "parameters:"):
            in_args = True
            continue

        if in_args:
            # A non-indented section header ends the Args section
            if stripped and not line.startswith(" ") and not line.startswith("\t"):
                if current_param:
                    param_descriptions[current_param] = " ".join(current_desc).strip()
                    current_param = None
                    current_desc = []
                in_args = False
                main_lines.append(line)
                continue

            # Match "param_name: description" or "param_name (type): description"
            if ":" in stripped:
                prefix, desc = stripped.split(":", 1)
                name_part = prefix.split("(")[0].strip()
                if name_part.isidentifier():
                    if current_param:
                        param_descriptions[current_param] = " ".join(
                            current_desc
                        ).strip()
                    current_param = name_part
                    current_desc = [desc.strip()]
                    continue

            if current_param:
                current_desc.append(stripped)
        else:
            main_lines.append(line)

    if current_param:
        param_descriptions[current_param] = " ".join(current_desc).strip()

    main_desc = "\n".join(main_lines).strip() or None
    return main_desc, param_descriptions


DEFAULT_COMMON_REF_PREFIX: str = "common_types.json#/$defs/"


def _map_type_hint_to_schema(
    t: Any,
    param_desc: str | None = None,
    ref_prefix: str = DEFAULT_COMMON_REF_PREFIX,
) -> dict[str, Any]:
    """Maps a Python type hint to a canonical A2UI JSON schema property."""
    schema: dict[str, Any]
    t = _unwrap_annotated(t)

    if t in _DYNAMIC_VALUE_ALIASES:
        schema = {"$ref": f"{ref_prefix}DynamicValue"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t in _DYNAMIC_STRING_LIST_ALIASES:
        schema = {"$ref": f"{ref_prefix}DynamicStringList"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t in _DYNAMIC_STRING_ALIASES:
        schema = {"$ref": f"{ref_prefix}DynamicString"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t in _DYNAMIC_NUMBER_ALIASES:
        schema = {"$ref": f"{ref_prefix}DynamicNumber"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t in _DYNAMIC_BOOLEAN_ALIASES:
        schema = {"$ref": f"{ref_prefix}DynamicBoolean"}
        if param_desc:
            schema["description"] = param_desc
        return schema

    origin = get_origin(t)
    args = get_args(t)

    # Handle Optional[T] / Union[T, None] / Dynamic Unions
    if origin in (Union, types.UnionType):
        non_none_args = [_unwrap_annotated(a) for a in args if a is not type(None)]
        if len(non_none_args) == 1:
            return _map_type_hint_to_schema(
                non_none_args[0], param_desc, ref_prefix=ref_prefix
            )

        has_binding = any(
            a in _DATA_BINDING_TYPES
            or (isinstance(a, type) and issubclass(a, _DATA_BINDING_TYPES))
            for a in non_none_args
        )
        has_func = any(
            a in _FUNCTION_CALL_TYPES
            or (isinstance(a, type) and issubclass(a, _FUNCTION_CALL_TYPES))
            for a in non_none_args
        )
        types_set = set(non_none_args)
        expr_types = set(_DATA_BINDING_TYPES) | set(_FUNCTION_CALL_TYPES)

        if has_binding or has_func:
            if str in types_set and len(types_set - (expr_types | {str})) == 0:
                schema = {"$ref": f"{ref_prefix}DynamicString"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            elif (int in types_set or float in types_set) and len(
                types_set - (expr_types | {int, float})
            ) == 0:
                schema = {"$ref": f"{ref_prefix}DynamicNumber"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            elif bool in types_set and len(types_set - (expr_types | {bool})) == 0:
                schema = {"$ref": f"{ref_prefix}DynamicBoolean"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            elif any(_is_child_list_slot_type(a) for a in types_set):
                schema = {"$ref": f"{ref_prefix}ChildList"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            elif any(
                get_origin(a) in (list, Sequence, AbcSequence, tuple, set)
                for a in types_set
            ) and not any(a in (int, float, bool) for a in types_set):
                schema = {"$ref": f"{ref_prefix}DynamicStringList"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            elif any(_is_single_child_slot_type(a) for a in types_set):
                schema = {"$ref": f"{ref_prefix}ComponentId"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            else:
                schema = {"$ref": f"{ref_prefix}DynamicValue"}
                if param_desc:
                    schema["description"] = param_desc
                return schema

    # Literal strings or numbers
    if origin is Literal:
        literal_vals = list(args)
        if all(isinstance(v, str) for v in literal_vals):
            schema = {"type": "string", "enum": literal_vals}
        elif all(isinstance(v, (int, float)) for v in literal_vals):
            schema = {"type": "number", "enum": literal_vals}
        else:
            schema = {"enum": literal_vals}
        if param_desc:
            schema["description"] = param_desc
        return schema

    # Enum subclasses
    if isinstance(t, type) and issubclass(t, Enum):
        enum_schema: dict[str, Any] = {
            "type": "string",
            "enum": [e.value for e in t],
        }
        if param_desc:
            enum_schema["description"] = param_desc
        return enum_schema

    # Direct Protocol References
    if t in _DATA_BINDING_TYPES or (
        isinstance(t, type) and issubclass(t, _DATA_BINDING_TYPES)
    ):
        schema = {"$ref": f"{ref_prefix}DataBinding"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t in _ACTION_TYPES or (isinstance(t, type) and issubclass(t, _ACTION_TYPES)):
        schema = {"$ref": f"{ref_prefix}Action"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t in _CHECK_RULE_TYPES or (
        isinstance(t, type) and issubclass(t, _CHECK_RULE_TYPES)
    ):
        schema = {"$ref": f"{ref_prefix}CheckRule"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t in _ACCESSIBILITY_TYPES or (
        isinstance(t, type) and issubclass(t, _ACCESSIBILITY_TYPES)
    ):
        schema = {"$ref": f"{ref_prefix}AccessibilityAttributes"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t in _FUNCTION_CALL_TYPES or (
        isinstance(t, type) and issubclass(t, _FUNCTION_CALL_TYPES)
    ):
        schema = {"$ref": f"{ref_prefix}FunctionCall"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if _is_child_list_slot_type(t):
        schema = {"$ref": f"{ref_prefix}ChildList"}
        if param_desc:
            schema["description"] = param_desc
        return schema

    # Single Child Slots
    if _is_single_child_slot_type(t):
        schema = {
            "$ref": f"{ref_prefix}ComponentId",
            "description": (
                param_desc or "ID of the child component to place in this slot."
            ),
        }
        return schema

    # Primitives
    if t is str:
        schema = {"type": "string"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t is int:
        schema = {"type": "integer"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t is float:
        schema = {"type": "number"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t is bool:
        schema = {"type": "boolean"}
        if param_desc:
            schema["description"] = param_desc
        return schema

    # Arrays
    if origin in (list, Sequence, AbcSequence, tuple, set):
        item_schema = (
            _map_type_hint_to_schema(args[0], ref_prefix=ref_prefix)
            if args
            else {"type": "string"}
        )
        array_schema: dict[str, Any] = {"type": "array", "items": item_schema}
        if param_desc:
            array_schema["description"] = param_desc
        return array_schema

    if t is Any:
        schema = {}
        if param_desc:
            schema["description"] = param_desc
        return schema

    if t is dict or origin is dict or (isinstance(t, type) and issubclass(t, dict)):
        schema = {"type": "object"}
        if param_desc:
            schema["description"] = param_desc
        return schema

    schema = {"type": "string"}
    if param_desc:
        schema["description"] = param_desc
    return schema


@dataclass(frozen=True)
class _MacroParameter:
    """Describes a parameter accepted by a macro."""

    name: str
    type_hint: Any
    required: bool
    default: Any = inspect.Parameter.empty
    description: str | None = None


@dataclass
class _MacroMetadata:
    """Metadata for an A2UI macro."""

    name: str
    description: str | None
    func: Callable[..., Any]
    parameters: dict[str, _MacroParameter]
    return_type: Any
    is_v1_0: bool = field(init=False)

    def __post_init__(self) -> None:
        if unicodedata.normalize("NFKC", self.name) == "Surface":
            raise A2uiValidationError(
                "Macro name 'Surface' is reserved and cannot be used as a"
                " component name."
            )
        if not self.name.isidentifier():
            raise A2uiValidationError(
                f"Macro name '{self.name}' must be a valid Unicode identifier."
            )
        self.is_v1_0 = _detect_macro_v1_0(self.func, self.parameters, self.return_type)

    def to_json_schema(
        self, ref_prefix: str = DEFAULT_COMMON_REF_PREFIX
    ) -> dict[str, Any]:
        """Generates a JSON Schema tool definition for this macro."""
        props: dict[str, Any] = {}
        required: list[str] = []

        for p_name, param in self.parameters.items():
            prop_schema = _map_type_hint_to_schema(
                param.type_hint, param.description, ref_prefix=ref_prefix
            )
            props[p_name] = prop_schema
            if param.required:
                required.append(p_name)

        schema: dict[str, Any] = {
            "type": "object",
            "properties": props,
        }
        if required:
            schema["required"] = required
        if self.description:
            schema["description"] = self.description
        return schema


def macro(
    name: str | Callable[..., Any] | None = None,
    description: str | None = None,
) -> Any:
    """Decorator to define an A2UI macro.

    Can be used bare (@macro), with an explicit name (@macro("SalaryCard")),
    or with keyword arguments (@macro(name="SalaryCard", description="...")).

    Example:
        @macro
        def UserProfile(name: str, role: str) -> Card:
            '''User summary card.

            Args:
                name: User's display name.
                role: User's job title.
            '''
            return Card(child=Column(children=[Text(text=name), Text(text=role)]))
    """

    def _decorate(
        func: Callable[..., Any], explicit_name: str | None = None
    ) -> Callable[..., Any]:
        macro_name = explicit_name or _to_pascal_case(func.__name__)
        raw_doc = inspect.getdoc(func)
        parsed_main_desc, param_docs = _parse_docstring(raw_doc)
        doc = description or parsed_main_desc

        sig = inspect.signature(func)
        try:
            hints = get_type_hints(func, include_extras=True)
        except Exception:
            frame = inspect.currentframe()
            try:
                localns: dict[str, Any] = {}
                caller_frames: list[types.FrameType] = []
                f = frame.f_back if frame is not None else None
                while f is not None:
                    if f.f_code.co_filename != __file__:
                        caller_frames.append(f)
                    f = f.f_back
                for cf in reversed(caller_frames):
                    localns.update(cf.f_locals)
                if func.__closure__ and func.__code__.co_freevars:
                    for var_name, cell in zip(
                        func.__code__.co_freevars, func.__closure__
                    ):
                        try:
                            localns[var_name] = cell.cell_contents
                        except ValueError:
                            pass
                hints = get_type_hints(func, localns=localns, include_extras=True)
            except Exception:
                hints = {}
            finally:
                del frame

        params: dict[str, _MacroParameter] = {}
        for p_name, param in sig.parameters.items():
            if param.kind in (
                inspect.Parameter.VAR_POSITIONAL,
                inspect.Parameter.VAR_KEYWORD,
            ):
                continue
            type_hint = hints.get(p_name, Any)
            is_req = param.default is inspect.Parameter.empty
            param_desc = (
                param_docs.get(p_name)
                or param_docs.get(p_name.lower())
                or p_name.replace("_", " ").capitalize()
            )
            params[p_name] = _MacroParameter(
                name=p_name,
                type_hint=type_hint,
                required=is_req,
                default=param.default,
                description=param_desc,
            )

        ret_type = hints.get("return", sig.return_annotation)

        meta = _MacroMetadata(
            name=macro_name,
            description=doc,
            func=func,
            parameters=params,
            return_type=ret_type,
        )
        func.__a2ui_macro__ = meta  # type: ignore[attr-defined]
        return func

    if callable(name):
        return _decorate(name)

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        return _decorate(func, explicit_name=name)

    return decorator
