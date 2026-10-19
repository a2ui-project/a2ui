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

from collections import OrderedDict
from collections.abc import AsyncIterable, AsyncIterator, Iterable, Mapping
import logging
import os
from typing import Any

from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    DataPart,
    Part,
    TextPart,
)
from google.adk.agents import run_config
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.models import Gemini
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService, Session
from google.genai import types

from a2ui.a2a import (
    create_a2ui_part,
    get_a2ui_agent_extension,
    stream_response_to_parts,
    to_a2a_parts,
)
from a2ui.constants import (
    A2UI_CLOSE_TAG,
    A2UI_CREATE_SURFACE_KEY,
    A2UI_DELETE_SURFACE_KEY,
    A2UI_OPEN_TAG,
    A2UI_SURFACE_ID_KEY,
    A2UI_VERSION_KEY,
)
from a2ui.core import A2uiError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from prompt_builder import get_text_prompt, get_ui_prompt, load_example_turns
from tools import get_restaurants

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 2
# How many conversations' surfaces to keep in memory.
_MAX_TRACKED_SESSIONS = 1000


def _text_parts(text: str) -> list[Part]:
    return [Part(root=TextPart(text=text))]


def _message_surface(part: Part, key: str) -> str | None:
    """Returns the surface of an A2UI message part of one type, if it is one."""
    if not isinstance(part.root, DataPart):
        return None
    body = part.root.data.get(key)
    if not isinstance(body, Mapping):
        return None
    surface_id = body.get(A2UI_SURFACE_ID_KEY)
    return surface_id if isinstance(surface_id, str) else None


def _delete_surface_part(surface_id: str, version: ProtocolVersion) -> Part:
    """Creates the part of a message that deletes a surface."""
    message: dict[str, Any] = {
        A2UI_DELETE_SURFACE_KEY: {A2UI_SURFACE_ID_KEY: surface_id}
    }
    if version != ProtocolVersion.V0_8:
        message = {A2UI_VERSION_KEY: version.value, **message}
    part: Part = create_a2ui_part(message, version=version)
    return part


