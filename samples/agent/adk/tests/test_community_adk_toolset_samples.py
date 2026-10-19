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

"""Negotiates A2UI with the community ADK toolset samples, without a model.

Each test sends the executor a request with the A2UI extension and the
client's capabilities, and checks what `_prepare_session` writes into the
session state for the instruction, the UI tool and the tools.
"""

from collections.abc import Callable
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any
import uuid

from a2a.server.agent_execution import RequestContext
from a2a.types import Message, MessageSendParams, Part, Role, TextPart
from google.adk.a2a.converters.request_converter import AgentRunRequest
import pytest

from a2ui.a2a import get_a2ui_extension_uri
from a2ui.constants import (
    A2UI_CLIENT_CAPABILITIES_KEY,
    A2UI_RENDERER_CAPABILITIES_KEY,
    A2UI_TOOL_ERROR_KEY,
    A2UI_VALIDATED_JSON_KEY,
)
from a2ui.core.schema import ProtocolVersion
from a2ui.utils import validate_payload

ADK_SAMPLES_DIR = (
    Path(__file__).resolve().parents[4] / "samples" / "community" / "agent" / "adk"
)
RIZZCHARTS_DIR = ADK_SAMPLES_DIR / "rizzcharts" / "python"
FILE_UPLOAD_DIR = ADK_SAMPLES_DIR / "file_upload_summarizer"
MCP_APP_PROXY_DIR = ADK_SAMPLES_DIR / "mcp_app_proxy"

BASIC_V1_0 = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
RIZZCHARTS_V1_0 = "https://a2ui.org/samples/community/agent/adk/rizzcharts/catalog_schemas/1.0/rizzcharts_catalog_definition.json"
FILE_UPLOAD_V0_9 = "https://a2ui.org/samples/community/agent/adk/file_upload_summarizer/catalogs/0.9/file_upload_catalog.json"
FILE_UPLOAD_V1_0 = "https://a2ui.org/samples/community/agent/adk/file_upload_summarizer/catalogs/1.0/file_upload_catalog.json"

_USER_ID = "test_user"


def _request(version: ProtocolVersion, catalog_ids: list[str]) -> RequestContext:
    """Returns a request that activates A2UI `version` and names `catalog_ids`."""
    capabilities_key = (
        A2UI_RENDERER_CAPABILITIES_KEY
        if version == ProtocolVersion.V1_0
        else A2UI_CLIENT_CAPABILITIES_KEY
    )
    message = Message(
        message_id=str(uuid.uuid4()),
        role=Role.user,
        parts=[Part(root=TextPart(text="hello"))],
        extensions=[get_a2ui_extension_uri(version)],
        metadata={
            capabilities_key: {version.value: {"supportedCatalogIds": catalog_ids}}
        },
    )
    return RequestContext(request=MessageSendParams(message=message))


async def _prepare_session(
    executor: Any, agent: Any, context: RequestContext, session_id: str = "session"
) -> Any:
    """Runs the executor's session setup, and returns the session it stored."""
    run_request = AgentRunRequest(user_id=_USER_ID, session_id=session_id)
    runner = agent.runner
    await executor._prepare_session(context, run_request, runner)
    return await runner.session_service.get_session(
        app_name=runner.app_name, user_id=_USER_ID, session_id=run_request.session_id
    )


def _tool_context(state: dict[str, Any]) -> Any:
    return SimpleNamespace(
        state=state, actions=SimpleNamespace(skip_summarization=False)
    )


@pytest.fixture
def rizzcharts(
    import_sample: Callable[..., list[ModuleType]], monkeypatch: pytest.MonkeyPatch
) -> tuple[Any, Any]:
    monkeypatch.setenv("GEMINI_API_KEY", "unused")
    agent_module, executor_module = import_sample(
        RIZZCHARTS_DIR, "agent", "agent_executor"
    )
    agent = agent_module.RizzchartsAgent(
        base_url="http://localhost", model="gemini-2.5-flash"
    )
    executor = executor_module.RizzchartsAgentExecutor(
        base_url="http://localhost", agent=agent
    )
    return agent, executor


