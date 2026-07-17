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
from a2ui.schema.constants import A2UI_INFERENCE_OPEN_TAG, A2UI_INFERENCE_CLOSE_TAG
from .compiler import ElementalCompiler
from .decompiler import _ElementalDecompiler


@experimental
class ElementalParser(Parser):
    """Concrete parser implementation for A2UI Elemental TSX/HTML5 responses."""

    def __init__(
        self, catalog: Union[Catalog[Any, Any], A2uiCatalog], surface_id: str = "main"
    ):
        """Initializes the parser with a component catalog and target surface ID.

        Args:
            catalog: The component catalog containing valid A2UI elements.
            surface_id: The surface identifier for layout targeting.
        """
        self.catalog = catalog
        self.surface_id = surface_id

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        """Checks if the content contains any A2UI Elemental sentinel tags.

        Args:
            content: The raw text content to inspect.
            complete: Whether to check for both opening and closing tags.

        Returns:
            True if sentinel tags are detected, False otherwise.
        """
        if complete:
            return (
                A2UI_INFERENCE_OPEN_TAG[:-1] in content
                and A2UI_INFERENCE_CLOSE_TAG in content
            )
        return A2UI_INFERENCE_OPEN_TAG[:-1] in content

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Unwraps and tokenizes response content into raw Elemental HTML parts.

        Args:
            content: The raw conversational text response containing HTML blocks.

        Returns:
            A list of response parts containing conversational or raw HTML text.
        """
        from a2ui.parser.lexer import BlockLexer

        lexer = BlockLexer(
            open_tag=A2UI_INFERENCE_OPEN_TAG,
            close_tag=A2UI_INFERENCE_CLOSE_TAG,
            string_delimiters={"'", '"', "`"},
            single_line_comments={"//", "<!--"},
        )
        return lexer.tokenize(content)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> List[dict[str, Any]]:
        """Compiles raw Elemental HTML into structured A2UI layout operation messages.

        For partial streams (when `is_final` is False), missing trailing tags (like
        `</body>` or `</a2ui>`) are automatically appended to ensure successful DOM parsing.

        Args:
            format_content: The raw unwrapped Elemental HTML snippet to compile.
            is_final: Whether this represents the final complete snippet.

        Returns:
            A list of compiled A2UI operation dictionaries (e.g. createSurface).

        Raises:
            A2uiCompilationError: If compilation or schema validation fails.
        """
        from a2ui.parser.errors import A2uiCompilationError

        if not is_final:
            stripped = format_content.strip()
            if "<body" in stripped and not stripped.endswith("</body>"):
                format_content = format_content + "\n</body>"

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
                help_message=(
                    "Please correct the validation or syntax error in your Elemental"
                    " XML/HTML."
                ),
            ) from e

    def decompile(self, val: dict[str, Any]) -> str:
        """Decompiles a structured A2UI payload into this format's raw notation."""
        return _ElementalDecompiler(self.catalog).decompile(val)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps multiple decompiled blocks with the format's enclosing tags/markers."""
        return _ElementalDecompiler(self.catalog).wrap_decompiled_blocks(blocks)
