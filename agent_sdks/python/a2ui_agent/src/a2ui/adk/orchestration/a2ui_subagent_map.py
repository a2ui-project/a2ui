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

"""Module for the A2uiSubagentMap.

This module provides the necessary logic to map A2UI surface IDs to the agents (or subagents)
that created them. This is primarily used by the A2A orchestrator to track which agent is responsible for which surface,
ensuring that client data models and events can be properly routed and stripped of information belonging
to other agents.

Key Components:
  * `A2uiSubagentMap`: A utility class containing class methods for managing subagent ownership mapping in an ADK `State` object.

Usage Examples:

  1. Tracking Ownership from Server Events:
    Whenever an agent sends a new a2ui message to a client, you should update the map using `update_from_server_event`.

    ```python
    await A2uiSubagentMap.update_from_server_event(
        a2a_part,
        author="agent_alpha",
        session_service=session_service,
        session=session
    )
    ```

  2. Determining Ownership for Client Events:
    When a client A2UI event is received, you can use the map to determine which subagent should handle it.

    ```python
    target_agent = await A2uiSubagentMap.get_subagent_name_for_client_event(
        a2a_part,
        state=context.state
    )
    # If implemented in an ADK LlmAgent.before_model_callback, trigger a transfer_to_agent
    if target_agent:
        return LlmResponse(
            content=genai_types.Content(
                parts=[
                    genai_types.Part(
                        function_call=genai_types.FunctionCall(
                            name="transfer_to_agent",
                            args={"agent_name": target_agent},
                        )
                    )
                ]
            )
        )
    ```

  3. Stripping Unowned Surfaces from Data Models:
    Before forwarding an a2uiClientDataModel metadata to a subagent, you should strip out surfaces owned by other agents to prevent data leakage.

    ```python
    await A2uiSubagentMap.strip_unowned_surfaces_from_data_model(
        agent_name,
        a2a_message.metadata[A2UI_CLIENT_DATA_MODEL_KEY],
        context.state
    )
    ```
"""

import logging
from typing import Optional, Any
from google.adk.agents.invocation_context import new_invocation_context_id
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.sessions.base_session_service import BaseSessionService
from google.adk.sessions.session import Session
from google.adk.sessions.state import State
import asyncio
from a2ui.schema.constants import (
    A2UI_BEGIN_RENDERING_KEY,
    A2UI_SURFACE_ID_KEY,
    A2UI_CREATE_SURFACE_KEY,
    A2UI_DELETE_SURFACE_KEY,
    A2UI_ACTIONS_KEY,
    A2UI_ERROR_KEY,
    A2UI_CLIENT_DATA_MODEL_SURFACES_KEY,
)
from a2ui.a2a.parts import is_a2ui_part
from a2a.types import Part, DataPart


class SurfaceIdAlreadyExistsError(Exception):

    def __init__(self, surface_id: str, message: str):
        self.surface_id = surface_id
        super().__init__(message)


