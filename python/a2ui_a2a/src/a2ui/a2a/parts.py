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

from collections.abc import AsyncIterable, Sequence
import logging
from typing import Any

from a2a.types import DataPart
from a2a.types import Part
from a2a.types import TextPart as A2aTextPart

from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats import to_message_dicts
from a2ui.parser import A2uiPart
from a2ui.parser import Parser
from a2ui.parser import ResponsePart
from a2ui.parser import ResponseStream
from a2ui.parser import TextPart
from a2ui.utils import RendererState
from a2ui.utils import to_version_number

logger = logging.getLogger(__name__)

MIME_TYPE_KEY = "mimeType"
A2UI_MIME_TYPE = "application/a2ui+json"
DEPRECATED_A2UI_MIME_TYPE = "application/json+a2ui"


def create_a2ui_part(
    a2ui_data: dict[str, Any], version: ProtocolVersion | str | None = None
) -> Part:
    """Creates an A2A Part containing A2UI data.

    Args:
        a2ui_data: The A2UI data dictionary.
        version: The A2UI version: a `ProtocolVersion`, or a version string with
            or without a leading "v". Without one, or for v0.8 and v0.9, the
            part uses the deprecated MIME type.

    Returns:
        An A2A Part with a DataPart containing the A2UI data.
    """
    mime_type = A2UI_MIME_TYPE
    if version is None or to_version_number(version) in ("0.8", "0.9"):
        mime_type = DEPRECATED_A2UI_MIME_TYPE

    return Part(
        root=DataPart(
            data=a2ui_data,
            metadata={
                MIME_TYPE_KEY: mime_type,
            },
        )
    )


def is_a2ui_part(part: Part) -> bool:
    """Checks if an A2A Part contains A2UI data.

    Args:
        part: The A2A Part to check.

    Returns:
        True if the part contains A2UI data, False otherwise.
    """
    return bool(
        isinstance(part.root, DataPart)
        and part.root.metadata
        and part.root.metadata.get(MIME_TYPE_KEY)
        in (A2UI_MIME_TYPE, DEPRECATED_A2UI_MIME_TYPE)
    )


def get_a2ui_datapart(part: Part) -> DataPart | None:
    """Extracts the DataPart containing A2UI data from an A2A Part, if present.

    Args:
        part: The A2A Part to extract A2UI data from.

    Returns:
        The DataPart containing A2UI data if present, None otherwise.
    """
    if is_a2ui_part(part) and isinstance(part.root, DataPart):
        return part.root
    return None


def to_a2a_parts(
    response_parts: Sequence[ResponsePart], version: ProtocolVersion | str | None = None
) -> list[Part]:
    """Converts parsed response parts into A2A Parts.

    Text becomes a `TextPart`, and each A2UI message becomes its own
    `DataPart`. Empty text is dropped.

    Args:
        response_parts: The parts from `A2uiRequestProcessor.parse_response`,
            `Parser.parse_response` or `ResponseStream.feed`.
        version: The A2UI protocol version to tag the data parts with.

    Returns:
        The A2A Parts, in the order of the response.
    """
    parts: list[Part] = []
    for part in response_parts:
        if isinstance(part, TextPart) and part.text:
            parts.append(Part(root=A2aTextPart(text=part.text)))
        elif isinstance(part, A2uiPart):
            for message in to_message_dicts(part.a2ui):
                parts.append(create_a2ui_part(message, version=version))
    return parts


def parse_content_to_parts(
    content: str,
    parser: Parser,
    fallback_text: str | None = None,
    version: ProtocolVersion | str | None = None,
    *,
    state: RendererState | None = None,
) -> list[Part]:
    """Parses a whole LLM response into A2A Parts, dropping invalid A2UI.

    The response is checked against `state`, or against a new renderer state
    when there is none. If it fails to parse or validate, the error is logged
    and no parts are returned, so use `to_a2a_parts` with
    `A2uiRequestProcessor.parse_response` to handle the error instead.

    Args:
        content: The LLM response content, potentially containing A2UI delimiters.
        parser: The Parser instance used to extract and compile format parts.
        fallback_text: Optional text to return if no parts are successfully
          created.
        version: The A2UI version, as for `create_a2ui_part`.
        state: The renderer state a canvas agent keeps for the conversation.
          The response is checked against it and, if it passes, applied to it,
          so a response may update a surface from an earlier turn.

    Returns:
        A list of A2A Part objects (TextPart and/or DataPart).
    """
    parts: list[Part] = []
    try:
        parts = to_a2a_parts(parser.parse_response(content, state=state), version)
    except Exception as e:
        logger.warning("Failed to parse A2UI response: %s", e)

    if not parts and fallback_text:
        parts.append(Part(root=A2aTextPart(text=fallback_text)))

    return parts


async def stream_response_to_parts(
    stream: ResponseStream,
    token_stream: AsyncIterable[str],
    version: ProtocolVersion | str | None = None,
) -> AsyncIterable[Part]:
    """Reads a stream of LLM tokens into A2A Parts incrementally.

    Each token is fed to the stream, and the stream is closed after the last
    token, so text still held back is emitted and a block left open raises.

    Args:
        stream: The stream that reads the response, from
            `A2uiRequestProcessor.open_stream` or `Parser.open_stream`. The
            state it was opened with is the one the response is checked
            against.
        token_stream: An async iterable of strings (tokens).
        version: The A2UI version, as for `create_a2ui_part`.

    Yields:
        A2A Part objects as they are discovered in the stream.
    """
    async for token in token_stream:
        for part in to_a2a_parts(stream.feed(token), version):
            yield part
    for part in to_a2a_parts(stream.close(), version):
        yield part
