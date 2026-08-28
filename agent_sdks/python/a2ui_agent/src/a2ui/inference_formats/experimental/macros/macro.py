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

"""Macro registration and metadata inspection."""

import inspect
from dataclasses import dataclass
from typing import Any, Callable, Optional, Sequence, Union, get_type_hints

from a2ui.inference_formats.experimental.macros.builder.base import (
    ComponentBuilderNode,
    ComponentRef,
    ExternalComponentBuilderNode,
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
                continue

            # Match "param_name: description" or "param_name (type): description"
            if ":" in stripped:
                prefix, desc = stripped.split(":", 1)
                name_part = prefix.split("(")[0].strip()
                if name_part.isidentifier():
                    if current_param:
                        param_descriptions[current_param] = " ".join(current_desc).strip()
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


@dataclass(frozen=True)
class MacroParameter:
    """Describes a parameter accepted by a macro."""

    name: str
    type_hint: Any
    required: bool
    default: Any = inspect.Parameter.empty
    description: Optional[str] = None


@dataclass
class MacroMetadata:
    """Metadata for a registered macro."""

    name: str
    description: Optional[str]
    func: Callable[..., Any]
    parameters: dict[str, MacroParameter]
    return_type: Any

    def to_json_schema(self) -> dict[str, Any]:
        """Generates a JSON Schema tool definition for this macro."""
        props: dict[str, Any] = {}
        required: list[str] = []

        for p_name, param in self.parameters.items():
            prop_schema: dict[str, Any] = {}
            if param.description:
                prop_schema["description"] = param.description

            # Map Python types to JSON Schema types
            t = param.type_hint
            if t in (str, Optional[str]):
                prop_schema["type"] = "string"
            elif t in (int, Optional[int]):
                prop_schema["type"] = "integer"
            elif t in (float, Optional[float]):
                prop_schema["type"] = "number"
            elif t in (bool, Optional[bool]):
                prop_schema["type"] = "boolean"
            elif t in (
                ComponentBuilderNode,
                ExternalComponentBuilderNode,
                ComponentRef,
                Optional[ComponentBuilderNode],
                Optional[ComponentRef],
            ):
                # Slot parameter: LLM passes child component ID
                prop_schema["type"] = "string"
                prop_schema["description"] = (
                    param.description or "ID of the child component to place in this slot."
                )
            elif getattr(t, "__origin__", None) in (list, Sequence):
                prop_schema["type"] = "array"
                prop_schema["items"] = {"type": "string"}
            else:
                prop_schema["type"] = "string"

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


_MACRO_REGISTRY: dict[str, MacroMetadata] = {}


def register_macro(
    func: Callable[..., Any],
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Callable[..., Any]:
    """Registers a Python function as an A2UI macro."""
    macro_name = name or _to_pascal_case(func.__name__)
    raw_doc = inspect.getdoc(func)
    parsed_main_desc, param_docs = _parse_docstring(raw_doc)
    doc = description or parsed_main_desc

    sig = inspect.signature(func)
    try:
        hints = get_type_hints(func)
    except Exception:
        hints = {}

    params: dict[str, MacroParameter] = {}
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
        params[p_name] = MacroParameter(
            name=p_name,
            type_hint=type_hint,
            required=is_req,
            default=param.default,
            description=param_desc,
        )

    ret_type = hints.get("return", sig.return_annotation)

    meta = MacroMetadata(
        name=macro_name,
        description=doc,
        func=func,
        parameters=params,
        return_type=ret_type,
    )
    _MACRO_REGISTRY[macro_name] = meta
    _MACRO_REGISTRY[func.__name__] = meta
    func.__a2ui_macro__ = meta  # type: ignore[attr-defined]
    return func


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
    if callable(name):
        return register_macro(name)

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        return register_macro(func, name=name, description=description)

    return decorator


# Backward-compatible aliases
macro_component = macro
dynamic_template = macro


def get_macro(name: str) -> Optional[MacroMetadata]:
    """Retrieves a registered macro by name."""
    return _MACRO_REGISTRY.get(name)


def list_macros() -> list[MacroMetadata]:
    """Returns all currently registered unique macros."""
    seen: set[str] = set()
    res: list[MacroMetadata] = []
    for m in _MACRO_REGISTRY.values():
        if m.name not in seen:
            seen.add(m.name)
            res.append(m)
    return res


def get_all_macros() -> list[MacroMetadata]:
    """Alias for list_macros()."""
    return list_macros()


def clear_macros() -> None:
    """Clears the global macro registry."""
    _MACRO_REGISTRY.clear()
