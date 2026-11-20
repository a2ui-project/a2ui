# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Serves the decision playground as an A2A agent."""

from __future__ import annotations

from collections.abc import Sequence
import logging
import os
from pathlib import Path
import time
from typing import Any
import uuid

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
import click
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware

from a2ui.a2a import get_a2ui_agent_extension
from a2ui.core.basic_catalog import BasicCatalog
from agent import PlaygroundAgent
from agent_executor import PlaygroundAgentExecutor
from modes import LlmToolTurn, LlmTurn, RenderMode
from renderers import PlaygroundRenderers

load_dotenv(Path.home() / ".env")
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]
_DEFAULT_THINKING_BUDGET = 1000


def _default_model_name() -> str:
    """Resolves the Gemini model name from environment variables."""
    model_env = (
        os.getenv("MODEL_NAME") or os.getenv("LITELLM_MODEL") or "gemini-3.6-flash"
    )
    return model_env.split("/")[-1]


def _default_thinking_budget() -> int:
    raw = os.getenv("A2UI_PLAYGROUND_THINKING_BUDGET")
    return int(raw) if raw is not None else _DEFAULT_THINKING_BUDGET


def _has_llm_credentials() -> bool:
    return bool(
        os.getenv("GOOGLE_GENAI_USE_VERTEXAI") == "TRUE"
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
    )


def _collect_tool_parts(
    parts: Sequence[Any],
    chunks: list[str],
    tool_name: str | None,
    tool_args: dict[str, Any],
    tool_result: Any,
) -> tuple[str | None, dict[str, Any], Any]:
    """Extracts text chunks, tool call, and tool response from ADK event parts."""
    for part in parts:
        p_text = getattr(part, "text", None)
        if isinstance(p_text, str):
            chunks.append(p_text)
        fn_call = getattr(part, "function_call", None)
        if fn_call:
            tool_name = fn_call.name
            tool_args = dict(fn_call.args or {})
        fn_resp = getattr(part, "function_response", None)
        if fn_resp:
            tool_result = fn_resp.response
    return tool_name, tool_args, tool_result


class AdkLlmCaller:
    """`LlmCaller` implementation over ADK with one `Runner` per instruction key."""

    def __init__(
        self,
        model_name: str,
        app_name: str = "decision_playground",
        user_id: str = "playground",
        *,
        thinking_budget: int | None = None,
    ) -> None:
        self._model_name = model_name
        self._app_name = app_name
        self._user_id = user_id
        self._thinking_budget = (
            _default_thinking_budget() if thinking_budget is None else thinking_budget
        )
        self._runners: dict[str, Any] = {}

    def _runner_for(
        self,
        instruction_key: str,
        instruction: str,
        tools: Sequence[Any] | None = None,
    ) -> Any:
        from google.adk.agents.llm_agent import LlmAgent
        from google.adk.artifacts import InMemoryArtifactService
        from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
        from google.adk.models import Gemini
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService
        from google.genai import types

        cache_key = f"{instruction_key}:{len(tools or ())}"
        runner = self._runners.get(cache_key)
        if runner is None:
            agent = LlmAgent(
                model=Gemini(
                    model=self._model_name,
                    retry_options=types.HttpRetryOptions(attempts=3, initial_delay=2.0),
                ),
                name=(
                    f"playground_{instruction_key.replace(':', '_').replace('.', '_')}"
                ),
                description="Decision playground LLM runner.",
                instruction=instruction,
                tools=list(tools) if tools else [],
                generate_content_config=types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(
                        thinking_budget=self._thinking_budget
                    )
                ),
            )
            runner = Runner(
                app_name=self._app_name,
                agent=agent,
                artifact_service=InMemoryArtifactService(),
                session_service=InMemorySessionService(),
                memory_service=InMemoryMemoryService(),
            )
            self._runners[cache_key] = runner
        return runner

    async def _session_for(self, runner: Any, session_id: str | None) -> str:
        sid = session_id or f"oneshot-{uuid.uuid4()}"
        session = await runner.session_service.get_session(
            app_name=self._app_name, user_id=self._user_id, session_id=sid
        )
        if session is None:
            await runner.session_service.create_session(
                app_name=self._app_name, user_id=self._user_id, session_id=sid
            )
        return sid

    async def __call__(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
    ) -> LlmTurn:
        from google.adk.agents import run_config
        from google.genai import types

        runner = self._runner_for(instruction_key, instruction)
        sid = await self._session_for(runner, session_id)
        started = time.perf_counter()
        chunks: list[str] = []
        prompt_tokens = output_tokens = 0
        async for event in runner.run_async(
            user_id=self._user_id,
            session_id=sid,
            new_message=types.Content(
                role="user", parts=[types.Part.from_text(text=user_text)]
            ),
            run_config=run_config.RunConfig(
                streaming_mode=run_config.StreamingMode.NONE
            ),
        ):
            if event.content and event.content.parts:
                for part in event.content.parts:
                    p_text = getattr(part, "text", None)
                    if isinstance(p_text, str):
                        chunks.append(p_text)
            usage = getattr(event, "usage_metadata", None)
            if usage is not None:
                prompt_tokens += int(usage.prompt_token_count or 0)
                output_tokens += int(usage.candidates_token_count or 0)
        return LlmTurn(
            text="".join(chunks),
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            latency_ms=(time.perf_counter() - started) * 1000.0,
        )

    async def call_with_tools(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
        tools: Sequence[Any],
    ) -> LlmToolTurn:
        from google.adk.agents import run_config
        from google.genai import types

        runner = self._runner_for(instruction_key, instruction, tools=tools)
        sid = await self._session_for(runner, session_id)
        started = time.perf_counter()
        chunks: list[str] = []
        tool_name: str | None = None
        tool_args: dict[str, Any] = {}
        tool_result: Any = None
        prompt_tokens = output_tokens = 0
        async for event in runner.run_async(
            user_id=self._user_id,
            session_id=sid,
            new_message=types.Content(
                role="user", parts=[types.Part.from_text(text=user_text)]
            ),
            run_config=run_config.RunConfig(
                streaming_mode=run_config.StreamingMode.NONE
            ),
        ):
            if event.content and event.content.parts:
                tool_name, tool_args, tool_result = _collect_tool_parts(
                    event.content.parts, chunks, tool_name, tool_args, tool_result
                )
            usage = getattr(event, "usage_metadata", None)
            if usage is not None:
                prompt_tokens += int(usage.prompt_token_count or 0)
                output_tokens += int(usage.candidates_token_count or 0)
        return LlmToolTurn(
            tool_name=tool_name,
            arguments=tool_args,
            result=tool_result,
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            latency_ms=(time.perf_counter() - started) * 1000.0,
            text="".join(chunks),
        )


