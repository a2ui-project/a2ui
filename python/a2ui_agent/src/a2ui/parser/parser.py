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

from __future__ import annotations

from abc import ABC
from abc import abstractmethod
from collections.abc import Mapping
from collections.abc import Sequence
from typing import Any
from typing import TYPE_CHECKING

from a2ui.core import A2uiError
from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from .errors import A2uiCompilationError
from .messages import to_message_models
from .response_part import A2uiPart
from .response_part import RawA2uiPart
from .response_part import RawResponsePart
from .response_part import ResponsePart
from .response_part import TextPart
from .response_stream import ResponseStream

if TYPE_CHECKING:
    from a2ui.utils import RendererState


class Parser(ABC):
    """Abstract base class for A2UI payload parsers.

    A format implements `compile` and `decompile`, which translate between its
    notation and A2UI messages, and the tag handling around them. The base
    class reads model responses: `parse_response` reads a whole one and
    `open_stream` a streamed one, and both check every message they compile
    against a `RendererState`, the one a call is given or a new one. A chat
    agent passes none, so every turn shows new UI. A canvas agent passes the
    same state every turn, so each turn is checked against the surfaces
    earlier turns built.

    A parser holds no state, so one parser can be reused across turns and
    responses.
    """

    @property
    @abstractmethod
    def catalogs(self) -> list[CatalogApi]:
        """The active catalogs in priority order."""

    @abstractmethod
    def has_format_content(self, content: str, complete: bool = False) -> bool:
        """Checks if the content contains format-specific syntax or blocks.

        Counts both sentinel-tagged blocks and any single block recovered by
        `unwrap` when its opening sentinel tag was omitted.

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
        """Splits raw LLM response content into text and raw A2UI blocks.

        In one-shot parsing, also recovers at most one payload block whose
        opening sentinel tag was omitted when closed by this format's closing
        tag (streaming via `parse_chunk` requires the opening sentinel tag).
        """

    @abstractmethod
    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> Sequence[AgentToRendererMessage | Mapping[str, Any]]:
        """Compiles a single raw A2UI block into A2UI messages.

        Compiling translates the notation and reports what the notation itself
        gets wrong. It does not check the messages against the catalogs or a
        renderer state: `parse_response` and `open_stream` do, and
        `parse_response(block, wrapped=False)` compiles and checks one block.

        Args:
          format_content: The text of the block.
          is_final: False if the block is still open, as at the end of a
            truncated response.
        """

    @abstractmethod
    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Converts a sequence of A2UI messages back into the format's syntax."""

    def _empty_state(self) -> RendererState:
        """Creates the empty state a call uses when it is given none.

        A call without a state checks a response that shows new UI, so an
        update to a surface the response did not create is rejected.
        """
        from a2ui.utils import RendererState

        return RendererState(self.catalogs)

    def parse_response(
        self,
        content: str,
        wrapped: bool = True,
        *,
        state: RendererState | None = None,
    ) -> list[ResponsePart]:
        """Parses a complete LLM response into a list of ResponsePart objects.

        Nothing has been sent when a whole response is parsed, so it is
        checked as a whole: a component may name a child that a later block
        adds, and the trees of the surfaces the response touches are checked
        once every block is applied. The messages are applied to the state all
        or nothing: if any check fails, the state is left as it was.

        A block cut off at the end of the response, which formats other than
        Direct JSON compile as far as it goes, is applied too, but the trees of
        the surfaces it touches are not checked.

        Args:
          content: The response text.
          wrapped: False if the whole response is one block, without tags.
          state: The state to check and apply the messages against. A new
            state for this call when None.

        Raises:
          A2uiError: If a block cannot be read or the state rejects it. The
            error's `partial_results` holds the parts before the failing block,
            or only the text when a tree check fails, since that check spans
            every block. None of them is applied to the state.
        """
        target = state if state is not None else self._empty_state()
        response_parts: list[ResponsePart] = []
        touched: dict[str, None] = {}
        incomplete: set[str] = set()
        with target.transaction():
            try:
                raw_parts = (
                    self.unwrap(content)
                    if wrapped
                    else [
                        RawResponsePart(
                            part=RawA2uiPart(a2ui_raw=content), is_final=True
                        )
                    ]
                )
                for raw_part in raw_parts:
                    if isinstance(raw_part.part, TextPart):
                        response_parts.append(raw_part.part)
                    elif isinstance(raw_part.part, RawA2uiPart):
                        messages, block_touched = self._apply_block(
                            raw_part.part.a2ui_raw, raw_part.is_final, target
                        )
                        response_parts.append(A2uiPart(a2ui=messages))
                        touched.update(dict.fromkeys(block_touched))
                        if not raw_part.is_final:
                            incomplete.update(block_touched)
            except A2uiError as e:
                setattr(e, "partial_results", response_parts)
                raise
            try:
                complete = [s for s in touched if s not in incomplete]
                if complete:
                    target.check_topology(complete)
            except A2uiError as e:
                # The tree check spans every block, so no block is known to be
                # good: only the text is kept.
                setattr(
                    e,
                    "partial_results",
                    [p for p in response_parts if isinstance(p, TextPart)],
                )
                raise
            # A truncated block's messages are kept, as the renderer the caller
            # sends them to will hold them, but its trees are not checked: a
            # cut-off block is missing what it would have added. Its components
            # are marked checked, so a later turn is not required to make them
            # reachable; its dangling references and a missing root are still
            # reported when a later turn checks the surface.
            target.mark_checked(incomplete)
        return response_parts

    def _apply_block(
        self, format_content: str, is_final: bool, state: RendererState
    ) -> tuple[list[AgentToRendererMessage], list[str]]:
        """Compiles a block and applies its messages, without checking trees.

        Returns:
          The messages, and the surfaces they touched.

        Raises:
          A2uiError: If the block cannot be read or the state rejects it. Any
            other failure to compile is raised as `A2uiCompilationError`.
        """
        try:
            messages = self.compile(format_content, is_final=is_final)
        except A2uiError:
            raise
        except Exception as e:
            raise A2uiCompilationError(
                f"Failed to compile A2UI block: {e}", format_content
            ) from e
        touched = state.apply(messages)
        return to_message_models(messages), touched

    @property
    def supports_streaming(self) -> bool:
        """Whether `open_stream` can read a response from this format chunk by chunk."""
        return False

    def open_stream(
        self, *, wrapped: bool = True, state: RendererState | None = None
    ) -> ResponseStream:
        """Opens a stream that reads one response chunk by chunk.

        Args:
          wrapped: False if the whole response is one block, without tags.
          state: The state to check and apply the messages against. A new
            state for this call when None.

        Raises:
          NotImplementedError: If the format cannot be read incrementally.
        """
        raise NotImplementedError(
            f"Streaming is not supported by {self.__class__.__name__}"
        )

    def flush(self) -> list[ResponsePart]:
        """Flushes any buffered tokens or parts held at the end of the stream."""
        return []
