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
from unittest.mock import AsyncMock, patch, MagicMock

from google.adk.sessions.state import State
from google.adk.sessions.session import Session

from a2ui.adk.orchestration.a2ui_subagent_map import A2uiSubagentMap, SurfaceIdAlreadyExistsError
from a2ui.schema.constants import A2UI_CLIENT_DATA_MODEL_SURFACES_KEY
from a2a.types import DataPart, TextPart


class TestA2uiSubagentMap(unittest.IsolatedAsyncioTestCase):

    def test_get_key(self):
        self.assertEqual(
            A2uiSubagentMap._get_key("my_surface"), "a2ui_surface_id_my_surface"
        )

    async def test_get_subagent_name_exists(self):
        state = {"a2ui_surface_id_surface1": "agent_alpha"}
        result = await A2uiSubagentMap.get_subagent_name("surface1", state)
        self.assertEqual(result, "agent_alpha")

    async def test_get_subagent_name_not_exists(self):
        state = {}
        result = await A2uiSubagentMap.get_subagent_name("surface1", state)
        self.assertIsNone(result)

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    async def test_get_subagent_name_for_client_event_action(self, mock_is_a2ui_part):
        mock_is_a2ui_part.return_value = True
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        a2a_part.root.data = {"action": {"surfaceId": "surface1"}}

        state = {"a2ui_surface_id_surface1": "agent_beta"}
        result = await A2uiSubagentMap.get_subagent_name_for_client_event(
            a2a_part, state
        )
        self.assertEqual(result, "agent_beta")

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    async def test_get_subagent_name_for_client_event_error(self, mock_is_a2ui_part):
        mock_is_a2ui_part.return_value = True
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        a2a_part.root.data = {"error": {"surfaceId": "surface1"}}

        state = {"a2ui_surface_id_surface1": "agent_beta"}
        result = await A2uiSubagentMap.get_subagent_name_for_client_event(
            a2a_part, state
        )
        self.assertEqual(result, "agent_beta")

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    async def test_get_subagent_name_for_client_event_not_a2ui(self, mock_is_a2ui_part):
        mock_is_a2ui_part.return_value = False
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        state = {"a2ui_surface_id_surface1": "agent_beta"}
        result = await A2uiSubagentMap.get_subagent_name_for_client_event(
            a2a_part, state
        )
        self.assertIsNone(result)

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.new_invocation_context_id")
    async def test_set_subagent_new_value(self, mock_new_id):
        mock_new_id.return_value = "fake-invocation-id"
        session_service = AsyncMock()
        session = MagicMock(spec=Session)
        session.state = {}

        await A2uiSubagentMap.set_subagent(
            "surface1", "agent_alpha", session_service, session
        )

        session_service.append_event.assert_called_once()
        call_args = session_service.append_event.call_args[0]
        self.assertEqual(call_args[0], session)
        event = call_args[1]
        self.assertEqual(event.author, "system")
        self.assertEqual(
            event.actions.state_delta, {"a2ui_surface_id_surface1": "agent_alpha"}
        )
        self.assertEqual(event.invocation_id, "fake-invocation-id")

    async def test_set_subagent_existing_value(self):
        session_service = AsyncMock()
        session = MagicMock(spec=Session)
        session.state = {"a2ui_surface_id_surface1": "agent_alpha"}

        await A2uiSubagentMap.set_subagent(
            "surface1", "agent_alpha", session_service, session
        )

        session_service.append_event.assert_not_called()

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.new_invocation_context_id")
    async def test_remove_subagent_existing_value(self, mock_new_id):
        mock_new_id.return_value = "fake-invocation-id"
        session_service = AsyncMock()
        session = MagicMock(spec=Session)
        session.state = {"a2ui_surface_id_surface1": "agent_alpha"}

        await A2uiSubagentMap.remove_subagent("surface1", session_service, session)

        session_service.append_event.assert_called_once()
        call_args = session_service.append_event.call_args[0]
        self.assertEqual(call_args[0], session)
        event = call_args[1]
        self.assertEqual(event.author, "system")
        self.assertEqual(event.actions.state_delta, {"a2ui_surface_id_surface1": None})
        self.assertEqual(event.invocation_id, "fake-invocation-id")

    async def test_remove_subagent_not_exists(self):
        session_service = AsyncMock()
        session = MagicMock(spec=Session)
        session.state = {}

        await A2uiSubagentMap.remove_subagent("surface1", session_service, session)

        session_service.append_event.assert_not_called()

    def test_surface_id_already_exists_error(self):
        err = SurfaceIdAlreadyExistsError("test_surface", "custom message")
        self.assertEqual(err.surface_id, "test_surface")
        self.assertEqual(str(err), "custom message")

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "set_subagent")
    async def test_update_from_server_event_begin_rendering_new(
        self, mock_set_subagent, mock_is_a2ui_part
    ):
        mock_is_a2ui_part.return_value = True
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        a2a_part.root.data = {"beginRendering": {"surfaceId": "surface1"}}

        session_service = AsyncMock()
        session = MagicMock(spec=Session)
        session.state = {}

        await A2uiSubagentMap.update_from_server_event(
            a2a_part, "agent_alpha", session_service, session
        )

        mock_set_subagent.assert_called_once_with(
            "surface1", "agent_alpha", session_service, session
        )

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "set_subagent")
    async def test_update_from_server_event_create_surface_new(
        self, mock_set_subagent, mock_is_a2ui_part
    ):
        mock_is_a2ui_part.return_value = True
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        a2a_part.root.data = {"createSurface": {"surfaceId": "surface1"}}

        session_service = AsyncMock()
        session = MagicMock(spec=Session)
        session.state = {}

        await A2uiSubagentMap.update_from_server_event(
            a2a_part, "agent_alpha", session_service, session
        )

        mock_set_subagent.assert_called_once_with(
            "surface1", "agent_alpha", session_service, session
        )

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "set_subagent")
    async def test_update_from_server_event_begin_rendering_existing_same_owner(
        self, mock_set_subagent, mock_is_a2ui_part
    ):
        mock_is_a2ui_part.return_value = True
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        a2a_part.root.data = {"beginRendering": {"surfaceId": "surface1"}}

        session_service = AsyncMock()
        session = MagicMock(spec=Session)
        session.state = {"a2ui_surface_id_surface1": "agent_alpha"}

        with self.assertRaises(SurfaceIdAlreadyExistsError) as context:
            await A2uiSubagentMap.update_from_server_event(
                a2a_part, "agent_alpha", session_service, session
            )

        self.assertEqual(context.exception.surface_id, "surface1")
        self.assertIn("already exists", str(context.exception))
        mock_set_subagent.assert_not_called()

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "set_subagent")
    async def test_update_from_server_event_begin_rendering_collision(
        self, mock_set_subagent, mock_is_a2ui_part
    ):
        mock_is_a2ui_part.return_value = True
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        a2a_part.root.data = {"beginRendering": {"surfaceId": "surface1"}}

        session_service = AsyncMock()
        session = MagicMock(spec=Session)
        session.state = {"a2ui_surface_id_surface1": "agent_alpha"}

        with self.assertRaises(SurfaceIdAlreadyExistsError) as context:
            await A2uiSubagentMap.update_from_server_event(
                a2a_part, "agent_beta", session_service, session
            )

        self.assertEqual(context.exception.surface_id, "surface1")
        self.assertIn("already exists", str(context.exception))
        self.assertIn("agent_alpha", str(context.exception))
        self.assertIn("agent_beta", str(context.exception))
        mock_set_subagent.assert_not_called()

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "remove_subagent")
    async def test_update_from_server_event_delete_surface(
        self, mock_remove_subagent, mock_is_a2ui_part
    ):
        mock_is_a2ui_part.return_value = True
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        a2a_part.root.data = {"deleteSurface": {"surfaceId": "surface1"}}

        session_service = AsyncMock()
        session = MagicMock(spec=Session)
        session.state = {"a2ui_surface_id_surface1": "agent_alpha"}

        await A2uiSubagentMap.update_from_server_event(
            a2a_part, "agent_alpha", session_service, session
        )

        mock_remove_subagent.assert_called_once_with(
            "surface1", session_service, session
        )

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "set_subagent")
    @patch.object(A2uiSubagentMap, "remove_subagent")
    async def test_update_from_server_event_not_a2ui(
        self, mock_remove_subagent, mock_set_subagent, mock_is_a2ui_part
    ):
        mock_is_a2ui_part.return_value = False
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        a2a_part.root.data = {"beginRendering": {"surfaceId": "surface1"}}

        session_service = AsyncMock()
        session = MagicMock(spec=Session)

        await A2uiSubagentMap.update_from_server_event(
            a2a_part, "agent_alpha", session_service, session
        )

        mock_set_subagent.assert_not_called()
        mock_remove_subagent.assert_not_called()

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "set_subagent")
    @patch.object(A2uiSubagentMap, "remove_subagent")
    async def test_update_from_server_event_not_datapart(
        self, mock_remove_subagent, mock_set_subagent, mock_is_a2ui_part
    ):
        mock_is_a2ui_part.return_value = True
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = TextPart
        a2a_part.root.text = "hello"

        session_service = AsyncMock()
        session = MagicMock(spec=Session)

        await A2uiSubagentMap.update_from_server_event(
            a2a_part, "agent_alpha", session_service, session
        )

        mock_set_subagent.assert_not_called()
        mock_remove_subagent.assert_not_called()

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "set_subagent")
    @patch.object(A2uiSubagentMap, "remove_subagent")
    async def test_update_from_server_event_data_not_dict(
        self, mock_remove_subagent, mock_set_subagent, mock_is_a2ui_part
    ):
        mock_is_a2ui_part.return_value = True
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        a2a_part.root.data = "this is a string, not a dict"

        session_service = AsyncMock()
        session = MagicMock(spec=Session)

        await A2uiSubagentMap.update_from_server_event(
            a2a_part, "agent_alpha", session_service, session
        )

        mock_set_subagent.assert_not_called()
        mock_remove_subagent.assert_not_called()

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.is_a2ui_part")
    @patch.object(A2uiSubagentMap, "set_subagent")
    @patch.object(A2uiSubagentMap, "remove_subagent")
    async def test_update_from_server_event_unrelated_dict(
        self, mock_remove_subagent, mock_set_subagent, mock_is_a2ui_part
    ):
        mock_is_a2ui_part.return_value = True
        a2a_part = MagicMock()
        a2a_part.root = MagicMock()
        a2a_part.root.__class__ = DataPart
        a2a_part.root.data = {"updateComponents": {"surfaceId": "surface1"}}

        session_service = AsyncMock()
        session = MagicMock(spec=Session)

        await A2uiSubagentMap.update_from_server_event(
            a2a_part, "agent_alpha", session_service, session
        )

        mock_set_subagent.assert_not_called()
        mock_remove_subagent.assert_not_called()

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.logging")
    async def test_strip_unowned_surfaces_no_surfaces_key(self, mock_logging):
        client_data_model = {"other_key": "value"}
        state = {}

        await A2uiSubagentMap.strip_unowned_surfaces_from_data_model(
            "subagent_a", client_data_model, state
        )

        mock_logging.warning.assert_called_with(
            "'Surfaces' not found in client data model dict"
        )
        self.assertEqual(client_data_model, {"other_key": "value"})

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.logging")
    async def test_strip_unowned_surfaces_empty_surfaces(self, mock_logging):
        client_data_model = {A2UI_CLIENT_DATA_MODEL_SURFACES_KEY: {}}
        state = {}

        await A2uiSubagentMap.strip_unowned_surfaces_from_data_model(
            "subagent_a", client_data_model, state
        )

        mock_logging.warning.assert_not_called()
        self.assertEqual(client_data_model, {A2UI_CLIENT_DATA_MODEL_SURFACES_KEY: {}})

    @patch("a2ui.adk.orchestration.a2ui_subagent_map.logging")
    async def test_strip_unowned_surfaces_no_subagent_name(self, mock_logging):
        client_data_model = {
            A2UI_CLIENT_DATA_MODEL_SURFACES_KEY: {"surface_1": {}, "surface_2": {}}
        }
        state = {}

        await A2uiSubagentMap.strip_unowned_surfaces_from_data_model(
            None, client_data_model, state
        )

        mock_logging.warning.assert_called_with(
            "No subagent name provided. Stripped all 2 surfaces from data model."
        )
        self.assertEqual(client_data_model, {A2UI_CLIENT_DATA_MODEL_SURFACES_KEY: {}})

    @patch.object(A2uiSubagentMap, "get_subagent_name")
    async def test_strip_unowned_surfaces_with_subagent(self, mock_get_subagent_name):
        client_data_model = {
            A2UI_CLIENT_DATA_MODEL_SURFACES_KEY: {
                "surface_1": {"data": "1"},
                "surface_2": {"data": "2"},
                "surface_3": {"data": "3"},
            }
        }
        state = {}

        async def mock_get_subagent(sid, s):
            mapping = {
                "surface_1": "subagent_a",
                "surface_2": "subagent_b",
                "surface_3": "subagent_a",
            }
            return mapping.get(sid)

        mock_get_subagent_name.side_effect = mock_get_subagent

        # Test stripping for subagent_a
        await A2uiSubagentMap.strip_unowned_surfaces_from_data_model(
            "subagent_a", client_data_model, state
        )

        # Original dictionary should have been mutated in place (surface_2 removed)
        self.assertEqual(
            client_data_model,
            {
                A2UI_CLIENT_DATA_MODEL_SURFACES_KEY: {
                    "surface_1": {"data": "1"},
                    "surface_3": {"data": "3"},
                }
            },
        )

        # Ensure we can run it again on the mutated dictionary for subagent_b (should remove everything left)
        await A2uiSubagentMap.strip_unowned_surfaces_from_data_model(
            "subagent_b", client_data_model, state
        )
        self.assertEqual(client_data_model, {A2UI_CLIENT_DATA_MODEL_SURFACES_KEY: {}})


if __name__ == "__main__":
    unittest.main()
