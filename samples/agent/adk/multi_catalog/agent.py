# Copyright 2026 Google LLC
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

from collections.abc import AsyncIterable, AsyncIterator, Mapping
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
from google.adk.sessions import InMemorySessionService, Session
from google.genai import errors as genai_errors
from google.genai import types

from a2ui.a2a import get_a2ui_agent_extension, stream_response_to_parts, to_a2a_parts
from a2ui.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG
from a2ui.core import A2uiError
from a2ui.processor import A2uiRequestProcessor
from prompt_builder import VERSION, build_generator, get_text_prompt, get_ui_prompt
from tools import get_sales_metrics

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 2


def _text_parts(text: str) -> list[Part]:
    return [Part(root=TextPart(text=text))]


def _describe(part: Part) -> str:
    """Formats a part for the log: its text, or its full A2UI messages as JSON."""
    if isinstance(part.root, TextPart):
        return f"text: {part.root.text!r}"
    if not isinstance(part.root, DataPart):
        return type(part.root).__name__
    data = part.root.data
    messages = data if isinstance(data, list) else [data]
    return "\n".join(json.dumps(message) for message in messages)


class SalesDashboardAgent:
    """An agent that shows sales metrics with two catalogs on one surface.

    It speaks A2UI v1.0, which lets one surface mix catalogs: the surface's
    default catalog is the basic catalog, for the layout, the text and the
    refresh button, and each `StatCard` and `ProgressBar` names the sample's
    dashboard catalog in its own `catalogId`. Each request negotiates its own
    processor from the client's capabilities, and the prompt, the parser and
    validation use the catalogs it holds.
    """

    SUPPORTED_CONTENT_TYPES = ["text/plain"]

    def __init__(self, base_url: str):
        self.base_url = base_url
        self._agent_name = "Sales Dashboard Agent"
        self._user_id = "remote_agent"
        # Shared by the text runner and the runner of each UI request, so a
        # conversation keeps its history across requests.
        self._session_service = InMemorySessionService()
        self._artifact_service = InMemoryArtifactService()
        self._memory_service = InMemoryMemoryService()
        self._text_runner = self._build_runner(get_text_prompt())
        self._generator = build_generator()
        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    def _build_agent_card(self) -> AgentCard:
        extension = get_a2ui_agent_extension(
            VERSION,
            supported_catalog_ids=[
                c.transformed_catalog.catalog_id for c in self._generator.catalogs
            ],
        )
        skill = AgentSkill(
            id="show_sales_dashboard",
            name="Show Sales Dashboard",
            description="Shows the latest quarterly sales metrics of a region.",
            tags=["sales", "dashboard"],
            examples=["Show me the sales dashboard for Europe"],
        )
        return AgentCard(
            name=self._agent_name,
            description="This agent shows sales metrics as a dashboard.",
            url=self.base_url,
            version="1.0.0",
            default_input_modes=SalesDashboardAgent.SUPPORTED_CONTENT_TYPES,
            default_output_modes=SalesDashboardAgent.SUPPORTED_CONTENT_TYPES,
            capabilities=AgentCapabilities(streaming=True, extensions=[extension]),
            skills=[skill],
        )

    def _build_runner(self, instruction: str) -> Runner:
        """Builds a runner whose LLM agent follows the instruction."""
        model_name = os.getenv("MODEL_NAME") or "gemini-3.6-flash"
        agent = LlmAgent(
            model=Gemini(
                model=model_name.split("/")[-1],
                # Retry transient backend errors (429, 5xx), which the model
                # returns under load.
                retry_options=types.HttpRetryOptions(attempts=3, initial_delay=2.0),
            ),
            name="sales_dashboard_agent",
            description="An agent that shows sales metrics as a dashboard.",
            # A callable instruction is used as is. ADK fills `{name}` in a
            # string instruction from the session state, and the A2UI schemas
            # in the prompt contain such text.
            instruction=lambda _: instruction,
            tools=[get_sales_metrics],
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
            app_name=self._agent_name, user_id=self._user_id, session_id=session_id
        )
        if session is None:
            session = await self._session_service.create_session(
                app_name=self._agent_name,
                user_id=self._user_id,
                session_id=session_id,
            )
        return session

    async def stream(
        self,
        query: str,
        session_id: str,
        client_ui_capabilities: Mapping[str, Any] | None,
        use_streaming: bool,
    ) -> AsyncIterable[dict[str, Any]]:
        """Answers one request, with UI if the client renders A2UI.

        With `use_streaming`, each A2UI message is validated and sent as soon
        as the model has written it. Otherwise the whole response is validated
        first and sent in the final item.

        Args:
            query: The user's question, or the text of a UI action.
            session_id: The conversation's id.
            client_ui_capabilities: The `a2uiRendererCapabilities` of the
                request, or None for a client that renders no A2UI.
            use_streaming: Whether to send the UI while the model writes it.
        """
        session = await self._get_session(session_id)
        processor: A2uiRequestProcessor | None = None
        if client_ui_capabilities is not None:
            try:
                # Picks the catalogs that both sides support, and checks the
                # examples against them.
                processor = self._generator.create_processor(client_ui_capabilities)
            except A2uiError as e:
                logger.error(f"--- Cannot set up the UI: {e} ---")
                yield {
                    "is_task_complete": True,
                    "parts": _text_parts(
                        "I'm sorry, I can't show my dashboard in this client. It"
                        " needs both the basic catalog and the dashboard catalog."
                    ),
                }
                return
            logger.info(
                "--- Negotiated catalogs: "
                f"{[c.catalog_id for c in processor.active_catalogs]} ---"
            )
            # The prompt shows the catalogs and examples of this request.
            runner = self._build_runner(get_ui_prompt(processor))
        else:
            runner = self._text_runner

        current_query = query
        for attempt in range(1, MAX_ATTEMPTS + 1):
            logger.info(
                f"--- Attempt {attempt}/{MAX_ATTEMPTS}, session {session_id} ---"
            )
            message = types.Content(
                role="user", parts=[types.Part.from_text(text=current_query)]
            )
            received: list[str] = []

            async def token_stream() -> AsyncIterator[str]:
                # In SSE mode, ADK sends the text in partial events, and then
                # the whole text again in a final event. Only the partial text
                # is sent on, so the parser sees each character once.
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
                            if p.text and not p.thought:
                                received.append(p.text)
                                yield p.text

            if processor is None:
                async for _ in token_stream():
                    pass
                yield {
                    "is_task_complete": True,
                    "parts": _text_parts("".join(received) or "OK."),
                }
                return

            # Each message is validated before it is sent, so the client only
            # gets valid UI. A failure ends the attempt.
            sent = 0
            try:
                if use_streaming:
                    async for part in stream_response_to_parts(
                        processor.open_stream(), token_stream(), version=VERSION
                    ):
                        sent += 1
                        logger.info(f"--- Streamed part {sent}:\n{_describe(part)}")
                        yield {"is_task_complete": False, "parts": [part]}
                    final_parts: list[Part] = []
                else:
                    async for _ in token_stream():
                        pass
                    final_parts = to_a2a_parts(
                        processor.parse_response("".join(received)), version=VERSION
                    )
                    for i, part in enumerate(final_parts, start=1):
                        logger.info(f"--- Final part {i}:\n{_describe(part)}")
            except genai_errors.APIError as e:
                # The model failed, for example with a 503 under load, after
                # the client's retries. End the task with a message instead of
                # dropping the connection.
                logger.error(f"--- The model failed (attempt {attempt}): {e} ---")
                break
            except A2uiError as e:
                logger.warning(
                    f"--- A2UI validation failed (attempt {attempt}): {e} ---"
                )
                logger.warning(f"--- Failed response: {''.join(received)[:500]}... ---")
                if sent:
                    # The client already shows part of this response, and a
                    # retry would create its surface again.
                    break
                current_query = (
                    f"Your previous response was invalid. Validation failed: {e}."
                    " You MUST generate a valid response that strictly follows the"
                    " A2UI JSON SCHEMA. Ensure each JSON part is wrapped in"
                    f" '{A2UI_OPEN_TAG}' and '{A2UI_CLOSE_TAG}' tags. Please retry"
                    f" the original request: '{query}'"
                )
                continue

            logger.info(f"--- Response is valid (attempt {attempt}) ---")
            yield {"is_task_complete": True, "parts": final_parts}
            return

        logger.error("--- Giving up; sending a text-only error ---")
        yield {
            "is_task_complete": True,
            "parts": _text_parts(
                "I'm sorry, I'm having trouble showing the dashboard right now."
                " Please try again in a moment."
            ),
        }
