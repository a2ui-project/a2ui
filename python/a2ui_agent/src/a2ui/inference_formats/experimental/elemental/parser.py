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
from typing import Any, cast

from google.adk.utils.feature_decorator import experimental

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser import (
    Parser,
    RawA2uiPart,
    RawResponsePart,
    TextPart,
)
from a2ui.schema.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG

from .compiler import ElementalCompiler
from .decompiler import _ElementalDecompiler


@experimental
class ElementalParser(Parser):
    """Concrete parser implementation for A2UI Elemental TSX/HTML5 responses."""

    def __init__(self, catalog: CatalogApi, surface_id: str = "main"):
        """Initializes the parser with a component catalog and target surface ID.

        Args:
            catalog: The component catalog containing valid A2UI elements.
            surface_id: The surface identifier for layout targeting.
        """
        self.catalog = catalog
        self.surface_id = surface_id

    def has_format_content(self, content: str, complete: bool = False) -> bool:
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

    def wrap(self, blocks: Sequence[RawResponsePart]) -> str:
        """Wraps interleaved text and raw A2UI blocks into a unified response string."""
        triple_backticks = chr(96) * 3
        out: list[str] = []
        for block in blocks:
            inner = block.part if isinstance(block, RawResponsePart) else block
            if isinstance(inner, RawA2uiPart):
                out.append(
                    f"{triple_backticks}html\n{A2UI_INFERENCE_OPEN_TAG}\n"
                    f"{inner.a2ui_raw}\n{A2UI_INFERENCE_CLOSE_TAG}\n{triple_backticks}"
                )
            elif isinstance(inner, TextPart):
                out.append(inner.text or "")
            elif isinstance(inner, str):
                out.append(inner)
        return "\n".join(out)

    def unwrap(self, content: str) -> list[RawResponsePart]:
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
        return cast(list[RawResponsePart], lexer.tokenize(content))

    def compile(self, format_content: str) -> list[AgentToRendererMessage]:
        """Compiles raw Elemental HTML into structured A2UI layout operation messages.

        Args:
            format_content: The raw unwrapped Elemental HTML snippet to compile.

        Returns:
            A list of compiled A2UI operation messages.

        Raises:
            A2uiCompilationError: If compilation or schema validation fails.
        """
        from a2ui.parser import A2uiCompilationError

        compiler = ElementalCompiler(self.catalog)
        try:
            compiled_json = compiler.compile(format_content, surface_id=self.surface_id)
            return cast(list[AgentToRendererMessage], [compiled_json])
        except Exception as e:
            raise A2uiCompilationError(
                message=str(e),
                raw_content=format_content,
                help_message=(
                    "Please correct the validation or syntax error in your Elemental"
                    " XML/HTML."
                ),
            ) from e

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles a structured A2UI payload into this format's raw notation."""
        return _ElementalDecompiler(self.catalog).decompile(a2ui_payload)
