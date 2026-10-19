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
from collections.abc import AsyncIterable, AsyncIterator, Mapping
import json
import logging
import os
from typing import Any

from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    Part,
    TextPart,
)
from google.adk.agents import run_config
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService, Session
from google.genai import types

from a2ui.a2a import (
    get_a2ui_agent_extension,
    stream_response_to_parts,
    to_a2a_parts,
)
from a2ui.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG
from a2ui.core import A2uiError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.utils import RendererState, to_version_number
from a2ui_examples import (
    load_close_modal_example,
    load_floor_plan_example,
    load_send_message_example,
)
from prompt_builder import get_text_prompt, get_ui_prompt
from tools import get_contact_info

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 2
# How many conversations' renderer states to keep in memory.
_MAX_RENDERER_STATES = 1000


def _text_parts(text: str) -> list[Part]:
    return [Part(root=TextPart(text=text))]


class ContactAgent:
    """An agent that finds contact info for colleagues.

    The agent holds one generator for each protocol version it speaks. Each
    request negotiates its own processor from the client's capabilities, so
    the prompt, the parser and validation all use the catalogs that this
    client renders.
    """

    SUPPORTED_CONTENT_TYPES = ["text/plain"]

    def __init__(self, base_url: str):
        self.base_url = base_url
        self._agent_name = "contact_agent"
        self._user_id = "remote_agent"
        # Shared by the text runner and the runner of each UI request, so a
        # conversation keeps its history across requests.
        self._session_service = InMemorySessionService()
        self._artifact_service = InMemoryArtifactService()
        self._memory_service = InMemoryMemoryService()
        self._text_runner = self._build_runner(get_text_prompt())
        self._generators: dict[ProtocolVersion, A2uiGenerator] = {
            version: self._build_generator(version)
            for version in [
                ProtocolVersion.V0_8,
                ProtocolVersion.V0_9,
                ProtocolVersion.V1_0,
            ]
        }
        # What each conversation's renderer shows. A later turn may update
        # the surfaces that an earlier turn created, such as the contact card
        # after a click on the org chart, so responses are checked against
        # the UI of the whole conversation. The least recently used states
        # are dropped once there are more than `_MAX_RENDERER_STATES`.
        self._renderer_states: OrderedDict[str, RendererState] = OrderedDict()
        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    def get_processing_message(self) -> str:
        return "Looking up contact information..."

    def _build_generator(self, version: ProtocolVersion) -> A2uiGenerator:
        return A2uiGenerator(
            [CatalogConfig(BasicCatalog(version))],
            accepts_inline_catalogs=True,
        )

    def _renderer_state(
        self, session_id: str, processor: A2uiRequestProcessor
    ) -> RendererState:
        """Returns the state of the conversation's renderer.

        A conversation starts with an empty renderer. If the client renders
        other catalogs than before, the old surfaces can't be checked against
        them, so the state starts over.
        """
        state = self._renderer_states.get(session_id)
        if state is None or not processor.accepts_state(state):
            state = processor.create_state()
            self._renderer_states[session_id] = state
        self._renderer_states.move_to_end(session_id)
        if len(self._renderer_states) > _MAX_RENDERER_STATES:
            self._renderer_states.popitem(last=False)
        return state

    def _build_agent_card(self) -> AgentCard:
        extensions = [
            get_a2ui_agent_extension(
                version,
                generator.accepts_inline_catalogs,
                [c.transformed_catalog.catalog_id for c in generator.catalogs],
            )
            for version, generator in self._generators.items()
        ]
        capabilities = AgentCapabilities(
            streaming=True,
            extensions=extensions,
        )
        skill = AgentSkill(
            id="find_contact",
            name="Find Contact Tool",
            description=(
                "Helps find contact information for colleagues (e.g., email, location,"
                " team)."
            ),
            tags=["contact", "directory", "people", "finder"],
            examples=[
                "Who is David Chen in marketing?",
                "Find Sarah Lee from engineering",
            ],
        )

        return AgentCard(
            name="Contact Lookup Agent",
            description=(
                "This agent helps find contact info for people in your organization."
            ),
            url=self.base_url,
            version="1.0.0",
            default_input_modes=ContactAgent.SUPPORTED_CONTENT_TYPES,
            default_output_modes=ContactAgent.SUPPORTED_CONTENT_TYPES,
            capabilities=capabilities,
            skills=[skill],
        )

    def _build_runner(self, instruction: str) -> Runner:
        """Builds a runner whose LLM agent follows the instruction."""
        model = os.getenv("LITELLM_MODEL", "gemini/gemini-3.6-flash")
        agent = LlmAgent(
            model=LiteLlm(model=model),
            name=self._agent_name,
            description="An agent that finds colleague contact info.",
            # A function returns the instruction, so that ADK sends it as it
            # is. ADK reads `{name}` in an instruction string as a state
            # variable, and the prompt shows such text, like `{XID_Start}` in
            # the v1.0 schemas.
            instruction=lambda _: instruction,
            tools=[get_contact_info],
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

    async def _handle_action(
        self,
        query: str,
        ui_version: ProtocolVersion,
        processor: A2uiRequestProcessor,
        state: RendererState,
    ) -> list[Part] | None:
        """Handles simulated UI actions like close_modal or view_location.

        The UI that an action shows is validated like a model response, and
        applied to the conversation's renderer state.

        Returns:
            The parts to send, or None if the query is not such an action.
        """
        if not query.startswith("ACTION:"):
            return None

        if "send_message" in query:
            logger.info("--- ContactAgent.stream: Detected send_message ACTION ---")
            contact_name = "Unknown"
            if "(contact:" in query:
                try:
                    contact_name = query.split("(contact:")[1].split(")")[0].strip()
                except Exception:
                    pass
            text = f"Message sent to {contact_name}"
            json_content = load_send_message_example(contact_name, ui_version)

        elif "view_location" in query:
            logger.info("--- ContactAgent.stream: Detected view_location ACTION ---")
            # Action maps to opening the FloorPlan overlay to view the contact's location
            from mcp import ClientSession
            from mcp.client.sse import sse_client

            sse_url = os.environ.get(
                "FLOOR_PLAN_SERVER_URL", "http://127.0.0.1:8000/sse"
            )
            try:
                async with sse_client(sse_url) as (read, write):
                    async with ClientSession(read, write) as mcp_session:
                        await mcp_session.initialize()
                        logger.info(
                            "--- ContactAgent: Fetching ui://floor-plan-server/map from"
                            " persistent SSE server ---"
                        )
                        result = await mcp_session.read_resource(
                            "ui://floor-plan-server/map"
                        )

                        if not result.contents or len(result.contents) == 0:
                            raise ValueError(
                                "No content returned from floor plan server"
                            )
                        html_content = result.contents[0].text
            except Exception as e:
                logger.error(f"Failed to fetch floor plan: {e}")
                return _text_parts(f"Failed to load floor plan data: {str(e)}")

            logger.info("--- ContactAgent.stream: Sending Floor Plan ---")
            text = "Here is the floor plan."
            json_content = json.dumps(load_floor_plan_example(ui_version, html_content))

        elif "close_modal" in query:
            logger.info("--- ContactAgent.stream: Handling close_modal ACTION ---")
            # Action maps to closing the FloorPlan overlay
            text = "Modal closed."
            json_content = json.dumps(load_close_modal_example(ui_version))

        else:
            return None

        content = f"{text}\n{A2UI_OPEN_TAG}\n{json_content}\n{A2UI_CLOSE_TAG}"
        try:
            return to_a2a_parts(
                processor.parse_response(content, state=state), version=ui_version
            )
        except A2uiError as e:
            # For example, the floor plan needs the inline catalog, which the
            # client may not render.
            logger.error(f"--- ContactAgent.stream: Invalid action UI: {e} ---")
            return _text_parts(f"{text} The interface can't be shown in this client.")

    async def stream(
        self,
        query: str,
        session_id: str,
        client_ui_capabilities: Mapping[str, Any] | None = None,
        ui_version: ProtocolVersion | None = None,
    ) -> AsyncIterable[dict[str, Any]]:
        """Answers one request, as text or, if `ui_version` is set, with UI."""
        session = await self._get_session(session_id)
        if not ui_version:
            async for item in self._stream_text(query, session):
                yield item
            return

        try:
            processor = self._generators[ui_version].create_processor(
                client_ui_capabilities
            )
        except A2uiError as e:
            logger.error(f"--- ContactAgent.stream: Cannot negotiate catalogs: {e} ---")
            yield {
                "is_task_complete": True,
                "parts": _text_parts(
                    "I'm sorry, I can't show my interface in this client."
                ),
            }
            return
        state = self._renderer_state(session_id, processor)

        logger.info(f"--- ContactAgent.stream: Received query: '{query}' ---")
        action_parts = await self._handle_action(query, ui_version, processor, state)
        if action_parts is not None:
            yield {"is_task_complete": True, "parts": action_parts}
            return

        # The prompt shows the catalogs of this request, including the
        # client's inline catalog.
        runner = self._build_runner(
            get_ui_prompt(
                processor, examples_path=f"examples/{to_version_number(ui_version)}"
            )
        )
        current_query_text = query
        for attempt in range(1, MAX_ATTEMPTS + 1):
            logger.info(
                f"--- ContactAgent.stream: Attempt {attempt}/{MAX_ATTEMPTS} "
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
                        streaming_mode=run_config.StreamingMode.SSE
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

            # The stream checks each message against the conversation's
            # renderer state before it is sent, so the client only gets
            # valid UI, and applies it to the state.
            try:
                async for part in stream_response_to_parts(
                    processor.open_stream(state=state),
                    token_stream(),
                    version=ui_version,
                ):
                    yield {"is_task_complete": False, "parts": [part]}
            except A2uiError as e:
                logger.warning(
                    f"--- ContactAgent.stream: A2UI validation failed: {e} (Attempt"
                    f" {attempt}) ---"
                )
                logger.warning(
                    f"--- Failed response content: {''.join(received)[:500]}... ---"
                )
                current_query_text = (
                    f"Your previous response was invalid. Validation failed: {e}."
                    " You MUST generate a valid response that strictly follows the"
                    " A2UI JSON SCHEMA. The response MUST be a JSON list of A2UI"
                    f" messages. Ensure each JSON part is wrapped in '{A2UI_OPEN_TAG}'"
                    f" and '{A2UI_CLOSE_TAG}' tags. Please retry the original"
                    f" request: '{query}'"
                )
                continue

            if not received:
                logger.warning(
                    "--- ContactAgent.stream: Received no response content from"
                    f" runner (Attempt {attempt}). ---"
                )
                current_query_text = (
                    "I received no response. Please retry the original request:"
                    f" '{query}'"
                )
                continue

            logger.info(
                "--- ContactAgent.stream: Response is valid and was streamed"
                f" (Attempt {attempt}). ---"
            )
            # Every part was already sent while streaming.
            yield {"is_task_complete": True, "parts": []}
            return

        logger.error(
            "--- ContactAgent.stream: Max retries exhausted. Sending text-only"
            " error. ---"
        )
        yield {
            "is_task_complete": True,
            "parts": _text_parts(
                "I'm sorry, I'm having trouble generating the interface for that"
                " request right now. Please try again in a moment."
            ),
        }

    async def _stream_text(
        self, query: str, session: Session
    ) -> AsyncIterable[dict[str, Any]]:
        """Answers a request from a client without A2UI, in plain text."""
        current_message = types.Content(
            role="user", parts=[types.Part.from_text(text=query)]
        )
        for attempt in range(1, MAX_ATTEMPTS + 1):
            logger.info(
                f"--- ContactAgent.stream: Attempt {attempt}/{MAX_ATTEMPTS} "
                f"for session {session.id} (Text-only mode) ---"
            )
            final_response_content = None
            async for event in self._text_runner.run_async(
                user_id=self._user_id,
                session_id=session.id,
                new_message=current_message,
            ):
                if event.is_final_response():
                    if event.content and event.content.parts:
                        final_response_content = "\n".join(
                            [p.text for p in event.content.parts if p.text]
                        )
                    break

            if final_response_content:
                yield {
                    "is_task_complete": True,
                    "parts": _text_parts(final_response_content),
                }
                return

        yield {
            "is_task_complete": True,
            "parts": _text_parts(
                "I encountered an error and couldn't process your request."
            ),
        }
