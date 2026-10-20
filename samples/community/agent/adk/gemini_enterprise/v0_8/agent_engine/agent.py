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

from collections.abc import Mapping
import os
from typing import Any

from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    Part,
    TextPart,
)
import dotenv
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService, Session
from google.genai import types

from a2ui.a2a import get_a2ui_agent_extension, to_a2a_parts
from a2ui.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG
from a2ui.core import A2uiError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.utils import to_version_number
from prompt_builder import get_text_prompt, get_ui_prompt
from tools import get_contact_info

SUPPORTED_CONTENT_TYPES = ["text/plain"]

MAX_ATTEMPTS = 2

# Gemini Enterprise doesn't send `a2uiClientCapabilities`. It renders the
# basic catalog, so a request without capabilities gets these, in the v0.8
# shape, which isn't keyed by protocol version.
GEMINI_ENTERPRISE_CAPABILITIES = {
    "supportedCatalogIds": [BasicCatalog(ProtocolVersion.V0_8).catalog_id]
}

dotenv.load_dotenv()


def _text_parts(text: str) -> list[Part]:
    return [Part(root=TextPart(text=text))]


class ContactAgent:
    """An agent that finds contact info for colleagues.

    The agent holds one generator for each protocol version it speaks. Each
    request negotiates its own processor from the client's capabilities, and
    the prompt, the parser and validation use the catalogs it holds. Each
    response shows new UI, so it is checked on its own.
    """

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
        # Gemini Enterprise only supports ProtocolVersion.V0_8 for now.
        self._generators: dict[ProtocolVersion, A2uiGenerator] = {
            version: A2uiGenerator([CatalogConfig(BasicCatalog(version))])
            for version in [ProtocolVersion.V0_8]
        }
        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    def get_processing_message(self) -> str:
        return "Looking up contact information..."

    def _build_agent_card(self) -> AgentCard:
        """Builds the AgentCard for this agent, describing its capabilities and skills."""
        extensions = [
            get_a2ui_agent_extension(
                version,
                generator.accepts_inline_catalogs,
                [c.transformed_catalog.catalog_id for c in generator.catalogs],
            )
            for version, generator in self._generators.items()
        ]
        capabilities = AgentCapabilities(
            # Agent Engine only supports non-streaming mode for now.
            streaming=False,
            extensions=extensions,
        )
        skill = AgentSkill(
            id="find_contact",
            name="Find Contact Tool",
            description=(
                "Helps find contact information for colleagues (e.g., email,"
                " location, team)."
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
            default_input_modes=SUPPORTED_CONTENT_TYPES,
            default_output_modes=SUPPORTED_CONTENT_TYPES,
            capabilities=capabilities,
            preferred_transport="HTTP+JSON",
            skills=[skill],
        )

    def _build_runner(self, instruction: str) -> Runner:
        """Builds a runner whose LLM agent follows the instruction."""
        agent = LlmAgent(
            model=os.getenv("MODEL", "gemini-2.5-flash"),
            name=self._agent_name,
            description="An agent that finds colleague contact info.",
            instruction=instruction,
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

    async def fetch_response(
        self,
        query: str,
        session_id: str,
        ui_version: ProtocolVersion | None = None,
        client_ui_capabilities: Mapping[str, Any] | None = None,
    ) -> list[Part]:
        """Answers one request, as text or, if `ui_version` is set, with UI.

        The whole response is validated before it is returned.
        """
        session = await self._get_session(session_id)
        processor: A2uiRequestProcessor | None = None
        if ui_version:
            try:
                processor = self._generators[ui_version].create_processor(
                    client_ui_capabilities or GEMINI_ENTERPRISE_CAPABILITIES
                )
            except A2uiError as e:
                print(
                    "--- ContactAgent.fetch_response: Cannot negotiate catalogs:"
                    f" {e} ---"
                )
                return _text_parts(
                    "I'm sorry, I can't show my interface in this client."
                )
            # The prompt shows the catalogs of this request.
            examples_path = os.path.join(
                os.path.dirname(__file__), f"examples/{to_version_number(ui_version)}"
            )
            runner = self._build_runner(get_ui_prompt(processor, examples_path))
        else:
            runner = self._text_runner

        current_query_text = query
        for attempt in range(1, MAX_ATTEMPTS + 1):
            print(
                f"--- ContactAgent.fetch_response: Attempt {attempt}/{MAX_ATTEMPTS}"
                f" for session {session_id} ---"
            )
            current_message = types.Content(
                role="user", parts=[types.Part.from_text(text=current_query_text)]
            )
            print(
                "--- ContactAgent.fetch_response: Starting runner.run_async with"
                f" message: {current_message} ---"
            )

            full_content_list: list[str] = []
            try:
                async for event in runner.run_async(
                    user_id=self._user_id,
                    session_id=session.id,
                    new_message=current_message,
                ):
                    if (
                        event.is_final_response()
                        and event.content
                        and event.content.parts
                    ):
                        full_content_list.extend(
                            p.text for p in event.content.parts if p.text
                        )
            except Exception as e:
                print(
                    "--- ContactAgent.fetch_response: Exception caught while running"
                    f" runner: {e} ---"
                )
                raise e

            final_response_content = "".join(full_content_list)
            print(
                "--- ContactAgent.fetch_response: Final response content:"
                f" {final_response_content[:500]}... ---"
            )

            if not final_response_content:
                # A retry would add a second user turn with no model turn
                # between them, so the agent stops here.
                print(
                    "--- ContactAgent.fetch_response: Received no final response"
                    f" content from runner (Attempt {attempt}). ---"
                )
                break

            if processor is None:
                return _text_parts(final_response_content)

            # The response is parsed and validated once, and its parts are
            # returned only if it is valid.
            try:
                final_parts = to_a2a_parts(
                    processor.parse_response(final_response_content),
                    version=ui_version,
                )
            except A2uiError as e:
                print(
                    f"--- ContactAgent.fetch_response: A2UI validation failed: {e}"
                    f" (Attempt {attempt}) ---"
                )
                print(
                    "--- Failed response content:"
                    f" {final_response_content[:500]}... ---"
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

            print(
                "--- ContactAgent.fetch_response: Response is valid. Task complete"
                f" (Attempt {attempt}). ---"
            )
            return final_parts

        print(
            "--- ContactAgent.fetch_response: No valid response. Sending"
            " text-only error. ---"
        )
        return _text_parts(
            "I'm sorry, I'm having trouble generating the interface for that"
            " request right now. Please try again in a moment."
        )


# ADK web looks for 'root_agent' in this file.
root_agent = ContactAgent("http://0.0.0.0:8080")
