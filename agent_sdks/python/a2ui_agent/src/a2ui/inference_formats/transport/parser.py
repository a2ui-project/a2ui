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

"""Parser and compiler implementation for standard A2UI JSON schema responses."""

from typing import List, Optional, Any
from a2ui.parser.parser import Parser
from a2ui.parser.response_part import ResponsePart
from a2ui.schema.catalog import A2uiCatalog
from a2ui.validation.validator import A2uiValidator
from a2ui.schema.constants import A2UI_OPEN_TAG, A2UI_CLOSE_TAG
from a2ui.core import A2uiParseError
from a2ui.parser.payload_fixer import parse_and_fix
from a2ui.inference_formats.transport.decompiler import _TransportDecompiler


def unwrap_response(content: str) -> List[ResponsePart]:
    """Tokenizes the LLM response into a list of ResponsePart objects, extracting raw format content.

    Args:
        content: The raw LLM response.

    Returns:
        A list of ResponsePart objects.
    """
    from a2ui.parser.lexer import BlockLexer

    lexer = BlockLexer(
        open_tag=A2UI_OPEN_TAG,
        close_tag=A2UI_CLOSE_TAG,
        string_delimiters={'"', "'"},
        single_line_comments=None,  # Standard JSON doesn't support comments
    )
    parts = lexer.tokenize(content)

    has_blocks = False
    valid_parts: List[ResponsePart] = []

    for part in parts:
        if part.a2ui_raw is not None:
            if not part.is_final:
                raise A2uiParseError(
                    f"A2UI close tag '{A2UI_CLOSE_TAG}' not found in response."
                )
            if not part.a2ui_raw:
                raise A2uiParseError("A2UI JSON part is empty.")

            valid_parts.append(part)
            has_blocks = True
        else:
            if part.text:
                valid_parts.append(part)

    if not has_blocks:
        raise A2uiParseError(
            f"A2UI tags '{A2UI_OPEN_TAG}' and '{A2UI_CLOSE_TAG}' not found in response."
        )

    return valid_parts


class TransportParser(Parser):
    """Concrete parser implementation for standard A2UI JSON schema responses (Transport Format)."""

    def __init__(
        self,
        catalog: A2uiCatalog,
        validator: Optional[A2uiValidator] = None,
    ):
        """Initializes the TransportParser.

        Args:
            catalog: The A2uiCatalog mapping schema identifiers.
            validator: Optional validator for payload verification.
        """
        self._catalog = catalog
        self._validator = validator
        self._stream_parser: Optional[Any] = None

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        from a2ui.schema.constants import A2UI_OPEN_TAG, A2UI_CLOSE_TAG

        if complete:
            return A2UI_OPEN_TAG in content and A2UI_CLOSE_TAG in content
        return A2UI_OPEN_TAG in content

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Tokenizes response content into raw format-content parts.

        Args:
            content: The raw response content.

        Returns:
            A list of unwrapped ResponsePart objects.
        """
        return unwrap_response(content)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> List[dict[str, Any]]:
        """Validates and compiles raw A2UI JSON schema content.

        Args:
            format_content: The raw A2UI JSON string.

        Returns:
            A list of compiled A2UI message dictionaries.
        """
        json_data = parse_and_fix(format_content)
        if self._validator:
            self._validator.validate(json_data)
        return json_data

    @property
    def supports_streaming(self) -> bool:
        return True

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Processes streamed token chunks incrementally.

        Args:
            chunk: The next token text chunk.

        Returns:
            A list of parsed or completed ResponsePart objects.
        """
        from a2ui.inference_formats.transport.streaming import TransportStreamParser

        if not self._stream_parser:
            self._stream_parser = TransportStreamParser(self._catalog)
        return self._stream_parser.process_chunk(chunk)

    def decompile(self, val: dict[str, Any]) -> str:
        """Decompiles a structured A2UI payload into this format's raw notation."""
        return _TransportDecompiler().decompile(val)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps multiple decompiled blocks with the format's enclosing tags/markers."""
        return _TransportDecompiler().wrap_decompiled_blocks(blocks)
