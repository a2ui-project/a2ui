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

"""Parser utilities to extract and compile A2UI Express DSL from LLM responses."""

import re
from typing import Any, List, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from a2ui.parser.parser import Parser
from google.adk.utils.feature_decorator import experimental
from .compiler import ExpressCompiler

_A2UI_DSL_BLOCK_PATTERN = re.compile(r"<a2ui>(.*?)</a2ui>", re.DOTALL)


@experimental
class ExpressParser(Parser):
    """Concrete parser implementation for A2UI Express DSL responses."""

    def __init__(self, catalog: Union[Catalog[Any, Any], A2uiCatalog], surface_id: str = "main"):
        self.catalog = catalog
        self.surface_id = surface_id
        self._truncated_blocks = set()

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        if complete:
            return "<a2ui>" in content and "</a2ui>" in content
        return "<a2ui" in content

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Unwraps/tokenizes the response content into raw Express DSL parts."""
        # Handle unclosed tag auto-closing
        last_open = content.rfind("<a2ui>")
        last_close = content.rfind("</a2ui>")
        is_truncated = False
        if last_open != -1 and last_open > last_close:
            content += "</a2ui>"
            is_truncated = True

        matches = list(_A2UI_DSL_BLOCK_PATTERN.finditer(content))
        if not matches:
            return [ResponsePart(text=content, a2ui_raw=None)]

        response_parts = []
        last_end = 0

        for idx, match in enumerate(matches):
            start, end = match.span()
            text_part = content[last_end:start].strip()

            dsl_content = match.group(1).strip()
            
            is_block_final = not (is_truncated and idx == len(matches) - 1)
            if not is_block_final:
                self._truncated_blocks.add(dsl_content)

            response_parts.append(
                ResponsePart(
                    text=text_part if text_part else None,
                    a2ui_raw=dsl_content,
                )
            )
            last_end = end

        trailing_text = content[last_end:].strip()
        if trailing_text:
            response_parts.append(ResponsePart(text=trailing_text, a2ui_raw=None))

        return response_parts

    def compile(self, format_content: str) -> List[dict[str, Any]]:
        """Compiles raw Express DSL to structured A2UI messages."""
        compiler = ExpressCompiler(self.catalog)
        is_final = format_content not in self._truncated_blocks
        compiled_json = compiler.compile(
            format_content, surface_id=self.surface_id, is_final=is_final
        )
        self._truncated_blocks.discard(format_content)
        return [compiled_json]

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Express DSL is parsed as a whole script block; streaming is not supported."""
        raise NotImplementedError("Streaming parsing is not supported for Express DSL.")