class RestaurantAgent:
    """An agent that finds restaurants based on user criteria.

    The agent holds one generator for each protocol version it speaks. Each
    request negotiates its own processor from the client's capabilities, and
    the prompt, the parser and validation use the catalogs it holds.

    Each response shows new UI on fixed surfaces, such as `default` for the
    results, so it is checked on its own. The client still holds the surfaces
    of earlier responses, and creating a surface it holds is an error from
    v0.9 on. So the agent remembers which surfaces each conversation's client
    holds, and sends `deleteSurface` before a response creates one of them
    again. When an attempt fails after part of it was sent, the agent deletes
    the surfaces that attempt created before it retries.
    """

    SUPPORTED_CONTENT_TYPES = ["text/plain"]

    def __init__(self, base_url: str):
        self.base_url = base_url
        self._agent_name = "Restaurant Agent"
        self._user_id = "remote_agent"
        # Shared by the text runner and the runner of each UI request, so a
        # conversation keeps its history across requests.
        self._session_service = InMemorySessionService()
        self._artifact_service = InMemoryArtifactService()
        self._memory_service = InMemoryMemoryService()
        self._text_runner = self._build_runner(get_text_prompt())
        self._generators: dict[ProtocolVersion, A2uiGenerator] = {
            version: A2uiGenerator(
                [CatalogConfig(BasicCatalog(version))],
                examples=load_example_turns(version),
            )
            for version in [
                ProtocolVersion.V0_8,
                ProtocolVersion.V0_9,
                ProtocolVersion.V1_0,
            ]
        }
        # The surfaces that each conversation's client holds. The least
        # recently used conversations are dropped once there are more than
        # `_MAX_TRACKED_SESSIONS`.
        self._client_surfaces: OrderedDict[str, set[str]] = OrderedDict()
        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    def get_processing_message(self) -> str:
        return "Finding restaurants that match your criteria..."

    def _build_agent_card(self) -> AgentCard:
        extensions = [
            get_a2ui_agent_extension(
                version,
                supported_catalog_ids=[
                    c.transformed_catalog.catalog_id for c in generator.catalogs
                ],
            )
            for version, generator in self._generators.items()
        ]
        capabilities = AgentCapabilities(
            streaming=True,
            extensions=extensions,
        )
        skill = AgentSkill(
            id="find_restaurants",
            name="Find Restaurants Tool",
            description=(
                "Helps find restaurants based on user criteria (e.g., cuisine,"
                " location)."
            ),
            tags=["restaurant", "finder"],
            examples=["Find me the top 10 chinese restaurants in the US"],
        )

        return AgentCard(
            name="Restaurant Agent",
            description="This agent helps find restaurants based on user criteria.",
            url=self.base_url,
            version="1.0.0",
            default_input_modes=RestaurantAgent.SUPPORTED_CONTENT_TYPES,
            default_output_modes=RestaurantAgent.SUPPORTED_CONTENT_TYPES,
            capabilities=capabilities,
            skills=[skill],
        )

    def _build_runner(self, instruction: str) -> Runner:
        """Builds a runner whose LLM agent follows the instruction."""
        model_env = (
            os.getenv("MODEL_NAME") or os.getenv("LITELLM_MODEL") or "gemini-3.6-flash"
        )
        agent = LlmAgent(
            model=Gemini(
                model=model_env.split("/")[-1],
                # Retry transient backend errors (429, 5xx), which the model
                # returns under load.
                retry_options=types.HttpRetryOptions(attempts=3, initial_delay=2.0),
            ),
            name="restaurant_agent",
            description="An agent that finds restaurants and helps book tables.",
            # A function returns the instruction, so that ADK sends it as it
            # is. ADK reads `{name}` in an instruction string as a state
            # variable, and the prompt shows such text, like `{XID_Start}` in
            # the v1.0 schemas.
            instruction=lambda _: instruction,
            tools=[get_restaurants],
        )
        return Runner(
            app_name=self._agent_name,
            agent=agent,
            artifact_service=self._artifact_service,
            session_service=self._session_service,
            memory_service=self._memory_service,
        )

    async def _get_session(self, session_id: str) -> Session:
        session = await self._session_service.get_session(
            app_name=self._agent_name,
            user_id=self._user_id,
            session_id=session_id,
        )
        if session is None:
            session = await self._session_service.create_session(
                app_name=self._agent_name,
                user_id=self._user_id,
                state={"base_url": self.base_url},
                session_id=session_id,
            )
        elif "base_url" not in session.state:
            session.state["base_url"] = self.base_url
        return session

    def _surfaces_of(self, session_id: str) -> set[str]:
        """Returns the surfaces that the conversation's client holds."""
        surfaces = self._client_surfaces.setdefault(session_id, set())
        self._client_surfaces.move_to_end(session_id)
        if len(self._client_surfaces) > _MAX_TRACKED_SESSIONS:
            self._client_surfaces.popitem(last=False)
        return surfaces

    @staticmethod
    def _prepare_parts(
        parts: Iterable[Part], surfaces: set[str], version: ProtocolVersion
    ) -> list[Part]:
        """Returns the parts to send, and records the surfaces they change.

        A `deleteSurface` goes before each `createSurface` for a surface that
        the client already holds. v0.8 has no `createSurface`, and a v0.8
        renderer accepts a second `beginRendering`, so v0.8 parts are sent as
        they are.
        """
        prepared: list[Part] = []
        for part in parts:
            created = _message_surface(part, A2UI_CREATE_SURFACE_KEY)
            if created is not None:
                if created in surfaces:
                    prepared.append(_delete_surface_part(created, version))
                surfaces.add(created)
            deleted = _message_surface(part, A2UI_DELETE_SURFACE_KEY)
            if deleted is not None:
                surfaces.discard(deleted)
            prepared.append(part)
        return prepared

    async def stream(
        self,
        query: str,
        session_id: str,
        ui_version: ProtocolVersion | None = None,
        client_ui_capabilities: Mapping[str, Any] | None = None,
        use_streaming: bool = True,
    ) -> AsyncIterable[dict[str, Any]]:
        """Answers one request, as text or, if `ui_version` is set, with UI.

        A client that sends no renderer capabilities, or none that the agent
        can use, gets a text answer. With `use_streaming`, the parts of the
        response are sent as the model writes them. Otherwise the whole
        response is validated first and sent in the final item.
        """
        session = await self._get_session(session_id)
        processor: A2uiRequestProcessor | None = None
        if ui_version and client_ui_capabilities is not None:
            try:
                # Checks the generator's examples against the request's
                # catalogs too.
                processor = self._generators[ui_version].create_processor(
                    client_ui_capabilities
                )
            except A2uiError as e:
                logger.error(
                    f"--- RestaurantAgent.stream: Cannot set up the UI: {e} ---"
                )
        if ui_version and processor is not None:
            # The prompt shows the catalogs and examples of this request.
            runner = self._build_runner(get_ui_prompt(processor))
            surfaces = self._surfaces_of(session_id)
        else:
            if ui_version:
                logger.warning(
                    "--- RestaurantAgent.stream: No usable renderer capabilities."
                    " Answering in text. ---"
                )
            runner = self._text_runner

        current_query_text = query
        for attempt in range(1, MAX_ATTEMPTS + 1):
            logger.info(
                f"--- RestaurantAgent.stream: Attempt {attempt}/{MAX_ATTEMPTS} "
                f"for session {session_id} ---"
            )
            message = types.Content(
                role="user", parts=[types.Part.from_text(text=current_query_text)]
            )
            received: list[str] = []

            async def token_stream() -> AsyncIterator[str]:
                # In SSE mode, ADK sends the text in partial events, and then
                # the whole text again in a final event. Only the partial text
                # is sent on, so the parser sees each character once. v1.0
                # rejects a second `createSurface` for the same surface.
                saw_partial = False
                async for event in runner.run_async(
                    user_id=self._user_id,
                    session_id=session.id,
                    run_config=run_config.RunConfig(
                        streaming_mode=(
                            run_config.StreamingMode.SSE
                            if use_streaming
                            else run_config.StreamingMode.NONE
                        )
                    ),
                    new_message=message,
                ):
                    is_partial = bool(event.partial)
                    if not is_partial and saw_partial:
                        saw_partial = False
                        continue
                    saw_partial = saw_partial or is_partial
                    if event.content and event.content.parts:
                        for p in event.content.parts:
                            if p.text:
                                received.append(p.text)
                                yield p.text

            if processor is None or ui_version is None:
                async for token in token_stream():
                    yield {"is_task_complete": False, "updates": token}
                yield {
                    "is_task_complete": True,
                    "parts": _text_parts("".join(received) or "OK."),
                }
                return

            # Each message is validated before it is sent, so the client only
            # gets valid UI. A failure ends the attempt. Each attempt is
            # checked against a new state, which holds what the attempt sent.
            state = processor.create_state()
            sent_ui = False
            final_parts: list[Part] = []
            error: str | None = None
            try:
                if use_streaming:
                    async for part in stream_response_to_parts(
                        processor.open_stream(state=state),
                        token_stream(),
                        version=ui_version,
                    ):
                        sent_ui = sent_ui or isinstance(part.root, DataPart)
                        yield {
                            "is_task_complete": False,
                            "parts": self._prepare_parts([part], surfaces, ui_version),
                        }
                else:
                    async for _ in token_stream():
                        pass
                    final_parts = self._prepare_parts(
                        to_a2a_parts(
                            processor.parse_response("".join(received), state=state),
                            version=ui_version,
                        ),
                        surfaces,
                        ui_version,
                    )
                    sent_ui = any(isinstance(p.root, DataPart) for p in final_parts)
            except A2uiError as e:
                error = f"Validation failed: {e}."
                logger.warning(
                    f"--- RestaurantAgent.stream: A2UI validation failed: {e}"
                    f" (Attempt {attempt}) ---"
                )
            if error is None and not sent_ui:
                error = "It had no A2UI messages."
                logger.warning(
                    "--- RestaurantAgent.stream: Response had no A2UI messages"
                    f" (Attempt {attempt}) ---"
                )

            if error is not None:
                logger.warning(
                    f"--- Failed response content: {''.join(received)[:500]}... ---"
                )
                # The client holds what a streamed attempt sent before it
                # failed. Its surfaces are deleted, so that the next attempt
                # can create them again and none is left half built.
                cleanup = [
                    _delete_surface_part(surface_id, ui_version)
                    for surface_id in state.surface_ids
                ]
                surfaces.difference_update(state.surface_ids)
                if use_streaming and cleanup:
                    yield {"is_task_complete": False, "parts": cleanup}
                current_query_text = (
                    f"Your previous response was invalid. {error}"
                    " You MUST generate a valid response that strictly follows the"
                    " A2UI JSON SCHEMA. The response MUST be a JSON list of A2UI"
                    f" messages. Ensure each JSON part is wrapped in '{A2UI_OPEN_TAG}'"
                    f" and '{A2UI_CLOSE_TAG}' tags. Please retry the original"
                    f" request: '{query}'"
                )
                continue

            logger.info(
                "--- RestaurantAgent.stream: Response is valid. Sending final"
                f" response (Attempt {attempt}). ---"
            )
            yield {"is_task_complete": True, "parts": final_parts}
            return

        logger.error(
            "--- RestaurantAgent.stream: Max retries exhausted. Sending text-only"
            " error. ---"
        )
        yield {
            "is_task_complete": True,
            "parts": _text_parts(
                "I'm sorry, I'm having trouble generating the interface for that"
                " request right now. Please try again in a moment."
            ),
        }
