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
from collections.abc import AsyncIterable, Mapping, Sequence
import json
import logging
import os
import re
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
from google.adk.sessions import InMemorySessionService
from google.genai import types
import jsonschema

from a2ui.a2a import (
    get_a2ui_agent_extension,
    parse_response_to_parts,
    stream_response_to_parts,
)
from a2ui.core import CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.parser import A2uiPart, Parser
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.schema import (
    A2UI_CLOSE_TAG,
    A2UI_OPEN_TAG,
    VERSION_0_8,
    VERSION_0_9,
)
from a2ui_examples import load_floor_plan_example
from prompt_builder import ROLE_DESCRIPTION, UI_DESCRIPTION, WORKFLOW_DESCRIPTION, get_text_prompt
from tools import get_contact_info

logger = logging.getLogger(__name__)


def _renderer_capabilities(
    version: str,
    client_ui_capabilities: Mapping[str, Any] | None,
    catalog_ids: Sequence[str],
) -> dict[str, Any]:
    """Returns the client's capabilities keyed by protocol version.

    Clients may send the bare capabilities entry, and may leave out
    `supportedCatalogIds`, which then names every catalog of the agent.
    Capabilities that are already keyed by protocol version are only read
    under the negotiated version's key.

    Args:
        version: The negotiated A2UI protocol version.
        client_ui_capabilities: The capabilities that the client sent.
        catalog_ids: The ids of the agent's catalogs.

    Returns:
        The capabilities for `A2uiGenerator.create_processor`.
    """
    key = f"v{version}"
    if not client_ui_capabilities:
        return {key: {"supportedCatalogIds": list(catalog_ids)}}
    raw: Any = client_ui_capabilities
    if any(_is_version_key(k) for k in client_ui_capabilities):
        raw = client_ui_capabilities.get(key)
        if raw is None:
            return {key: {"supportedCatalogIds": list(catalog_ids)}}
        if not isinstance(raw, Mapping):
            # Left for `create_processor` to reject with a validation error.
            return {key: raw}
    entry = dict(raw)
    if "supportedCatalogIds" not in entry and "supported_catalog_ids" not in entry:
        entry["supportedCatalogIds"] = list(catalog_ids)
    return {key: entry}


def _is_version_key(key: Any) -> bool:
    """Whether a capabilities key names a protocol version, such as `v0.9`."""
    return (
        isinstance(key, str)
        and key.startswith("v")
        and bool(re.fullmatch(r"\d+(\.\d+)*", key[1:]))
    )


