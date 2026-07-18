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
from a2ui.schema.constants import A2UI_INFERENCE_OPEN_TAG, A2UI_INFERENCE_CLOSE_TAG
from .compiler import ExpressCompiler
from .decompiler import _ExpressDecompiler


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
            return (
                A2UI_INFERENCE_OPEN_TAG in content
                and A2UI_INFERENCE_CLOSE_TAG in content
            )
        return A2UI_INFERENCE_OPEN_TAG[:-1] in content

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Unwraps/tokenizes the response content into raw Express DSL parts."""
        from a2ui.parser.lexer import BlockLexer

        lexer = BlockLexer(
            open_tag=A2UI_INFERENCE_OPEN_TAG,
            close_tag=A2UI_INFERENCE_CLOSE_TAG,
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

    def decompile(self, val: dict[str, Any]) -> str:
        """Decompiles a structured A2UI payload into this format's raw notation."""
        return _ExpressDecompiler(self.catalog).decompile(val)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps multiple decompiled blocks with the format's enclosing tags/markers."""
        return _ExpressDecompiler(self.catalog).wrap_decompiled_blocks(blocks)
