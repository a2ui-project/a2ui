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
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import jsonschema


@dataclass
class Template:
    """Represents a reusable, parameterized A2UI component template."""

    template_id: str
    parameters: Dict[str, Dict[str, Any]]
    components: List[Dict[str, Any]]
    sample_data: Optional[Dict[str, Any]] = None

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
        if self.sample_data is not None:
            res["sampleData"] = self.sample_data
        return res

    def validate_definition(self) -> None:
        """Statically validates parameter schemas, internal expressions, and sample data."""
        # 1. Validate parameter definitions
        for p_name, p_schema in self.parameters.items():
            if not isinstance(p_schema, dict):
                raise ValueError(
                    f"Template '{self.template_id}': Parameter '{p_name}' schema must"
                    " be an object/dict."
                )

        # 2. Extract and validate all parameter references within component definitions
        expr_pattern = re.compile(r"\$\{([\w\.]+)\}")

        def check_val(val: Any) -> None:
            if isinstance(val, dict):
                if "param" in val and isinstance(val["param"], str):
                    check_path(val["param"])
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
                # Allow special tokens or parameters
                if root.startswith("__"):
                    return
                raise ValueError(
                    f"Template '{self.template_id}': Component references"
                    f" '${{{path}}}', but parameter '{root}' is not declared in"
                    " parameters."
                )

            # Check nested properties if object schema is declared
            curr_schema = self.parameters[root]
            for part in parts[1:]:
                if "properties" in curr_schema:
                    props = curr_schema.get("properties", {})
                    if part not in props:
                        raise ValueError(
                            f"Template '{self.template_id}': Component references"
                            f" '${{{path}}}', but property '{part}' is not declared in"
                            f" parameter '{root}' schema properties."
                        )
                    curr_schema = props[part]

        for comp in self.components:
            check_val(comp)

        # 3. Validate sample_data against parameter schemas if provided
        if self.sample_data and isinstance(self.sample_data, dict):
            for p_name, p_val in self.sample_data.items():
                if p_name in self.parameters:
                    schema_copy = dict(self.parameters[p_name])
                    schema_copy.pop("dynamic", None)
                    # Ignore child/children pseudo-types for raw JSON schema validation
                    if schema_copy.get("type") in ["child", "children"]:
                        continue
                    try:
                        jsonschema.validate(instance=p_val, schema=schema_copy)
                    except jsonschema.ValidationError as err:
                        raise ValueError(
                            f"Template '{self.template_id}': sampleData for parameter"
                            f" '{p_name}' fails schema validation: {err.message}"
                        ) from err
