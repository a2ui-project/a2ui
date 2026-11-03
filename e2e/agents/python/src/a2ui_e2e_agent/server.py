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

"""The A2A server of the scripted test agent.

`build_app` wires an ADK `LlmAgent` whose model is `HubScriptedLlm` into
ADK's `A2aAgentExecutor`, with the A2UI converters on both sides:

- Inbound, each request is negotiated against the renderer's capabilities,
  read from the A2A message. A request with capabilities gets a processor
  for its protocol version and format, bound to the conversation's
  `RendererState`; a request without gets none, so the agent's instruction
  carries no A2UI snippet and the model answers with text only. Renderer
  messages in the request (`action`, `error`) reach the model as text through
  `A2uiInboundPartConverter`; `callAgentFunction` is answered without a model
  turn by `a2ui_rpc_callback`.
- Outbound, `A2uiEventConverter` streams the model's chunks through the
  processor, so the renderer gets `application/a2ui+json` parts as they
  parse.

`GET /e2e/log` returns the `RequestLog` as JSON, and `DELETE /e2e/log`
clears it.
"""

from __future__ import annotations

from collections.abc import Callable
import contextvars
from dataclasses import dataclass, field
import logging
from pathlib import Path
from typing import Any

from a2a.server.agent_execution import RequestContext
from a2a.server.apps import A2AStarletteApplication
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill, DataPart, Part
from google.adk.a2a.converters.part_converter import convert_a2a_part_to_genai_part
from google.adk.a2a.converters.request_converter import (
    AgentRunRequest,
    convert_a2a_request_to_agent_run_request,
)
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor
from google.adk.a2a.executor.config import A2aAgentExecutorConfig
from google.adk.agents.llm_agent import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from a2ui.a2a import (
    get_a2ui_agent_extension,
    is_a2ui_part,
    renderer_capabilities_from_message,
    try_activate_a2ui_extension,
)
from a2ui.adk import (
    A2uiEventConverter,
    A2uiInboundPartConverter,
    A2uiInstruction,
    A2uiProcessorStore,
    a2ui_rpc_callback,
)
from a2ui.core.catalog import CatalogApi
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_format import InferenceFormatFactory
from a2ui.inference_formats import DirectJsonFormatFactory, ExpressFormatFactory
from a2ui.processor import A2uiRequestProcessor, CatalogConfig
from a2ui.rpc import AgentFunctionRegistry
from a2ui.utils import RendererState, resolve_catalogs

from .functions import build_catalog, build_registry
from .scenarios import ScenarioIndex, load_scenarios
from .scripted_llm import HubScriptedLlm, RequestLog

__all__ = [
    "AGENT_NAME",
    "DEFAULT_SCENARIO_DIR",
    "FORMATS",
    "SUPPORTED_VERSIONS",
    "ServerConfig",
    "build_app",
]

logger = logging.getLogger(__name__)

AGENT_NAME = "A2UI E2E Test Agent"
APP_NAME = "a2ui_e2e_agent"
USER_ID = "renderer"

SUPPORTED_VERSIONS: tuple[ProtocolVersion, ...] = (
    ProtocolVersion.V0_9,
    ProtocolVersion.V1_0,
)
"""The protocol versions the agent card advertises, oldest first."""

FORMATS: dict[str, Callable[[], InferenceFormatFactory]] = {
    "direct_json": DirectJsonFormatFactory,
    "express": ExpressFormatFactory,
}
"""The inference formats the agent can be started with, by scenario name."""

DEFAULT_SCENARIO_DIR = Path(__file__).resolve().parents[5] / "conformance" / "e2e"

_ROLE = (
    "You are the A2UI end-to-end test agent. You replay a scripted scenario and"
    " never answer anything else."
)
_RPC_KEYS = ("callAgentFunction", "rendererFunctionResponse")


@dataclass(frozen=True)
class ServerConfig:
    """How the server runs."""

    host: str = "localhost"
    port: int = 10010
    format: str = "direct_json"
    scenario_dir: Path = DEFAULT_SCENARIO_DIR
    chunk_delay_ms: int = 0
    rpc_delay_ms: int = 0

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def format_factory(self) -> InferenceFormatFactory:
        try:
            return FORMATS[self.format]()
        except KeyError:
            raise ValueError(
                f"Unknown format {self.format!r}; expected one of {sorted(FORMATS)}."
            ) from None


