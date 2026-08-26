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

"""Tests verifying Protobuf output support for the restaurant_finder agent."""

import base64
import os
import sys
from pathlib import Path
import pytest

# Ensure restaurant_finder is on path
ROOT_DIR = Path(__file__).parent.parent.parent.parent.parent
SAMPLE_DIR = ROOT_DIR / "samples" / "agent" / "adk" / "restaurant_finder"
sys.path.insert(0, str(SAMPLE_DIR))

from agent import RestaurantAgent
from a2ui.core.serialization import (
    OutputFormat,
    MIME_TYPE_PROTO_BYTES,
    MIME_TYPE_A2UI_PROTO,
)
from a2ui.core.proto.v1_0 import agent_to_renderer_pb2
from a2ui.schema.constants import VERSION_0_8, VERSION_0_9, VERSION_1_0
from a2ui.a2a.parts import parse_response_to_parts


def test_restaurant_agent_initialization_with_output_format():
    agent_default = RestaurantAgent(base_url="http://localhost:10002")
    assert agent_default.output_format == OutputFormat.JSON_DICT

    agent_bytes = RestaurantAgent(
        base_url="http://localhost:10002", output_format=OutputFormat.PROTO_BYTES
    )
    assert agent_bytes.output_format == OutputFormat.PROTO_BYTES

    agent_str = RestaurantAgent(
        base_url="http://localhost:10002", output_format="proto_message"
    )
    assert agent_str.output_format == OutputFormat.PROTO_MESSAGE


def test_restaurant_agent_supports_v1_0_catalog():
    agent = RestaurantAgent(base_url="http://localhost:10002")
    assert VERSION_0_8 in agent._inference_formats
    assert VERSION_0_9 in agent._inference_formats
    assert VERSION_1_0 in agent._inference_formats
    assert agent._inference_formats[VERSION_1_0]._version == VERSION_1_0


def test_parse_response_to_parts_proto_bytes():
    raw_response = """
    Here are the restaurants:
    <a2ui-json>
    [
      {
        "createSurface": {
          "surfaceId": "test-surface",
          "catalogId": "basic"
        }
      },
      {
        "updateComponents": {
          "surfaceId": "test-surface",
          "components": [
            {
              "id": "root",
              "component": "Text",
              "text": "Welcome to Sushi Palace"
            }
          ]
        }
      }
    ]
    </a2ui-json>
    """
    parts = parse_response_to_parts(
        raw_response,
        version=VERSION_1_0,
        output_format=OutputFormat.PROTO_BYTES,
    )

    # Should contain 1 TextPart and 2 FileParts with protobuf bytes
    assert len(parts) >= 2
    file_parts = [p for p in parts if hasattr(p.root, "file")]
    assert len(file_parts) == 2

    # Verify first file part is a createSurface Protobuf message
    p1 = file_parts[0]
    assert p1.root.file.mime_type == MIME_TYPE_PROTO_BYTES
    b64_data = p1.root.file.bytes
    raw_bytes = base64.b64decode(b64_data)

    msg1 = agent_to_renderer_pb2.AgentToRendererMessage()
    msg1.ParseFromString(raw_bytes)
    assert msg1.HasField("create_surface")
    assert msg1.create_surface.surface_id == "test-surface"
    assert msg1.create_surface.catalog_id == "basic"

    # Verify second file part is updateComponents
    p2 = file_parts[1]
    msg2 = agent_to_renderer_pb2.AgentToRendererMessage()
    msg2.ParseFromString(base64.b64decode(p2.root.file.bytes))
    assert msg2.HasField("update_components")
    assert msg2.update_components.surface_id == "test-surface"
    assert len(msg2.update_components.components) == 1
    assert msg2.update_components.components[0].id == "root"


def test_parse_response_to_parts_proto_message():
    raw_response = """
    <a2ui-json>
    [
      {
        "createSurface": {
          "surfaceId": "proto-msg-surface",
          "catalogId": "basic"
        }
      }
    ]
    </a2ui-json>
    """
    parts = parse_response_to_parts(
        raw_response,
        version=VERSION_1_0,
        output_format=OutputFormat.PROTO_MESSAGE,
    )

    data_parts = [p for p in parts if hasattr(p.root, "data")]
    assert len(data_parts) == 1
    p = data_parts[0]
    assert p.root.metadata["mimeType"] == MIME_TYPE_A2UI_PROTO
    assert p.root.data["createSurface"]["surfaceId"] == "proto-msg-surface"
