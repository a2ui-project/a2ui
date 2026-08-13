# Copyright 2026 Google LLC
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
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


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
        return cls(
            template_id=template_id,
            parameters=data.get("parameters", {}),
            components=data.get("components", []),
            sample_data=data.get("sampleData") or data.get("sample_data"),
        )

    @classmethod
    def from_json_file(cls, file_path: str) -> Template:
        """Loads and parses a Template definition from a JSON file."""
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)
