# Copyright 2024 Google LLC
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

from collections.abc import Sequence

from google.adk.utils.feature_decorator import experimental

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import check_mixed_catalogs
from a2ui.parser import (
    A2uiCompilationError,
    A2uiCompilationParseError,
    A2uiCompilationValidationError,
    Parser,
    ResponsePart,
)
from a2ui.parser.lexer import BlockLexer
from a2ui.schema.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG

from .compiler import ElementalCompiler
from .decompiler import ElementalDecompiler


@experimental
class ElementalParser(Parser):
    """Concrete parser implementation for A2UI Elemental TSX/HTML5 responses."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        surface_id: str = "main",
    ):
        """Initializes the parser with one or more component catalogs and target surface ID.

        Args:
            catalogs: A sequence of catalogs containing valid A2UI elements.
                Several catalogs need A2UI v1.0 or later.
            surface_id: The surface identifier for layout targeting.

        Raises:
            A2uiCatalogError: If `check_mixed_catalogs` rejects the catalogs.
        """
        self._catalogs = check_mixed_catalogs(catalogs)
        self.surface_id = surface_id
        # The compiler and decompiler precompute per-catalog schema data, so
        # they are built once instead of once per call.
        self._compiler = ElementalCompiler(self._catalogs)
        self._decompiler = ElementalDecompiler(self._catalogs)

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs the parser holds, in the order it received them."""
        return list(self._catalogs)

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

    def unwrap(self, content: str) -> list[ResponsePart]:
        """Unwraps and tokenizes response content into raw Elemental HTML parts.

        Args:
            content: The raw conversational text response containing HTML blocks.

        Returns:
            A list of response parts containing conversational or raw HTML text.
        """
        lexer = BlockLexer(
            open_tag=A2UI_INFERENCE_OPEN_TAG,
            close_tag=A2UI_INFERENCE_CLOSE_TAG,
            string_delimiters={"'", '"', "`"},
            single_line_comments={"//", "<!--"},
        )
        return lexer.tokenize(content)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> list[AgentToRendererMessage]:
        """Compiles raw Elemental HTML into structured A2UI layout operation messages.

        For partial streams (when `is_final` is False), a missing trailing
        `</body>` tag is appended to ensure successful DOM parsing.

        Args:
            format_content: The raw unwrapped Elemental HTML snippet to compile.
            is_final: Whether this represents the final complete snippet.

        Returns:
            A list of compiled AgentToRendererMessage objects.

        Raises:
            A2uiCompilationError: If compilation or schema validation fails.
        """
        if not is_final:
            stripped = format_content.strip()
            if "<body" in stripped and not stripped.endswith("</body>"):
                format_content = format_content + "\n</body>"

        try:
            return self._compiler.compile(format_content, surface_id=self.surface_id)
        except Exception as e:
            err_cls = A2uiCompilationError
            if isinstance(e, SyntaxError):
                err_cls = A2uiCompilationParseError
            elif isinstance(e, ValueError):
                err_cls = A2uiCompilationValidationError
            raise err_cls(
                message=str(e),
                raw_content=format_content,
                help_message=(
                    "Please correct the validation or syntax error in your Elemental"
                    " XML/HTML."
                ),
            ) from e

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles structured A2UI payload messages into this format's raw notation."""
        return self._decompiler.decompile(a2ui_payload)

    def decompile_blocks(
        self, a2ui_payload: Sequence[AgentToRendererMessage]
    ) -> list[str]:
        """Decompiles a payload into one Elemental block per coalesced message."""
        return self._decompiler.decompile_blocks(a2ui_payload)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Wraps multiple decompiled blocks with the format's enclosing tags/markers."""
        return self._decompiler.wrap_decompiled_blocks(blocks)
