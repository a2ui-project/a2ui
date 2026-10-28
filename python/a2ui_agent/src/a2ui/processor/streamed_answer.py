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

"""One streamed model answer, for an app that is both the agent and the renderer."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Union

from a2ui.core import MessageProcessor, SurfaceModel
from a2ui.parser import ErrorPart, StreamPart, TextPart, to_message_dicts
from a2ui.utils import RendererState

from .processor import A2uiRequestProcessor


@dataclass
class AnswerTextPart:
    """Text the model wrote between two surfaces, or before or after them."""

    text: str


@dataclass
class AnswerSurfacePart:
    """A surface the answer created, where the model wrote it."""

    surface: SurfaceModel


AnswerPart = Union[AnswerTextPart, AnswerSurfacePart, ErrorPart]


class StreamedAnswer:
    """One model answer, read as it streams, for an app that is both the agent and the renderer.

    The answer opens a stream on the request processor that applies each
    message to the renderer's processor through `RendererState.of`, and reads
    past a rejected block. It keeps the answer's parts in the order the model
    wrote them: the text, one part per surface the answer creates, and an
    `ErrorPart` where a block was rejected, followed by the text and surfaces
    after it. A surface the answer deletes leaves the parts.

    Text the stream returns in pieces is joined into one part until a block
    comes between.
    """

    def __init__(
        self, processor: A2uiRequestProcessor, *, renderer: MessageProcessor
    ) -> None:
        """Opens the answer's stream.

        Args:
          processor: The request processor whose prompt the model answered.
          renderer: The processor the app renders the answer's surfaces from.
            It holds the processor's active catalogs, and takes its messages
            from the answer only.

        Raises:
          A2uiCatalogError: If the renderer's catalogs are not the processor's
            active catalogs, in the same order.
          NotImplementedError: If the processor's format cannot be read
            incrementally.
        """
        self._renderer = renderer
        self._stream = processor.open_stream(
            state=RendererState.of(renderer), after_rejected_block="continue"
        )
        self._parts: tuple[AnswerPart, ...] = ()
        # Whether the last part the stream returned was text, so more text
        # joins it.
        self._in_text = False

    @property
    def renderer(self) -> MessageProcessor:
        """The processor the answer's surfaces are applied to."""
        return self._renderer

    @property
    def parts(self) -> Sequence[AnswerPart]:
        """The parts of the answer so far, in the order the model wrote them.

        The sequence is replaced, not changed, when the parts change.
        """
        return self._parts

    @property
    def is_in_block(self) -> bool:
        """Whether the answer so far ends inside a block. See `ResponseStream.is_in_block`."""
        return self._stream.is_in_block

    def feed(self, chunk: str) -> None:
        """Reads the next chunk of the answer.

        Raises:
          ValueError: If the answer has been closed.
          Exception: If the stream fails for a reason other than a rejected
            block.
        """
        self._show(self._stream.feed(chunk))

    def close(self) -> None:
        """Ends the answer, adding the text held back as a possible tag and any rejected block."""
        self._show(self._stream.close())

    def _show(self, stream_parts: list[StreamPart]) -> None:
        if not stream_parts:
            return
        parts = list(self._parts)
        for part in stream_parts:
            if isinstance(part, TextPart):
                last = parts[-1] if parts else None
                if self._in_text and isinstance(last, AnswerTextPart):
                    parts[-1] = AnswerTextPart(text=last.text + part.text)
                else:
                    parts.append(AnswerTextPart(text=part.text))
                self._in_text = True
                continue
            self._in_text = False
            if isinstance(part, ErrorPart):
                parts.append(part)
                continue
            for message in to_message_dicts(part.a2ui):
                created = _surface_id_of(message, "createSurface")
                surface = (
                    self._renderer.model.get_surface(created)
                    if created is not None
                    else None
                )
                if surface is not None:
                    parts.append(AnswerSurfacePart(surface=surface))
                deleted = _surface_id_of(message, "deleteSurface")
                if deleted is not None:
                    parts = [
                        p
                        for p in parts
                        if not (
                            isinstance(p, AnswerSurfacePart) and p.surface.id == deleted
                        )
                    ]
        self._parts = tuple(parts)


def _surface_id_of(message: Mapping[str, Any], action: str) -> str | None:
    """The surface that a message's action names, if the message holds that action."""
    body = message.get(action)
    if not isinstance(body, Mapping):
        return None
    surface_id = body.get("surfaceId")
    return surface_id if isinstance(surface_id, str) else None
