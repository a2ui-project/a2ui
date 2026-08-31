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

from typing import Any
from utils import (
    ensure_v_prefix,
    to_pascal_case,
    to_snake_case,
    version_to_underscore,
)


class PydanticCodegen:
    """Deterministic Pydantic v2 code generator from JSON Schema."""

    def __init__(self, version: str):
        self.version = ensure_v_prefix(version)
        self.dir_name = version_to_underscore(self.version)
        self.spec_dot = self.version
        self.inline_objects: dict[str, dict[str, Any]] = {}
        self.allow_inline = True

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
                    return "str"
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
        """Compiles JSON Schema properties into Pydantic v2 field declarations."""
        lines = []
        for prop_name, prop_desc in props.items():
            if prop_name == "component":
                continue
            py_type = self.map_json_type_to_python(prop_name, prop_desc)
            raw_desc = (
                prop_desc.get("description", "").replace("\n", " ").replace('"', '\\"')
            )

            field_opts = []
            if raw_desc:
                field_opts.append(f'description="{raw_desc}"')

            if "pattern" in prop_desc:
                pat = prop_desc["pattern"].replace("\\", "\\\\")
                field_opts.append(f'pattern=r"{pat}"')

            has_default = False
            if "default" in prop_desc:
                has_default = True
                default_val = prop_desc["default"]
                if isinstance(default_val, str):
                    field_opts.append(f'default="{default_val}"')
                elif isinstance(default_val, bool):
                    field_opts.append(f"default={default_val}")
                elif default_val is None:
                    field_opts.append("default=None")
                else:
                    field_opts.append(f"default={default_val}")
            elif "const" in prop_desc:
                has_default = True
                const_val = prop_desc["const"]
                if isinstance(const_val, str):
                    field_opts.append(f'default="{const_val}"')
                elif isinstance(const_val, bool):
                    field_opts.append(f"default={const_val}")
                else:
                    field_opts.append(f"default={const_val}")

            snake_name = to_snake_case(prop_name)
            if snake_name != prop_name:
                field_opts.insert(0, f'alias="{prop_name}"')

            field_str = f", {', '.join(field_opts)}" if field_opts else ""

            if prop_name in required:
                clean_opts = [o for o in field_opts if not o.startswith("default=")]
                field_str = f", {', '.join(clean_opts)}" if clean_opts else ""
                if "const" in prop_desc:
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
