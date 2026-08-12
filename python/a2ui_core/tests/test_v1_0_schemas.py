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

"""Unit tests for A2UI v1.0 schema models and envelope union types."""

import pytest
from pydantic import TypeAdapter, ValidationError

from a2ui.core.schema import (
    A2uiProtocolVersion,
    AgentToRendererMessage,
    RendererToAgentMessage,
)
from a2ui.core.schema.v1_0 import (
    ActionMessage,
    ActionPayload,
    AgentCapabilities,
    AgentFunctionResponseMessage,
    AgentToRendererMessage as AgentToRendererV10,
    CallAgentFunctionMessage,
    CallRendererFunctionMessage,
    CreateSurfaceMessage,
    DeleteSurfaceMessage,
    ErrorResponseMessage,
    FunctionCall,
    FunctionResponse,
    GenericErrorPayload,
    RendererCapabilities,
    RendererCapabilitiesMessage,
    RendererFunctionResponseMessage,
    RendererToAgentMessage as RendererToAgentV10,
    UpdateComponentsMessage,
    UpdateDataModelMessage,
    UpdateSurfaceMessage,
    V10AgentCapabilities,
    V10RendererCapabilities,
    ValidationErrorPayload,
)


def test_protocol_version_enum():
    assert A2uiProtocolVersion.V0_8.value == "v0.8"
    assert A2uiProtocolVersion.V0_9.value == "v0.9"
    assert A2uiProtocolVersion.V0_9_1.value == "v0.9.1"
    assert A2uiProtocolVersion.V1_0.value == "v1.0"


def test_agent_to_renderer_create_surface():
    msg_dict = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "surf-1",
            "catalogId": "org.example:cat-1",
            "sendDataModel": True,
            "components": [{"id": "root", "component": "Text", "text": "Hello"}],
            "dataModel": {"count": 1},
        },
    }
    adapter = TypeAdapter(CreateSurfaceMessage)
    msg = adapter.validate_python(msg_dict)
    assert msg.version == "v1.0"
    assert msg.create_surface.surface_id == "surf-1"
    assert msg.create_surface.catalog_id == "org.example:cat-1"
    assert msg.create_surface.send_data_model is True
    assert msg.create_surface.data_model == {"count": 1}

    # Verify serialization uses camelCase aliases
    dump = msg.model_dump(by_alias=True, exclude_none=True)
    assert dump["createSurface"]["surfaceId"] == "surf-1"
    assert dump["createSurface"]["catalogId"] == "org.example:cat-1"
    assert dump["createSurface"]["sendDataModel"] is True


def test_agent_to_renderer_update_components_and_surface_alias():
    msg_dict = {
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "surf-1",
            "components": [{"id": "btn-1", "component": "Button", "label": "Click me"}],
        },
    }
    msg1 = TypeAdapter(UpdateComponentsMessage).validate_python(msg_dict)
    msg2 = TypeAdapter(UpdateSurfaceMessage).validate_python(msg_dict)

    assert msg1.update_components.surface_id == "surf-1"
    assert msg2.update_components.surface_id == "surf-1"
    assert len(msg1.update_components.components) == 1


def test_agent_to_renderer_update_data_model():
    msg_dict = {
        "version": "v1.0",
        "updateDataModel": {
            "surfaceId": "surf-1",
            "path": "/user/name",
            "value": "Alice",
        },
    }
    msg = TypeAdapter(UpdateDataModelMessage).validate_python(msg_dict)
    assert msg.update_data_model.surface_id == "surf-1"
    assert msg.update_data_model.path == "/user/name"
    assert msg.update_data_model.value == "Alice"


def test_agent_to_renderer_delete_surface():
    msg_dict = {
        "version": "v1.0",
        "deleteSurface": {"surfaceId": "surf-1"},
    }
    msg = TypeAdapter(DeleteSurfaceMessage).validate_python(msg_dict)
    assert msg.delete_surface.surface_id == "surf-1"


def test_agent_to_renderer_call_renderer_function():
    msg_dict = {
        "version": "v1.0",
        "callRendererFunction": {
            "functionCallId": "call-123",
            "callFunction": {
                "call": "showNotification",
                "args": {"title": "Alert", "message": "Test message"},
            },
        },
    }
    msg = TypeAdapter(CallRendererFunctionMessage).validate_python(msg_dict)
    assert msg.call_renderer_function.function_call_id == "call-123"
    assert msg.call_renderer_function.call_function.call == "showNotification"


def test_agent_function_response():
    msg_dict = {
        "version": "v1.0",
        "agentFunctionResponse": {
            "functionCallId": "call-456",
            "value": {"result": 42},
        },
    }
    msg = TypeAdapter(AgentFunctionResponseMessage).validate_python(msg_dict)
    assert msg.agent_function_response.function_call_id == "call-456"
    assert msg.agent_function_response.value == {"result": 42}


