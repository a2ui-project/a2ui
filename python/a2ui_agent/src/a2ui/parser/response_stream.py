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
from typing import TYPE_CHECKING

from .response_part import ResponsePart

if TYPE_CHECKING:
    from a2ui.utils import RendererState


class ResponseStream(ABC):
    """Reads one streamed model response, chunk by chunk.

    A stream holds the text buffers of one response and the `RendererState`
    its messages are applied to. Each message it emits has been applied to the
    state, in the order emitted, and no other message has, so the state mirrors
    what a renderer that received the emitted parts holds.
    """

    @property
    @abstractmethod
    def state(self) -> RendererState:
        """The state the stream's messages are applied to."""

    @abstractmethod
    def feed(self, chunk: str) -> list[ResponsePart]:
        """Reads the next chunk and returns the parts that became ready.

        If it raises, the stream has ended: the response cannot be read further
        once part of it is rejected.

        Raises:
          A2uiParseError: If a block cannot be read.
          A2uiValidationError: If a message is rejected.
          ValueError: If the stream has ended.
        """

    @abstractmethod
    def close(self) -> list[ResponsePart]:
        """Ends the response and returns the parts still held back.

        Call it after the last chunk: text that could still have started a tag
        is held until then, and an unwrapped response is checked as a whole
        only then. Closing a stream that has ended returns nothing.

        Raises:
          A2uiParseError: If a block is still open.
          A2uiValidationError: If the messages the response left behind are
            rejected.
        """