@pytest.fixture
def file_upload(
    import_sample: Callable[..., list[ModuleType]], monkeypatch: pytest.MonkeyPatch
) -> tuple[Any, Any, ModuleType]:
    monkeypatch.setenv("GEMINI_API_KEY", "unused")
    agent_module, executor_module, tools = import_sample(
        FILE_UPLOAD_DIR, "agent", "agent_executor", "tools"
    )
    agent = agent_module.FileUploadSummarizerAgent(
        base_url="http://localhost", model="gemini-2.5-flash"
    )
    executor = executor_module.FileUploadSummarizerAgentExecutor(
        base_url="http://localhost", agent=agent
    )
    return agent, executor, tools


@pytest.mark.asyncio
async def test_rizzcharts_v1_0_without_the_basic_catalog_answers_in_text(rizzcharts):
    """A v1.0 rizzcharts surface defaults to the basic catalog, which is missing."""
    agent, executor = rizzcharts

    session = await _prepare_session(
        executor, agent, _request(ProtocolVersion.V1_0, [RIZZCHARTS_V1_0])
    )

    assert session.state["system:a2ui_enabled"] is False
    assert session.state["system:a2ui_catalogs"] == []
    assert session.state["system:a2ui_examples"] == ""


@pytest.mark.parametrize(
    "catalog_ids, examples_component",
    [
        ([RIZZCHARTS_V1_0, BASIC_V1_0], '"component": "Chart"'),
        ([BASIC_V1_0, RIZZCHARTS_V1_0], '"component": "List"'),
        ([BASIC_V1_0], '"component": "List"'),
    ],
)
@pytest.mark.asyncio
async def test_rizzcharts_v1_0_gets_the_examples_of_the_preferred_catalog(
    rizzcharts, catalog_ids, examples_component
):
    agent, executor = rizzcharts

    session = await _prepare_session(
        executor, agent, _request(ProtocolVersion.V1_0, catalog_ids)
    )

    assert session.state["system:a2ui_enabled"] is True
    assert [c.catalog_id for c in session.state["system:a2ui_catalogs"]] == catalog_ids
    assert examples_component in session.state["system:a2ui_examples"]


@pytest.mark.parametrize("version", [ProtocolVersion.V0_8, ProtocolVersion.V0_9])
@pytest.mark.asyncio
async def test_rizzcharts_up_to_v0_9_uses_either_catalog_alone(rizzcharts, version):
    """Up to v0.9 both catalogs hold every component that their examples use."""
    agent, executor = rizzcharts
    generator = agent._generators[version]
    for config in generator.catalogs:
        catalog_id = config.transformed_catalog.catalog_id

        session = await _prepare_session(
            executor, agent, _request(version, [catalog_id]), session_id=catalog_id
        )

        assert session.state["system:a2ui_enabled"] is True
        assert [c.catalog_id for c in session.state["system:a2ui_catalogs"]] == [
            catalog_id
        ]
        assert session.state["system:a2ui_examples"]


@pytest.mark.asyncio
async def test_rizzcharts_adds_a_session_event_only_when_the_negotiation_changes(
    rizzcharts,
):
    agent, executor = rizzcharts
    both = [RIZZCHARTS_V1_0, BASIC_V1_0]

    first = await _prepare_session(
        executor, agent, _request(ProtocolVersion.V1_0, both)
    )
    again = await _prepare_session(
        executor, agent, _request(ProtocolVersion.V1_0, both)
    )
    changed = await _prepare_session(
        executor, agent, _request(ProtocolVersion.V1_0, [BASIC_V1_0])
    )

    assert len(first.events) == 1
    assert len(again.events) == 1
    assert len(changed.events) == 2
    assert [c.catalog_id for c in changed.state["system:a2ui_catalogs"]] == [BASIC_V1_0]


