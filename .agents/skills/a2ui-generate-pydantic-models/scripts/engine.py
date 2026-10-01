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

"""Core Pydantic v2 code generation engine for converting JSON Schemas to Python types."""

import inspect
import json
import math
from typing import Any
from utils import (
    ensure_v_prefix,
    to_pascal_case,
    to_snake_case,
    version_to_underscore,
)

# Property key through which a generator supplies a field's exact Python type.
PYTHON_TYPE_KEY = "x-python-type"

# Keywords that `map_json_type_to_python` turns into a type, or that only
# annotate one. Strict mode rejects any other keyword, which the type would
# not enforce.
_STRICT_TYPE_KEYWORDS = frozenset({
    "$ref",
    "additionalProperties",
    "allOf",
    "anyOf",
    "const",
    "default",
    "description",
    "enum",
    "items",
    "oneOf",
    "properties",
    "required",
    "type",
})

# Keywords that only annotate a schema, which may sit next to a keyword that
# determines the whole type (`$ref`, `const`, a union or a one-item `allOf`).
_ANNOTATION_KEYWORDS = frozenset({"description", "default"})

# Keywords that only apply to a schema with an explicit `type`.
_TYPED_KEYWORDS = frozenset({"properties", "required", "items", "additionalProperties"})

# References to common types from other documents, which those documents do
# not import as named aliases, mapped to their plain Python type.
_CROSS_DOCUMENT_REF_TYPES: dict[str, str] = {"CallId": "str"}


def json_type_name(value: Any) -> str:
    """Returns the JSON schema type name of a JSON value."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    raise ValueError(f"Not a JSON value: {value!r}")


def python_literal(value: Any) -> str:
    """Renders a JSON value as a Python literal, strings with double quotes.

    Booleans and null become `True`, `False` and `None`, and containers are
    rendered recursively, so the result is valid Python for any JSON value.

    Raises:
        ValueError: If `value` is not a JSON value.
    """
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if value is None or isinstance(value, (bool, int)):
        return repr(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"Not a JSON value: {value!r}")
        return repr(value)
    if isinstance(value, list):
        return "[" + ", ".join(python_literal(item) for item in value) + "]"
    if isinstance(value, dict):
        items = (f"{python_literal(k)}: {python_literal(v)}" for k, v in value.items())
        return "{" + ", ".join(items) + "}"
    raise ValueError(f"Not a JSON value: {value!r}")


def _is_docstring_safe(text: str) -> bool:
    """Returns whether a docstring would carry `text` unchanged.

    Pydantic reads a model's description from its docstring through
    `inspect.cleandoc`, which strips surrounding whitespace and indentation.
    """
    return "\n" not in text and inspect.cleandoc(text) == text


def _docstring_literal(text: str) -> str:
    """Renders `text` as a triple-quoted docstring that evaluates to `text`."""
    escaped = text.replace("\\", "\\\\").replace('"""', '\\"\\"\\"')
    if escaped.endswith('"'):
        escaped = escaped[:-1] + '\\"'
    return f'"""{escaped}"""'


