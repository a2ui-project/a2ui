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

"""Unit tests for A2UI message serialization and Protobuf conversions."""

import json
import pytest
from a2ui.core.proto.v1_0 import agent_to_renderer_pb2, renderer_to_agent_pb2
from a2ui.core.serialization import (
    OutputFormat,
    MessageSerializer,
    JsonDictSerializer,
    JsonStringSerializer,
    ProtobufMessageSerializer,
    ProtobufBinarySerializer,
    get_serializer,
    dict_to_agent_message,
    agent_message_to_dict,
    dict_to_renderer_message,
    renderer_message_to_dict,
    MIME_TYPE_A2UI_JSON,
    MIME_TYPE_A2UI_PROTO,
    MIME_TYPE_PROTO_BYTES,
)
from a2ui.core.exceptions import A2uiValidationError


SAMPLE_CREATE_SURFACE = {
    "createSurface": {
        "surfaceId": "main-surface",
        "catalogId": "basic",
        "sendDataModel": True,
    }
}

SAMPLE_UPDATE_COMPONENTS = {
    "updateComponents": {
        "surfaceId": "main-surface",
        "components": [
            {
                "id": "text_1",
                "component": "Text",
                "text": "Hello World",
            },
            {
                "id": "btn_1",
                "component": "Button",
                "label": "Click Me",
            },
        ],
    }
}

SAMPLE_UPDATE_DATA_MODEL = {
    "updateDataModel": {
        "surfaceId": "main-surface",
        "path": "/user/profile",
        "value": {"name": "Alice", "age": 30},
    }
}

SAMPLE_DELETE_SURFACE = {
    "deleteSurface": {
        "surfaceId": "main-surface",
    }
}


def test_dict_to_agent_message_create_surface():
    msg = dict_to_agent_message(SAMPLE_CREATE_SURFACE)
    assert isinstance(msg, agent_to_renderer_pb2.AgentToRendererMessage)
    assert msg.HasField("create_surface")
    assert msg.create_surface.surface_id == "main-surface"
    assert msg.create_surface.catalog_id == "basic"
    assert msg.create_surface.send_data_model is True

    roundtrip = agent_message_to_dict(msg)
    assert roundtrip["createSurface"]["surfaceId"] == "main-surface"
    assert roundtrip["createSurface"]["catalogId"] == "basic"


def test_dict_to_agent_message_update_components():
    msg = dict_to_agent_message(SAMPLE_UPDATE_COMPONENTS)
    assert msg.HasField("update_components")
    assert msg.update_components.surface_id == "main-surface"
    assert len(msg.update_components.components) == 2
    assert msg.update_components.components[0].id == "text_1"
    assert msg.update_components.components[0].component == "Text"

    roundtrip = agent_message_to_dict(msg)
    assert len(roundtrip["updateComponents"]["components"]) == 2


def test_dict_to_agent_message_update_data_model():
    msg = dict_to_agent_message(SAMPLE_UPDATE_DATA_MODEL)
    assert msg.HasField("update_data_model")
    assert msg.update_data_model.surface_id == "main-surface"
    assert msg.update_data_model.path == "/user/profile"
    assert msg.update_data_model.value.struct_value.fields["name"].string_value == "Alice"

    roundtrip = agent_message_to_dict(msg)
    assert roundtrip["updateDataModel"]["value"]["name"] == "Alice"


def test_dict_to_agent_message_delete_surface():
    msg = dict_to_agent_message(SAMPLE_DELETE_SURFACE)
    assert msg.HasField("delete_surface")
    assert msg.delete_surface.surface_id == "main-surface"


def test_dict_to_renderer_message():
    action_dict = {
        "version": "v1.0",
        "action": {
            "name": "submit",
            "surfaceId": "main-surface",
            "sourceComponentId": "btn_1",
            "context": {"form_valid": True},
        },
    }
    msg = dict_to_renderer_message(action_dict)
    assert isinstance(msg, renderer_to_agent_pb2.RendererToAgentMessage)
    assert msg.HasField("action")
    assert msg.action.name == "submit"
    assert msg.action.surface_id == "main-surface"

    roundtrip = renderer_message_to_dict(msg)
    assert roundtrip["action"]["name"] == "submit"


def test_dict_to_agent_message_invalid_raises():
    with pytest.raises(A2uiValidationError):
        dict_to_agent_message({"invalidKey": {"bad": 123}})


def test_json_dict_serializer():
    serializer = JsonDictSerializer()
    assert serializer.mime_type == MIME_TYPE_A2UI_JSON
    res = serializer.serialize(SAMPLE_CREATE_SURFACE)
    assert res == SAMPLE_CREATE_SURFACE


def test_json_string_serializer():
    serializer = JsonStringSerializer()
    assert serializer.mime_type == MIME_TYPE_A2UI_JSON
    res = serializer.serialize(SAMPLE_CREATE_SURFACE)
    assert isinstance(res, str)
    assert json.loads(res) == SAMPLE_CREATE_SURFACE


def test_protobuf_message_serializer():
    serializer = ProtobufMessageSerializer()
    assert serializer.mime_type == MIME_TYPE_A2UI_PROTO
    res = serializer.serialize(SAMPLE_CREATE_SURFACE)
    assert isinstance(res, agent_to_renderer_pb2.AgentToRendererMessage)
    assert res.create_surface.surface_id == "main-surface"


def test_protobuf_binary_serializer():
    serializer = ProtobufBinarySerializer()
    assert serializer.mime_type == MIME_TYPE_PROTO_BYTES
    res = serializer.serialize(SAMPLE_CREATE_SURFACE)
    assert isinstance(res, bytes)
    # Parse back to verify correctness
    decoded = agent_to_renderer_pb2.AgentToRendererMessage()
    decoded.ParseFromString(res)
    assert decoded.create_surface.surface_id == "main-surface"


def test_get_serializer_factory():
    assert isinstance(get_serializer(OutputFormat.JSON_DICT), JsonDictSerializer)
    assert isinstance(get_serializer(OutputFormat.JSON_STRING), JsonStringSerializer)
    assert isinstance(get_serializer(OutputFormat.PROTO_MESSAGE), ProtobufMessageSerializer)
    assert isinstance(get_serializer(OutputFormat.PROTO_BYTES), ProtobufBinarySerializer)
    assert isinstance(get_serializer("proto_bytes"), ProtobufBinarySerializer)

    with pytest.raises(ValueError):
        get_serializer("unsupported_format")
