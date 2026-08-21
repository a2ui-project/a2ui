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

if TYPE_CHECKING:
    from a2ui.inference_formats.direct_json.streaming import DirectJsonStreamParser
from a2a.types import (
    Part,
    DataPart,
    FilePart,
    FileWithBytes,
    TextPart,
)

from a2ui.core.proto.v1_0 import agent_to_renderer_pb2
from a2ui.core.serialization import (
    ALL_A2UI_MIME_TYPES,
    MIME_TYPE_A2UI_JSON,
    MIME_TYPE_A2UI_PROTO,
    MIME_TYPE_PROTO_BYTES,
    LEGACY_MIME_TYPE_JSON,
    OutputFormat,
    ProtobufBinarySerializer,
    agent_message_to_dict,
)

logger = logging.getLogger(__name__)

MIME_TYPE_KEY = "mimeType"
A2UI_MIME_TYPE = MIME_TYPE_A2UI_JSON
DEPRECATED_A2UI_MIME_TYPE = LEGACY_MIME_TYPE_JSON


def create_a2ui_part(
    a2ui_data: Any,
    version: Optional[str] = None,
    output_format: OutputFormat = OutputFormat.JSON_DICT,
) -> Part:
    """Creates an A2A Part containing A2UI data formatted according to output_format.

    Args:
        a2ui_data: The A2UI data payload (dictionary, Protobuf message, or bytes).
        version: Optional version string.
        output_format: OutputFormat specifying target representation.

    Returns:
        An A2A Part (DataPart or FilePart) containing the serialized A2UI data.
    """
    if output_format == OutputFormat.PROTO_BYTES or isinstance(
        a2ui_data, (bytes, bytearray)
    ):
        raw_bytes = (
            bytes(a2ui_data)
            if isinstance(a2ui_data, (bytes, bytearray))
            else ProtobufBinarySerializer().serialize(a2ui_data)
        )
        import base64

        b64_str = base64.b64encode(raw_bytes).decode("utf-8")
        return Part(
            root=FilePart(
                file=FileWithBytes(
                    bytes=b64_str,
                    mime_type=MIME_TYPE_PROTO_BYTES,
                ),
                metadata={MIME_TYPE_KEY: MIME_TYPE_PROTO_BYTES},
            )
        )

    if output_format == OutputFormat.PROTO_MESSAGE:
        data = (
            agent_message_to_dict(a2ui_data)
            if isinstance(a2ui_data, agent_to_renderer_pb2.AgentToRendererMessage)
            else a2ui_data
        )
        return Part(
            root=DataPart(
                data=data,
                metadata={
                    MIME_TYPE_KEY: MIME_TYPE_A2UI_PROTO,
                },
            )
        )

    # Default JSON dict
    mime_type = MIME_TYPE_A2UI_JSON
    if version is None or version in ("0.8", "0.9", "v0.8", "v0.9"):
        mime_type = DEPRECATED_A2UI_MIME_TYPE

    data = (
        agent_message_to_dict(a2ui_data)
        if isinstance(a2ui_data, agent_to_renderer_pb2.AgentToRendererMessage)
        else a2ui_data
    )

    return Part(
        root=DataPart(
            data=data,
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
    if isinstance(part.root, DataPart):
        return bool(
            part.root.metadata
            and part.root.metadata.get(MIME_TYPE_KEY) in ALL_A2UI_MIME_TYPES
        )
    if isinstance(part.root, FilePart):
        file_mime = getattr(part.root.file, "mime_type", None)
        meta_mime = (
            part.root.metadata.get(MIME_TYPE_KEY) if part.root.metadata else None
        )
        return file_mime in ALL_A2UI_MIME_TYPES or meta_mime in ALL_A2UI_MIME_TYPES
    return False


def get_a2ui_datapart(part: Part) -> Optional[DataPart]:
    """Extracts the DataPart containing A2UI data from an A2A Part, if present.

    Args:
        part: The A2A Part to extract A2UI data from.

    Returns:
        The DataPart containing A2UI data if present, None otherwise.
    """
    if is_a2ui_part(part) and isinstance(part.root, DataPart):
        return part.root
    return None


def parse_content_to_parts(
    content: str,
    parser: Parser,
    fallback_text: Optional[str] = None,
    version: Optional[str] = None,
    output_format: OutputFormat = OutputFormat.JSON_DICT,
) -> List[Part]:
    """Helper to parse LLM response content into A2A Parts using a Parser instance.

    Args:
        content: The LLM response content, potentially containing A2UI delimiters.
        parser: The Parser instance used to extract and compile format parts.
        fallback_text: Optional text to return if no parts are successfully created.
        version: Optional version string.
        output_format: OutputFormat specifying target representation.

    Returns:
        A list of A2A Part objects (TextPart and/or DataPart).
    """
    parts = []
    try:
        response_parts = parser.parse_response(content)

        for part in response_parts:
            if part.text:
                parts.append(Part(root=TextPart(text=part.text)))

            if part.a2ui_json:
                json_data = part.a2ui_json
                if isinstance(json_data, list):
                    for message in json_data:
                        parts.append(
                            create_a2ui_part(
                                message,
                                version=version,
                                output_format=output_format,
                            )
                        )
                else:
                    parts.append(
                        create_a2ui_part(
                            json_data,
                            version=version,
                            output_format=output_format,
                        )
                    )

    except Exception as e:
        logger.warning(f"Failed to parse A2UI response: {e}")

    if not parts and fallback_text:
        parts.append(Part(root=TextPart(text=fallback_text)))

    return parts


def parse_response_to_parts(
    content: str,
    validator: Optional[Any] = None,
    fallback_text: Optional[str] = None,
    version: Optional[str] = None,
    output_format: OutputFormat = OutputFormat.JSON_DICT,
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
                parts.append(Part(root=TextPart(text=part.text)))

            if part.a2ui_json:
                json_data = part.a2ui_json
                if validator is not None:
                    validator.validate(json_data)

                if isinstance(json_data, list):
                    for message in json_data:
                        parts.append(
                            create_a2ui_part(
                                message,
                                version=version,
                                output_format=output_format,
                            )
                        )
                else:
                    parts.append(
                        create_a2ui_part(
                            json_data,
                            version=version,
                            output_format=output_format,
                        )
                    )

    except Exception as e:
        logger.warning(f"Failed to parse legacy A2UI response: {e}")

    if not parts and fallback_text:
        parts.append(Part(root=TextPart(text=fallback_text)))

    return parts


async def stream_response_to_parts(
    parser: "DirectJsonStreamParser",
    token_stream: AsyncIterable[str],
    version: Optional[str] = None,
    output_format: OutputFormat = OutputFormat.JSON_DICT,
) -> AsyncIterable[Part]:
    """Helper to parse a stream of LLM tokens into A2A Parts incrementally.

    Args:
        parser: DirectJsonStreamParser instance to process the stream.
        token_stream: An async iterable of strings (tokens).
        version: Optional version string.
        output_format: OutputFormat specifying target representation.

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
                yield Part(root=TextPart(text=part.text))

            if part.a2ui_json:
                json_data = part.a2ui_json

                if isinstance(json_data, list):
                    for message in json_data:
                        yield create_a2ui_part(
                            message,
                            version=version,
                            output_format=output_format,
                        )
                else:
                    yield create_a2ui_part(
                        json_data,
                        version=version,
                        output_format=output_format,
                    )
