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

from collections.abc import AsyncIterable
from collections.abc import Iterable
import logging
from typing import Any

from a2a.types import Part

from a2ui.a2a import _compat
from a2ui.inference_formats import to_message_dicts
from a2ui.parser import A2uiPart
from a2ui.parser import BlockLexer
from a2ui.parser import Parser
from a2ui.parser import RawA2uiPart
from a2ui.parser import TextPart
from a2ui.parser import parse_and_fix

logger = logging.getLogger(__name__)

MIME_TYPE_KEY = "mimeType"
A2UI_MIME_TYPE = "application/a2ui+json"
DEPRECATED_A2UI_MIME_TYPE = "application/json+a2ui"
_A2UI_MIME_TYPES = (A2UI_MIME_TYPE, DEPRECATED_A2UI_MIME_TYPE)


def create_a2ui_part(a2ui_data: dict[str, Any], version: str | None = None) -> Part:
    """Creates an A2A Part containing A2UI data.

    Works with a2a-sdk 0.3 (pydantic ``Part.root``) and 1.x (protobuf ``Part``).

    Args:
        a2ui_data: The A2UI data dictionary.
        version: Optional version string.

    Returns:
        An A2A Part carrying the A2UI data and its mime type metadata.
    """
    mime_type = A2UI_MIME_TYPE
    if version is None or version in ("0.8", "0.9", "v0.8", "v0.9"):
        mime_type = DEPRECATED_A2UI_MIME_TYPE

    return _compat.make_data_part(a2ui_data, metadata={MIME_TYPE_KEY: mime_type})


def is_a2ui_part(part: Part) -> bool:
    """Checks if an A2A Part contains A2UI data.

    Args:
        part: The A2A Part to check.

    Returns:
        True if the part contains A2UI data, False otherwise.
    """
    if part is None or not _compat.is_data_part(part):
        return False
    return (
        _compat.part_metadata(part).get(MIME_TYPE_KEY) in _A2UI_MIME_TYPES
        or _compat.part_media_type(part) in _A2UI_MIME_TYPES
    )


def get_a2ui_data(part: Part) -> Any | None:
    """Extracts the Python-native A2UI payload from an A2A Part, if present.

    Args:
        part: The A2A Part to extract A2UI data from.

    Returns:
        The A2UI payload if the Part is an A2UI data Part, None otherwise.
    """
    if not is_a2ui_part(part):
        return None
    return _compat.data_part_dict(part)


def get_a2ui_datapart(part: Part) -> Any | None:
    """Extracts the data view containing A2UI data from an A2A Part, if present.

    On a2a-sdk 0.3 this is the inner ``DataPart``. On 1.x it is a view with
    ``data`` and ``metadata`` dicts, so existing callers keep working.

    Args:
        part: The A2A Part to extract A2UI data from.

    Returns:
        The data view containing A2UI data if present, None otherwise.
    """
    if not is_a2ui_part(part):
        return None
    return _compat.data_part_view(part)


def part_data_as_dict(part: Part) -> dict[str, Any] | None:
    """Decodes a data Part to a dict, whatever its mime type.

    Unlike :func:`is_a2ui_part`, it does not look at the mime type, so it also
    reads inbound parts that carry no A2UI mime type.

    Args:
        part: The A2A Part to decode.

    Returns:
        The Part's data as a dict, or None if it is not a data Part.
    """
    if part is None:
        return None
    return _compat.data_part_dict(part)


def extract_user_action(message_parts: Iterable[Part] | None) -> dict[str, Any] | None:
    """Finds a ``userAction`` payload in inbound message parts.

    Checks the A2UI-tagged parts first, then data parts without an A2UI mime
    type, so both kinds of client work.

    Args:
        message_parts: The parts of the inbound A2A message.

    Returns:
        The ``userAction`` dict if one is present, None otherwise.
    """
    for part in message_parts or []:
        data = get_a2ui_data(part)
        if not isinstance(data, dict):
            data = part_data_as_dict(part)
        if isinstance(data, dict) and "userAction" in data:
            action = data["userAction"]
            return action if isinstance(action, dict) else None
    return None


