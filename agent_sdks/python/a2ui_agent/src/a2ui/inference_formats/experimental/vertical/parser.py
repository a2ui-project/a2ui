# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Parser utilities to extract and compile A2UI Vertical syntax from LLM responses."""

import re
from typing import Any, List, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from a2ui.parser.parser import Parser
from a2ui.schema.constants import (
    A2UI_INFERENCE_OPEN_TAG,
    A2UI_INFERENCE_CLOSE_TAG,
)
from .compiler import VerticalCompiler
from .decompiler import VerticalDecompiler

try:
    from google.adk.utils.feature_decorator import experimental
except ImportError:

    def experimental(cls):
        return cls


@experimental
class VerticalParser(Parser):
    """Parses, unwraps, compiles, and decompiles A2UI Vertical format responses."""

    def __init__(
        self,
        catalog: Union[Catalog[Any, Any], A2uiCatalog],
        surface_id: str = "main",
        version: str = "v1.0",
    ):
        """Initializes the Vertical parser.

        Args:
            catalog: Catalog or A2uiCatalog schema helper.
            surface_id: Default surface identifier for compiled messages.
            version: Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
        """
        self.catalog = catalog
        self.surface_id = surface_id
        self.version = version
        self._stream_parser = None

    @property
    def supports_streaming(self) -> bool:
        """Whether the parser supports streaming token chunk compilation."""
        return True

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Processes streamed token chunks incrementally, emitting a Surface per component.

        Args:
            chunk: The next token text chunk.

        Returns:
            A list of parsed or completed ResponsePart objects.
        """
        if self._stream_parser is None:
            from .streaming import VerticalStreamParser

            self._stream_parser = VerticalStreamParser(
                self.catalog, surface_id=self.surface_id, version=self.version
            )
        return self._stream_parser.process_chunk(chunk)

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        """Checks whether the given content string contains A2UI sentinel tags."""
        patterns = [
            (r"<a2ui\b", r"</a2ui\s*>"),
            (r"<a2ui-vertical\b", r"</a2ui-vertical\s*>"),
        ]
        for open_pat, close_pat in patterns:
            if complete:
                if re.search(open_pat, content, re.IGNORECASE) and re.search(
                    close_pat, content, re.IGNORECASE
                ):
                    return True
            else:
                if re.search(open_pat, content, re.IGNORECASE):
                    return True
        return False

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Tokenizes response content into raw Vertical parts and conversational text."""
        from a2ui.parser.lexer import BlockLexer

        lexer = BlockLexer(
            open_tag=re.compile(r"<(?:a2ui|a2ui-vertical)\b[^>]*>", re.IGNORECASE),
            close_tag=re.compile(r"</(?:a2ui|a2ui-vertical)\s*>", re.IGNORECASE),
            string_delimiters={"'", '"'},
            single_line_comments={"#", ";"},
        )
        return lexer.tokenize(content)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> List[dict[str, Any]]:
        """Compiles raw Vertical text into structured A2UI messages."""
        from a2ui.parser.errors import A2uiCompilationError

        compiler = VerticalCompiler(
            self.catalog, surface_id=self.surface_id, version=self.version
        )
        try:
            return compiler.compile(
                format_content,
                surface_id=self.surface_id,
                is_final=is_final,
                version=self.version,
            )
        except Exception as e:
            raise A2uiCompilationError(
                message=str(e),
                raw_content=format_content,
                help_message=(
                    "Please correct the syntax error in your Vertical UI component"
                    " expression."
                ),
            ) from e

    def decompile(self, val: Union[dict[str, Any], List[dict[str, Any]]]) -> str:
        """Decompiles structured A2UI payload into Vertical notation."""
        return VerticalDecompiler(self.catalog).decompile(val)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps multiple decompiled blocks with sentinel tags."""
        return VerticalDecompiler(self.catalog).wrap_decompiled_blocks(blocks)