def build_agent_card(base_url: str) -> AgentCard:
    """Constructs the A2A `AgentCard` advertising A2UI v1.0 support."""
    catalog = BasicCatalog("v1.0")
    extensions = [
        get_a2ui_agent_extension(
            "1.0",
            supported_catalog_ids=[catalog.catalog_id],
        )
    ]
    skill = AgentSkill(
        id="decision_playground",
        name="A2UI Decision Playground",
        description=(
            "Interactive sample for the decision cascade router, zero-LLM tool"
            " binder, and RPC predicate validation. Commands: /mode, /backend,"
            " /budget, /tool, /form, /compare, /trace, /help."
        ),
        tags=["a2ui", "playground", "decision", "cascade", "binder", "rpc"],
        examples=["/tool host", "/form bug", "Show host health dashboard"],
    )
    return AgentCard(
        name="A2UI Decision Playground",
        description=(
            "Exercises the A2UI decision cascade, tool pointer binder, and RPC"
            " predicates with an interactive inspector trace."
        ),
        url=base_url,
        version="1.0.0",
        default_input_modes=_SUPPORTED_CONTENT_TYPES,
        default_output_modes=_SUPPORTED_CONTENT_TYPES,
        capabilities=AgentCapabilities(streaming=True, extensions=extensions),
        skills=[skill],
    )


@click.command()
@click.option("--host", default="localhost")
@click.option("--port", default=10010)
@click.option(
    "--mode",
    type=click.Choice([m.value for m in RenderMode], case_sensitive=False),
    default=os.getenv("A2UI_PLAYGROUND_MODE") or RenderMode.CASCADE.value,
    help="Initial render mode for new conversations.",
)
@click.option(
    "--backend",
    default=None,
    help=(
        "Decision backend ('mock', 'gemini', 'jev', 'systemone', 'step0');"
        " overrides A2UI_DECISION_BACKEND."
    ),
)
def main(host: str, port: int, mode: str, backend: str | None) -> None:
    """Starts the A2A Starlette server for the decision playground agent."""
    try:
        if backend:
            os.environ["A2UI_DECISION_BACKEND"] = backend
        backend_kind = os.getenv("A2UI_DECISION_BACKEND") or "mock"

        llm: AdkLlmCaller | None = None
        model_name = _default_model_name()
        if _has_llm_credentials():
            llm = AdkLlmCaller(model_name=model_name)
        else:
            logger.warning(
                "No GEMINI_API_KEY or Vertex AI credentials found; running in"
                " offline mode (cascade/binder/rpc work with 0 LLM calls;"
                " express/direct baselines require credentials)."
            )

        base_url = f"http://{host}:{port}"
        renderers = PlaygroundRenderers(backend_kind=backend_kind, llm=llm)
        agent = PlaygroundAgent(renderers, initial_mode=RenderMode(mode.lower()))
        logger.info(
            "Decision playground on %s (mode %s, llm %s, decision backend %s / %s)",
            base_url,
            mode.lower(),
            model_name if llm is not None else "offline",
            renderers.backend_kind,
            renderers.model_id,
        )

        agent_card = build_agent_card(base_url)
        request_handler = DefaultRequestHandler(
            agent_executor=PlaygroundAgentExecutor(agent, agent_card=agent_card),
            task_store=InMemoryTaskStore(),
        )
        server = A2AStarletteApplication(
            agent_card=agent_card,
            http_handler=request_handler,
        )
        import uvicorn

        app = server.build()
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"http://localhost:\d+",
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        uvicorn.run(app, host=host, port=port)
    except Exception as exc:
        logger.error("An error occurred during server startup: %s", exc)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