class ContactAgent:
    """An agent that finds contact info for colleagues."""

    SUPPORTED_CONTENT_TYPES = ["text/plain"]

    def __init__(self, base_url: str):
        self.base_url = base_url
        self._agent_name = "contact_agent"
        self._user_id = "remote_agent"
        self._text_runner: Runner | None = self._build_runner(self._build_llm_agent())

        self._accepts_inline_catalogs = True
        self._generators: dict[str, A2uiGenerator] = {}
        self._processors: dict[str, A2uiRequestProcessor] = {}
        self._ui_runners: dict[str, Runner] = {}
        self._parsers: OrderedDict[str, Parser] = OrderedDict()
        self._max_parsers = 1000  # Max active sessions to keep in memory

        for version in [VERSION_0_8, VERSION_0_9]:
            generator = self._build_generator(version)
            processor = self._build_default_processor(version, generator)
            self._generators[version] = generator
            self._processors[version] = processor
            agent = self._build_llm_agent(
                processor, examples_path=f"examples/{version}"
            )
            self._ui_runners[version] = self._build_runner(agent)

        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    @property
    def accepts_inline_catalogs(self) -> bool:
        return self._accepts_inline_catalogs

    def get_processor(self, version: str | None) -> A2uiRequestProcessor | None:
        if version is None:
            return None
        return self._processors[version]

    def create_processor(
        self, version: str, client_ui_capabilities: Mapping[str, Any] | None
    ) -> A2uiRequestProcessor:
        """Creates an A2uiRequestProcessor negotiated for the client's capabilities."""
        catalog_ids = [c.catalog_id for c in self._processors[version].active_catalogs]
        return self._generators[version].create_processor(
            _renderer_capabilities(version, client_ui_capabilities, catalog_ids)
        )

    def resolve_catalogs(
        self, version: str, client_ui_capabilities: Mapping[str, Any] | None
    ) -> list[CatalogApi]:
        """Returns the catalogs that a response's surfaces can name."""
        return self.create_processor(version, client_ui_capabilities).active_catalogs

    def _build_generator(self, version: str) -> A2uiGenerator:
        config = CatalogConfig(BasicCatalog(version))
        return A2uiGenerator(
            [config],
            accepts_inline_catalogs=self._accepts_inline_catalogs,
        )

    def _build_default_processor(
        self, version: str, generator: A2uiGenerator
    ) -> A2uiRequestProcessor:
        catalog_ids = [c.transformed_catalog.catalog_id for c in generator.catalogs]
        return generator.create_processor(
            _renderer_capabilities(version, None, catalog_ids)
        )

    def _build_agent_card(self) -> AgentCard:
        extensions = []
        if self._processors:
            for version, processor in self._processors.items():
                ext = get_a2ui_agent_extension(
                    version,
                    self._accepts_inline_catalogs,
                    [c.catalog_id for c in processor.active_catalogs],
                )
                extensions.append(ext)

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

    def _build_runner(self, agent: LlmAgent) -> Runner:
        return Runner(
            app_name=self._agent_name,
            agent=agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )

    def get_processing_message(self) -> str:
        return "Looking up contact information..."

    def _build_llm_agent(
        self,
        processor: A2uiRequestProcessor | None = None,
        examples_path: str | None = None,
    ) -> LlmAgent:
        """Builds the LLM agent for the contact agent."""
        from a2ui.schema import load_examples

        LITELLM_MODEL = os.getenv("LITELLM_MODEL", "gemini/gemini-3.6-flash")

        if processor:
            prompt_parts = [
                ROLE_DESCRIPTION,
                f"## Workflow Description:\n{WORKFLOW_DESCRIPTION}",
                f"## UI Description:\n{UI_DESCRIPTION}",
                processor.prompt_snippet,
            ]
            # Missing inline_catalogs for OrgChart and WebFrame validation
            examples = load_examples(
                processor.active_catalogs, examples_path, validate=False
            )
            if examples:
                prompt_parts.append(f"### Examples:\n{examples}")
            instruction = "\n\n".join(prompt_parts)
        else:
            instruction = get_text_prompt()

        return LlmAgent(
            model=LiteLlm(model=LITELLM_MODEL),
            name=self._agent_name,
            description="An agent that finds colleague contact info.",
            instruction=instruction,
            tools=[get_contact_info],
        )

    async def _handle_action(
        self, query: str, ui_version: str | None = None
    ) -> dict[str, Any] | None:
        """Handles simulated UI actions like close_modal or view_location."""
        if not query.startswith("ACTION:"):
            return None

        from a2ui_examples import (
            load_floor_plan_example,
            load_close_modal_example,
            load_send_message_example,
        )

        if "send_message" in query:
            logger.info("--- ContactAgent.stream: Detected send_message ACTION ---")
            contact_name = "Unknown"
            if "(contact:" in query:
                try:
                    contact_name = query.split("(contact:")[1].split(")")[0].strip()
                except Exception:
                    pass
            json_content = load_send_message_example(contact_name, ui_version)
            final_response_content = (
                f"Message sent to {contact_name}\n"
                f"{A2UI_OPEN_TAG}\n{json_content}\n{A2UI_CLOSE_TAG}"
            )

            return {
                "is_task_complete": True,
                "parts": parse_response_to_parts(
                    final_response_content, version=ui_version
                ),
            }

        elif "view_location" in query:
            logger.info("--- ContactAgent.stream: Detected view_location ACTION ---")
            # Action maps to opening the FloorPlan overlay to view the contact's location
            from mcp import ClientSession
            from mcp.client.sse import sse_client
            import os

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
                return {
                    "is_task_complete": True,
                    "parts": parse_response_to_parts(
                        f"Failed to load floor plan data: {str(e)}", version=ui_version
                    ),
                }

            json_content = json.dumps(load_floor_plan_example(ui_version, html_content))
            logger.info(f"--- ContactAgent.stream: Sending Floor Plan ---")

            final_response_content = (
                "Here is the floor"
                f" plan.\n{A2UI_OPEN_TAG}\n{json_content}\n{A2UI_CLOSE_TAG}"
            )

            return {
                "is_task_complete": True,
                "parts": parse_response_to_parts(
                    final_response_content, version=ui_version
                ),
            }

        elif "close_modal" in query:
            logger.info("--- ContactAgent.stream: Handling close_modal ACTION ---")
            # Action maps to closing the FloorPlan overlay
            json_content = json.dumps(load_close_modal_example(ui_version))

            final_response_content = (
                f"Modal closed.\n{A2UI_OPEN_TAG}\n{json_content}\n{A2UI_CLOSE_TAG}"
            )

            return {
                "is_task_complete": True,
                "parts": parse_response_to_parts(
                    final_response_content, version=ui_version
                ),
            }

        return None

    async def stream(
        self,
        query,
        session_id,
        client_ui_capabilities: dict[str, Any] | None = None,
        ui_version: str | None = None,
    ) -> AsyncIterable[dict[str, Any]]:
        session_state = {"base_url": self.base_url}

        # Determine which runner to use based on whether the a2ui extension is active.
        if ui_version:
            runner = self._ui_runners[ui_version]
            default_processor = self._processors[ui_version]
            request_processor = self.create_processor(
                ui_version, client_ui_capabilities
            )
            validation_catalogs = request_processor.active_catalogs
            selected_catalog = validation_catalogs[0]
        else:
            runner = self._text_runner
            default_processor = None
            request_processor = None
            validation_catalogs = []
            selected_catalog = None

        session = await runner.session_service.get_session(
            app_name=self._agent_name,
            user_id=self._user_id,
            session_id=session_id,
        )
        if session is None:
            session = await runner.session_service.create_session(
                app_name=self._agent_name,
                user_id=self._user_id,
                state=session_state,
                session_id=session_id,
            )
        elif "base_url" not in session.state:
            session.state["base_url"] = self.base_url

        # --- Begin: UI Validation and Retry Logic ---
        max_retries = 1  # Total 2 attempts
        attempt = 0
        current_query_text = query

        if not ui_version:
            # For non-UI Requests
            while attempt <= max_retries:
                attempt += 1
                logger.info(
                    f"--- ContactAgent.stream: Attempt {attempt}/{max_retries + 1} "
                    f"for session {session_id} (Text-only mode) ---"
                )
                current_message = types.Content(
                    role="user", parts=[types.Part.from_text(text=current_query_text)]
                )
                final_response_content = None

                async for event in runner.run_async(
                    user_id=self._user_id,
                    session_id=session.id,
                    new_message=current_message,
                ):
                    if event.is_final_response():
                        if (
                            event.content
                            and event.content.parts
                            and event.content.parts[0].text
                        ):
                            final_response_content = "\n".join(
                                [p.text for p in event.content.parts if p.text]
                            )
                        break

                if final_response_content:
                    yield {
                        "is_task_complete": True,
                        "parts": [Part(root=TextPart(text=final_response_content))],
                    }
                    return

            yield {
                "is_task_complete": True,
                "parts": [
                    Part(
                        root=TextPart(
                            text=(
                                "I encountered an error and couldn't process your"
                                " request."
                            )
                        )
                    )
                ],
            }
            return

        if ui_version and (
            not selected_catalog or not selected_catalog.validation_schema
        ):
            logger.error(
                "--- ContactAgent.stream: A2UI_SCHEMA is not loaded. "
                "Cannot perform UI validation. ---"
            )
            yield {
                "is_task_complete": True,
                "content": (
                    "I'm sorry, I'm facing an internal configuration error with my UI"
                    " components. Please contact support."
                ),
            }
            return

        while attempt <= max_retries:
            attempt += 1
            logger.info(
                f"--- ContactAgent.stream: Attempt {attempt}/{max_retries + 1} "
                f"for session {session_id} ---"
            )
            logger.info(f"--- ContactAgent.stream: Received query: '{query}' ---")

            # --- Check for User Action ---
            action_response = await self._handle_action(query, ui_version)
            if action_response:
                yield action_response
                return

            current_message = types.Content(
                role="user", parts=[types.Part.from_text(text=current_query_text)]
            )

            full_content_list = []

            async def token_stream():
                async for event in runner.run_async(
                    user_id=self._user_id,
                    session_id=session.id,
                    run_config=run_config.RunConfig(
                        streaming_mode=run_config.StreamingMode.SSE
                    ),
                    new_message=current_message,
                ):
                    if event.content and event.content.parts:
                        for p in event.content.parts:
                            if p.text:
                                full_content_list.append(p.text)
                                yield p.text

            # When the client's inline catalogs are active too, a response's
            # surfaces may name any of them, so the response is buffered and
            # the complete payload is validated against all of them below.
            if default_processor and selected_catalog and len(validation_catalogs) == 1:
                if session_id in self._parsers:
                    self._parsers.move_to_end(session_id)
                else:
                    self._parsers[session_id] = default_processor.create_parser()
                    if len(self._parsers) > self._max_parsers:
                        self._parsers.popitem(last=False)

                async for part in stream_response_to_parts(
                    self._parsers[session_id],
                    token_stream(),
                    version=ui_version,
                ):
                    yield {
                        "is_task_complete": False,
                        "parts": [part],
                    }
            elif request_processor:
                async for _ in token_stream():
                    pass
            else:
                async for token in token_stream():
                    yield {
                        "is_task_complete": False,
                        "updates": token,
                    }

            final_response_content = (
                "".join(full_content_list) if full_content_list else None
            )

            if final_response_content is None:
                logger.warning(
                    "--- ContactAgent.stream: Received no final response content from"
                    f" runner (Attempt {attempt}). ---"
                )
                if attempt <= max_retries:
                    current_query_text = (
                        "I received no response. Please try again."
                        f"Please retry the original request: '{query}'"
                    )
                    continue
                else:
                    final_response_content = (
                        "I'm sorry, I encountered an error and couldn't process your"
                        " request."
                    )

            is_valid = False
            error_message = ""

            if ui_version and request_processor:
                logger.info(
                    "--- ContactAgent.stream: Validating UI response (Attempt"
                    f" {attempt})... ---"
                )
                try:
                    response_parts = request_processor.parse_response(
                        final_response_content
                    )

                    for part in response_parts:
                        if not isinstance(part, A2uiPart):
                            continue

                        parsed_json_data = part.a2ui

                        # Handle the "no results found" or empty JSON case
                        if parsed_json_data == []:
                            logger.info(
                                "--- ContactAgent.stream: Empty JSON list found. "
                                "Assuming valid (e.g., 'no results'). ---"
                            )
                            is_valid = True
                        else:
                            logger.info(
                                "--- ContactAgent.stream: UI JSON successfully parsed"
                                " AND validated against schema. Validation OK (Attempt"
                                f" {attempt}). ---"
                            )
                            is_valid = True

                except (
                    ValueError,
                    json.JSONDecodeError,
                    jsonschema.exceptions.ValidationError,
                ) as e:
                    logger.warning(
                        f"--- ContactAgent.stream: A2UI validation failed: {e} (Attempt"
                        f" {attempt}) ---"
                    )
                    logger.warning(
                        "--- Failed response content:"
                        f" {final_response_content[:500]}... ---"
                    )
                    error_message = f"Validation failed: {e}."

            else:  # Not using UI, so text is always "valid"
                is_valid = True

            if is_valid:
                logger.info(
                    "--- ContactAgent.stream: Response is valid. Sending final response"
                    f" (Attempt {attempt}). ---"
                )

                final_parts = parse_response_to_parts(
                    final_response_content, fallback_text="OK.", version=ui_version
                )

                yield {
                    "is_task_complete": True,
                    "parts": final_parts,
                }
                return  # We're done, exit the generator

            # --- If we're here, it means validation failed ---

            if attempt <= max_retries:
                logger.warning(
                    "--- ContactAgent.stream: Retrying..."
                    f" ({attempt}/{max_retries + 1}) ---"
                )
                # Prepare the query for the retry
                current_query_text = (
                    f"Your previous response was invalid. {error_message} You MUST"
                    " generate a valid response that strictly follows the A2UI JSON"
                    " SCHEMA. The response MUST be a JSON list of A2UI messages."
                    f" Ensure each JSON part is wrapped in '{A2UI_OPEN_TAG}' and"
                    f" '{A2UI_CLOSE_TAG}' tags. Please retry the original request:"
                    f" '{query}'"
                )
                # Loop continues...

        # --- If we're here, it means we've exhausted retries ---
        logger.error(
            "--- ContactAgent.stream: Max retries exhausted. Sending text-only"
            " error. ---"
        )
        yield {
            "is_task_complete": True,
            "parts": [
                Part(
                    root=TextPart(
                        text=(
                            "I'm sorry, I'm having trouble generating the interface for"
                            " that request right now. Please try again in a moment."
                        )
                    )
                )
            ],
        }
