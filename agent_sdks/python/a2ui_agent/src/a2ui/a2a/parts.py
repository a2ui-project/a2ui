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

import logging
from typing import Any, Optional, List, AsyncIterable, TYPE_CHECKING
from a2ui.parser.parser import Parser
from a2ui.a2a import _compat

if TYPE_CHECKING:
    from a2ui.inference_formats.direct_json.streaming import DirectJsonStreamParser
from a2a.types import Part


def make_text_part(text: str) -> Part:
    """Builds a text Part for the installed a2a-sdk generation."""
    return _compat.make_text_part(text)

logger = logging.getLogger(__name__)

MIME_TYPE_KEY = "mimeType"
A2UI_MIME_TYPE = "application/a2ui+json"
DEPRECATED_A2UI_MIME_TYPE = "application/json+a2ui"
_A2UI_MIME_TYPES = (A2UI_MIME_TYPE, DEPRECATED_A2UI_MIME_TYPE)


def _mime_type_for_version(version: Optional[str]) -> str:
    if version is None or version in ("0.8", "0.9", "v0.8", "v0.9"):
        return DEPRECATED_A2UI_MIME_TYPE
    return A2UI_MIME_TYPE


def create_a2ui_part(a2ui_data: dict[str, Any], version: Optional[str] = None) -> Part:
    """Creates an A2A Part containing A2UI data.

    Works with a2a-sdk 0.3 (pydantic ``Part.root``) and 1.x (protobuf ``Part``).

    Args:
        a2ui_data: The A2UI data dictionary.
        version: Optional version string.

    Returns:
        An A2A Part carrying A2UI data and mime metadata.
    """
    mime_type = _mime_type_for_version(version)
    payload = a2ui_data
    if isinstance(a2ui_data, list) and len(a2ui_data) == 1:
        payload = a2ui_data[0]
    return _compat.make_data_part(payload, metadata={MIME_TYPE_KEY: mime_type})


def is_a2ui_part(part: Part) -> bool:
    """Checks if an A2A Part contains A2UI data.

    Args:
        part: The A2A Part to check.

    Returns:
        True if the part contains A2UI data, False otherwise.
    """
    if not _compat.is_data_part(part):
        return False
    meta_mime = _compat.part_metadata(part).get(MIME_TYPE_KEY)
    media_type = _compat.part_media_type(part)
    return meta_mime in _A2UI_MIME_TYPES or media_type in _A2UI_MIME_TYPES


def get_a2ui_data(part: Part) -> Optional[Any]:
    """Extracts the Python-native A2UI payload from an A2A Part, if present."""
    if not is_a2ui_part(part):
        return None
    return _compat.data_part_dict(part)


def get_a2ui_datapart(part: Part) -> Optional[Any]:
    """Extracts the data view containing A2UI data from an A2A Part, if present.

    On a2a-sdk 0.3 this is the inner ``DataPart``. On 1.x it is a view with
    ``.data`` and ``.metadata`` dicts so existing callers keep working.

    Args:
        part: The A2A Part to extract A2UI data from.

    Returns:
        A data view if the Part is A2UI, otherwise None.
    """
    if not is_a2ui_part(part):
        return None
    return _compat.data_part_view(part)


def part_data_as_dict(part: Part) -> Optional[dict[str, Any]]:
    """Decode any data Part to a dict without an A2UI mime gate.

    Inbound ``userAction`` / streaming-hint Parts are often untagged, so
    mime-gated :func:`get_a2ui_data` is too strict for those readers.
    """
    return _compat.data_part_dict(part)


def extract_user_action(message_parts) -> Optional[dict]:
    """Find a ``userAction`` payload in inbound message parts.

    Checks mime-gated :func:`get_a2ui_data` first, then untagged
    :func:`part_data_as_dict`, so both A2UI-tagged and plain data Parts work.
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
    fallback_text: Optional[str] = None,
    version: Optional[str] = None,
) -> List[Part]:
    """Helper to parse LLM response content into A2A Parts using a Parser instance.

    Args:
        content: The LLM response content, potentially containing A2UI delimiters.
        parser: The Parser instance used to extract and compile format parts.
        fallback_text: Optional text to return if no parts are successfully created.
        version: Optional version string.

    Returns:
        A list of A2A Part objects (TextPart and/or DataPart).
    """
    parts = []
    try:
        response_parts = parser.parse_response(content)

        for part in response_parts:
            if part.text:
                parts.append(_compat.make_text_part(part.text))

            if part.a2ui_json:
                json_data = part.a2ui_json
                if isinstance(json_data, list):
                    for message in json_data:
                        parts.append(create_a2ui_part(message, version=version))
                else:
                    parts.append(create_a2ui_part(json_data, version=version))

    except Exception as e:
        logger.warning(f"Failed to parse A2UI response: {e}")

    if not parts and fallback_text:
        parts.append(_compat.make_text_part(fallback_text))

    return parts


def parse_response_to_parts(
    content: str,
    validator: Optional[Any] = None,
    fallback_text: Optional[str] = None,
    version: Optional[str] = None,
) -> List[Part]:
    """Deprecated compatibility wrapper around parse_response_to_parts.

    Please use parse_content_to_parts instead, providing a Parser instance.
    """
    import warnings

    warnings.warn(
        "parse_response_to_parts is deprecated. Please use parse_content_to_parts(...) "
        "providing a Parser instance instead.",
        DeprecationWarning,
        stacklevel=2,
    )

    from a2ui.parser.parser import parse_response as legacy_parse_response

    parts = []
    try:
        response_parts = legacy_parse_response(content)

        for part in response_parts:
            if part.text:
                parts.append(_compat.make_text_part(part.text))

            if part.a2ui_json:
                json_data = part.a2ui_json
                if validator is not None:
                    validator.validate(json_data)

                if isinstance(json_data, list):
                    for message in json_data:
                        parts.append(create_a2ui_part(message, version=version))
                else:
                    parts.append(create_a2ui_part(json_data, version=version))

    except Exception as e:
        logger.warning(f"Failed to parse legacy A2UI response: {e}")

    if not parts and fallback_text:
        parts.append(_compat.make_text_part(fallback_text))

    return parts


async def stream_response_to_parts(
    parser: "DirectJsonStreamParser",
    token_stream: AsyncIterable[str],
    version: Optional[str] = None,
) -> AsyncIterable[Part]:
    """Helper to parse a stream of LLM tokens into A2A Parts incrementally.

    Args:
        parser: DirectJsonStreamParser instance to process the stream.
        token_stream: An async iterable of strings (tokens).
        version: Optional version string.

    Yields:
        A2A Part objects as they are discovered in the stream.
    """
    async for token in token_stream:
        logger.info("-----------------------------")
        logger.info(f"--- AGENT: Received token:\n{token}")
        response_parts = parser.process_chunk(token)
        logger.info(
            "--- AGENT: Response"
            f" parts:\n{[part.a2ui_json for part in response_parts]}\n"
        )
        logger.info("-----------------------------")

        for part in response_parts:
            if part.text:
                yield _compat.make_text_part(part.text)

            if part.a2ui_json:
                json_data = part.a2ui_json

                if isinstance(json_data, list):
                    for message in json_data:
                        yield create_a2ui_part(message, version=version)
                else:
                    yield create_a2ui_part(json_data, version=version)
