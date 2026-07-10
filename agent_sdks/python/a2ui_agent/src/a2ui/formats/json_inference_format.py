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
from typing import List, Any
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from . import InferenceFormat


class JsonInferenceFormat(InferenceFormat):
    """Standard JSON envelope format."""

    @property
    def name(self) -> str:
        return "json"

    def generate_workflow_rules(self, custom_workflow_description: str = "") -> str:
        from a2ui.schema.constants import DEFAULT_WORKFLOW_RULES

        rules = DEFAULT_WORKFLOW_RULES
        if custom_workflow_description:
            rules += f"\n{custom_workflow_description}"
        return rules

    def generate_instructions(self, catalog: A2uiCatalog) -> str:
        return catalog.render_as_llm_instructions()

    def parse_response(
        self,
        content: str,
        catalog: A2uiCatalog | None = None,
        surface_id: str | None = None,
    ) -> List[ResponsePart]:
        from a2ui.parser.parser import parse_response

        return parse_response(content)

    def decompile(self, val: dict[str, Any], catalog: A2uiCatalog) -> str:
        return json.dumps(val, indent=2)

    def detect_format(self, content: str) -> bool:
        from a2ui.schema.constants import A2UI_OPEN_TAG, A2UI_CLOSE_TAG

        return A2UI_OPEN_TAG in content and A2UI_CLOSE_TAG in content
