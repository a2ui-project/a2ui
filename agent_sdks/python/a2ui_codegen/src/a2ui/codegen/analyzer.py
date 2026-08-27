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

"""Catalog schema analysis and semantic type extraction."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Union

from a2ui.codegen.types import (
    ActionType,
    CheckRuleType,
    ComponentListType,
    ComponentRefType,
    DataBindingType,
    DynamicType,
    EnumType,
    ListType,
    MapType,
    PrimitiveKind,
    PrimitiveType,
    PropertyDescriptor,
    TypeDescriptor,
    UnionType,
)


@dataclass(frozen=True)
class AnalysedComponentApi:
    """Rich semantic analysis of an A2UI component."""

    name: str
    description: Optional[str]
    properties: dict[str, PropertyDescriptor]
    required_properties: tuple[str, ...]
    is_checkable: bool = False


@dataclass(frozen=True)
class AnalysedFunctionApi:
    """Rich semantic analysis of an A2UI catalog function."""

    name: str
    description: Optional[str]
    parameters: dict[str, PropertyDescriptor]
    required_parameters: tuple[str, ...]
    return_type: Optional[TypeDescriptor] = None


@dataclass(frozen=True)
class AnalysedCatalog:
    """Unified collection of analysed components, functions, and enums."""

    catalog_id: str
    spec_version: str
    components: dict[str, AnalysedComponentApi]
    functions: dict[str, AnalysedFunctionApi]
    enums: dict[str, EnumType]


class CatalogAnalyzer:
    """Analyzes A2UI catalog JSON schemas into strongly-typed AnalysedCatalog."""

    def __init__(self, catalog_dict: dict[str, Any], spec_version: str = "v0.9.1"):
        self.raw_catalog = catalog_dict
        self.spec_version = spec_version
        self.defs: dict[str, Any] = catalog_dict.get("$defs", {})
        self.enums: dict[str, EnumType] = {}

    @classmethod
    def from_file(
        cls, file_path: Union[str, Path], spec_version: str = "v0.9.1"
    ) -> "AnalysedCatalog":
        """Loads and analyzes a catalog JSON Schema from a file."""
        path = Path(file_path)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        analyzer = cls(data, spec_version=spec_version)
        return analyzer.analyze()

    @classmethod
    def from_dict(
        cls, data: dict[str, Any], spec_version: str = "v0.9.1"
    ) -> "AnalysedCatalog":
        """Analyzes a catalog JSON Schema from an in-memory dictionary."""
        analyzer = cls(data, spec_version=spec_version)
        return analyzer.analyze()

    def analyze(self) -> AnalysedCatalog:
        """Runs full analysis on components and functions in the catalog."""
        catalog_id = self.raw_catalog.get(
            "catalogId", self.raw_catalog.get("$id", "https://a2ui.org/catalogs/custom")
        )
        components_map = self.raw_catalog.get("components", {})
        functions_map = self.raw_catalog.get("functions", {})

        analysed_components: dict[str, AnalysedComponentApi] = {}
        for comp_name, comp_schema in components_map.items():
            if not isinstance(comp_schema, dict):
                continue
            analysed_components[comp_name] = self._analyze_component(
                comp_name, comp_schema
            )

        analysed_functions: dict[str, AnalysedFunctionApi] = {}
        for fn_name, fn_schema in functions_map.items():
            if not isinstance(fn_schema, dict):
                continue
            analysed_functions[fn_name] = self._analyze_function(fn_name, fn_schema)

        return AnalysedCatalog(
            catalog_id=catalog_id,
            spec_version=self.spec_version,
            components=analysed_components,
            functions=analysed_functions,
            enums=self.enums,
        )

    def _analyze_component(
        self, comp_name: str, schema: dict[str, Any]
    ) -> AnalysedComponentApi:
        """Crawls allOf and property schemas to build an AnalysedComponentApi."""
        description = schema.get("description")
        all_props: dict[str, Any] = {}
        required_set: set[str] = set()
        is_checkable = False

        # Gather schemas from allOf if present
        sub_schemas = [schema]
        if "allOf" in schema and isinstance(schema["allOf"], list):
            sub_schemas.extend(schema["allOf"])

        for sub in sub_schemas:
            if not isinstance(sub, dict):
                continue

            ref = sub.get("$ref", "")
            if isinstance(ref, str):
                if "Checkable" in ref:
                    is_checkable = True
                    all_props["checks"] = {
                        "type": "array",
                        "description": "Validation checks to perform.",
                        "items": {"$ref": "#/$defs/CheckRule"},
                    }
                elif "ComponentCommon" in ref:
                    all_props["id"] = {
                        "type": "string",
                        "description": "Unique identifier for this component.",
                    }

            if "properties" in sub and isinstance(sub["properties"], dict):
                for p_name, p_schema in sub["properties"].items():
                    if p_name == "component":
                        # Skip component discriminator in user-facing builders
                        continue
                    all_props[p_name] = p_schema

            if "required" in sub and isinstance(sub["required"], list):
                for req in sub["required"]:
                    if req != "component":
                        required_set.add(req)

        # Build PropertyDescriptors
        properties: dict[str, PropertyDescriptor] = {}
        for p_name, p_schema in all_props.items():
            prop_desc = self._resolve_property(comp_name, p_name, p_schema)
            is_req = p_name in required_set
            properties[p_name] = PropertyDescriptor(
                name=p_name,
                type_desc=prop_desc,
                required=is_req,
                description=p_schema.get("description")
                if isinstance(p_schema, dict)
                else None,
                default_value=p_schema.get("default")
                if isinstance(p_schema, dict)
                else None,
            )

        # If id not yet present, add it as optional string
        if "id" not in properties:
            properties["id"] = PropertyDescriptor(
                name="id",
                type_desc=PrimitiveType(PrimitiveKind.STRING),
                required=False,
                description="Unique identifier for this component.",
            )

        # Sort properties: required first, then optional, keeping id at the end
        def sort_key(item: tuple[str, PropertyDescriptor]) -> tuple[int, int, str]:
            name, desc = item
            if name == "id":
                return (2, 0, name)
            if desc.required:
                return (0, 0, name)
            return (1, 0, name)

        sorted_props = dict(sorted(properties.items(), key=sort_key))
        req_tuple = tuple(k for k, v in sorted_props.items() if v.required)

        return AnalysedComponentApi(
            name=comp_name,
            description=description,
            properties=sorted_props,
            required_properties=req_tuple,
            is_checkable=is_checkable,
        )

    def _analyze_function(
        self, fn_name: str, schema: dict[str, Any]
    ) -> AnalysedFunctionApi:
        """Analyzes a catalog function definition."""
        description = schema.get("description")
        params: dict[str, PropertyDescriptor] = {}
        required_params: set[str] = set()

        props = schema.get("properties", {})
        args_schema = props.get("args", schema.get("args", {}))
        if isinstance(args_schema, dict) and "properties" in args_schema:
            if "required" in args_schema and isinstance(args_schema["required"], list):
                required_params.update(args_schema["required"])

            for p_name, p_schema in args_schema["properties"].items():
                if not isinstance(p_schema, dict):
                    continue
                type_desc = self._resolve_property(fn_name, p_name, p_schema)
                params[p_name] = PropertyDescriptor(
                    name=p_name,
                    type_desc=type_desc,
                    required=p_name in required_params,
                    description=p_schema.get("description"),
                    default_value=p_schema.get("default"),
                )

        return AnalysedFunctionApi(
            name=fn_name,
            description=description,
            parameters=params,
            required_parameters=tuple(k for k, v in params.items() if v.required),
            return_type=PrimitiveType(PrimitiveKind.STRING),
        )

    def _resolve_property(
        self, parent_name: str, prop_name: str, schema: Any
    ) -> TypeDescriptor:
        """Maps a JSON schema property definition to a semantic TypeDescriptor."""
        if not isinstance(schema, dict):
            return PrimitiveType(PrimitiveKind.ANY)

        # 1. Child and Children slots
        if prop_name == "child":
            return ComponentRefType()
        if prop_name == "children":
            return ComponentListType()
        if prop_name == "checks":
            return ListType(CheckRuleType())

        # 2. Check $ref
        ref = schema.get("$ref", "")
        if isinstance(ref, str) and ref:
            if "ComponentId" in ref or ref.endswith("/Child"):
                return ComponentRefType()
            if "ChildList" in ref:
                return ComponentListType()
            if "Action" in ref:
                return ActionType()
            if "DataBinding" in ref:
                return DataBindingType()
            if "DynamicString" in ref:
                return DynamicType(PrimitiveType(PrimitiveKind.STRING))
            if "DynamicNumber" in ref:
                return DynamicType(PrimitiveType(PrimitiveKind.FLOAT))
            if "DynamicBoolean" in ref:
                return DynamicType(PrimitiveType(PrimitiveKind.BOOLEAN))
            if "DynamicStringList" in ref:
                return DynamicType(ListType(PrimitiveType(PrimitiveKind.STRING)))
            if "DynamicValue" in ref:
                return DynamicType(PrimitiveType(PrimitiveKind.ANY))
            if "CheckRule" in ref:
                return CheckRuleType()

        # 3. Enum values
        if "enum" in schema and isinstance(schema["enum"], list):
            enum_name = self._synthesize_enum_name(parent_name, prop_name)
            enum_type = EnumType(name=enum_name, values=tuple(schema["enum"]))
            self.enums[enum_name] = enum_type
            return enum_type

        # 4. oneOf / anyOf inspection
        for choice_key in ("oneOf", "anyOf"):
            if choice_key in schema and isinstance(schema[choice_key], list):
                branches = schema[choice_key]
                # Check for Action pattern (event or function)
                has_event = any(
                    isinstance(b, dict) and "event" in b.get("properties", {})
                    for b in branches
                )
                has_func = any(
                    isinstance(b, dict) and "function" in b.get("properties", {})
                    for b in branches
                )
                if has_event or has_func:
                    return ActionType()

                # Check for Dynamic pattern (primitive + DataBinding)
                has_binding = any(
                    isinstance(b, dict) and "DataBinding" in b.get("$ref", "")
                    for b in branches
                )
                if has_binding:
                    for b in branches:
                        if not isinstance(b, dict):
                            continue
                        if "enum" in b and isinstance(b["enum"], list):
                            enum_name = self._synthesize_enum_name(
                                parent_name, prop_name
                            )
                            enum_type = EnumType(
                                name=enum_name, values=tuple(b["enum"])
                            )
                            self.enums[enum_name] = enum_type
                            return DynamicType(enum_type)
                        b_type = b.get("type")
                        if b_type == "string":
                            return DynamicType(PrimitiveType(PrimitiveKind.STRING))
                        if b_type in ("number", "integer"):
                            return DynamicType(PrimitiveType(PrimitiveKind.FLOAT))
                        if b_type == "boolean":
                            return DynamicType(PrimitiveType(PrimitiveKind.BOOLEAN))
                    return DynamicType(PrimitiveType(PrimitiveKind.ANY))

                # Check for ChildList pattern
                has_child_array = any(
                    isinstance(b, dict)
                    and b.get("type") == "array"
                    and "ComponentId" in b.get("items", {}).get("$ref", "")
                    for b in branches
                )
                if has_child_array:
                    return ComponentListType()

        # 5. Scalar Types
        t = schema.get("type")
        if t == "string":
            return PrimitiveType(PrimitiveKind.STRING)
        if t == "integer":
            return PrimitiveType(PrimitiveKind.INTEGER)
        if t == "number":
            return PrimitiveType(PrimitiveKind.FLOAT)
        if t == "boolean":
            return PrimitiveType(PrimitiveKind.BOOLEAN)

        # 6. Array
        if t == "array":
            items = schema.get("items")
            if items:
                elem_type = self._resolve_property(
                    parent_name, f"{prop_name}_item", items
                )
                return ListType(element_type=elem_type)
            return ListType(element_type=PrimitiveType(PrimitiveKind.ANY))

        # 7. Object
        if t == "object":
            return MapType(value_type=PrimitiveType(PrimitiveKind.ANY))

        return PrimitiveType(PrimitiveKind.ANY)

    def _synthesize_enum_name(self, parent_name: str, prop_name: str) -> str:
        """Synthesizes a PascalCase enum name."""
        if parent_name in ("Row", "Column") and prop_name in ("justify", "align"):
            return f"Flex{prop_name.capitalize()}"
        return f"{parent_name}{prop_name.capitalize()}"
