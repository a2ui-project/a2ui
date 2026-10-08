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

from __future__ import annotations

from abc import ABC
from abc import abstractmethod
from collections.abc import Sequence

from a2ui.core import A2uiError
from a2ui.core.schema import AgentToRendererMessage
from .errors import A2uiCompilationError
from .response_part import A2uiPart
from .response_part import RawA2uiPart
from .response_part import RawResponsePart
from .response_part import ResponsePart
from .response_part import TextPart


class Parser(ABC):
    """Abstract base class for A2UI payload parsers."""

    @abstractmethod
    def has_format_content(self, content: str, complete: bool = False) -> bool:
        """Checks if the content contains format-specific syntax or blocks.

        Args:
          content: The string content to check.
          complete: If True, checks if at least one format block is fully closed.

        Returns:
          True if format content is detected, False otherwise.
        """

    @abstractmethod
    def wrap(self, blocks: Sequence[RawResponsePart]) -> str:
        """Wraps text and raw A2UI blocks into a single LLM-formatted string."""

    @abstractmethod
    def unwrap(self, content: str) -> list[RawResponsePart]:
        """Splits raw LLM response content into text and raw A2UI blocks."""

    @abstractmethod
    def compile(self, format_content: str) -> list[AgentToRendererMessage]:
        """Compiles a single raw A2UI block into validated A2UI messages."""

    @abstractmethod
    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Converts a sequence of A2UI messages back into the format's syntax."""

    def parse_response(self, content: str, wrapped: bool = True) -> list[ResponsePart]:
        """Parses a complete LLM response into a list of ResponsePart objects."""
        if not wrapped:
            try:
                compiled = self.compile(content)
            except A2uiError:
                raise
            except Exception as e:
                raise A2uiCompilationError(
                    f"Failed to compile A2UI block: {e}", content
                ) from e
            return [A2uiPart(a2ui=compiled)]

        raw_parts = self.unwrap(content)
        response_parts: list[ResponsePart] = []

        for raw_part in raw_parts:
            if isinstance(raw_part.part, TextPart):
                response_parts.append(raw_part.part)
            elif isinstance(raw_part.part, RawA2uiPart):
                try:
                    compiled = self._compile_raw_part(raw_part)
                    response_parts.append(A2uiPart(a2ui=compiled))
                except A2uiError as e:
                    setattr(e, "partial_results", response_parts)
                    raise
                except Exception as e:
                    err = A2uiCompilationError(
                        f"Failed to compile A2UI block: {e}",
                        raw_part.part.a2ui_raw,
                    )
                    setattr(err, "partial_results", response_parts)
                    raise err from e

        return response_parts

    def _compile_raw_part(
        self, raw_part: RawResponsePart
    ) -> list[AgentToRendererMessage]:
        """Compiles a RawResponsePart containing a RawA2uiPart."""
        assert isinstance(raw_part.part, RawA2uiPart)
        return self.compile(raw_part.part.a2ui_raw)

    @property
    def supports_streaming(self) -> bool:
        """Indicates whether this parser supports incremental chunk streaming."""
        return False

    def parse_chunk(self, chunk: str, wrapped: bool = True) -> list[ResponsePart]:
        """Processes a single chunk of streamed LLM output."""
        raise NotImplementedError(
            f"Streaming is not supported by {self.__class__.__name__}"
        )
