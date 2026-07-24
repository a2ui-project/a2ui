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

from collections import OrderedDict
from collections.abc import AsyncIterable
import json
import logging
import os
from typing import Any, Optional

from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    Part,
    TextPart,
)
from a2ui.a2a.extension import get_a2ui_agent_extension
from a2ui.a2a.parts import parse_response_to_parts, stream_response_to_parts
from a2ui.parser.parser import parse_response
from a2ui.schema.catalog import CatalogConfig
from a2ui.schema.common_modifiers import remove_strict_validation
from a2ui.schema.constants import (
    A2UI_CLOSE_TAG,
    A2UI_OPEN_TAG,
    VERSION_0_9,
)
from a2ui.schema.manager import A2uiSchemaManager
from google.adk.agents import run_config
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.models import Gemini
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
import jsonschema
from prompt_builder import (
    ROLE_DESCRIPTION,
    UI_DESCRIPTION,
    get_text_prompt,
)
from tools import get_restaurants

logger = logging.getLogger(__name__)

# A2UI version supported by this agent. Only v0.9 is supported.
A2UI_VERSION = VERSION_0_9

# Name of the component catalog this agent advertises and validates against.
COMPOSITE_CATALOG_NAME = "composite"

# Path to the A2UI v0.9 Gemini Enterprise composite catalog (copied into this
# agent's directory). The composite catalog is the union of the standard
# Material catalog, the basic catalog, and the Gemini Enterprise custom catalog,
# so a single surface can mix all three component families. Sourced from
# https://www.gstatic.com/vertexaisearch/a2ui/v0_9/gemini_enterprise_composite_catalog.json.
COMPOSITE_CATALOG_PATH = os.path.join(
    os.path.dirname(__file__), "gemini_enterprise_composite_catalog.json"
)