def test_renderer_to_agent_action():
    msg_dict = {
        "version": "v1.0",
        "action": {
            "name": "submit_form",
            "userMessage": "User submitted form",
            "surfaceId": "surf-1",
            "sourceComponentId": "btn-submit",
            "timestamp": "2026-08-12T16:00:00Z",
            "context": {"formId": "f-1"},
        },
    }
    msg = TypeAdapter(ActionMessage).validate_python(msg_dict)
    assert msg.action.name == "submit_form"
    assert msg.action.user_message == "User submitted form"
    assert msg.action.surface_id == "surf-1"
    assert msg.action.source_component_id == "btn-submit"
    assert msg.action.context == {"formId": "f-1"}


def test_renderer_to_agent_call_agent_function():
    msg_dict = {
        "version": "v1.0",
        "callAgentFunction": {
            "surfaceId": "surf-1",
            "functionCallId": "call-789",
            "callFunction": {"call": "fetchUserData", "args": {"userId": "u-1"}},
        },
    }
    msg = TypeAdapter(CallAgentFunctionMessage).validate_python(msg_dict)
    assert msg.call_agent_function.surface_id == "surf-1"
    assert msg.call_agent_function.function_call_id == "call-789"


def test_renderer_to_agent_renderer_function_response():
    msg_dict = {
        "version": "v1.0",
        "rendererFunctionResponse": {
            "functionCallId": "call-999",
            "value": True,
        },
    }
    msg = TypeAdapter(RendererFunctionResponseMessage).validate_python(msg_dict)
    assert msg.renderer_function_response.function_call_id == "call-999"
    assert msg.renderer_function_response.value is True


def test_renderer_to_agent_error_validation_and_generic():
    val_err_dict = {
        "version": "v1.0",
        "error": {
            "code": "VALIDATION_FAILED",
            "surfaceId": "surf-1",
            "path": "/components/0/text",
            "message": "Missing text attribute",
        },
    }
    msg1 = TypeAdapter(ErrorResponseMessage).validate_python(val_err_dict)
    assert isinstance(msg1.error, ValidationErrorPayload)
    assert msg1.error.code == "VALIDATION_FAILED"
    assert msg1.error.surface_id == "surf-1"

    gen_err_dict = {
        "version": "v1.0",
        "error": {
            "code": "INTERNAL_ERROR",
            "message": "Something went wrong",
            "surfaceId": "surf-1",
        },
    }
    msg2 = TypeAdapter(ErrorResponseMessage).validate_python(gen_err_dict)
    assert isinstance(msg2.error, GenericErrorPayload)
    assert msg2.error.code == "INTERNAL_ERROR"


def test_renderer_and_agent_capabilities():
    rc_dict = {
        "version": "v1.0",
        "rendererCapabilities": {
            "v1.0": {
                "supportedCatalogIds": ["org.example:basic"],
                "inlineCatalogs": [],
            }
        },
    }
    rc_msg = TypeAdapter(RendererCapabilitiesMessage).validate_python(rc_dict)
    assert rc_msg.renderer_capabilities.v1_0.supported_catalog_ids == [
        "org.example:basic"
    ]

    ac_dict = {
        "v1.0": {
            "supportedCatalogIds": ["org.example:basic"],
            "acceptsInlineCatalogs": True,
        }
    }
    ac = TypeAdapter(AgentCapabilities).validate_python(ac_dict)
    assert ac.v1_0 is not None
    assert ac.v1_0.accepts_inline_catalogs is True


def test_envelope_unions_v09_and_v10():
    # v0.9 CreateSurface Message
    v09_payload = {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "surf-v09",
            "catalogId": (
                "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
            ),
        },
    }
    v09_parsed = TypeAdapter(AgentToRendererMessage).validate_python(v09_payload)
    assert getattr(v09_parsed, "version") == "v0.9"

    # v1.0 CreateSurface Message
    v10_payload = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "surf-v10",
        },
    }
    v10_parsed = TypeAdapter(AgentToRendererMessage).validate_python(v10_payload)
    assert getattr(v10_parsed, "version") == "v1.0"

    # v0.9 Action Message
    v09_action = {
        "version": "v0.9",
        "action": {
            "name": "click",
            "surfaceId": "surf-v09",
            "sourceComponentId": "btn-1",
            "timestamp": "2026-08-12T16:00:00Z",
            "context": {},
        },
    }
    v09_action_parsed = TypeAdapter(RendererToAgentMessage).validate_python(v09_action)
    assert getattr(v09_action_parsed, "version") == "v0.9"

    # v1.0 Action Message
    v10_action = {
        "version": "v1.0",
        "action": {
            "name": "click",
            "userMessage": "Clicked button",
            "surfaceId": "surf-v10",
            "sourceComponentId": "btn-1",
            "timestamp": "2026-08-12T16:00:00Z",
            "context": {},
        },
    }
    v10_action_parsed = TypeAdapter(RendererToAgentMessage).validate_python(v10_action)
    assert getattr(v10_action_parsed, "version") == "v1.0"
