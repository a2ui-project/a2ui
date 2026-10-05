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

"""Parser and compiler implementation for standard A2UI JSON schema responses."""

from typing import Any

from a2ui.core import A2uiParseError, CatalogApi
from a2ui.inference_formats.direct_json.decompiler import _DirectJsonDecompiler
from a2ui.parser.parser import Parser
from a2ui.parser.payload_fixer import parse_and_fix
from a2ui.parser.response_part import ResponsePart
from a2ui.schema.constants import (
    A2UI_CLOSE_TAG,
    A2UI_OPEN_TAG,
    DEFAULT_PROGRESSIVE_KEYS,
)
from a2ui.utils import validate_payload


def unwrap_response(content: str) -> list[ResponsePart]:
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
    valid_parts: list[ResponsePart] = []

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


class DirectJsonParser(Parser):
    """Concrete parser implementation for standard A2UI JSON schema responses (Direct JSON Format)."""

    def __init__(
        self,
        catalog: CatalogApi,
        *,
        progressive_keys: frozenset[str] = DEFAULT_PROGRESSIVE_KEYS,
    ):
        """Initializes the DirectJsonParser.

        Args:
            catalog: The catalog that payloads are validated against.
            progressive_keys: Keys whose string values the stream parser may
                auto-close when cut. An empty set turns healing off.
        """
        self._catalog = catalog
        self._progressive_keys = progressive_keys
        self._stream_parser: Any | None = None

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        if complete:
            return A2UI_OPEN_TAG in content and A2UI_CLOSE_TAG in content
        return A2UI_OPEN_TAG in content

    def unwrap(self, content: str) -> list[ResponsePart]:
        """Tokenizes response content into raw format-content parts.

        Args:
            content: The raw response content.

        Returns:
            A list of unwrapped ResponsePart objects.
        """
        return unwrap_response(content)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> list[dict[str, Any]]:
        """Validates and compiles raw A2UI JSON schema content.

        A final payload is checked with `validate_payload`, which runs it
        through a `MessageProcessor` holding the catalog, as the stream parser
        checks its messages. A partial payload isn't checked, since it may be
        cut mid-message.

        Args:
            format_content: The raw A2UI JSON string.
            is_final: Whether the content is the complete payload.

        Returns:
            A list of compiled A2UI message dictionaries.

        Raises:
            A2uiValidationError: If the payload fails validation.
        """
        json_data = parse_and_fix(format_content)
        if is_final:
            validate_payload([self._catalog], json_data)
        return json_data

    @property
    def supports_streaming(self) -> bool:
        return True

    def process_chunk(self, chunk: str) -> list[ResponsePart]:
        """Processes streamed token chunks incrementally.

        Args:
            chunk: The next token text chunk.

        Returns:
            A list of parsed or completed ResponsePart objects.
        """
        from a2ui.inference_formats.direct_json.streaming import DirectJsonStreamParser

        if not self._stream_parser:
            self._stream_parser = DirectJsonStreamParser(
                self._catalog,
                progressive_keys=self._progressive_keys,
            )
        return self._stream_parser.process_chunk(chunk)

    def decompile(self, val: dict[str, Any]) -> str:
        """Decompiles a structured A2UI payload into this format's raw notation."""
        return _DirectJsonDecompiler().decompile(val)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Wraps multiple decompiled blocks with the format's enclosing tags/markers."""
        return _DirectJsonDecompiler().wrap_decompiled_blocks(blocks)