@pytest.mark.parametrize("catalog_ids", [[BASIC_V1_0], [FILE_UPLOAD_V1_0]])
@pytest.mark.asyncio
async def test_file_upload_v1_0_with_one_catalog_answers_in_text(
    file_upload, catalog_ids
):
    """The v1.0 uploader surface uses both the basic and the file upload catalog."""
    agent, executor, _ = file_upload

    session = await _prepare_session(
        executor, agent, _request(ProtocolVersion.V1_0, catalog_ids)
    )

    assert session.state["system:a2ui_enabled"] is False
    assert session.state["system:a2ui_catalogs"] == []


@pytest.mark.parametrize(
    "version, catalog_ids",
    [
        (ProtocolVersion.V0_9, [FILE_UPLOAD_V0_9]),
        (ProtocolVersion.V1_0, [BASIC_V1_0, FILE_UPLOAD_V1_0]),
        (ProtocolVersion.V1_0, [FILE_UPLOAD_V1_0, BASIC_V1_0]),
    ],
)
@pytest.mark.asyncio
async def test_file_upload_uploader_is_valid_on_the_negotiated_catalogs(
    file_upload, version, catalog_ids
):
    agent, executor, tools = file_upload
    session = await _prepare_session(executor, agent, _request(version, catalog_ids))
    assert session.state["system:a2ui_enabled"] is True
    tool_context = _tool_context(session.state)

    response = await tools.show_file_uploader_tool(tool_context, multiple=False)

    assert A2UI_TOOL_ERROR_KEY not in response
    messages = response[A2UI_VALIDATED_JSON_KEY]
    assert {m["version"] for m in messages} == {version.value}
    validate_payload(session.state["system:a2ui_catalogs"], messages)
    assert tool_context.actions.skip_summarization is True


@pytest.mark.asyncio
async def test_file_upload_tool_returns_an_error_instead_of_an_invalid_surface(
    file_upload,
):
    """A surface that names a catalog the request lacks is never sent."""
    agent, executor, tools = file_upload
    v1_0 = await _prepare_session(
        executor,
        agent,
        _request(ProtocolVersion.V1_0, [BASIC_V1_0, FILE_UPLOAD_V1_0]),
        session_id="v1_0",
    )
    basic_only = [
        c for c in v1_0.state["system:a2ui_catalogs"] if c.catalog_id == BASIC_V1_0
    ]
    tool_context = _tool_context({
        **v1_0.state,
        "system:a2ui_catalogs": basic_only,
    })

    response = await tools.show_file_uploader_tool(tool_context, multiple=False)

    assert A2UI_VALIDATED_JSON_KEY not in response
    assert FILE_UPLOAD_V1_0 in response[A2UI_TOOL_ERROR_KEY]
    assert tool_context.actions.skip_summarization is False


@pytest.mark.asyncio
async def test_mcp_app_proxy_answers_v0_8_in_text(
    import_sample: Callable[..., list[ModuleType]], monkeypatch: pytest.MonkeyPatch
):
    """The tools write v0.9 or v1.0 messages, so the agent doesn't speak v0.8."""
    monkeypatch.setenv("GEMINI_API_KEY", "unused")
    agent_module, executor_module = import_sample(
        MCP_APP_PROXY_DIR, "agent", "agent_executor"
    )
    agent = agent_module.McpAppProxyAgent(
        base_url="http://localhost", model="gemini-2.5-flash"
    )
    executor = executor_module.McpAppProxyAgentExecutor(
        base_url="http://localhost", agent=agent
    )
    extension_uris = [e.uri for e in agent.agent_card.capabilities.extensions]
    v0_8_catalog = "https://a2ui.org/samples/community/agent/adk/mcp_app_proxy/catalogs/0.8/mcp_app_catalog.json"

    session = await _prepare_session(
        executor, agent, _request(ProtocolVersion.V0_8, [v0_8_catalog])
    )

    assert get_a2ui_extension_uri(ProtocolVersion.V0_8) not in extension_uris
    assert session.state["system:a2ui_enabled"] is False
    assert session.state["system:a2ui_version"] == ""
