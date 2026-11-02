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
import logging
import types
from typing import (
    Annotated,
    Any,
    Literal,
    Sequence,
    TypeAlias,
    Union,
    get_args,
    get_origin,
    get_type_hints,
)
import unicodedata

from pydantic import BaseModel
from pydantic.fields import FieldInfo

from a2ui.builder import v0_9 as builder_v0_9
from a2ui.builder import v1_0 as builder_v1_0
from a2ui.builder.core import (
    ComponentBuilderNode,
    ComponentRef,
)
from a2ui.core import (
    A2uiValidationError,
    is_valid_uax31_identifier,
    to_protocol_version,
)
from a2ui.core.schema import ProtocolVersion

logger = logging.getLogger(__name__)

MacroVersionFamily: TypeAlias = Literal["0.9", "1.0"]


class _MacroProtocolError(A2uiValidationError):
    """Protocol-level macro violation that propagates rather than falling back."""


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

_V1_0_MODEL_TYPES: tuple[type, ...] = (
    builder_v1_0.AccessibilityAttributes,
    builder_v1_0.Action,
    builder_v1_0.ActionEvent,
    builder_v1_0.CheckRule,
    builder_v1_0.DataBinding,
    builder_v1_0.DynamicChildList,
    builder_v1_0.FunctionCall,
)
_V0_9_MODEL_TYPES: tuple[type, ...] = (
    builder_v0_9.AccessibilityAttributes,
    builder_v0_9.Action,
    builder_v0_9.ActionEvent,
    builder_v0_9.CheckRule,
    builder_v0_9.DataBinding,
    builder_v0_9.DynamicChildList,
    builder_v0_9.FunctionCall,
)


def _unwrap_annotated(t: Any) -> Any:
    """Strips typing.Annotated wrappers (such as Pydantic StrictStr/StrictInt) to the underlying type."""
    while get_origin(t) is Annotated:
        args = get_args(t)
        if not args:
            break
        t = args[0]
    return t


def _extract_annotated_description(t: Any) -> str | None:
    """Extracts a parameter description from ``Annotated[T, Field(description=...)]`` or ``Annotated[T, "..."]``."""
    while get_origin(t) is Annotated:
        args = get_args(t)
        if not args:
            break
        for meta in args[1:]:
            if isinstance(meta, FieldInfo) and meta.description:
                return meta.description
            if isinstance(meta, str) and meta:
                return meta
        t = args[0]
    return None


def _is_expr_type(t: Any) -> bool:
    """Returns True if ``t`` is a DataBinding or FunctionCall model class."""
    t = _unwrap_annotated(t)
    expr_types = _DATA_BINDING_TYPES + _FUNCTION_CALL_TYPES
    return t in expr_types or (isinstance(t, type) and issubclass(t, expr_types))


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


def _normalize_version_family(
    version: str | ProtocolVersion,
) -> MacroVersionFamily:
    """Normalizes a protocol version string or enum into its macro builder family."""
    try:
        pv = to_protocol_version(version)
    except ValueError as err:
        raise _MacroProtocolError(
            f"Unsupported macro protocol version: {version!r}."
        ) from err
    if pv in (ProtocolVersion.V0_9, ProtocolVersion.V0_9_1):
        return "0.9"
    if pv == ProtocolVersion.V1_0:
        return "1.0"
    raise _MacroProtocolError(f"Unsupported macro protocol version: {version!r}.")


def _validate_v1_0_macro_name(name: str) -> None:
    """Validates a macro component name against A2UI v1.0 identifier and reservation rules."""
    if unicodedata.normalize("NFKC", name) == "Surface":
        raise _MacroProtocolError(
            "Macro name 'Surface' is reserved and cannot be used as a component name."
        )
    if not is_valid_uax31_identifier(name):
        raise _MacroProtocolError(
            f"Macro name '{name}' must be a valid Unicode identifier."
        )


def _type_version_family(t: Any) -> MacroVersionFamily | None:
    """Returns the A2UI builder protocol family for a type object, if any."""
    if not isinstance(t, type):
        return None
    if issubclass(t, builder_v1_0.ComponentBuilderNode) or issubclass(
        t, _V1_0_MODEL_TYPES
    ):
        return "1.0"
    if (
        issubclass(t, ComponentBuilderNode)
        and t not in (ComponentBuilderNode, ComponentRef)
    ) or issubclass(t, _V0_9_MODEL_TYPES):
        return "0.9"
    if issubclass(t, BaseModel):
        mod = getattr(t, "__module__", "") or ""
        if mod.startswith((
            "a2ui.builder.v1_0",
            "a2ui.core.schema.v1_0",
            "a2ui.core.basic_catalog.v1_0",
        )):
            return "1.0"
        if mod.startswith((
            "a2ui.builder.v0_9",
            "a2ui.core.schema.v0_9",
            "a2ui.core.basic_catalog.v0_9",
        )):
            return "0.9"
    return None


