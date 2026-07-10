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

import logging
from typing import Optional
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
)
from a2ui.a2a.parts import is_a2ui_part
from a2a.server.events import Event as A2AEvent
from a2a.types import Part, DataPart


class SurfaceIdAlreadyExistsError(Exception):

    def __init__(self, surface_id: str, message: str):
        self.surface_id = surface_id
        super().__init__(message)


class A2uiSubagentMap:
    """Manages routing of tasks to sub-agents."""

    KEY_PREFIX = "a2ui_surface_id_"

    @classmethod
    def _get_key(cls, surface_id: str) -> str:
        return cls.KEY_PREFIX + surface_id

    @classmethod
    async def get_subagent_name(cls, surface_id: str, state: State) -> Optional[str]:
        """Gets the subagent route for the given tool call id."""
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
        """Gets the subagent route for a client event a2a part, if applicable."""
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
        """Sets the subagent route for the given tool call id."""
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
        """Removes the subagent route for the given surface id."""
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
        """Processes a single server-to-client part and updates the subagent map.
        Raises SurfaceIdAlreadyExistsError if a collision occurs.
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
