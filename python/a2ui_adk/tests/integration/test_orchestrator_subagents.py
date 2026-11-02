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

"""In-process integration tests for multi-subagent orchestrator A2UI isolation."""

from __future__ import annotations

from contextlib import AsyncExitStack
import copy
import json
from typing import Any

from a2a.client import ClientConfig, ClientFactory
from a2a.server.agent_execution import RequestContext
from a2a.types import Message
from google.adk.a2a.agent.config import (
    A2aRemoteAgentConfig,
    ParametersConfig,
    RequestInterceptor,
)
from google.adk.a2a.converters.part_converter import convert_genai_part_to_a2a_part
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor
from google.adk.a2a.executor.config import A2aAgentExecutorConfig, ExecuteInterceptor
from google.adk.a2a.utils.agent_to_a2a import to_a2a
from google.adk.agents.invocation_context import InvocationContext
from google.adk.agents.llm_agent import LlmAgent
from google.adk.agents.remote_a2a_agent import RemoteA2aAgent
from google.adk.events.event import Event
from google.adk.runners import InMemoryRunner
from google.adk.sessions.session import Session
from google.adk.sessions.state import State
from google.genai import types as genai_types
import httpx
import pytest
from starlette.applications import Starlette

from a2ui.a2a import create_a2ui_part
from a2ui.adk import (
    A2uiEventConverter,
    A2uiSubagentMap,
    SurfaceIdAlreadyExistsError,
)
from a2ui.constants import A2UI_CLIENT_DATA_MODEL_KEY
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.processor import A2uiRequestProcessor

from .scripted_llm import ScriptedLlm, make_text_response

_ORCHESTRATOR_APP = "orchestrator_app"
_USER = "orchestrator_user"


def _wire_version(version: str) -> str:
    return "1.0" if version == "1.0" else f"v{version}"


def _create_surface_block(
    version: str,
    catalog_id: str,
    surface_id: str,
    text: str = "Subagent surface",
) -> str:
    wire = _wire_version(version)
    payload = [
        {
            "version": wire,
            "createSurface": {
                "surfaceId": surface_id,
                "catalogId": catalog_id,
            },
        },
        {
            "version": wire,
            "updateComponents": {
                "surfaceId": surface_id,
                "components": [{"id": "root", "component": "Text", "text": text}],
            },
        },
    ]
    return f"<a2ui-json>{json.dumps(payload)}</a2ui-json>"


def _delete_surface_block(version: str, surface_id: str) -> str:
    wire = _wire_version(version)
    payload = [{
        "version": wire,
        "deleteSurface": {
            "surfaceId": surface_id,
        },
    }]
    return f"<a2ui-json>{json.dumps(payload)}</a2ui-json>"


class _SubagentHarness:
    """Holds an in-process Starlette A2A subagent app and its RemoteA2aAgent."""

    def __init__(
        self,
        *,
        name: str,
        app: Starlette,
        http_client: httpx.AsyncClient,
        remote_agent: RemoteA2aAgent,
        received_metadata: list[dict[str, Any]],
    ) -> None:
        self.name = name
        self.app = app
        self.http_client = http_client
        self.remote_agent = remote_agent
        self.received_metadata = received_metadata