@dataclass
class _Conversation:
    """What the agent keeps for one A2A context across its turns."""

    version: ProtocolVersion | None = None
    state: RendererState | None = None
    registry: AgentFunctionRegistry | None = None
    processor: A2uiRequestProcessor | None = None


@dataclass
class _Negotiation:
    """The outcome of reading one request's capabilities."""

    version: ProtocolVersion | None
    processor: A2uiRequestProcessor | None
    state: RendererState | None
    renderer_messages: list[dict[str, Any]] = field(default_factory=list)


_current: contextvars.ContextVar[_Negotiation | None] = contextvars.ContextVar(
    "a2ui_e2e_negotiation", default=None
)


class _ScriptedAgentExecutor(A2aAgentExecutor):
    """ADK's A2A executor, negotiating A2UI per request before it runs the agent."""

    def __init__(
        self,
        *,
        runner: Runner,
        agent_card: AgentCard,
        catalogs: dict[ProtocolVersion, list[CatalogConfig]],
        format_factory: InferenceFormatFactory,
        processors: A2uiProcessorStore,
        conversations: dict[str, _Conversation],
    ) -> None:
        self._agent_card = agent_card
        self._catalogs = catalogs
        self._format_factory = format_factory
        self._processors = processors
        self._conversations = conversations
        super().__init__(
            runner=runner,
            config=A2aAgentExecutorConfig(
                a2a_part_converter=_convert_inbound_part,
                request_converter=_streaming_request_converter,
                event_converter=A2uiEventConverter(a2ui_processor=processors.get),
            ),
        )

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        negotiation = self._negotiate(context)
        token = _current.set(negotiation)
        try:
            await super().execute(context, event_queue)
        finally:
            _current.reset(token)

    def _negotiate(self, context: RequestContext) -> _Negotiation:
        """Reads the request's capabilities and sets the session's processor.

        The processor is set, or cleared, on every request: a renderer that
        withdraws its capabilities for a turn gets text for that turn.
        """
        context_id = context.context_id or ""
        conversation = self._conversations.setdefault(context_id, _Conversation())
        version = try_activate_a2ui_extension(context, self._agent_card)
        capabilities = None
        if version is not None:
            capabilities = renderer_capabilities_from_message(context.message, version)
        else:
            # A renderer that names no extension may still send capabilities.
            for candidate in reversed(SUPPORTED_VERSIONS):
                capabilities = renderer_capabilities_from_message(
                    context.message, candidate
                )
                if capabilities is not None:
                    version = candidate
                    break
        if version is None or capabilities is None:
            conversation.processor = None
            self._processors.set(context_id, None)
            return _Negotiation(version=None, processor=None, state=None)

        active = resolve_catalogs(self._catalogs[version], capabilities)
        state = conversation.state
        if (
            state is None
            or conversation.version is not version
            or not _same_catalogs(state.catalogs, active)
        ):
            conversation.registry = build_registry(active)
            state = RendererState(active, agent_functions=conversation.registry)
        processor = A2uiRequestProcessor(
            active, format_factory=self._format_factory, state=state
        )
        conversation.version = version
        conversation.state = state
        conversation.processor = processor
        self._processors.set(context_id, processor)
        return _Negotiation(version=version, processor=processor, state=state)


def _same_catalogs(left: list[CatalogApi], right: list[CatalogApi]) -> bool:
    return [c.catalog_id for c in left] == [c.catalog_id for c in right]


def _streaming_request_converter(
    request: RequestContext, part_converter: Any
) -> AgentRunRequest:
    """ADK's request converter, asking the model for a streamed response."""
    run_request = convert_a2a_request_to_agent_run_request(request, part_converter)
    if run_request.run_config is None:
        run_request.run_config = RunConfig()
    run_request.run_config.streaming_mode = StreamingMode.SSE
    return run_request


def _convert_inbound_part(
    a2a_part: Part,
) -> genai_types.Part | list[genai_types.Part] | None:
    """Converts one request part for the model.

    Renderer messages become text through `A2uiInboundPartConverter`, in the
    request's negotiated version. RPC messages keep ADK's own conversion so
    `a2ui_rpc_callback` can read and answer them without a model turn.
    """
    inner = a2a_part.root
    if (
        is_a2ui_part(a2a_part)
        and isinstance(inner, DataPart)
        and isinstance(inner.data, dict)
        and any(key in inner.data for key in _RPC_KEYS)
    ):
        return convert_a2a_part_to_genai_part(a2a_part)
    negotiation = _current.get()
    version = negotiation.version if negotiation is not None else None
    return A2uiInboundPartConverter(version)(a2a_part)


