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

"""Parser utilities to extract and compile A2UI Elemental HTML from LLM responses."""

import re
from typing import Any, List, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from a2ui.parser.parser import Parser
from google.adk.utils.feature_decorator import experimental
from .compiler import ElementalCompiler, TAG_PREFIX

_A2UI_OPEN_PATTERN = re.compile(r"<a2ui\b[^>]*>", re.IGNORECASE)

_BLOCK_PATTERN = re.compile(
    r"<a2ui\b[^>]*>.*</a2ui>"
    f"|<{TAG_PREFIX}delete-surface\\b[^>]*>(?:.*?</{TAG_PREFIX}delete-surface>|/>)?"
    f"|<{TAG_PREFIX}call-function\\b[^>]*>(?:.*?</{TAG_PREFIX}call-function>|/>)?",
    re.DOTALL | re.IGNORECASE,
)


@experimental
class ElementalParser(Parser):
    """Concrete parser implementation for A2UI Elemental TSX/HTML5 responses."""

    def __init__(self, catalog: Union[Catalog[Any, Any], A2uiCatalog], surface_id: str = "main"):
        self.catalog = catalog
        self.surface_id = surface_id
        self._truncated_blocks = set()

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        if complete:
            return "<a2ui" in content and "</a2ui>" in content
        return "<a2ui" in content

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Unwraps/tokenizes the response content into raw Elemental HTML parts."""
        content_lower = content.lower()
        last_open_match = list(_A2UI_OPEN_PATTERN.finditer(content))
        last_close = content_lower.rfind("</a2ui>")

        is_truncated = False
        if last_open_match:
            last_open = last_open_match[-1].start()
            if last_open > last_close:
                content += "\n</a2ui>"
                is_truncated = True

        matches = list(_BLOCK_PATTERN.finditer(content))

        if not matches:
            return [ResponsePart(text=content, a2ui_raw=None)]

        response_parts = []
        last_end = 0

        for idx, match in enumerate(matches):
            start, end = match.span()

            text_part = content[last_end:start]
            text_part_stripped = re.sub(
                r"```html\s*$", "", text_part, flags=re.IGNORECASE
            ).strip()

            html_content = match.group(0).strip()
            
            is_block_final = not (is_truncated and idx == len(matches) - 1)
            if not is_block_final:
                self._truncated_blocks.add(html_content)

            response_parts.append(
                ResponsePart(
                    text=text_part_stripped if text_part_stripped else None,
                    a2ui_raw=html_content,
                )
            )
            last_end = end

        trailing_text = content[last_end:].strip()
        if trailing_text:
            response_parts.append(ResponsePart(text=trailing_text, a2ui_raw=None))

        return response_parts

    def compile(self, format_content: str) -> List[dict[str, Any]]:
        """Compiles raw Elemental HTML to structured A2UI messages."""
        compiler = ElementalCompiler(self.catalog)
        is_final = format_content not in self._truncated_blocks
        compiled_json = compiler.compile(
            format_content, surface_id=self.surface_id, is_final=is_final
        )
        self._truncated_blocks.discard(format_content)
        return [compiled_json]

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Elemental is parsed as a whole HTML5 document; streaming is not supported."""
        raise NotImplementedError(
            "Streaming parsing is not supported for Elemental HTML."
        )
