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

"""Abstract parser interface and legacy parsing compatibility helpers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
import warnings

from a2ui.core import A2uiError
from a2ui.core.schema import AgentToRendererMessage

from .response_part import (
    A2uiPart,
    RawA2uiPart,
    RawResponsePart,
    ResponsePart,
    TextPart,
)


class Parser(ABC):
    """Abstract base class for response parsers.

    Responsible for tokenizing LLM output streams, unwrapping format tags, and
    compiling raw format expressions into standard A2UI payload messages.
    """

    @abstractmethod
    def has_format_content(self, content: str, complete: bool = False) -> bool:
        """Reports whether the content carries a block written in this format.

        A caller uses this to decide whether a response is this format's
        business at all, without paying for a parse. It reads the sentinel tags
        only and never compiles.

        Args:
            content: Raw string response emitted by the LLM, possibly partial.
            complete: Whether to require a closed block. False matches an
                opening tag on its own, which is what a streaming caller needs
                to know it has started receiving a payload.

        Returns:
            True when the content carries a block belonging to this format.
        """

    @abstractmethod
    def wrap(self, blocks: Sequence[RawResponsePart]) -> str:
        """Converts a sequence of RawResponseParts to a string, adding enclosing tags or markers around each raw A2UI section and concatenating conversational text parts."""

    @abstractmethod
    def unwrap(self, content: str) -> list[RawResponsePart]:
        """Tokenizes the LLM response into an ordered list of RawResponsePart objects, extracting raw format content between sentinel tags while preserving chronological order.

        Args:
            content: Raw string response emitted by the LLM.

        Returns:
            An ordered list of RawResponsePart objects representing alternating
            slices of conversational text and tagged A2UI payload blocks
            exactly as emitted by the LLM.
        """

    @abstractmethod
    def compile(self, format_content: str) -> list[AgentToRendererMessage]:
        """Compiles a raw format content string into a list of validated A2UI message structures.

        Args:
            format_content: The uncompiled raw payload string (e.g. raw JSON or
                DSL expression).

        Returns:
            List of compiled AgentToRendererMessage objects.
        """

    @abstractmethod
    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles structured A2UI payload messages into this format's raw notation.

        Args:
            a2ui_payload: Sequence of AgentToRendererMessage objects to convert to
                raw format text.

        Returns:
            Raw format content string representing the messages.
        """

    def parse_response(self, content: str, wrapped: bool = True) -> list[ResponsePart]:
        """Generic non-streaming response parsing.

        Unwraps raw LLM text and compiles valid A2UI payloads, preserving the
        exact chronological order of conversational text and A2UI payload
        blocks.

        Args:
            content: Complete raw text response emitted by the LLM.
            wrapped: Whether the output is expected to be wrapped inside format
                sentinel tags.

        Returns:
            List of ResponsePart objects (TextPart / A2uiPart).
        """
        if wrapped:
            parts = self.unwrap(content)
            result: list[ResponsePart] = []
            for raw_part in parts:
                if isinstance(raw_part, RawResponsePart):
                    if isinstance(raw_part.part, TextPart):
                        result.append(raw_part.part)
                    elif isinstance(raw_part.part, RawA2uiPart):
                        compiled = self.compile(raw_part.part.a2ui_raw)
                        result.append(A2uiPart(a2ui=compiled))
                elif isinstance(raw_part, ResponsePart):
                    if raw_part.a2ui_raw is not None:
                        try:
                            raw_part.a2ui_json = self.compile(raw_part.a2ui_raw)
                        except A2uiError as e:
                            setattr(e, "partial_results", result)
                            raise
                        except Exception as e:
                            from .errors import A2uiCompilationError

                            raise A2uiCompilationError(
                                message=str(e),
                                raw_content=raw_part.a2ui_raw,
                                partial_results=result,
                            ) from e
                    result.append(raw_part)
            return result
        return [A2uiPart(a2ui=self.compile(content))]

    @property
    def supports_streaming(self) -> bool:
        """Whether this parser can read a response incrementally through parse_chunk.

        A format can only stream if a partial block already means something.
        Direct JSON can, because an unfinished object can be healed and re-read
        as it grows. Express cannot: its notation resolves references across
        the whole block, so a block is read once it is closed and not before.
        A parser that returns False here buffers the response and is parsed
        whole through parse_response.
        """
        return False

    def parse_chunk(self, chunk: str, wrapped: bool = True) -> list[ResponsePart]:
        """Processes streaming response chunks incrementally.

        Implemented only by parsers whose supports_streaming is True. The
        default refuses, so that a caller handed a non-streaming parser fails
        at the call rather than silently receiving nothing.

        Args:
            chunk: Incremental text chunk received from the LLM stream.
            wrapped: Whether the output stream is expected to be wrapped inside
                format sentinel tags.

        Returns:
            List of newly parsed ResponsePart objects (incremental delta)
            extracted since the last chunk.

        Raises:
            NotImplementedError: If this format does not support streaming.
        """
        raise NotImplementedError(
            f"Streaming is not supported by {self.__class__.__name__}"
        )


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
    from a2ui.schema.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG

    return A2UI_OPEN_TAG in content and A2UI_CLOSE_TAG in content


def parse_response(content: str) -> list[ResponsePart]:
    """Parses the LLM response into a list of ResponsePart objects (legacy).

    Args:
        content: The raw LLM response.

    Returns:
        A list of ResponsePart objects.
    """
    warnings.warn(
        "parse_response is deprecated. Please use format.parser.parse_response(...)"
        " on your InferenceFormat instance instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    from a2ui.inference_formats.direct_json.parser import unwrap_response

    from .payload_fixer import parse_and_fix

    parts = unwrap_response(content)
    for part in parts:
        if part.a2ui_raw is not None:
            part.a2ui_json = parse_and_fix(part.a2ui_raw)
    return parts


__all__ = [
    "Parser",
    "has_a2ui_parts",
    "parse_response",
]
