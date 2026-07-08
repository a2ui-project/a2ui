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
from a2ui_subagent_map import A2uiSubagentMap

class DummyA2aPart:
    def __init__(self, root_data):
        self.root = MagicMock()
        self.root.data = root_data

class TestOrchestratorAgentExecutor(unittest.IsolatedAsyncioTestCase):

    @patch("orchestrator_agent_executor.convert_genai_part_to_a2a_part")
    @patch("orchestrator_agent_executor.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "get_subagent_name")
    async def test_programmtically_route_user_action_to_subagent(
        self,
        mock_get_route,
        mock_is_a2ui_part,
        mock_convert,
    ):
        # Use Case 1: subagent creates a surface -> user triggers action -> route to subagent
        
        # Setup mocks
        mock_get_route.return_value = "target_subagent_123"
        mock_is_a2ui_part.return_value = True
        
        a2a_part_data = {
            "userAction": {
                "surfaceId": "surface_123",
                "action": "click"
            }
        }
        mock_convert.return_value = DummyA2aPart(a2a_part_data)
        
        # Create dummy LLM request
        mock_part = genai_types.Part()
        mock_content = genai_types.Content(parts=[mock_part])
        llm_request = LlmRequest(contents=[mock_content])
        
        # Create callback context dummy
        callback_context = MagicMock()
        callback_context.state = {}
        
        # Execute the method
        response = await OrchestratorAgentExecutor.programmtically_route_user_action_to_subagent(
            callback_context, llm_request
        )
        
        # Assertions
        mock_get_route.assert_called_once_with("surface_123", {})
        self.assertIsNotNone(response)
        self.assertEqual(len(response.content.parts), 1)
        self.assertEqual(
            response.content.parts[0].function_call.name, 
            "transfer_to_agent"
        )
        self.assertEqual(
            response.content.parts[0].function_call.args["agent_name"], 
            "target_subagent_123"
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
                "surface_C": "agent_alpha"
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
                    "metadata": {
                        "a2uiClientDataModel": {
                            "surfaces": {
                                "surface_A": {"data": "A"},
                                "surface_B": {"data": "B"},
                                "surface_C": {"data": "C"},
                            }
                        }
                    }
                }
            }
        }
        http_kwargs = {}
        context = ClientCallContext(
            method="send_message",
            state={
                "active_ui_version": "0.9.1",
                "client_capabilities": {}
            }
        )
        
        # Execute the interceptor
        new_payload, new_http_kwargs = await interceptor.intercept(
            "send_message",
            request_payload,
            http_kwargs,
            agent_card,
            context
        )
        
        # Assertions: We expect only surface_A and surface_C to remain for agent_alpha
        filtered_surfaces = new_payload["params"]["message"]["metadata"]["a2uiClientDataModel"]["surfaces"]
        self.assertIn("surface_A", filtered_surfaces)
        self.assertIn("surface_C", filtered_surfaces)
        self.assertNotIn("surface_B", filtered_surfaces)

if __name__ == "__main__":
    unittest.main()