def _build_in_process_subagent(
    *,
    name: str,
    version: str,
    scripted_blocks: list[str],
    client_data_model: dict[str, Any] | None = None,
) -> _SubagentHarness:
    """Creates a `to_a2a(LlmAgent(model=ScriptedLlm(...)))` app over ASGITransport."""
    catalog = BasicCatalog(version)
    processor = A2uiRequestProcessor(
        [catalog],
        format_factory=DirectJsonFormatFactory(),
    )
    llm = ScriptedLlm(
        responses=[make_text_response(block) for block in scripted_blocks]
    )
    sub_llm_agent = LlmAgent(model=llm, name=name)
    runner = InMemoryRunner(agent=sub_llm_agent, app_name=f"{name}_app")

    received_metadata: list[dict[str, Any]] = []

    async def _capture_before_agent(ctx: RequestContext) -> RequestContext:
        received_metadata.append(dict(ctx.metadata))
        return ctx

    executor_config = A2aAgentExecutorConfig(
        event_converter=A2uiEventConverter(a2ui_processor=processor),
        execute_interceptors=[ExecuteInterceptor(before_agent=_capture_before_agent)],
    )
    app = to_a2a(
        sub_llm_agent,
        host="testserver",
        port=80,
        runner=runner,
        agent_executor_factory=lambda r: A2aAgentExecutor(
            runner=r, config=executor_config
        ),
    )
    transport = httpx.ASGITransport(app=app)
    http_client = httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    )
    client_factory = ClientFactory(ClientConfig(httpx_client=http_client))

    async def _filter_outbound_request(
        ctx: InvocationContext,
        a2a_message: Message,
        params_config: ParametersConfig,
    ) -> tuple[Message | Event, ParametersConfig]:
        if client_data_model is not None:
            model_copy = copy.deepcopy(client_data_model)
            await A2uiSubagentMap.strip_unowned_surfaces_from_data_model(
                name, model_copy, State(value=ctx.session.state, delta={})
            )
            params_config.request_metadata = {A2UI_CLIENT_DATA_MODEL_KEY: model_copy}
        return a2a_message, params_config

    remote_agent = RemoteA2aAgent(
        name=name,
        agent_card="http://testserver/.well-known/agent-card.json",
        httpx_client=http_client,
        a2a_client_factory=client_factory,
        config=A2aRemoteAgentConfig(
            request_interceptors=[
                RequestInterceptor(before_request=_filter_outbound_request)
            ]
        ),
    )
    return _SubagentHarness(
        name=name,
        app=app,
        http_client=http_client,
        remote_agent=remote_agent,
        received_metadata=received_metadata,
    )


async def _get_orchestrator_session(runner: InMemoryRunner, session_id: str) -> Session:
    session = await runner.session_service.get_session(
        app_name=_ORCHESTRATOR_APP,
        user_id=_USER,
        session_id=session_id,
    )
    assert session is not None
    return session


async def _get_orchestrator_state(runner: InMemoryRunner, session_id: str) -> State:
    session = await _get_orchestrator_session(runner, session_id)
    return State(value=session.state, delta={})


async def _run_subagent_turn_on_session(
    runner: InMemoryRunner,
    subagent: RemoteA2aAgent,
    session_id: str,
    prompt: str = "Render UI",
) -> list[Event]:
    """Runs a single `RemoteA2aAgent` turn against an existing orchestrator session."""
    runner.agent = subagent
    events: list[Event] = []
    async for event in runner.run_async(
        user_id=_USER,
        session_id=session_id,
        new_message=genai_types.Content(
            role="user", parts=[genai_types.Part(text=prompt)]
        ),
    ):
        if event.content and event.content.parts:
            for genai_part in event.content.parts:
                a2a_part = convert_genai_part_to_a2a_part(genai_part)
                if a2a_part is not None:
                    session = await _get_orchestrator_session(runner, session_id)
                    await A2uiSubagentMap.update_from_server_event(
                        a2a_part,
                        event.author,
                        runner.session_service,
                        session,
                    )
        events.append(event)
    return events


