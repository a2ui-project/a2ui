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

"""The stream that reads one model response chunk by chunk."""

from __future__ import annotations

from abc import ABC
from abc import abstractmethod
from typing import Generic, TYPE_CHECKING, TypeVar

from .response_part import StreamPart

if TYPE_CHECKING:
    from a2ui.utils import RendererState

PartT = TypeVar("PartT", bound=StreamPart, covariant=True)


class ResponseStream(ABC, Generic[PartT]):
    """Reads one streamed model response, chunk by chunk.

    A stream holds the text buffers of one response and the `RendererState`
    its messages are applied to. Each message it emits, whether `feed` and
    `close` return it or a raised error carries it in `partial_results`, has
    been applied to the state, in the order emitted, and no other message has,
    so the state mirrors what a renderer that received the emitted parts holds.

    What happens once a block is rejected depends on how the stream was
    opened. By default the stream ends: `feed` or `close` raises. A stream
    opened with `after_rejected_block="continue"` returns an `ErrorPart` in
    place of the block instead, drops what the block had not emitted yet, and
    goes on with the text and blocks after it.

    `PartT` is the type of the parts the stream returns: `StreamPart` for a
    stream that reads past rejected blocks, and `ResponsePart` for one that
    ends at them.
    """

    @property
    @abstractmethod
    def state(self) -> RendererState:
        """The state the stream's messages are applied to."""

    @property
    @abstractmethod
    def is_in_block(self) -> bool:
        """Whether the response read so far ends inside a block.

        True after an opening tag and before its closing tag. An unwrapped
        response is one block, so its stream is inside it until it ends. Text
        held back because it could start a tag is not inside a block. False
        once the stream has ended.

        A caller that joins the chunks of a paused and resumed response reads
        it to tell whether it may add text between them, such as a space,
        which inside a block could break the block.
        """

    @abstractmethod
    def feed(self, chunk: str) -> list[PartT]:
        """Reads the next chunk and returns the parts that became ready.

        If it raises, the stream has ended, and the error's `partial_results`
        holds the parts the chunk made ready before the failure. They have
        been applied to the state like the parts of any earlier chunk, so the
        caller shows them too.

        Raises:
          A2uiParseError: If a block cannot be read and the stream ends at a
            rejected block.
          A2uiValidationError: If a message is rejected and the stream ends at
            a rejected block.
          ValueError: If the stream has ended.
        """

    @abstractmethod
    def close(self) -> list[PartT]:
        """Ends the response and returns the parts still held back.

        Call it after the last chunk: text that could still have started a tag
        is held until then, and an unwrapped response is checked as a whole
        only then. Closing a stream that has ended returns nothing. If it
        raises, the error's `partial_results` holds the parts made ready
        before the failure, as for `feed`.

        Raises:
          A2uiParseError: If a block is still open and the stream ends at a
            rejected block. A stream that reads past rejected blocks returns
            an `ErrorPart` for it instead.
          A2uiValidationError: If the messages the response left behind are
            rejected and the stream ends at a rejected block.
        """
