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

"""Abstract parser interface and legacy parsing compatibility helpers."""

import warnings
from abc import ABC, abstractmethod
from typing import List, Any
from .response_part import ResponsePart


class Parser(ABC):
    """Abstract interface defining the response parser and compiler."""

    @abstractmethod
    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        """Checks if the content contains blocks belonging to this parser's format.

        Args:
            content: The raw LLM response.
            complete: If True, checks that the format block is closed/complete.

        Returns:
            True if the content contains blocks belonging to this format.
        """
        pass

    def parse_response(self, content: str) -> List[ResponsePart]:
        """Parses full response content into standard JSON payload parts by unwrapping and compiling.

        Args:
            content: The raw LLM response.

        Returns:
            A list of ResponsePart objects containing text and compiled JSON.
        """
        parts = self.unwrap(content)
        for part in parts:
            if part.a2ui_raw is not None:
                part.a2ui_json = self.compile(part.a2ui_raw)
        return parts

    @abstractmethod
    def unwrap(self, content: str) -> List[ResponsePart]:
        """Tokenizes response content into raw format-content parts.

        Args:
            content: The raw LLM response.

        Returns:
            A list of ResponsePart objects with a2ui_raw populated.
        """
        pass

    @abstractmethod
    def compile(self, format_content: str) -> List[dict[str, Any]]:
        """Compiles raw format-content (inference format string) to structured A2UI messages.

        Args:
            format_content: The raw format-content extracted from response.

        Returns:
            A list of compiled A2UI message dictionaries.
        """
        pass

    @abstractmethod
    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Processes a streamed token chunk (incremental parsing).

        Args:
            chunk: The next text chunk from the stream.

        Returns:
            A list of parsed or completed ResponsePart objects.
        """
        pass


def has_a2ui_parts(content: str) -> bool:
    """Checks if the content has A2UI parts (legacy compatibility helper).

    Args:
        content: The raw response text.

    Returns:
        Whether the content contains open and close A2UI tags.
    """
    warnings.warn(
        "has_a2ui_parts is deprecated. Please use"
        " format.parser.has_format_content(content, complete=True) on your"
        " InferenceFormat instance instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    from a2ui.schema.constants import A2UI_OPEN_TAG, A2UI_CLOSE_TAG

    return A2UI_OPEN_TAG in content and A2UI_CLOSE_TAG in content


def parse_response(content: str) -> List[ResponsePart]:
    """Parses the LLM response into a list of ResponsePart objects (legacy).

    Args:
        content: The raw LLM response.

    Returns:
        A list of ResponsePart objects.
    """
    warnings.warn(
        "parse_response is deprecated. Please use format.parser.parse_response(...) "
        "on your InferenceFormat instance instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    from a2ui.inference_formats.transport.parser import unwrap_response
    from a2ui.parser.payload_fixer import parse_and_fix

    parts = unwrap_response(content)
    for part in parts:
        if part.a2ui_raw is not None:
            part.a2ui_json = parse_and_fix(part.a2ui_raw)
    return parts