def _build_agent_card(
    config: ServerConfig, catalogs: dict[ProtocolVersion, list[CatalogConfig]]
) -> AgentCard:
    extensions = [
        get_a2ui_agent_extension(
            version,
            supported_catalog_ids=[
                c.transformed_catalog.catalog_id for c in catalogs[version]
            ],
        )
        for version in SUPPORTED_VERSIONS
    ]
    return AgentCard(
        name=AGENT_NAME,
        description=(
            "Replays the conformance/e2e scenarios over A2A, in"
            f" {config.format}, for the live-pair end-to-end tests."
        ),
        url=config.base_url,
        version="0.1.0",
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        capabilities=AgentCapabilities(streaming=True, extensions=extensions),
        skills=[
            AgentSkill(
                id="replay_scenario",
                name="Replay a scenario",
                description=(
                    "Answers the opening text of a conformance/e2e scenario with"
                    " that scenario's scripted turns."
                ),
                tags=["a2ui", "test"],
            )
        ],
    )


def _build_agent(
    llm: HubScriptedLlm,
    processors: A2uiProcessorStore,
    conversations: dict[str, _Conversation],
) -> LlmAgent:
    async def instruction(ctx: ReadonlyContext) -> str:
        # The scripted model reads the protocol version from these ids, which
        # the Express snippet does not name on its own.
        processor = processors.get(ctx)
        if processor is None:
            return _ROLE
        ids = ", ".join(catalog.catalog_id for catalog in processor.active_catalogs)
        return f"{_ROLE}\n\nActive A2UI catalogs: {ids}"

    def registry(ctx: ReadonlyContext) -> AgentFunctionRegistry | None:
        conversation = conversations.get(ctx.session.id)
        return conversation.registry if conversation is not None else None

    return LlmAgent(
        model=llm,
        name="a2ui_e2e_agent",
        description="Replays scripted A2UI scenarios.",
        instruction=A2uiInstruction(
            instruction,
            a2ui_processor=processors.get,
            a2ui_enabled=processors.is_enabled,
            fallback_instruction=_ROLE,
        ),
        before_agent_callback=a2ui_rpc_callback(agent_functions=registry),
    )


def build_app(
    config: ServerConfig, *, scenarios: ScenarioIndex | None = None
) -> Starlette:
    """Builds the Starlette app of the test agent.

    Args:
        config: How the server runs. `config.format` picks the scenario chunks
            the model streams and the parser that reads them.
        scenarios: The scenarios to serve. Loaded from `config.scenario_dir`
            when not given.

    Returns:
        The A2A JSON-RPC app, with the agent card at
        `/.well-known/agent-card.json` and the model's request log at
        `/e2e/log`. The log is also reachable as `app.state.request_log`.
    """
    format_factory = config.format_factory()
    if scenarios is None:
        scenarios = load_scenarios(config.scenario_dir)
    catalogs = {
        version: [
            CatalogConfig(build_catalog(version, rpc_delay_ms=config.rpc_delay_ms))
        ]
        for version in SUPPORTED_VERSIONS
    }
    agent_card = _build_agent_card(config, catalogs)
    processors = A2uiProcessorStore()
    conversations: dict[str, _Conversation] = {}
    log = RequestLog()
    llm = HubScriptedLlm(
        scenarios=scenarios,
        format_name=config.format,
        chunk_delay_ms=config.chunk_delay_ms,
        log=log,
    )
    runner = Runner(
        app_name=APP_NAME,
        agent=_build_agent(llm, processors, conversations),
        session_service=InMemorySessionService(),  # type: ignore[no-untyped-call]
    )
    executor = _ScriptedAgentExecutor(
        runner=runner,
        agent_card=agent_card,
        catalogs=catalogs,
        format_factory=format_factory,
        processors=processors,
        conversations=conversations,
    )
    handler = DefaultRequestHandler(
        agent_executor=executor, task_store=InMemoryTaskStore()
    )

    async def get_log(_request: Request) -> JSONResponse:
        return JSONResponse(log.to_json())

    async def clear_log(_request: Request) -> JSONResponse:
        log.clear()
        return JSONResponse({"cleared": True})

    app = A2AStarletteApplication(agent_card=agent_card, http_handler=handler).build(
        routes=[
            Route("/e2e/log", get_log, methods=["GET"]),
            Route("/e2e/log", clear_log, methods=["DELETE"]),
        ]
    )
    app.state.request_log = log
    app.state.config = config
    return app