def _collect_annotation_versions(
    t: Any,
    out: set[MacroVersionFamily],
    seen: set[int] | None = None,
) -> None:
    """Collects all A2UI protocol families referenced by ``t`` and its nested type arguments."""
    if seen is None:
        seen = set()
    t = _unwrap_annotated(t)
    obj_id = id(t)
    if obj_id in seen:
        return
    seen.add(obj_id)
    fam = _type_version_family(t)
    if fam is not None:
        out.add(fam)
    for arg in get_args(t):
        _collect_annotation_versions(arg, out, seen)
    if (
        fam is None
        and isinstance(t, type)
        and issubclass(t, BaseModel)
        and not issubclass(t, ComponentBuilderNode)
    ):
        try:
            field_hints = get_type_hints(t, include_extras=True)
        except Exception:
            field_hints = {}
        for f_name, f_info in t.model_fields.items():
            _collect_annotation_versions(
                field_hints.get(f_name, f_info.annotation), out, seen
            )


def _detect_macro_version(
    parameters: dict[str, _MacroParameter],
    return_type: Any,
    macro_name: str,
) -> MacroVersionFamily | None:
    """Determines the protocol family referenced in a macro's type annotations."""
    versions: set[MacroVersionFamily] = set()
    _collect_annotation_versions(return_type, versions)
    for p in parameters.values():
        _collect_annotation_versions(p.type_hint, versions)

    if len(versions) > 1:
        raise _MacroProtocolError(
            f"Macro '{macro_name}' mixes A2UI v0.9 and v1.0 protocol types."
        )
    return next(iter(versions), None)


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
    *,
    use_v1_0: bool = False,
    _seen: frozenset[type] = frozenset(),
) -> dict[str, Any]:
    """Maps a Python type hint to a canonical A2UI JSON schema property."""
    schema: dict[str, Any]
    t = _unwrap_annotated(t)
    child_ref_name = "Child" if use_v1_0 else "ComponentId"

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

    # Handle Optional[T] / Union[T, None] / Dynamic & Composite Unions
    if origin in (Union, types.UnionType):
        non_none_args = [_unwrap_annotated(a) for a in args if a is not type(None)]
        if len(non_none_args) == 1:
            return _map_type_hint_to_schema(
                non_none_args[0],
                param_desc,
                ref_prefix=ref_prefix,
                use_v1_0=use_v1_0,
                _seen=_seen,
            )

        expr_args = [a for a in non_none_args if _is_expr_type(a)]
        val_args = [a for a in non_none_args if not _is_expr_type(a)]
        val_set = set(val_args)

        if expr_args and val_args:
            if val_set == {str}:
                schema = {"$ref": f"{ref_prefix}DynamicString"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            if val_set <= {int, float}:
                schema = {"$ref": f"{ref_prefix}DynamicNumber"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            if val_set == {bool}:
                schema = {"$ref": f"{ref_prefix}DynamicBoolean"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            if {str, int, float, bool} <= val_set:
                schema = {"$ref": f"{ref_prefix}DynamicValue"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            if all(
                _is_child_list_slot_type(a) or _is_single_child_slot_type(a)
                for a in val_args
            ) and any(_is_child_list_slot_type(a) for a in val_args):
                schema = {"$ref": f"{ref_prefix}ChildList"}
                if param_desc:
                    schema["description"] = param_desc
                return schema
            if len(val_args) == 1 and get_origin(val_args[0]) in (
                list,
                Sequence,
                AbcSequence,
                tuple,
                set,
            ):
                seq_elem_args = get_args(val_args[0])
                if not seq_elem_args or _unwrap_annotated(seq_elem_args[0]) is str:
                    schema = {"$ref": f"{ref_prefix}DynamicStringList"}
                    if param_desc:
                        schema["description"] = param_desc
                    return schema
            if all(_is_single_child_slot_type(a) for a in val_args):
                schema = {"$ref": f"{ref_prefix}{child_ref_name}"}
                if param_desc:
                    schema["description"] = param_desc
                return schema

        if all(
            _is_child_list_slot_type(a) or _is_single_child_slot_type(a)
            for a in non_none_args
        ) and any(_is_child_list_slot_type(a) for a in non_none_args):
            schema = {"$ref": f"{ref_prefix}ChildList"}
            if param_desc:
                schema["description"] = param_desc
            return schema

        if all(_is_single_child_slot_type(a) for a in non_none_args):
            schema = {"$ref": f"{ref_prefix}{child_ref_name}"}
            if param_desc:
                schema["description"] = param_desc
            return schema

        branch_schemas = [
            _map_type_hint_to_schema(
                branch,
                ref_prefix=ref_prefix,
                use_v1_0=use_v1_0,
                _seen=_seen,
            )
            for branch in non_none_args
        ]
        schema = {"oneOf": branch_schemas}
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
        schema = {"$ref": f"{ref_prefix}{child_ref_name}"}
        if param_desc:
            schema["description"] = param_desc
        return schema

    # Catalog item & structured Pydantic sub-models (e.g. TabItem, ChoicePickerOption, IconNameSvgPath, ActionEvent)
    if isinstance(t, type) and issubclass(t, BaseModel):
        if t in _seen:
            schema = {"type": "object"}
            if param_desc:
                schema["description"] = param_desc
            return schema
        try:
            model_hints = get_type_hints(t, include_extras=True)
        except Exception:
            model_hints = {}
        sub_props: dict[str, Any] = {}
        sub_req: list[str] = []
        next_seen = _seen | {t}
        for f_name, f_info in t.model_fields.items():
            prop_name = f_info.serialization_alias or f_info.alias or f_name
            f_hint = model_hints.get(f_name, f_info.annotation)
            f_desc = f_info.description or _extract_annotated_description(f_hint)
            sub_props[prop_name] = _map_type_hint_to_schema(
                f_hint,
                f_desc,
                ref_prefix=ref_prefix,
                use_v1_0=use_v1_0,
                _seen=next_seen,
            )
            if f_info.is_required():
                sub_req.append(prop_name)
        model_schema: dict[str, Any] = {
            "type": "object",
            "properties": sub_props,
        }
        if sub_req:
            model_schema["required"] = sub_req
        if t.model_config.get("extra") == "forbid":
            model_schema["additionalProperties"] = False
        if param_desc:
            model_schema["description"] = param_desc
        return model_schema

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
            _map_type_hint_to_schema(
                args[0],
                ref_prefix=ref_prefix,
                use_v1_0=use_v1_0,
                _seen=_seen,
            )
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
        if (
            origin is dict
            and len(args) == 2
            and _unwrap_annotated(args[0]) is str
            and _unwrap_annotated(args[1]) is not Any
        ):
            schema["additionalProperties"] = _map_type_hint_to_schema(
                args[1],
                ref_prefix=ref_prefix,
                use_v1_0=use_v1_0,
                _seen=_seen,
            )
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
    target_version: MacroVersionFamily | None = field(init=False)

    def __post_init__(self) -> None:
        self.target_version = _detect_macro_version(
            self.parameters,
            self.return_type,
            self.name,
        )
        if self.target_version == "1.0":
            _validate_v1_0_macro_name(self.name)

    @property
    def is_v1_0(self) -> bool:
        """Returns True if this macro explicitly targets A2UI Protocol v1.0."""
        return self.target_version == "1.0"

    def to_json_schema(
        self,
        ref_prefix: str = DEFAULT_COMMON_REF_PREFIX,
        *,
        include_component_const: bool = False,
        use_v1_0: bool | None = None,
    ) -> dict[str, Any]:
        """Generates a JSON Schema component definition for this macro."""
        effective_v1_0 = self.is_v1_0 if use_v1_0 is None else use_v1_0
        props: dict[str, Any] = {}
        required: list[str] = []
        if include_component_const:
            props["component"] = {"const": self.name}
            required.append("component")

        for p_name, param in self.parameters.items():
            prop_schema = _map_type_hint_to_schema(
                param.type_hint,
                param.description,
                ref_prefix=ref_prefix,
                use_v1_0=effective_v1_0,
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
            f = frame.f_back if frame is not None else None
            try:
                localns: dict[str, Any] = {}
                scope_dicts: list[dict[str, Any]] = []
                qualname = getattr(func, "__qualname__", "")
                enclosing_names = {
                    seg for seg in qualname.split(".")[:-1] if seg != "<locals>"
                }
                func_filename = getattr(
                    getattr(func, "__code__", None), "co_filename", None
                )
                while f is not None and enclosing_names:
                    if (
                        f.f_code.co_filename == func_filename
                        and f.f_code.co_name in enclosing_names
                    ):
                        scope_dicts.append(f.f_locals)
                    f = f.f_back
                for scope_dict in reversed(scope_dicts):
                    localns.update(scope_dict)
                if func.__closure__ and func.__code__.co_freevars:
                    for var_name, cell in zip(
                        func.__code__.co_freevars, func.__closure__
                    ):
                        try:
                            localns[var_name] = cell.cell_contents
                        except ValueError:
                            pass
                hints = get_type_hints(func, localns=localns, include_extras=True)
            except Exception as err:
                logger.warning(
                    "Could not resolve type annotations for macro %r: %s",
                    macro_name,
                    err,
                )
                hints = {}
            finally:
                del f
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
                or _extract_annotated_description(type_hint)
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