@pytest.mark.parametrize("version", ["0.9", "1.0"], ids=["v0.9", "1.0"])
@pytest.mark.asyncio
async def test_orchestrator_records_surface_ownership_per_subagent(
    version: str,
) -> None:
    catalog_id = BasicCatalog(version).catalog_id
    subagent_a = _build_in_process_subagent(
        name="subagent_a",
        version=version,
        scripted_blocks=[
            _create_surface_block(version, catalog_id, "surface_a", text="From A"),
            _delete_surface_block(version, "surface_a"),
        ],
    )
    subagent_b = _build_in_process_subagent(
        name="subagent_b",
        version=version,
        scripted_blocks=[
            _create_surface_block(version, catalog_id, "surface_b", text="From B")
        ],
    )

    async with AsyncExitStack() as stack:
        await stack.enter_async_context(
            subagent_a.app.router.lifespan_context(subagent_a.app)
        )
        await stack.enter_async_context(
            subagent_b.app.router.lifespan_context(subagent_b.app)
        )
        await stack.enter_async_context(subagent_a.http_client)
        await stack.enter_async_context(subagent_b.http_client)

        runner = InMemoryRunner(
            agent=subagent_a.remote_agent, app_name=_ORCHESTRATOR_APP
        )
        session = await runner.session_service.create_session(
            app_name=_ORCHESTRATOR_APP, user_id=_USER
        )

        await _run_subagent_turn_on_session(runner, subagent_a.remote_agent, session.id)
        await _run_subagent_turn_on_session(runner, subagent_b.remote_agent, session.id)

        updated_state = await _get_orchestrator_state(runner, session.id)
        assert (
            await A2uiSubagentMap.get_subagent_name("surface_a", updated_state)
            == "subagent_a"
        )
        assert (
            await A2uiSubagentMap.get_subagent_name("surface_b", updated_state)
            == "subagent_b"
        )
        assert (
            await A2uiSubagentMap.get_subagent_name("unknown_surface", updated_state)
            is None
        )

        wire = _wire_version(version)
        client_event_a = create_a2ui_part({
            "version": wire,
            "action": {
                "name": "submit",
                "surfaceId": "surface_a",
                "sourceComponentId": "root",
                "timestamp": "2026-01-01T00:00:00Z",
                "context": {},
            },
        })
        client_event_b = create_a2ui_part({
            "version": wire,
            "action": {
                "name": "submit",
                "surfaceId": "surface_b",
                "sourceComponentId": "root",
                "timestamp": "2026-01-01T00:00:00Z",
                "context": {},
            },
        })
        assert (
            await A2uiSubagentMap.get_subagent_name_for_client_event(
                client_event_a, updated_state
            )
            == "subagent_a"
        )
        assert (
            await A2uiSubagentMap.get_subagent_name_for_client_event(
                client_event_b, updated_state
            )
            == "subagent_b"
        )

        # When subagent_a emits deleteSurface for surface_a, ownership is removed
        # while subagent_b retains ownership of surface_b.
        await _run_subagent_turn_on_session(
            runner, subagent_a.remote_agent, session.id, prompt="Close surface_a"
        )
        state_after_delete = await _get_orchestrator_state(runner, session.id)
        assert (
            await A2uiSubagentMap.get_subagent_name("surface_a", state_after_delete)
            is None
        )
        assert (
            await A2uiSubagentMap.get_subagent_name("surface_b", state_after_delete)
            == "subagent_b"
        )


@pytest.mark.parametrize("version", ["0.9", "1.0"], ids=["v0.9", "1.0"])
@pytest.mark.asyncio
async def test_orchestrator_duplicate_surface_across_subagents_raises_error(
    version: str,
) -> None:
    catalog_id = BasicCatalog(version).catalog_id
    subagent_a = _build_in_process_subagent(
        name="subagent_a",
        version=version,
        scripted_blocks=[
            _create_surface_block(version, catalog_id, "surface1", text="Owner A")
        ],
    )
    subagent_b = _build_in_process_subagent(
        name="subagent_b",
        version=version,
        scripted_blocks=[
            _create_surface_block(version, catalog_id, "surface1", text="Colliding B")
        ],
    )

    async with AsyncExitStack() as stack:
        await stack.enter_async_context(
            subagent_a.app.router.lifespan_context(subagent_a.app)
        )
        await stack.enter_async_context(
            subagent_b.app.router.lifespan_context(subagent_b.app)
        )
        await stack.enter_async_context(subagent_a.http_client)
        await stack.enter_async_context(subagent_b.http_client)

        runner = InMemoryRunner(
            agent=subagent_a.remote_agent, app_name=_ORCHESTRATOR_APP
        )
        session = await runner.session_service.create_session(
            app_name=_ORCHESTRATOR_APP, user_id=_USER
        )

        await _run_subagent_turn_on_session(runner, subagent_a.remote_agent, session.id)

        with pytest.raises(SurfaceIdAlreadyExistsError) as exc_info:
            await _run_subagent_turn_on_session(
                runner, subagent_b.remote_agent, session.id
            )

        assert exc_info.value.surface_id == "surface1"
        assert "subagent_a" in str(exc_info.value)
        assert "subagent_b" in str(exc_info.value)

        updated_state = await _get_orchestrator_state(runner, session.id)
        assert (
            await A2uiSubagentMap.get_subagent_name("surface1", updated_state)
            == "subagent_a"
        )


