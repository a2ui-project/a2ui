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

import re
from typing import List, Optional, Any
from a2ui.parser.parser import Parser
from a2ui.parser.response_part import ResponsePart
from a2ui.schema.catalog import A2uiCatalog
from a2ui.validation.validator import A2uiValidator
from a2ui.schema.constants import A2UI_OPEN_TAG, A2UI_CLOSE_TAG
from a2ui.core import A2uiParseError
from a2ui.parser.payload_fixer import parse_and_fix

_A2UI_BLOCK_PATTERN = re.compile(
    f"{re.escape(A2UI_OPEN_TAG)}(.*?){re.escape(A2UI_CLOSE_TAG)}", re.DOTALL
)


def _sanitize_json_string(json_string: str) -> str:
    """Sanitizes the JSON string by removing markdown code blocks.

    Args:
        json_string: The raw JSON string.

    Returns:
        The sanitized JSON string.
    """
    json_string = json_string.strip()
    if json_string.startswith("```json"):
        json_string = json_string[len("```json") :]
    elif json_string.startswith("```"):
        json_string = json_string[len("```") :]
    if json_string.endswith("```"):
        json_string = json_string[: -len("```")]
    json_string = json_string.strip()
    return json_string


def unwrap_response(content: str) -> List[ResponsePart]:
    """Tokenizes the LLM response into a list of ResponsePart objects, extracting raw format content.

    Args:
        content: The raw LLM response.

    Returns:
        A list of ResponsePart objects.
    """
    matches = list(_A2UI_BLOCK_PATTERN.finditer(content))

    if not matches:
        raise A2uiParseError(
            f"A2UI tags '{A2UI_OPEN_TAG}' and '{A2UI_CLOSE_TAG}' not found in response."
        )

    response_parts = []
    last_end = 0

    for match in matches:
        start, end = match.span()
        text_part = content[last_end:start].strip()

        json_string = match.group(1)
        json_string_cleaned = _sanitize_json_string(json_string)
        if not json_string_cleaned:
            raise A2uiParseError("A2UI JSON part is empty.")

        response_parts.append(
            ResponsePart(text=text_part, a2ui_raw=json_string_cleaned)
        )
        last_end = end

    trailing_text = content[last_end:].strip()
    if trailing_text:
        response_parts.append(ResponsePart(text=trailing_text, a2ui_raw=None))

    return response_parts


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

    def compile(self, format_content: str) -> List[dict[str, Any]]:
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
