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

import json
from typing import Any
from utils import (
    ensure_v_prefix,
    to_pascal_case,
    to_snake_case,
    version_to_underscore,
)

# Property key through which a generator supplies a field's exact Python type.
PYTHON_TYPE_KEY = "x-python-type"


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

    def map_json_type_to_python(self, prop_name: str, prop: dict[str, Any]) -> str:
        """Maps JSON Schema property type to Python typing string."""
        if "const" in prop:
            cval = prop["const"]
            if isinstance(cval, str):
                return f"Literal['{cval}']"
            return f"Literal[{cval}]"

        if "$ref" in prop:
            ref = prop["$ref"]
            if isinstance(ref, str):
                if ref.endswith("/ComponentsList"):
                    return "list[dict[str, Any]]"
                if ref.endswith("/Component") or ref.endswith("/anyComponent"):
                    return "dict[str, Any]"
                if ref.endswith("/CallId"):
                    # Only common_types defines the `CallId` alias; other
                    # documents use the plain string type.
                    return "CallId" if ref.startswith("#/") else "str"
                if ref.endswith("/Child"):
                    return "Child"
                if ref.endswith("catalog_definition.json") or ref.endswith(
                    "catalog_description_schema.json"
                ):
                    return "CatalogDefinition"
                if "common_types.json" in ref or ref.startswith("#/$defs/"):
                    return ref.split("/")[-1]
                elif ref.startswith("#/components/"):
                    return f"{ref.split('/')[-1]}Component"
                elif ref.startswith("#/"):
                    return ref.split("/")[-1]
            return "Any"

        if "oneOf" in prop or "anyOf" in prop:
            union_items = prop.get("oneOf") or prop.get("anyOf")
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
            if allOf_items:
                return self.map_json_type_to_python(prop_name, allOf_items[0])

        if "enum" in prop:
            enum_vals = [
                f'"{v}"' if isinstance(v, str) else str(v) for v in prop["enum"]
            ]
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
            add_props = prop.get("additionalProperties")
            if isinstance(add_props, dict):
                val_type = self.map_json_type_to_python(prop_name, add_props)
                return f"dict[str, {val_type}]"
            return "dict[str, Any]"

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
                        f"{json.dumps(prop_desc['default'], ensure_ascii=False)}}}"
                    )
                elif "default" not in raw_desc.lower():
                    documented_default = json.dumps(
                        prop_desc["default"], ensure_ascii=False
                    )
                    default_note = f"Defaults to {documented_default} when absent."
                    raw_desc = f"{raw_desc} {default_note}".strip()
            elif "const" in prop_desc:
                has_default = True
                const_val = prop_desc["const"]
                if isinstance(const_val, str):
                    const_default = f'default="{const_val}"'
                elif isinstance(const_val, bool):
                    const_default = f"default={const_val}"
                else:
                    const_default = f"default={const_val}"

            if raw_desc:
                field_opts.append(
                    f"description={json.dumps(raw_desc, ensure_ascii=False)}"
                )
            if schema_default:
                field_opts.append(schema_default)

            if "pattern" in prop_desc:
                field_opts.append(f"pattern={json.dumps(prop_desc['pattern'])}")

            if const_default:
                field_opts.append(const_default)

            snake_name = to_snake_case(prop_name)
            if snake_name != prop_name:
                field_opts.insert(0, f'alias="{prop_name}"')

            field_str = f", {', '.join(field_opts)}" if field_opts else ""

            if prop_name in required:
                clean_opts = [o for o in field_opts if not o.startswith("default=")]
                field_str = f", {', '.join(clean_opts)}" if clean_opts else ""
                if "const" in prop_desc and self.required_const_default:
                    const_val = prop_desc["const"]
                    const_str = (
                        f'"{const_val}"'
                        if isinstance(const_val, str)
                        else str(const_val)
                    )
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
        """Compiles an object schema definition into a Pydantic BaseModel class."""
        add_props = spec.get("additionalProperties")
        base = base_class or ("BaseModel" if add_props else "StrictBaseModel")
        doc = spec.get("description", "").replace("\n", " ")

        lines = [f"class {class_name}({base}):"]
        if doc:
            lines.append(f'    """{doc}"""')
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
        """Compiles a union schema into a type alias."""
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