class A2uiSubagentMap:
    """Manages routing of tasks to sub-agents based on A2UI surface ownership."""

    KEY_PREFIX = "a2ui_surface_id_"

    @classmethod
    def _get_key(cls, surface_id: str) -> str:
        return cls.KEY_PREFIX + surface_id

    @classmethod
    async def get_subagent_name(cls, surface_id: str, state: State) -> Optional[str]:
        """Gets the subagent name that owns the given surface ID.

        Args:
            surface_id: The ID of the A2UI surface.
            state: The ADK State object where the mapping is stored.

        Returns:
            The name of the subagent that owns the surface, or None if no owner is found.
        """
        subagent_name = state.get(cls._get_key(surface_id), None)
        logging.info(
            "Mapped surface_id %s to subagent_name %s",
            surface_id,
            subagent_name,
        )
        if isinstance(subagent_name, str):
            return subagent_name
        return None

    @classmethod
    async def get_subagent_name_for_client_event(
        cls, a2a_part: Part, state: State
    ) -> Optional[str]:
        """Extracts the surface ID from a client event A2A part and returns the owning subagent.

        Examines an incoming client event (like an action or error) to find the targeted
        surface ID. It then looks up and returns the agent that originally created that surface.

        Args:
            a2a_part: The A2A Part containing the client event payload.
            state: The ADK State object where the mapping is stored.

        Returns:
            The name of the subagent that owns the targeted surface, or None if not applicable or not found.
        """
        if (
            a2a_part is None
            or not is_a2ui_part(a2a_part)
            or not isinstance(a2a_part.root, DataPart)
        ):
            return None

        surface_id = None
        data = a2a_part.root.data
        if isinstance(data, dict):
            if (action := data.get(A2UI_ACTIONS_KEY)) and isinstance(action, dict):
                surface_id = action.get(A2UI_SURFACE_ID_KEY)
            elif (error := data.get(A2UI_ERROR_KEY)) and isinstance(error, dict):
                surface_id = error.get(A2UI_SURFACE_ID_KEY)

        if surface_id:
            return await cls.get_subagent_name(surface_id, state)
        return None

    @classmethod
    async def set_subagent(
        cls,
        surface_id: str,
        subagent_name: str,
        session_service: BaseSessionService,
        session: Session,
    ) -> None:
        """Assigns ownership of a surface ID to a specific subagent.

        Updates the state to map the given surface ID to the provided subagent name.
        This is typically called when an agent creates a new surface.

        Args:
            surface_id: The ID of the A2UI surface.
            subagent_name: The name of the subagent creating the surface.
            session_service: The service used to append state-changing events.
            session: The current session containing the state.
        """
        key = cls._get_key(surface_id)

        if session.state.get(key) != subagent_name:
            await session_service.append_event(
                session,
                Event(
                    invocation_id=new_invocation_context_id(),
                    author="system",
                    actions=EventActions(state_delta={key: subagent_name}),
                ),
            )

            logging.info(
                "Set surface_id %s to subagent_name %s",
                surface_id,
                subagent_name,
            )

    @classmethod
    async def remove_subagent(
        cls,
        surface_id: str,
        session_service: BaseSessionService,
        session: Session,
    ) -> None:
        """Removes the ownership mapping for a given surface ID.

        Updates the state to clear the owner of the surface ID.
        This is typically called when an agent deletes a surface.

        Args:
            surface_id: The ID of the A2UI surface to unmap.
            session_service: The service used to append state-changing events.
            session: The current session containing the state.
        """
        key = cls._get_key(surface_id)

        if session.state.get(key) is not None:
            await session_service.append_event(
                session,
                Event(
                    invocation_id=new_invocation_context_id(),
                    author="system",
                    actions=EventActions(state_delta={key: None}),
                ),
            )

            logging.info(
                "Removed surface_id %s from subagent map",
                surface_id,
            )

    @classmethod
    async def update_from_server_event(
        cls,
        a2a_part: Part,
        author: str,
        session_service: BaseSessionService,
        session: Session,
    ) -> None:
        """Processes a single server-to-client part and updates the subagent map accordingly.

        Inspects the server event for A2UI `createSurface` (or legacy `beginRendering`) and
        `deleteSurface` operations. If a surface is created, it assigns ownership to the `author`.
        If a surface is deleted, it removes the ownership mapping.

        Args:
            a2a_part: The A2A Part containing the server event payload.
            author: The name of the subagent that authored the event.
            session_service: The service used to append state-changing events.
            session: The current session containing the state.

        Raises:
            SurfaceIdAlreadyExistsError: If an agent tries to create a surface ID that is already owned by someone else.
        """
        if (
            a2a_part is None
            or not is_a2ui_part(a2a_part)
            or not isinstance(a2a_part.root, DataPart)
            or not (data := a2a_part.root.data)
            or not isinstance(data, dict)
        ):
            return

        if (
            (
                surface_dict := data.get(A2UI_CREATE_SURFACE_KEY)  # v0.9+
                or data.get(A2UI_BEGIN_RENDERING_KEY)  # v0.8
            )
            and isinstance(surface_dict, dict)
            and (surface_id := surface_dict.get(A2UI_SURFACE_ID_KEY))
        ):
            key = cls._get_key(surface_id)
            existing_owner = session.state.get(key)

            if existing_owner:
                raise SurfaceIdAlreadyExistsError(
                    surface_id,
                    f"Surface ID {surface_id} already exists: surface was previously"
                    f" created by {existing_owner}, and {author} tried to create it"
                    " again",
                )
            else:
                await cls.set_subagent(
                    surface_id,
                    author,
                    session_service,
                    session,
                )
        elif (
            isinstance(data, dict)
            and (delete_surface := data.get(A2UI_DELETE_SURFACE_KEY))
            and isinstance(delete_surface, dict)
            and (surface_id := delete_surface.get(A2UI_SURFACE_ID_KEY))
        ):
            await cls.remove_subagent(
                surface_id,
                session_service,
                session,
            )

    @classmethod
    async def strip_unowned_surfaces_from_data_model(
        cls,
        subagent_name: Optional[str],
        client_data_model: dict[str, Any],
        state: State,
    ) -> None:
        """Strips data model surfaces not owned by the given subagent in place.

        Mutates the `client_data_model` dictionary by removing any surfaces from the
        `surfaces` key that do not belong to the provided `subagent_name`. This prevents
        agents from seeing data models for surfaces they didn't create.

        Args:
            subagent_name: The name of the target subagent.
            client_data_model: The A2UI data model dictionary extracted from the message metadata.
            state: The ADK State object where the mapping is stored.
        """
        if (
            surfaces := client_data_model.get(A2UI_CLIENT_DATA_MODEL_SURFACES_KEY)
        ) is None:
            logging.warning("'Surfaces' not found in client data model")
            return

        if not isinstance(surfaces, dict):
            logging.warning("'Surfaces' is not a dict in client data model")
            return

        if not surfaces:
            return

        surfaces_count = len(surfaces)

        if not subagent_name:
            client_data_model[A2UI_CLIENT_DATA_MODEL_SURFACES_KEY] = {}
            logging.warning(
                f"No subagent name provided. Stripped all {surfaces_count} surfaces"
                " from data model."
            )
            return

        surface_ids_to_check = list(surfaces.keys())
        owner_agents = await asyncio.gather(
            *[cls.get_subagent_name(sid, state) for sid in surface_ids_to_check]
        )

        for i, surface_id in enumerate(surface_ids_to_check):
            if owner_agents[i] != subagent_name:
                del surfaces[surface_id]

        logging.info(
            f"Stripped {surfaces_count - len(surfaces)} surfaces not owned by subagent"
            f" {subagent_name} from data model. Kept surfaces: {list(surfaces.keys())}"
        )