@pytest.mark.parametrize("version", ["0.9", "1.0"], ids=["v0.9", "1.0"])
@pytest.mark.asyncio
async def test_orchestrator_forwards_only_owned_surfaces_in_client_data_model(
    version: str,
) -> None:
    catalog_id = BasicCatalog(version).catalog_id
    wire = _wire_version(version)
    shared_client_data_model: dict[str, Any] = {
        "version": wire,
        "surfaces": {
            "surface_a": {"cart": ["item_a"]},
            "surface_b": {"profile": {"name": "Alice"}},
            "unowned_surface": {"secret": "hidden"},
        },
    }

    subagent_a = _build_in_process_subagent(
        name="subagent_a",
        version=version,
        scripted_blocks=[
            _create_surface_block(version, catalog_id, "surface_a", text="A1"),
            _create_surface_block(version, catalog_id, "surface_a2", text="A2"),
        ],
        client_data_model=shared_client_data_model,
    )
    subagent_b = _build_in_process_subagent(
        name="subagent_b",
        version=version,
        scripted_blocks=[
            _create_surface_block(version, catalog_id, "surface_b", text="B1"),
            _create_surface_block(version, catalog_id, "surface_b2", text="B2"),
        ],
        client_data_model=shared_client_data_model,
    )

    async with AsyncExitStack() as stack:
        await stack.enter_async_context(
            subagent_a.app.router.lifespan_context(subagent_a.app)
        )
        await stack.enter_async_context(
            subagent_b.app.router.lifespan_context(subagent_b.app)
        )
        await stack.enter_async_context(subagent_a.http_client)
        await stack.enter_async_context(subagent_b.http_client)

        runner = InMemoryRunner(
            agent=subagent_a.remote_agent, app_name=_ORCHESTRATOR_APP
        )
        session = await runner.session_service.create_session(
            app_name=_ORCHESTRATOR_APP, user_id=_USER
        )

        # Turn 1: neither subagent owns any surfaces yet, so all surfaces are stripped.
        await _run_subagent_turn_on_session(
            runner, subagent_a.remote_agent, session.id, prompt="Init A"
        )
        await _run_subagent_turn_on_session(
            runner, subagent_b.remote_agent, session.id, prompt="Init B"
        )

        assert subagent_a.received_metadata[0][A2UI_CLIENT_DATA_MODEL_KEY] == {
            "version": wire,
            "surfaces": {},
        }
        assert subagent_b.received_metadata[0][A2UI_CLIENT_DATA_MODEL_KEY] == {
            "version": wire,
            "surfaces": {},
        }

        # Turn 2: subagent_a owns surface_a and subagent_b owns surface_b.
        # Each subagent receives only its own surface in a2uiClientDataModel,
        # and the caller's shared_client_data_model dictionary is not mutated.
        await _run_subagent_turn_on_session(
            runner, subagent_a.remote_agent, session.id, prompt="Update A"
        )
        await _run_subagent_turn_on_session(
            runner, subagent_b.remote_agent, session.id, prompt="Update B"
        )

        assert subagent_a.received_metadata[1][A2UI_CLIENT_DATA_MODEL_KEY] == {
            "version": wire,
            "surfaces": {
                "surface_a": {"cart": ["item_a"]},
            },
        }
        assert subagent_b.received_metadata[1][A2UI_CLIENT_DATA_MODEL_KEY] == {
            "version": wire,
            "surfaces": {
                "surface_b": {"profile": {"name": "Alice"}},
            },
        }
        assert set(shared_client_data_model["surfaces"].keys()) == {
            "surface_a",
            "surface_b",
            "unowned_surface",
        }
