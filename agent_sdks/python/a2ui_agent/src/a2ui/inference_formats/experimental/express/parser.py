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

from typing import Any, List, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from a2ui.parser.parser import Parser
from google.adk.utils.feature_decorator import experimental
from .compiler import ExpressCompiler


@experimental
class ExpressParser(Parser):
    """Concrete parser implementation for A2UI Express DSL responses."""

    def __init__(
        self, catalog: Union[Catalog[Any, Any], A2uiCatalog], surface_id: str = "main"
    ):
        self.catalog = catalog
        self.surface_id = surface_id

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        if complete:
            return "<a2ui>" in content and "</a2ui>" in content
        return "<a2ui" in content

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Unwraps/tokenizes the response content into raw Express DSL parts."""
        from a2ui.parser.lexer import BlockLexer

        lexer = BlockLexer(
            open_tag="<a2ui>",
            close_tag="</a2ui>",
            string_delimiters={"'", '"'},
            single_line_comments={"#"},
        )
        return lexer.tokenize(content)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> List[dict[str, Any]]:
        """Compiles raw Express DSL to structured A2UI messages."""
        from a2ui.parser.errors import A2uiCompilationError

        compiler = ExpressCompiler(self.catalog)
        try:
            compiled_json = compiler.compile(
                format_content, surface_id=self.surface_id, is_final=is_final
            )
            return [compiled_json]
        except (SyntaxError, ValueError) as e:
            orig_err = e
            if isinstance(e, ValueError) and isinstance(e.__cause__, SyntaxError):
                orig_err = e.__cause__
            line = getattr(orig_err, "lineno", None)
            column = getattr(orig_err, "offset", None)
            raise A2uiCompilationError(
                message=str(e),
                raw_content=format_content,
                line=line,
                column=column,
                help_message="Please correct the syntax error in your Express DSL.",
            ) from e

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Express DSL is parsed as a whole script block; streaming is not supported."""
        raise NotImplementedError("Streaming parsing is not supported for Express DSL.")
