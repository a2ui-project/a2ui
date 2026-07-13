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

import json
from typing import Any, Optional
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from . import InferenceFormat


class JsonInferenceFormat(InferenceFormat):
    """Standard JSON envelope format."""

    def __init__(
        self,
        catalog: Optional[A2uiCatalog] = None,
        surface_id: str = "main",
    ):
        super().__init__(catalog, surface_id)

    @property
    def name(self) -> str:
        return "json"

    def format_description(self, custom_workflow_description: str = "") -> str:
        from a2ui.schema.constants import DEFAULT_WORKFLOW_RULES

        rules = DEFAULT_WORKFLOW_RULES
        if custom_workflow_description:
            rules += f"\n{custom_workflow_description}"
        return rules

    def catalog_description(self, include_schema: bool = True) -> str:
        if not self.catalog:
            return ""
        return self.catalog.render_as_llm_instructions()

    def parse_response(self, content: str) -> list[ResponsePart]:
        from a2ui.parser.parser import parse_response

        return parse_response(content)

    def decompile(self, val: dict[str, Any]) -> str:
        return json.dumps(val, indent=2)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        full_json = "\n\n".join(blocks)
        triple_backticks = chr(96) * 3
        return f"{triple_backticks}json\n{full_json}\n{triple_backticks}"