def parse_content_to_parts(
    content: str,
    parser: Parser,
    fallback_text: str | None = None,
    version: str | None = None,
) -> list[Part]:
    """Helper to parse LLM response content into A2A Parts using a Parser instance.

    Args:
        content: The LLM response content, potentially containing A2UI delimiters.
        parser: The Parser instance used to extract and compile format parts.
        fallback_text: Optional text to return if no parts are successfully
          created.
        version: Optional version string.

    Returns:
        A list of A2A Part objects (TextPart and/or DataPart).
    """
    parts: list[Part] = []
    try:
        response_parts = parser.parse_response(content)

        for part in response_parts:
            if isinstance(part, TextPart) and part.text:
                parts.append(_compat.make_text_part(part.text))
            elif isinstance(part, A2uiPart):
                for message in to_message_dicts(part.a2ui):
                    parts.append(create_a2ui_part(message, version=version))

    except Exception as e:
        logger.warning("Failed to parse A2UI response: %s", e)

    if not parts and fallback_text:
        parts.append(_compat.make_text_part(fallback_text))

    return parts


def parse_response_to_parts(
    content: str,
    validator: Any | None = None,
    fallback_text: str | None = None,
    version: str | None = None,
) -> list[Part]:
    """Deprecated compatibility wrapper around parse_response_to_parts.

    Please use parse_content_to_parts instead, providing a Parser instance.
    """
    if isinstance(validator, Parser):
        return parse_content_to_parts(
            content,
            parser=validator,
            fallback_text=fallback_text,
            version=version,
        )

    import warnings

    warnings.warn(
        "parse_response_to_parts is deprecated. Please use"
        " parse_content_to_parts(...) providing a Parser instance instead.",
        DeprecationWarning,
        stacklevel=2,
    )

    parts: list[Part] = []
    try:
        raw_parts = BlockLexer("<a2ui-json>", "</a2ui-json>").tokenize(content)
        for raw_part in raw_parts:
            part = raw_part.part
            if isinstance(part, TextPart) and part.text:
                parts.append(_compat.make_text_part(part.text))
            elif isinstance(part, RawA2uiPart):
                json_data = parse_and_fix(part.a2ui_raw)
                if validator is not None:
                    validator(json_data)
                if isinstance(json_data, list):
                    for message in json_data:
                        parts.append(create_a2ui_part(message, version=version))
                else:
                    parts.append(create_a2ui_part(json_data, version=version))
    except Exception as e:
        logger.warning("Failed to parse legacy A2UI response: %s", e)

    if not parts and fallback_text:
        parts.append(_compat.make_text_part(fallback_text))

    return parts


def parse_stream_chunk_to_parts(
    token: str,
    parser: Parser,
    fallback_text: str | None = None,
    version: str | None = None,
) -> list[Part]:
    """Processes a streamed token chunk into a list of A2A Parts."""
    parts: list[Part] = []
    try:
        response_parts = parser.parse_chunk(token)
        for part in response_parts:
            if isinstance(part, TextPart) and part.text:
                parts.append(_compat.make_text_part(part.text))
            elif isinstance(part, A2uiPart):
                for message in to_message_dicts(part.a2ui):
                    parts.append(create_a2ui_part(message, version=version))
    except Exception as e:
        logger.warning("Failed to process A2UI stream chunk: %s", e)
        if fallback_text:
            parts.append(_compat.make_text_part(fallback_text))

    return parts


async def stream_response_to_parts(
    parser: Parser,
    token_stream: AsyncIterable[str],
    version: str | None = None,
) -> AsyncIterable[Part]:
    """Helper to parse a stream of LLM tokens into A2A Parts incrementally.

    Args:
        parser: Parser instance to process the stream.
        token_stream: An async iterable of strings (tokens).
        version: Optional version string.

    Yields:
        A2A Part objects as they are discovered in the stream.
    """
    async for token in token_stream:
        response_parts = parser.parse_chunk(token)
        for part in response_parts:
            if isinstance(part, TextPart) and part.text:
                yield _compat.make_text_part(part.text)
            elif isinstance(part, A2uiPart):
                for message in to_message_dicts(part.a2ui):
                    yield create_a2ui_part(message, version=version)
