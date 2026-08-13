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

"""Data models for A2UI Template definitions."""

from __future__ import annotations

import json
from pathlib import Path
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import jsonschema

SCHEMA_PATH = Path(__file__).parent / "schema" / "template_definition.json"
with open(SCHEMA_PATH, "r", encoding="utf-8") as _f:
    TEMPLATE_DEFINITION_SCHEMA = json.load(_f)


def normalize_a2ui_type_to_jsonschema(meta: Any) -> Any:
    """Recursively converts an A2UI parameter type schema into standard JSON Schema."""
    if not isinstance(meta, dict):
        return meta
    schema = dict(meta)
    p_type = schema.get("type")
    if p_type == "enum" and "values" in schema:
        schema["type"] = "string"
        schema["enum"] = schema.pop("values")
    elif p_type in ["child", "action"]:
        schema["type"] = "string"
    elif p_type == "children":
        schema["type"] = "array"
        schema["items"] = {"type": "string"}

    if "properties" in schema and isinstance(schema["properties"], dict):
        schema["properties"] = {
            k: normalize_a2ui_type_to_jsonschema(v)
            for k, v in schema["properties"].items()
        }
    if "items" in schema:
        if isinstance(schema["items"], dict):
            schema["items"] = normalize_a2ui_type_to_jsonschema(schema["items"])
        elif isinstance(schema["items"], str):
            schema["items"] = {"type": schema["items"]}
    return schema


@dataclass
class Template:
    """Represents a reusable, parameterized A2UI component template."""

    template_id: str
    parameters: Dict[str, Dict[str, Any]]
    components: List[Dict[str, Any]]
    sample_data: Optional[Dict[str, Any]] = None
    description: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Template:
        """Constructs a Template instance from a dictionary payload."""
        template_id = data.get("templateId") or data.get("template_id")
        if not template_id:
            raise ValueError("Template dictionary must contain 'templateId'.")
        instance = cls(
            template_id=template_id,
            parameters=data.get("parameters", {}),
            components=data.get("components", []),
            sample_data=data.get("sampleData") or data.get("sample_data"),
            description=data.get("description"),
        )
        instance.validate_definition()
        return instance

    @classmethod
    def from_json_file(cls, file_path: str) -> Template:
        """Loads and parses a Template definition from a JSON file."""
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)

    def to_dict(self) -> Dict[str, Any]:
        """Serializes the template instance to a dictionary."""
        res: Dict[str, Any] = {
            "templateId": self.template_id,
            "parameters": self.parameters,
            "components": self.components,
        }
        if self.description:
            res["description"] = self.description
        if self.sample_data is not None:
            res["sampleData"] = self.sample_data
        return res

    def validate_definition(self) -> None:
        """Statically validates the template against the JSON Schema, verifies parameter references, and validates sampleData."""
        # 1. Validate whole template structure against official template definition schema
        raw_dict = self.to_dict()
        try:
            jsonschema.validate(instance=raw_dict, schema=TEMPLATE_DEFINITION_SCHEMA)
        except jsonschema.ValidationError as err:
            raise ValueError(
                f"Template '{self.template_id}' fails template_definition.json schema:"
                f" {err.message}"
            ) from err

        # 2. Extract and validate all parameter references within component definitions
        expr_pattern = re.compile(r"\$\{([\w\.]+)\}")

        def check_val(val: Any) -> None:
            if isinstance(val, dict):
                if "param" in val and isinstance(val["param"], str):
                    check_path(val["param"])
                if "concat" in val and isinstance(val["concat"], list):
                    for elem in val["concat"]:
                        check_val(elem)
                if "format" in val and "args" in val and isinstance(val["args"], dict):
                    for v in val["args"].values():
                        check_val(v)
                for v in val.values():
                    check_val(v)
            elif isinstance(val, list):
                for item in val:
                    check_val(item)
            elif isinstance(val, str):
                for m in expr_pattern.finditer(val):
                    check_path(m.group(1))

        def check_path(path: str) -> None:
            parts = path.split(".")
            root = parts[0]
            if root not in self.parameters:
                if root.startswith("__"):
                    return
                raise ValueError(
                    f"Template '{self.template_id}': Component references parameter"
                    f" '{root}' in '{path}', but it is not declared in template"
                    " parameters."
                )

            curr_schema = self.parameters[root]
            for part in parts[1:]:
                if "properties" in curr_schema:
                    props = curr_schema.get("properties", {})
                    if part not in props:
                        raise ValueError(
                            f"Template '{self.template_id}': Component references"
                            f" property '{part}' in '{path}', but it is not declared in"
                            f" parameter '{root}' properties."
                        )
                    curr_schema = props[part]

        for comp in self.components:
            check_val(comp)

        # 3. Validate sample_data against parameter definitions
        if self.sample_data and isinstance(self.sample_data, dict):
            for p_name, p_val in self.sample_data.items():
                if p_name in self.parameters:
                    p_meta = self.parameters[p_name]
                    p_type = p_meta.get("type")
                    if p_type in ["child", "children", "action"]:
                        continue

                    val_schema = normalize_a2ui_type_to_jsonschema(p_meta)
                    try:
                        jsonschema.validate(instance=p_val, schema=val_schema)
                    except jsonschema.ValidationError as err:
                        raise ValueError(
                            f"Template '{self.template_id}': sampleData for parameter"
                            f" '{p_name}' fails validation: {err.message}"
                        ) from err
