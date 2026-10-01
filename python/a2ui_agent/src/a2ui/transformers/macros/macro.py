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

import collections.abc
from collections.abc import Iterable as AbcIterable, Sequence as AbcSequence
from enum import Enum
import inspect
from dataclasses import dataclass
from typing import (
    Any,
    Callable,
    Literal,
    Optional,
    Sequence,
    Union,
    get_args,
    get_origin,
    get_type_hints,
)

from a2ui.builder.core import (
    ComponentBuilderNode,
    ComponentRef,
)
from a2ui.builder.v0_9 import (
    AccessibilityAttributes,
    Action,
    CheckRule,
    DataBinding,
    DynamicBoolean,
    DynamicChildList,
    DynamicNumber,
    DynamicString,
    DynamicStringList,
    DynamicValue,
    FunctionCall,
)


def _to_pascal_case(s: str) -> str:
    """Converts a snake_case or identifier string to PascalCase."""
    if not s:
        return s
    if s[0].isupper() and "_" not in s:
        return s
    return "".join(word.capitalize() for word in s.split("_") if word)


def _parse_docstring(doc: Optional[str]) -> tuple[Optional[str], dict[str, str]]:
    """Extracts top description and per-argument descriptions from Google/Sphinx style docstrings."""
    if not doc:
        return None, {}

    cleaned = inspect.cleandoc(doc)
    lines = cleaned.splitlines()

    main_lines: list[str] = []
    param_descriptions: dict[str, str] = {}

    in_args = False
    current_param: Optional[str] = None
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
    param_desc: Optional[str] = None,
    ref_prefix: str = DEFAULT_COMMON_REF_PREFIX,
) -> dict[str, Any]:
    """Maps a Python type hint to a canonical A2UI JSON schema property."""
    schema: dict[str, Any]

    if t == DynamicValue:
        schema = {"$ref": f"{ref_prefix}DynamicValue"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t == DynamicStringList:
        schema = {"$ref": f"{ref_prefix}DynamicStringList"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t == DynamicString:
        schema = {"$ref": f"{ref_prefix}DynamicString"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t == DynamicNumber:
        schema = {"$ref": f"{ref_prefix}DynamicNumber"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t == DynamicBoolean:
        schema = {"$ref": f"{ref_prefix}DynamicBoolean"}
        if param_desc:
            schema["description"] = param_desc
        return schema

    origin = get_origin(t)
    args = get_args(t)

    # Handle Optional[T] / Union[T, None] / Dynamic Unions
    if origin is Union:
        non_none_args = [a for a in args if a is not type(None)]
        if len(non_none_args) == 1:
            return _map_type_hint_to_schema(
                non_none_args[0], param_desc, ref_prefix=ref_prefix
            )

        has_binding = any(
            a is DataBinding or (isinstance(a, type) and issubclass(a, DataBinding))
            for a in non_none_args
        )
        has_func = any(
            a is FunctionCall or (isinstance(a, type) and issubclass(a, FunctionCall))
            for a in non_none_args
        )
        types_set = set(non_none_args)
        expr_types = {DataBinding, FunctionCall}

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
            elif any(
                (
                    get_origin(a) in (list, Sequence, AbcSequence, tuple, set)
                    and get_args(a)
                    and (
                        get_args(a)[0] in (ComponentBuilderNode, ComponentRef)
                        or (
                            isinstance(get_args(a)[0], type)
                            and issubclass(get_args(a)[0], ComponentBuilderNode)
                        )
                    )
                )
                or a is DynamicChildList
                for a in types_set
            ):
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
            elif any(
                a in (ComponentBuilderNode, ComponentRef)
                or (isinstance(a, type) and issubclass(a, ComponentBuilderNode))
                for a in types_set
            ):
                if any(
                    get_origin(a) in (list, Sequence, AbcSequence, tuple, set)
                    or a is DynamicChildList
                    for a in types_set
                ):
                    schema = {"$ref": f"{ref_prefix}ChildList"}
                    if param_desc:
                        schema["description"] = param_desc
                    return schema
                else:
                    schema = {"$ref": f"{ref_prefix}ComponentId"}
                    if param_desc:
                        schema["description"] = param_desc
                    return schema
            else:
                schema = {"$ref": f"{ref_prefix}DynamicValue"}
                if param_desc:
                    schema["description"] = param_desc
                return schema

        if any(
            a in (ComponentBuilderNode, ComponentRef)
            or (isinstance(a, type) and issubclass(a, ComponentBuilderNode))
            for a in types_set
        ) and any(
            get_origin(a) in (list, Sequence, AbcSequence, tuple, set)
            or a is DynamicChildList
            for a in types_set
        ):
            schema = {"$ref": f"{ref_prefix}ChildList"}
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
        enum_schema: dict[str, Any] = {"type": "string", "enum": [e.value for e in t]}
        if param_desc:
            enum_schema["description"] = param_desc
        return enum_schema

    # Direct Protocol References
    if t is DataBinding:
        schema = {"$ref": f"{ref_prefix}DataBinding"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t is Action:
        schema = {"$ref": f"{ref_prefix}Action"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t is CheckRule:
        schema = {"$ref": f"{ref_prefix}CheckRule"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t is AccessibilityAttributes:
        schema = {"$ref": f"{ref_prefix}AccessibilityAttributes"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t is FunctionCall:
        schema = {"$ref": f"{ref_prefix}FunctionCall"}
        if param_desc:
            schema["description"] = param_desc
        return schema
    if t is DynamicChildList:
        schema = {"$ref": f"{ref_prefix}ChildList"}
        if param_desc:
            schema["description"] = param_desc
        return schema

    # Single Child Slots
    if t in (ComponentBuilderNode, ComponentRef) or (
        isinstance(t, type) and issubclass(t, ComponentBuilderNode)
    ):
        schema = {
            "$ref": f"{ref_prefix}ComponentId",
            "description": (
                param_desc or "ID of the child component to place in this slot."
            ),
        }
        return schema

    # Child List Slots
    if (
        origin in (list, Sequence, AbcSequence, tuple, set)
        and args
        and (
            args[0] in (ComponentBuilderNode, ComponentRef)
            or (isinstance(args[0], type) and issubclass(args[0], ComponentBuilderNode))
        )
    ):
        schema = {"$ref": f"{ref_prefix}ChildList"}
        if param_desc:
            schema["description"] = param_desc
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
    description: Optional[str] = None


@dataclass
class _MacroMetadata:
    """Metadata for an A2UI macro."""

    name: str
    description: Optional[str]
    func: Callable[..., Any]
    parameters: dict[str, _MacroParameter]
    return_type: Any

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
    name: Optional[Union[str, Callable[..., Any]]] = None,
    description: Optional[str] = None,
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
        func: Callable[..., Any], explicit_name: Optional[str] = None
    ) -> Callable[..., Any]:
        macro_name = explicit_name or _to_pascal_case(func.__name__)
        raw_doc = inspect.getdoc(func)
        parsed_main_desc, param_docs = _parse_docstring(raw_doc)
        doc = description or parsed_main_desc

        sig = inspect.signature(func)
        try:
            hints = get_type_hints(func, include_extras=True)
        except Exception:
            hints = {}

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
