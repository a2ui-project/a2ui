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

from typing import List, Optional
from a2ui.inference_strategy import Parser
from a2ui.parser.response_part import ResponsePart
from a2ui.parser.parser import parse_response
from a2ui.parser.streaming import A2uiStreamParser
from a2ui.schema.catalog import A2uiCatalog
from a2ui.validation.validator import A2uiValidator


class A2uiSchemaParser(Parser):
    """Concrete parser implementation for standard A2UI JSON schema responses."""

    def __init__(
        self,
        catalog: A2uiCatalog,
        validator: Optional[A2uiValidator] = None,
    ):
        self._catalog = catalog
        self._validator = validator
        self._stream_parser: Optional[A2uiStreamParser] = None

    def parse_response(self, content: str) -> List[ResponsePart]:
        """Parses standard A2UI JSON tags in LLM responses."""
        return parse_response(content)

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Processes streamed token chunks incrementally."""
        if not self._stream_parser:
            self._stream_parser = A2uiStreamParser(self._catalog)
        return self._stream_parser.process_chunk(chunk)

    def has_a2ui_parts(self, content: str) -> bool:
        from a2ui.schema.constants import A2UI_OPEN_TAG

        return A2UI_OPEN_TAG.rstrip(">") in content
