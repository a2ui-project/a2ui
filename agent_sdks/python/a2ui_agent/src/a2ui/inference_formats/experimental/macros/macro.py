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
from typing import Any, Callable, Optional, Sequence, get_type_hints

from a2ui.inference_formats.experimental.macros.builder.base import (
    ComponentBuilderNode,
    ComponentRef,
    ExternalComponentBuilderNode,
)


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
    macro_name = name or func.__name__
    doc = description or inspect.getdoc(func)

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
        params[p_name] = MacroParameter(
            name=p_name,
            type_hint=type_hint,
            required=is_req,
            default=param.default,
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
    func.__a2ui_macro__ = meta  # type: ignore[attr-defined]
    return func


def macro(
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator to define an A2UI macro.

    Example:
        @macro(description="A user summary card")
        def user_card(name: str, role: str) -> Card:
            return Card(child=Column(children=[Text(text=name), Text(text=role)]))
    """

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
    """Returns all currently registered macros."""
    return list(_MACRO_REGISTRY.values())


def clear_macros() -> None:
    """Clears all registered macros (used for test isolation)."""
    _MACRO_REGISTRY.clear()
