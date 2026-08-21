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

"""Unit tests for MessageProcessor Protobuf ingestion (binary and message instances)."""

import pytest
from a2ui.core.processing import MessageProcessor
from a2ui.core.basic_catalog.v1_0 import BasicCatalog
from a2ui.core.proto.v1_0 import (
    agent_to_renderer_pb2,
    agent_to_renderer_list_wrapper_pb2,
    agent_to_renderer_list_pb2,
)
from a2ui.core.serialization import ProtobufBinarySerializer, dict_to_agent_message


@pytest.fixture
def test_catalog():
    return BasicCatalog()


@pytest.fixture
def processor(test_catalog):
    return MessageProcessor(catalogs=[test_catalog])


def test_process_protobuf_message_instance(processor, test_catalog):
    msg = dict_to_agent_message(
        {
            "createSurface": {
                "surfaceId": "surface_1",
                "catalogId": test_catalog.catalog_id,
                "sendDataModel": True,
            }
        }
    )

    processor.process_messages(msg)

    assert processor.model.get_surface("surface_1") is not None
    surface = processor.model.get_surface("surface_1")
    assert surface.id == "surface_1"
    assert surface.catalog.catalog_id == test_catalog.catalog_id


def test_process_protobuf_binary_bytes(processor, test_catalog):
    serializer = ProtobufBinarySerializer()

    # 1. Create surface via binary bytes
    create_bytes = serializer.serialize(
        {
            "createSurface": {
                "surfaceId": "surface_1",
                "catalogId": test_catalog.catalog_id,
            }
        }
    )
    processor.process_messages(create_bytes)
    assert processor.model.get_surface("surface_1") is not None

    # 2. Update components via binary bytes
    components_bytes = serializer.serialize(
        {
            "updateComponents": {
                "surfaceId": "surface_1",
                "components": [
                    {"id": "t1", "component": "Text", "text": "Hello Proto"},
                ],
            }
        }
    )
    processor.process_messages(components_bytes)

    surface = processor.model.get_surface("surface_1")
    assert surface.components_model.get("t1") is not None
    assert surface.components_model.get("t1").properties.get("text") == "Hello Proto"

    # 3. Update data model via binary bytes
    data_bytes = serializer.serialize(
        {
            "updateDataModel": {
                "surfaceId": "surface_1",
                "path": "/user/status",
                "value": "online",
            }
        }
    )
    processor.process_messages(data_bytes)
    assert surface.data_model.get("/user/status") == "online"

    # 4. Delete surface via binary bytes
    delete_bytes = serializer.serialize(
        {
            "deleteSurface": {
                "surfaceId": "surface_1",
            }
        }
    )
    processor.process_messages(delete_bytes)
    assert processor.model.get_surface("surface_1") is None


def test_process_protobuf_list_wrapper_binary(processor, test_catalog):
    # Construct AgentToRendererListWrapper
    wrapper = agent_to_renderer_list_wrapper_pb2.AgentToRendererListWrapper()
    msg1 = wrapper.messages.messages.add()
    msg1.create_surface.surface_id = "s_multi"
    msg1.create_surface.catalog_id = test_catalog.catalog_id

    msg2 = wrapper.messages.messages.add()
    msg2.update_components.surface_id = "s_multi"
    comp = msg2.update_components.components.add()
    comp.id = "txt_multi"
    comp.component = "Text"
    comp.properties.fields["text"].string_value = "Multi Msg"

    binary_data = wrapper.SerializeToString()
    processor.process_messages(binary_data)

    surface = processor.model.get_surface("s_multi")
    assert surface is not None
    assert surface.components_model.get("txt_multi") is not None
