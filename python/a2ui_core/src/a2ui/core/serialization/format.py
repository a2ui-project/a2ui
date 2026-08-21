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

"""Format definitions and MIME type constants for A2UI message serialization."""

from enum import Enum

# MIME type constants
MIME_TYPE_A2UI_JSON = "application/a2ui+json"
MIME_TYPE_A2UI_PROTO = "application/a2ui+proto"
MIME_TYPE_PROTO_BYTES = "application/x-protobuf"
LEGACY_MIME_TYPE_JSON = "application/json+a2ui"

# All recognized A2UI MIME types
ALL_A2UI_MIME_TYPES = frozenset([
    MIME_TYPE_A2UI_JSON,
    MIME_TYPE_A2UI_PROTO,
    MIME_TYPE_PROTO_BYTES,
    LEGACY_MIME_TYPE_JSON,
])


class OutputFormat(str, Enum):
    """Supported output serialization formats for A2UI messages.

    Attributes:
        JSON_DICT: Emits Python dictionaries representing A2UI JSON structures.
        JSON_STRING: Emits serialized JSON strings.
        PROTO_MESSAGE: Emits AgentToRendererMessage Protocol Buffer instances.
        PROTO_BYTES: Emits binary serialized Protocol Buffer bytes.
    """

    JSON_DICT = "json_dict"
    JSON_STRING = "json_string"
    PROTO_MESSAGE = "proto_message"
    PROTO_BYTES = "proto_bytes"
