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

"""A2UI Serialization package for multi-format output and conversion."""

from a2ui.core.serialization.format import (
    ALL_A2UI_MIME_TYPES,
    LEGACY_MIME_TYPE_JSON,
    MIME_TYPE_A2UI_JSON,
    MIME_TYPE_A2UI_PROTO,
    MIME_TYPE_PROTO_BYTES,
    OutputFormat,
)
from a2ui.core.serialization.converter import (
    agent_message_to_dict,
    dict_to_agent_message,
    dict_to_renderer_message,
    renderer_message_to_dict,
)
from a2ui.core.serialization.serializer import (
    JsonDictSerializer,
    JsonStringSerializer,
    MessageSerializer,
    ProtobufBinarySerializer,
    ProtobufMessageSerializer,
    get_serializer,
)

__all__ = [
    "ALL_A2UI_MIME_TYPES",
    "LEGACY_MIME_TYPE_JSON",
    "MIME_TYPE_A2UI_JSON",
    "MIME_TYPE_A2UI_PROTO",
    "MIME_TYPE_PROTO_BYTES",
    "OutputFormat",
    "agent_message_to_dict",
    "dict_to_agent_message",
    "dict_to_renderer_message",
    "renderer_message_to_dict",
    "JsonDictSerializer",
    "JsonStringSerializer",
    "MessageSerializer",
    "ProtobufBinarySerializer",
    "ProtobufMessageSerializer",
    "get_serializer",
]
