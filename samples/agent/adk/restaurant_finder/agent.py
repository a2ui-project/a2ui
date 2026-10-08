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
from collections.abc import AsyncIterable
import json
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
from google.adk.sessions import InMemorySessionService
from google.genai import types
import jsonschema

from a2ui.a2a import (
    get_a2ui_agent_extension,
    parse_response_to_parts,
    stream_response_to_parts,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.parser import A2uiPart
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.schema import (
    A2UI_CLOSE_TAG,
    A2UI_OPEN_TAG,
    VERSION_0_8,
    VERSION_0_9,
)
from prompt_builder import (
    ROLE_DESCRIPTION,
    UI_DESCRIPTION,
    get_text_prompt,
)
from tools import get_restaurants

logger = logging.getLogger(__name__)


class RestaurantAgent:
    """An agent that finds restaurants based on user criteria."""

    SUPPORTED_CONTENT_TYPES = ["text/plain"]

    def __init__(self, base_url: str):
        self.base_url = base_url
        self._agent_name = "Restaurant Agent"
        self._user_id = "remote_agent"
        self._text_runner: Runner | None = self._build_runner(self._build_llm_agent())

        self._generators: dict[str, A2uiGenerator] = {}
        self._processors: dict[str, A2uiRequestProcessor] = {}
        self._ui_runners: dict[str, Runner] = {}
        self._parsers = OrderedDict()
        self._max_parsers = 1000  # Max active sessions to keep in memory

        for version in [VERSION_0_8, VERSION_0_9]:
            generator = self._build_generator(version)
            processor = self._build_processor(version, generator)
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

    def _build_generator(self, version: str) -> A2uiGenerator:
        return A2uiGenerator([CatalogConfig(BasicCatalog(version))])

    def _build_processor(
        self, version: str, generator: A2uiGenerator
    ) -> A2uiRequestProcessor:
        return generator.create_processor({
            f"v{version}": {
                "supportedCatalogIds": [
                    c.transformed_catalog.catalog_id for c in generator.catalogs
                ]
            }
        })

    def _build_agent_card(self) -> AgentCard:
        extensions = []
        if self._processors:
            for version, processor in self._processors.items():
                ext = get_a2ui_agent_extension(
                    version,
                    supported_catalog_ids=[
                        c.catalog_id for c in processor.active_catalogs
                    ],
                )
                extensions.append(ext)

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

    def _build_runner(self, agent: LlmAgent) -> Runner:
        return Runner(
            app_name=self._agent_name,
            agent=agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )

    def get_processing_message(self) -> str:
        return "Finding restaurants that match your criteria..."

    def _build_llm_agent(
        self,
        processor: A2uiRequestProcessor | None = None,
        examples_path: str | None = None,
    ) -> LlmAgent:
        """Builds the LLM agent for the restaurant agent."""
        from a2ui.schema import load_examples

        model_env = (
            os.getenv("MODEL_NAME") or os.getenv("LITELLM_MODEL") or "gemini-3.6-flash"
        )
        model_name = model_env.split("/")[-1]

        if processor:
            prompt_parts = [
                ROLE_DESCRIPTION,
                f"## UI Description:\n{UI_DESCRIPTION}",
                processor.prompt_snippet,
            ]
            examples = load_examples(
                processor.active_catalogs, examples_path, validate=True
            )
            if examples:
                prompt_parts.append(f"### Examples:\n{examples}")
            instruction = "\n\n".join(prompt_parts)
        else:
            instruction = get_text_prompt()

        return LlmAgent(
            model=Gemini(
                model=model_name,
                # Retry transient backend errors (429, 5xx), which the model
                # returns under load.
                retry_options=types.HttpRetryOptions(attempts=3, initial_delay=2.0),
            ),
            name="restaurant_agent",
            description="An agent that finds restaurants and helps book tables.",
            instruction=instruction,
            tools=[get_restaurants],
        )

    async def stream(
        self,
        query,
        session_id,
        ui_version: str | None = None,
        use_streaming: bool = True,
    ) -> AsyncIterable[dict[str, Any]]:
        session_state = {"base_url": self.base_url, "expression": "{expression}"}

        # Determine which runner to use based on whether the a2ui extension is active.
        if ui_version:
            runner = self._ui_runners[ui_version]
            processor = self._processors[ui_version]
            selected_catalog = (
                processor.active_catalogs[0] if processor.active_catalogs else None
            )
        else:
            runner = self._text_runner
            processor = None
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

        # Ensure schema was loaded
        if ui_version and (not selected_catalog or not selected_catalog.catalog_schema):
            logger.error(
                "--- RestaurantAgent.stream: A2UI_SCHEMA is not loaded. "
                "Cannot perform UI validation. ---"
            )
            yield {
                "is_task_complete": True,
                "parts": [
                    Part(
                        root=TextPart(
                            text=(
                                "I'm sorry, I'm facing an internal configuration error"
                                " with my UI components. Please contact support."
                            )
                        )
                    )
                ],
            }
            return

        while attempt <= max_retries:
            attempt += 1
            logger.info(
                f"--- RestaurantAgent.stream: Attempt {attempt}/{max_retries + 1} "
                f"for session {session_id} ---"
            )

            current_message = types.Content(
                role="user", parts=[types.Part.from_text(text=current_query_text)]
            )

            full_content_list = []
            parts_streamed = False

            async def token_stream():
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
                    new_message=current_message,
                ):
                    if event.content and event.content.parts:
                        for p in event.content.parts:
                            if p.text:
                                full_content_list.append(p.text)
                                yield p.text

            if processor and selected_catalog:
                if session_id in self._parsers:
                    self._parsers.move_to_end(session_id)
                else:
                    self._parsers[session_id] = processor.create_parser()
                    if len(self._parsers) > self._max_parsers:
                        self._parsers.popitem(last=False)

                async for part in stream_response_to_parts(
                    self._parsers[session_id],
                    token_stream(),
                    version=ui_version,
                ):
                    parts_streamed = True
                    yield {
                        "is_task_complete": False,
                        "parts": [part],
                    }
            else:
                async for token in token_stream():
                    yield {
                        "is_task_complete": False,
                        "updates": token,
                    }

            final_response_content = "".join(full_content_list)

            is_valid = False
            error_message = ""

            if ui_version and processor:
                logger.info(
                    "--- RestaurantAgent.stream: Validating UI response (Attempt"
                    f" {attempt})... ---"
                )
                try:
                    response_parts = processor.parse_response(final_response_content)

                    for part in response_parts:
                        if not isinstance(part, A2uiPart):
                            continue

                        logger.info(
                            "--- RestaurantAgent.stream: UI JSON successfully parsed"
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
                        f"--- RestaurantAgent.stream: A2UI validation failed: {e}"
                        f" (Attempt {attempt}) ---"
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
                    "--- RestaurantAgent.stream: Response is valid. Sending final"
                    f" response (Attempt {attempt}). ---"
                )
                final_parts = parse_response_to_parts(
                    final_response_content, fallback_text="OK.", version=ui_version
                )

                yield {
                    "is_task_complete": True,
                    "parts": [] if (use_streaming and parts_streamed) else final_parts,
                }
                return  # We're done, exit the generator

            # --- If we're here, it means validation failed ---

            if attempt <= max_retries:
                logger.warning(
                    "--- RestaurantAgent.stream: Retrying..."
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
            "--- RestaurantAgent.stream: Max retries exhausted. Sending text-only"
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
        # --- End: UI Validation and Retry Logic ---