class PydanticCodegen:
    """Deterministic Pydantic v2 code generator from JSON Schema."""

    def __init__(self, version: str):
        self.version = ensure_v_prefix(version)
        self.dir_name = version_to_underscore(self.version)
        self.spec_dot = "v" + self.dir_name[1:].replace("_", ".")
        self.inline_objects: dict[str, dict[str, Any]] = {}
        self.allow_inline = True
        # When set, spec defaults are emitted as JSON schema defaults instead of
        # being appended to the field description.
        self.schema_defaults = False
        # Component models get their `component` discriminator elsewhere, so
        # the property is skipped unless a generator needs it as a field.
        self.skip_component_property = True
        # Whether a required `const` property defaults to its value. When
        # unset, the property must be present, as the schema requires.
        self.required_const_default = True
        # When set, shapes that would map to a looser type (for example `Any`)
        # or drop keywords raise `ValueError` instead.
        self.strict = False
        # In strict mode, the names that a local `#/$defs/` reference may
        # target; None accepts any name.
        self.known_local_refs: set[str] | None = None

    def _unsupported(self, prop_name: str, prop: dict[str, Any]) -> ValueError:
        return ValueError(f"Unsupported schema for {prop_name or 'a type'}: {prop}")

    def _check_strict_shape(self, prop_name: str, prop: dict[str, Any]) -> None:
        """Raises if `prop` has keywords that its mapped type would drop."""
        keys = set(prop)
        if (
            keys - _STRICT_TYPE_KEYWORDS
            or ("oneOf" in prop and "anyOf" in prop)
            or len(prop.get("allOf", [])) > 1
            or isinstance(prop.get("type"), list)
            # `properties`, `required`, `items` and `additionalProperties`
            # constrain nothing without the `type` that maps them.
            or ("type" not in prop and keys & _TYPED_KEYWORDS)
        ):
            raise self._unsupported(prop_name, prop)
        if "$ref" in prop and keys - {"$ref"} - _ANNOTATION_KEYWORDS:
            raise self._unsupported(prop_name, prop)
        if "const" in prop:
            siblings = keys - {"const"} - _ANNOTATION_KEYWORDS
            const_type = json_type_name(prop["const"])
            type_matches = prop.get("type") == const_type or (
                prop.get("type") == "number" and const_type == "integer"
            )
            if siblings - {"type"} or ("type" in siblings and not type_matches):
                raise self._unsupported(prop_name, prop)
        for union_key in ("oneOf", "anyOf"):
            if union_key in prop and keys - {union_key} - _ANNOTATION_KEYWORDS:
                raise self._unsupported(prop_name, prop)
        if "allOf" in prop and keys - {"allOf"} - _ANNOTATION_KEYWORDS:
            raise self._unsupported(prop_name, prop)

    def map_json_type_to_python(self, prop_name: str, prop: dict[str, Any]) -> str:
        """Maps JSON Schema property type to Python typing string.

        Raises:
            ValueError: In strict mode, if the schema would map to a looser type.
        """
        if self.strict:
            self._check_strict_shape(prop_name, prop)

        if "const" in prop:
            return f"Literal[{python_literal(prop['const'])}]"

        if "$ref" in prop:
            ref = prop["$ref"]
            if isinstance(ref, str):
                if self.strict:
                    # Strict mode only resolves references within the document.
                    local_name = ref[len("#/$defs/") :]
                    if not ref.startswith("#/$defs/") or (
                        self.known_local_refs is not None
                        and local_name not in self.known_local_refs
                    ):
                        raise self._unsupported(prop_name, prop)
                    return local_name
                if ref.endswith("/ComponentsList"):
                    return "list[dict[str, Any]]"
                if ref.endswith("/Component") or ref.endswith("/anyComponent"):
                    return "dict[str, Any]"
                ref_name = ref.split("/")[-1]
                if not ref.startswith("#/") and ref_name in _CROSS_DOCUMENT_REF_TYPES:
                    return _CROSS_DOCUMENT_REF_TYPES[ref_name]
                if ref.endswith("/Child"):
                    return "Child"
                if ref.endswith("catalog_definition.json") or ref.endswith(
                    "catalog_description_schema.json"
                ):
                    return "CatalogDefinition"
                if "common_types.json" in ref or ref.startswith("#/$defs/"):
                    return ref_name
                elif ref.startswith("#/components/"):
                    return f"{ref_name}Component"
                elif ref.startswith("#/"):
                    return ref_name
            if self.strict:
                raise self._unsupported(prop_name, prop)
            return "Any"

        if "oneOf" in prop or "anyOf" in prop:
            union_items = prop.get("oneOf") or prop.get("anyOf")
            if self.strict and not union_items:
                raise self._unsupported(prop_name, prop)
            if union_items is not None:
                mapped_items = []
                for item in union_items:
                    mapped = self.map_json_type_to_python(prop_name, item)
                    if mapped not in mapped_items:
                        mapped_items.append(mapped)
                if len(mapped_items) == 1:
                    return mapped_items[0]
                return f"{' | '.join(mapped_items)}"

        if "allOf" in prop:
            allOf_items = prop["allOf"]
            if self.strict and not allOf_items:
                raise self._unsupported(prop_name, prop)
            if allOf_items:
                return self.map_json_type_to_python(prop_name, allOf_items[0])

        if "enum" in prop:
            enum_vals = [python_literal(v) for v in prop["enum"]]
            return f"Literal[{', '.join(enum_vals)}]"

        t = prop.get("type")
        if t == "string":
            return "str"
        elif t == "number":
            return "float"
        elif t == "integer":
            return "int"
        elif t == "boolean":
            return "bool"
        elif t == "array":
            items = prop.get("items", {})
            if isinstance(items, list):
                item_types = [
                    self.map_json_type_to_python(prop_name, it) for it in items
                ]
                return f"tuple[{', '.join(item_types)}]"
            item_type = self.map_json_type_to_python(prop_name, items)
            return f"list[{item_type}]"
        elif t == "object":
            add_props = prop.get("additionalProperties")
            if prop_name == "properties":
                return "dict[str, Any]"
            if self.allow_inline and "properties" in prop:
                if len(prop["properties"]) == 1:
                    single_prop = list(prop["properties"].keys())[0]
                    class_name = to_pascal_case(single_prop)
                elif prop_name.endswith("ies"):
                    base_name = prop_name[:-3] + "y"
                    class_name = f"{to_pascal_case(base_name)}Item"
                elif prop_name.endswith("s") and not prop_name.endswith("ss"):
                    base_name = prop_name[:-1]
                    class_name = f"{to_pascal_case(base_name)}Item"
                elif prop_name:
                    class_name = f"{to_pascal_case(prop_name)}Item"
                else:
                    first_prop = list(prop["properties"].keys())[0]
                    class_name = f"{to_pascal_case(first_prop)}Item"
                self.inline_objects[class_name] = prop
                return class_name
            if self.strict and (
                "properties" in prop or "required" in prop or add_props is False
            ):
                # A nested object needs its own model to enforce its keys.
                raise self._unsupported(prop_name, prop)
            if isinstance(add_props, dict):
                val_type = self.map_json_type_to_python(prop_name, add_props)
                return f"dict[str, {val_type}]"
            return "dict[str, Any]"

        if self.strict and t is not None:
            raise self._unsupported(prop_name, prop)
        return "Any"

    def compile_properties(
        self, props: dict[str, Any], required: list[str]
    ) -> list[str]:
        """Compiles JSON Schema properties into Pydantic v2 field declarations.

        A property may carry `PYTHON_TYPE_KEY` with the exact Python type
        expression to use, for shapes that the JSON type mapping cannot express.
        """
        lines = []
        for prop_name, prop_desc in props.items():
            if prop_name == "component" and self.skip_component_property:
                continue
            py_type = prop_desc.get(PYTHON_TYPE_KEY) or self.map_json_type_to_python(
                prop_name, prop_desc
            )
            raw_desc = prop_desc.get("description", "").replace("\n", " ")

            field_opts = []
            has_default = False
            const_default: str | None = None
            schema_default: str | None = None
            if "default" in prop_desc and "const" not in prop_desc:
                # JSON Schema defaults describe consumers' assumptions; they should
                # not become values that a Pydantic model producer writes.
                if self.schema_defaults:
                    # Emitted into the JSON schema only; the Python default stays
                    # None so an absent value is still distinguishable.
                    schema_default = (
                        "json_schema_extra={'default': "
                        f"{python_literal(prop_desc['default'])}}}"
                    )
                elif "default" not in raw_desc.lower():
                    documented_default = json.dumps(
                        prop_desc["default"], ensure_ascii=False
                    )
                    default_note = f"Defaults to {documented_default} when absent."
                    raw_desc = f"{raw_desc} {default_note}".strip()
            elif "const" in prop_desc:
                has_default = True
                const_default = f"default={python_literal(prop_desc['const'])}"

            if raw_desc:
                field_opts.append(f"description={python_literal(raw_desc)}")
            if schema_default:
                field_opts.append(schema_default)

            if "pattern" in prop_desc:
                field_opts.append(f"pattern={python_literal(prop_desc['pattern'])}")

            if const_default:
                field_opts.append(const_default)

            snake_name = to_snake_case(prop_name)
            if snake_name != prop_name:
                field_opts.insert(0, f"alias={python_literal(prop_name)}")

            field_str = f", {', '.join(field_opts)}" if field_opts else ""

            if prop_name in required:
                clean_opts = [o for o in field_opts if not o.startswith("default=")]
                field_str = f", {', '.join(clean_opts)}" if clean_opts else ""
                if "const" in prop_desc and self.required_const_default:
                    const_str = python_literal(prop_desc["const"])
                    lines.append(
                        f"    {snake_name}: {py_type} = Field({const_str}{field_str})"
                    )
                else:
                    lines.append(f"    {snake_name}: {py_type} = Field(...{field_str})")
            else:
                if has_default:
                    clean_field_str = field_str.lstrip(", ")
                    lines.append(
                        f"    {snake_name}: {py_type} | None = Field({clean_field_str})"
                    )
                else:
                    lines.append(
                        f"    {snake_name}: {py_type} | None = Field(None{field_str})"
                    )

        return lines

    def compile_object_def(
        self, class_name: str, spec: dict[str, Any], base_class: str | None = None
    ) -> str:
        """Compiles an object schema definition into a Pydantic BaseModel class.

        The spec description becomes the docstring, which Pydantic publishes
        as the model's description.

        Raises:
            ValueError: In strict mode, if a docstring cannot carry the
                description unchanged (for example, a multi-line description).
        """
        add_props = spec.get("additionalProperties")
        base = base_class or ("BaseModel" if add_props else "StrictBaseModel")
        doc = spec.get("description", "")
        if doc and not _is_docstring_safe(doc):
            if self.strict:
                raise ValueError(
                    f"Description of {class_name} would not round-trip as a"
                    f" docstring: {doc!r}"
                )
            doc = doc.replace("\n", " ")

        lines = [f"class {class_name}({base}):"]
        if doc:
            lines.append(f"    {_docstring_literal(doc)}")
        if add_props is True:
            lines.append(
                '    model_config = ConfigDict(extra="allow", populate_by_name=True)'
            )
        else:
            lines.append("    model_config = ConfigDict(populate_by_name=True)")

        props = spec.get("properties", {})
        required = spec.get("required", [])

        prop_lines = self.compile_properties(props, required)
        if not prop_lines:
            lines.append("    pass")
        else:
            lines.extend(prop_lines)
        return "\n".join(lines) + "\n"

    def compile_union_def(self, class_name: str, spec: dict[str, Any]) -> str:
        """Compiles a union schema into a type alias.

        Raises:
            ValueError: In strict mode, if the alias would accept more than the
                spec: an empty union, an `allOf` (an intersection), both
                `oneOf` and `anyOf`, or keywords next to the union.
        """
        if self.strict:
            union_keys = [key for key in ("oneOf", "anyOf") if key in spec]
            if (
                len(union_keys) != 1
                or not spec[union_keys[0]]
                or set(spec) - {union_keys[0], "description"}
            ):
                raise ValueError(f"Unsupported union def {class_name}: {spec}")
            mapped_items = []
            for item in spec[union_keys[0]]:
                mapped = self.map_json_type_to_python("", item)
                if mapped not in mapped_items:
                    mapped_items.append(mapped)
            return f"{class_name} = {' | '.join(mapped_items)}\n"

        union_items = spec.get("oneOf") or spec.get("anyOf") or spec.get("allOf")
        if not union_items:
            return f"{class_name} = Any\n"

        mapped_items = []
        for item in union_items:
            ref_item = item
            if isinstance(item, dict) and "allOf" in item:
                ref_item = item["allOf"][0]
            mapped = self.map_json_type_to_python("", ref_item)
            if mapped not in mapped_items:
                mapped_items.append(mapped)

        return f"{class_name} = {' | '.join(mapped_items)}\n"
