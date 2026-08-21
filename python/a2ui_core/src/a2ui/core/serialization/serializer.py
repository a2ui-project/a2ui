# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Message serializers for converting A2UI payloads into target output formats."""

from abc import ABC, abstractmethod
import json
from typing import Any, Union
from a2ui.core.proto.v1_0 import agent_to_renderer_pb2
from a2ui.core.serialization.format import (
    MIME_TYPE_A2UI_JSON,
    MIME_TYPE_A2UI_PROTO,
    MIME_TYPE_PROTO_BYTES,
    OutputFormat,
)
from a2ui.core.serialization.converter import dict_to_agent_message


class MessageSerializer(ABC):
    """Abstract base strategy for serializing A2UI message payloads."""

    @property
    @abstractmethod
    def mime_type(self) -> str:
        """The MIME type associated with the output format."""

    @abstractmethod
    def serialize(self, payload: dict[str, Any]) -> Any:
        """Serializes an A2UI dictionary payload into the target format.

        Args:
            payload: A2UI message dictionary.

        Returns:
            The serialized payload in the target representation.
        """


class JsonDictSerializer(MessageSerializer):
    """Serializer that emits raw Python dictionaries."""

    @property
    def mime_type(self) -> str:
        return MIME_TYPE_A2UI_JSON

    def serialize(self, payload: dict[str, Any]) -> dict[str, Any]:
        return payload


class JsonStringSerializer(MessageSerializer):
    """Serializer that emits serialized JSON strings."""

    @property
    def mime_type(self) -> str:
        return MIME_TYPE_A2UI_JSON

    def serialize(self, payload: dict[str, Any]) -> str:
        return json.dumps(payload)


class ProtobufMessageSerializer(MessageSerializer):
    """Serializer that emits AgentToRendererMessage Protobuf instances."""

    @property
    def mime_type(self) -> str:
        return MIME_TYPE_A2UI_PROTO

    def serialize(
        self, payload: dict[str, Any]
    ) -> agent_to_renderer_pb2.AgentToRendererMessage:
        return dict_to_agent_message(payload)


class ProtobufBinarySerializer(MessageSerializer):
    """Serializer that emits binary serialized Protobuf bytes."""

    @property
    def mime_type(self) -> str:
        return MIME_TYPE_PROTO_BYTES

    def serialize(self, payload: dict[str, Any]) -> bytes:
        message = dict_to_agent_message(payload)
        return message.SerializeToString()


_SERIALIZER_REGISTRY: dict[OutputFormat, MessageSerializer] = {
    OutputFormat.JSON_DICT: JsonDictSerializer(),
    OutputFormat.JSON_STRING: JsonStringSerializer(),
    OutputFormat.PROTO_MESSAGE: ProtobufMessageSerializer(),
    OutputFormat.PROTO_BYTES: ProtobufBinarySerializer(),
}


def get_serializer(output_format: Union[OutputFormat, str]) -> MessageSerializer:
    """Retrieves the serializer instance for the specified output format.

    Args:
        output_format: The desired OutputFormat or its string representation.

    Returns:
        The matching MessageSerializer instance.

    Raises:
        ValueError: If output_format is not recognized.
    """
    if isinstance(output_format, str):
        try:
            output_format = OutputFormat(output_format)
        except ValueError as err:
            raise ValueError(f"Unknown output format: {output_format}") from err

    serializer = _SERIALIZER_REGISTRY.get(output_format)
    if serializer is None:
        raise ValueError(f"No serializer registered for format: {output_format}")
    return serializer