class A2uiDemoAgent:
    """A generic agent that demos A2UI v0.9 Material and custom components."""

    SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]

    def __init__(self, base_url: str):
        self.base_url = base_url
        self._agent_name = "A2UI v0.9 Demo"
        self._user_id = "remote_agent"
        self._text_runner: Optional[Runner] = self._build_runner(
            self._build_llm_agent()
        )

        self._schema_manager: A2uiSchemaManager = self._build_schema_manager()
        self._ui_runner: Runner = self._build_runner(
            self._build_llm_agent(self._schema_manager)
        )
        self._parsers = OrderedDict()
        self._max_parsers = 1000  # Max active sessions to keep in memory

        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    def _build_schema_manager(self) -> A2uiSchemaManager:
        return A2uiSchemaManager(
            version=A2UI_VERSION,
            catalogs=[
                CatalogConfig.from_path(
                    name=COMPOSITE_CATALOG_NAME,
                    catalog_path=COMPOSITE_CATALOG_PATH,
                    examples_path=f"examples/{A2UI_VERSION}",
                )
            ],
            schema_modifiers=[remove_strict_validation],
        )

    def _build_agent_card(self) -> AgentCard:
        ext = get_a2ui_agent_extension(
            A2UI_VERSION,
            self._schema_manager.accepts_inline_catalogs,
            self._schema_manager.supported_catalog_ids,
        )

        capabilities = AgentCapabilities(
            streaming=True,
            extensions=[ext],
        )
        demo_skill = AgentSkill(
            id="a2ui_demo",
            name="A2UI v0.9 Component Demo",
            description=(
                "Demonstrates A2UI v0.9 UIs built from the Material catalog and"
                " Gemini Enterprise custom components: cards, forms & inputs,"
                " tabs, tables, progress indicators, dialogs & menus, the"
                " Canvas side panel, and the Iframe (IFrameSrcdoc / IFrameUrl)"
                " components."
            ),
            tags=["a2ui", "demo", "material", "canvas", "iframe"],
            examples=[
                "What can you do?",
                "Show me a demo of Material components",
                "Render a contact form",
                "Show a data table of recent orders",
                "Demo the Canvas side panel",
                "Show an IFrameSrcdoc with custom HTML",
                "Embed a web page with IFrameUrl",
            ],
        )
        restaurant_skill = AgentSkill(
            id="find_restaurants",
            name="Find Restaurants Tool",
            description=(
                "Helps find restaurants based on user criteria (e.g., cuisine,"
                " location) and renders the results as an A2UI list."
            ),
            tags=["restaurant", "finder"],
            examples=["Find me the top 10 chinese restaurants in the US"],
        )

        return AgentCard(
            name="A2UI v0.9 Demo",
            description=(
                "A demo agent that showcases A2UI v0.9 UIs built from the"
                " Material component catalog and Gemini Enterprise custom"
                " components (Canvas, Iframe). Ask it 'what can you do?' to see"
                " the available demos."
            ),
            url=self.base_url,
            version="1.0.0",
            default_input_modes=A2uiDemoAgent.SUPPORTED_CONTENT_TYPES,
            default_output_modes=A2uiDemoAgent.SUPPORTED_CONTENT_TYPES,
            capabilities=capabilities,
            skills=[demo_skill, restaurant_skill],
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
        return "Building an A2UI demo for you..."

    def _build_llm_agent(
        self, schema_manager: Optional[A2uiSchemaManager] = None
    ) -> LlmAgent:
        """Builds the LLM agent for the A2UI demo agent."""
        model_env = os.getenv("MODEL") or "gemini-2.5-flash"
        model_name = model_env.split("/")[-1]

        instruction = (
            schema_manager.generate_system_prompt(
                role_description=ROLE_DESCRIPTION,
                ui_description=UI_DESCRIPTION,
                include_schema=True,
                include_examples=True,
                validate_examples=True,
            )
            if schema_manager
            else get_text_prompt()
        )

        return LlmAgent(
            model=Gemini(model=model_name),
            name="a2ui_demo_agent",
            description=(
                "An agent that demos A2UI v0.9 Material and custom components,"
                " and can also find restaurants and help book tables."
            ),
            instruction=instruction,
            tools=[get_restaurants],
        )

    async def stream(
        self,
        query,
        session_id,
        ui_version: Optional[str] = None,
        use_streaming: bool = True,
    ) -> AsyncIterable[dict[str, Any]]:
        session_state = {"base_url": self.base_url, "expression": "{expression}"}

        # Always use UI version 0.9
        ui_version = A2UI_VERSION

        # Determine which runner to use based on whether the a2ui extension is active.
        if ui_version:
            runner = self._ui_runner
            schema_manager = self._schema_manager
            selected_catalog = (
                schema_manager.get_selected_catalog() if schema_manager else None
            )
        else:
            runner = self._text_runner
            schema_manager = None
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
                "--- A2uiDemoAgent.stream: A2UI_SCHEMA is not loaded. "
                "Cannot perform UI validation. ---"
            )
            yield {
                "is_task_complete": True,
                "parts": [
                    Part(
                        root=TextPart(
                            text=(
                                "I'm sorry, I'm facing an internal configuration"
                                " error with my UI components. Please contact"
                                " support."
                            )
                        )
                    )
                ],
            }
            return

        async def token_stream(current_message, full_content_list):
            """Runs the model and yields its non-thought text parts.

            Defined once here (rather than inside the retry loop) so it is not
            recreated on every attempt. The per-attempt `current_message` and
            `full_content_list` are passed in; streamed text is accumulated into
            `full_content_list` so the caller can validate/parse the full response.
            """
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
                        # Skip the model's "thought"/reasoning parts. Thinking
                        # models emit parts with thought=True (and .text set);
                        # streaming these would surface raw reasoning in the UI
                        # and corrupt the content we later validate/parse.
                        if p.text and not getattr(p, "thought", False):
                            full_content_list.append(p.text)
                            yield p.text

        while attempt <= max_retries:
            attempt += 1
            logger.info(
                f"--- A2uiDemoAgent.stream: Attempt {attempt}/{max_retries + 1} "
                f"for session {session_id} ---"
            )

            current_message = types.Content(
                role="user", parts=[types.Part.from_text(text=current_query_text)]
            )

            full_content_list = []
            parts_streamed = False

            if selected_catalog:
                from a2ui.parser.streaming import A2uiStreamParser

                if session_id in self._parsers:
                    self._parsers.move_to_end(session_id)
                else:
                    self._parsers[session_id] = A2uiStreamParser(
                        catalog=selected_catalog
                    )
                    if len(self._parsers) > self._max_parsers:
                        self._parsers.popitem(last=False)

                async for part in stream_response_to_parts(
                    self._parsers[session_id],
                    token_stream(current_message, full_content_list),
                    version=ui_version,
                ):
                    parts_streamed = True
                    yield {
                        "is_task_complete": False,
                        "parts": [part],
                    }
            else:
                async for token in token_stream(current_message, full_content_list):
                    yield {
                        "is_task_complete": False,
                        "updates": token,
                    }

            final_response_content = "".join(full_content_list)

            is_valid = False
            error_message = ""

            if ui_version:
                logger.info(
                    "--- A2uiDemoAgent.stream: Validating UI response (Attempt"
                    f" {attempt})... ---"
                )
                try:
                    response_parts = parse_response(final_response_content)

                    for part in response_parts:
                        if not part.a2ui_json:
                            continue

                        parsed_json_data = part.a2ui_json

                        # --- Validation Steps ---
                        # Check if it validates against the A2UI_SCHEMA
                        # This will raise jsonschema.exceptions.ValidationError if it fails
                        logger.info(
                            "--- A2uiDemoAgent.stream: Validating against"
                            " A2UI_SCHEMA... ---"
                        )
                        selected_catalog.validator.validate(parsed_json_data)
                        # --- End Validation Steps ---

                        logger.info(
                            "--- A2uiDemoAgent.stream: UI JSON successfully parsed AND"
                            " validated against schema. Validation OK (Attempt"
                            f" {attempt}). ---"
                        )
                        is_valid = True

                except (
                    ValueError,
                    json.JSONDecodeError,
                    jsonschema.exceptions.ValidationError,
                ) as e:
                    logger.warning(
                        f"--- A2uiDemoAgent.stream: A2UI validation failed: {e}"
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
                    "--- A2uiDemoAgent.stream: Response is valid. Sending final"
                    f" response (Attempt {attempt}). ---"
                )
                final_parts = parse_response_to_parts(
                    final_response_content, fallback_text="OK.", version=ui_version
                )

                # Always include the full parts in the final message. Even when
                # streaming working chunks, many A2UI clients only render the
                # final message's parts (treating working updates as progress/
                # "thought"). Sending empty final parts caused all content to be
                # shown as thoughts with nothing rendered.
                yield {
                    "is_task_complete": True,
                    "parts": final_parts,
                }
                return  # We're done, exit the generator

            # --- If we're here, it means validation failed ---

            if attempt <= max_retries:
                logger.warning(
                    "--- A2uiDemoAgent.stream: Retrying..."
                    f" ({attempt}/{max_retries + 1}) ---"
                )
                # Prepare the query for the retry
                current_query_text = (
                    f"Your previous response was invalid. {error_message} You MUST"
                    " generate a valid response that strictly follows the A2UI JSON"
                    " SCHEMA. The response MUST be a JSON list of A2UI messages. Ensure"
                    f" each JSON part is wrapped in '{A2UI_OPEN_TAG}' and"
                    f" '{A2UI_CLOSE_TAG}' tags. Please retry the original request:"
                    f" '{query}'"
                )
                # Loop continues...

        # --- If we're here, it means we've exhausted retries ---
        logger.error(
            "--- A2uiDemoAgent.stream: Max retries exhausted. Sending text-only"
            " error. ---"
        )
        yield {
            "is_task_complete": True,
            "parts": [
                Part(
                    root=TextPart(
                        text=(
                            "I'm sorry, I'm having trouble generating the interface"
                            " for that request right now. Please try again in a"
                            " moment."
                        )
                    )
                )
            ],
        }
        # --- End: UI Validation and Retry Logic ---
