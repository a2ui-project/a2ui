# Copyright 2025 Google LLC
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

import unittest
import asyncio
from unittest.mock import MagicMock, AsyncMock, patch

from google.genai import types as genai_types
from google.adk.models.llm_request import LlmRequest
from a2a.types import AgentCard
from a2a.client.middleware import ClientCallContext

# Import the modules we want to test
from orchestrator_agent_executor import (
    OrchestratorAgentExecutor,
    A2UIMetadataInterceptor,
)
from a2ui.adk.orchestration.a2ui_subagent_map import A2uiSubagentMap
from a2ui.schema.constants import (
    A2UI_CLIENT_DATA_MODEL_KEY,
    A2UI_CLIENT_DATA_MODEL_SURFACES_KEY,
)
from a2a.types import DataPart


class DummyA2aPart:

    def __init__(self, root_data):
        self.root = MagicMock()
        self.root.__class__ = DataPart
        self.root.data = root_data


class TestOrchestratorAgentExecutor(unittest.IsolatedAsyncioTestCase):

    @patch("orchestrator_agent_executor.convert_genai_part_to_a2a_part")
    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "get_subagent_name")
    async def test_programmatically_route_client_event_to_subagent(
        self,
        mock_get_route,
        mock_is_a2ui_part,
        mock_convert,
    ):
        # Use Case 1: subagent creates a surface -> user triggers action -> route to subagent

        # Setup mocks
        mock_get_route.return_value = "target_subagent_123"
        mock_is_a2ui_part.return_value = True

        a2a_part_data = {"action": {"surfaceId": "surface_123", "name": "click"}}
        mock_convert.return_value = DummyA2aPart(a2a_part_data)

        # Create dummy LLM request
        mock_part = genai_types.Part()
        mock_content = genai_types.Content(parts=[mock_part])
        llm_request = LlmRequest(contents=[mock_content])

        # Create callback context dummy
        callback_context = MagicMock()
        callback_context.state = {}

        # Execute the method
        response = await OrchestratorAgentExecutor.programmatically_route_client_event_to_subagent(
            callback_context, llm_request
        )

        # Assertions
        mock_get_route.assert_called_once_with("surface_123", {})
        self.assertIsNotNone(response)
        self.assertEqual(len(response.content.parts), 1)
        self.assertEqual(
            response.content.parts[0].function_call.name, "transfer_to_agent"
        )
        self.assertEqual(
            response.content.parts[0].function_call.args["agent_name"],
            "target_subagent_123",
        )

    @patch("orchestrator_agent_executor.convert_genai_part_to_a2a_part")
    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "get_subagent_name")
    async def test_programmatically_route_client_error_to_subagent(
        self,
        mock_get_route,
        mock_is_a2ui_part,
        mock_convert,
    ):
        # Use Case 1b: client sends validation error -> route to subagent

        mock_get_route.return_value = "target_subagent_123"
        mock_is_a2ui_part.return_value = True

        a2a_part_data = {
            "error": {
                "surfaceId": "surface_123",
                "code": "VALIDATION_FAILED",
                "message": "Field invalid",
            }
        }
        mock_convert.return_value = DummyA2aPart(a2a_part_data)

        mock_part = genai_types.Part()
        mock_content = genai_types.Content(parts=[mock_part])
        llm_request = LlmRequest(contents=[mock_content])

        callback_context = MagicMock()
        callback_context.state = {}

        response = await OrchestratorAgentExecutor.programmatically_route_client_event_to_subagent(
            callback_context, llm_request
        )

        self.assertIsNotNone(response)
        self.assertEqual(
            response.content.parts[0].function_call.name, "transfer_to_agent"
        )
        self.assertEqual(
            response.content.parts[0].function_call.args["agent_name"],
            "target_subagent_123",
        )

    @patch.object(A2uiSubagentMap, "get_subagent_name")
    async def test_a2ui_metadata_interceptor_filters_data_model(self, mock_get_route):
        # Use Case 2: two subagents create surfaces -> orchestrator filters data model to the owner

        # The interceptor uses gather to query all surface routes
        async def fake_get_route(sid, state):
            # mapping surface ids to agent names
            mapping = {
                "surface_A": "agent_alpha",
                "surface_B": "agent_beta",
                "surface_C": "agent_alpha",
            }
            return mapping.get(sid)

        mock_get_route.side_effect = fake_get_route

        interceptor = A2UIMetadataInterceptor()

        # Setup input data
        agent_card = MagicMock()
        agent_card.name = "agent_alpha"

        request_payload = {
            "params": {
                "message": {
                    "role": "user",
                    "parts": [],
                    "messageId": "msg-123",
                    "metadata": {
                        A2UI_CLIENT_DATA_MODEL_KEY: {
                            A2UI_CLIENT_DATA_MODEL_SURFACES_KEY: {
                                "surface_A": {"data": "A"},
                                "surface_B": {"data": "B"},
                                "surface_C": {"data": "C"},
                            }
                        }
                    },
                }
            }
        }
        http_kwargs = {}
        context = ClientCallContext(
            method="send_message",
            state={"active_ui_version": "0.9.1", "client_capabilities": {}},
        )

        # Execute the interceptor
        new_payload, new_http_kwargs = await interceptor.intercept(
            "send_message", request_payload, http_kwargs, agent_card, context
        )

        # Assertions: We expect only surface_A and surface_C to remain for agent_alpha
        filtered_surfaces = new_payload["params"]["message"]["metadata"][
            A2UI_CLIENT_DATA_MODEL_KEY
        ][A2UI_CLIENT_DATA_MODEL_SURFACES_KEY]
        self.assertIn("surface_A", filtered_surfaces)
        self.assertIn("surface_C", filtered_surfaces)
        self.assertNotIn("surface_B", filtered_surfaces)

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "set_subagent")
    async def test_surface_id_collision(self, mock_set_subagent, mock_is_a2ui_part):
        # Use Case 3: surfaceId collision between subagents

        event = MagicMock()
        event.author = "subagent_2"

        invocation_context = MagicMock()

        # Mock subagent_2
        mock_subagent_2 = MagicMock()
        mock_subagent_2.name = "subagent_2"
        mock_subagent_2.description = "{}"
        mock_subagent_2.run_async = AsyncMock()

        invocation_context.agent.sub_agents = [mock_subagent_2]

        # Return subagent_1 to simulate collision
        invocation_context.session.state.get.return_value = "subagent_1"

        a2a_part_data = {"beginRendering": {"surfaceId": "surface_123"}}
        dummy_a2a_part = DummyA2aPart(a2a_part_data)

        a2a_event = MagicMock()
        # Ensure metadata is accessible to avoid NoneType errors
        a2a_event.metadata = {}
        a2a_event.status.message.parts = [dummy_a2a_part]

        executor_context = MagicMock()
        executor_context.invocation_context = invocation_context

        result_event = await OrchestratorAgentExecutor.after_event_save_surface_id_to_subagent_name(
            executor_context, a2a_event, event
        )

        mock_set_subagent.assert_not_called()

        # The part should be dropped
        self.assertEqual(len(result_event.status.message.parts), 0)

        # The subagent should have received a run_async call with the error
        mock_subagent_2.run_async.assert_called_once()
        error_req = mock_subagent_2.run_async.call_args[0][0]
        self.assertIsInstance(error_req, LlmRequest)
        error_text = error_req.contents[0].parts[0].text

        import json

        error_json = json.loads(error_text)
        self.assertEqual(error_json["version"], "0.9")
        self.assertEqual(error_json["error"]["code"], "SURFACE_ID_ALREADY_EXISTS")
        self.assertEqual(error_json["error"]["surfaceId"], "surface_123")
        self.assertIn(
            "surfaceId 'surface_123' already exists, surfaceIds must be globally"
            " unique",
            error_json["error"]["message"],
        )

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "remove_subagent")
    async def test_delete_surface_removes_from_map(
        self, mock_remove_subagent, mock_is_a2ui_part
    ):
        event = MagicMock()
        event.author = "subagent_1"

        invocation_context = MagicMock()

        a2a_part_data = {"deleteSurface": {"surfaceId": "surface_to_delete"}}
        dummy_a2a_part = DummyA2aPart(a2a_part_data)

        a2a_event = MagicMock()
        a2a_event.metadata = {}
        a2a_event.status.message.parts = [dummy_a2a_part]

        executor_context = MagicMock()
        executor_context.invocation_context = invocation_context

        result_event = await OrchestratorAgentExecutor.after_event_save_surface_id_to_subagent_name(
            executor_context, a2a_event, event
        )

        # Verify remove_subagent was called
        mock_remove_subagent.assert_called_once_with(
            "surface_to_delete",
            invocation_context.session_service,
            invocation_context.session,
        )


if __name__ == "__main__":
    unittest.main()
