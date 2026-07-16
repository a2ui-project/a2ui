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

from typing import Any, List, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from a2ui.parser.parser import Parser
from google.adk.utils.feature_decorator import experimental
from .compiler import ElementalCompiler


@experimental
class ElementalParser(Parser):
    """Concrete parser implementation for A2UI Elemental TSX/HTML5 responses."""

    def __init__(
        self, catalog: Union[Catalog[Any, Any], A2uiCatalog], surface_id: str = "main"
    ):
        self.catalog = catalog
        self.surface_id = surface_id

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        if complete:
            return "<a2ui" in content and "</a2ui>" in content
        return "<a2ui" in content

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Unwraps/tokenizes the response content into raw Elemental HTML parts."""
        from a2ui.parser.lexer import BlockLexer

        lexer = BlockLexer(
            open_tag="<a2ui>",
            close_tag="</a2ui>",
            string_delimiters={"'", '"', "`"},
            single_line_comments={"//", "<!--"},
        )
        parts = lexer.tokenize(content)
        for part in parts:
            if part.a2ui_raw is not None:
                # The Elemental HTML compiler (DomBuilder) parses standard DOM nodes and
                # expects the root node of the parsed document to be the enclosing <a2ui> tag.
                # Since BlockLexer returns raw content without the enclosing tags, we wrap it
                # back in `<a2ui>...</a2ui>` here before compilation.
                if not part.a2ui_raw.startswith("<a2ui"):
                    part.a2ui_raw = f"<a2ui>{part.a2ui_raw}</a2ui>"
        return parts

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> List[dict[str, Any]]:
        """Compiles raw Elemental HTML to structured A2UI messages."""
        from a2ui.parser.errors import A2uiCompilationError

        compiler = ElementalCompiler(self.catalog)
        try:
            compiled_json = compiler.compile(
                format_content, surface_id=self.surface_id, is_final=is_final
            )
            return [compiled_json]
        except Exception as e:
            raise A2uiCompilationError(
                message=str(e),
                raw_content=format_content,
                help_message="Please correct the validation or syntax error in your Elemental XML/HTML.",
            ) from e

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Elemental is parsed as a whole HTML5 document; streaming is not supported."""
        raise NotImplementedError(
            "Streaming parsing is not supported for Elemental HTML."
        )
