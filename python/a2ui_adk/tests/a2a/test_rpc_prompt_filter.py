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

"""Tests for keeping A2UI RPC messages out of the model's prompt.

The parts are built with ADK's own A2A part converter, as `A2aAgentExecutor`
builds them, and the end-to-end tests run a real `LlmAgent` with a stub model
that records each request.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import MagicMock

from google.adk.a2a.converters import part_converter
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.llm_agent import LlmAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools.tool_context import ToolContext
from google.genai import types as genai_types
import pytest

from a2ui.a2a import create_a2ui_part, get_a2ui_messages
from a2ui.adk import SendA2uiToClientToolset
from a2ui.adk.a2a import a2ui_rpc_callback, exclude_a2ui_rpc_from_prompt
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.catalog import AgentFunction, AgentFunctionContext
from a2ui.core.schema import ProtocolVersion
from a2ui.rpc import AgentFunctionRegistry

CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"


async def _echo(args: dict[str, Any], context: AgentFunctionContext) -> str:
    return str(args["x"])


CATALOG = BasicCatalog(ProtocolVersion.V1_0).copy_with(
    agent_functions=[
        AgentFunction(
            "echo",
            handler=_echo,
            return_type="string",
            schema={
                "type": "object",
                "properties": {"x": {"type": "string"}},
                "required": ["x"],
            },
        )
    ]
)

CALL = {
    "version": "1.0",
    "callAgentFunction": {
        "functionCallId": "c1",
        "surfaceId": "s1",
        "callFunction": {"@call": "echo", "catalogId": CATALOG_ID, "args": {"x": "hi"}},
    },
}
REPLY = {
    "version": "1.0",
    "agentFunctionResponse": {"functionCallId": "c1", "value": "hi"},
}
RENDERER_CALL = {
    "version": "1.0",
    "callRendererFunction": {
        "functionCallId": "r1",
        "callFunction": {"@call": "getLocation", "catalogId": CATALOG_ID, "args": {}},
    },
}
RENDERER_RESPONSE = {
    "version": "1.0",
    "rendererFunctionResponse": {"functionCallId": "r1", "value": "Paris"},
}
ACTION = {
    "version": "1.0",
    "action": {
        "name": "submit",
        "surfaceId": "s1",
        "sourceComponentId": "button",
        "timestamp": "2026-01-01T00:00:00Z",
        "context": {},
    },
}
CREATE_SURFACE = {
    "version": "1.0",
    "createSurface": {"surfaceId": "s1", "catalogId": CATALOG_ID},
}


def _part(message: dict[str, Any]) -> genai_types.Part:
    part = part_converter.convert_a2a_part_to_genai_part(create_a2ui_part(message))
    assert part is not None
    return part


def _text(text: str) -> genai_types.Part:
    return genai_types.Part.from_text(text=text)


def _a2ui_messages(contents: list[genai_types.Content]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for content in contents:
        for part in content.parts or []:
            if part.inline_data is None:
                continue
            a2a_part = part_converter.convert_genai_part_to_a2a_part(part)
            if a2a_part is not None:
                messages.extend(get_a2ui_messages([a2a_part]))
    return messages


def _texts(contents: list[genai_types.Content]) -> list[str]:
    return [
        part.text for content in contents for part in content.parts or [] if part.text
    ]


def _request() -> LlmRequest:
    return LlmRequest(
        contents=[
            genai_types.Content(role="user", parts=[_text("show me rates")]),
            genai_types.Content(
                role="model", parts=[_text("here"), _part(CREATE_SURFACE)]
            ),
            genai_types.Content(role="user", parts=[_part(CALL)]),
            genai_types.Content(role="model", parts=[_part(REPLY)]),
            genai_types.Content(role="model", parts=[_part(RENDERER_CALL)]),
            genai_types.Content(role="user", parts=[_part(RENDERER_RESPONSE)]),
            genai_types.Content(role="user", parts=[_part(ACTION)]),
            genai_types.Content(role="user", parts=[_text("and"), _part(CALL)]),
        ]
    )


def _assert_rpc_removed(llm_request: LlmRequest) -> None:
    assert [content.role for content in llm_request.contents] == [
        "user",
        "model",
        "user",
        "user",
    ]
    assert _texts(llm_request.contents) == ["show me rates", "here", "and"]
    assert _a2ui_messages(llm_request.contents) == [CREATE_SURFACE, ACTION]


def test_callback_removes_rpc_parts_and_keeps_the_rest() -> None:
    llm_request = _request()

    result = exclude_a2ui_rpc_from_prompt(MagicMock(spec=CallbackContext), llm_request)

    assert result is None
    _assert_rpc_removed(llm_request)


def test_callback_leaves_requests_without_rpc_unchanged() -> None:
    contents = [
        genai_types.Content(role="user", parts=[_text("hi")]),
        genai_types.Content(role="user", parts=[_part(ACTION)]),
    ]
    llm_request = LlmRequest(contents=list(contents))

    exclude_a2ui_rpc_from_prompt(MagicMock(spec=CallbackContext), llm_request)

    assert llm_request.contents == contents


@pytest.mark.asyncio
async def test_toolset_removes_rpc_parts() -> None:
    toolset = SendA2uiToClientToolset(a2ui_enabled=False, a2ui_processor=MagicMock())
    llm_request = _request()

    await toolset.process_llm_request(
        tool_context=MagicMock(spec=ToolContext), llm_request=llm_request
    )

    _assert_rpc_removed(llm_request)


class _RecordingLlm(BaseLlm):
    """Answers with fixed text and records the requests it gets."""

    requests: list[LlmRequest] = []

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.requests.append(llm_request)
        yield LlmResponse(
            content=genai_types.Content(role="model", parts=[_text("model reply")])
        )


async def _run_rpc_then_text(agent: LlmAgent) -> list[genai_types.Content]:
    """Runs an RPC turn, then a text turn; returns the session's contents."""
    runner = Runner(
        app_name="app", agent=agent, session_service=InMemorySessionService()
    )
    session = await runner.session_service.create_session(app_name="app", user_id="u")
    for content in (
        genai_types.Content(role="user", parts=[_part(CALL)]),
        genai_types.Content(role="user", parts=[_text("hello")]),
    ):
        async for _ in runner.run_async(
            user_id="u", session_id=session.id, new_message=content
        ):
            pass
    stored = await runner.session_service.get_session(
        app_name="app", user_id="u", session_id=session.id
    )
    assert stored is not None
    return [event.content for event in stored.events if event.content]


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["toolset", "callback"])
async def test_model_never_sees_rpc_turns_that_the_session_keeps(path: str) -> None:
    model = _RecordingLlm(model="recording", requests=[])
    rpc_callback = a2ui_rpc_callback(agent_functions=AgentFunctionRegistry([CATALOG]))
    if path == "toolset":
        agent = LlmAgent(
            name="agent",
            model=model,
            before_agent_callback=rpc_callback,
            tools=[
                SendA2uiToClientToolset(a2ui_enabled=False, a2ui_processor=MagicMock())
            ],
        )
    else:
        agent = LlmAgent(
            name="agent",
            model=model,
            before_agent_callback=rpc_callback,
            before_model_callback=exclude_a2ui_rpc_from_prompt,
        )

    session_contents = await _run_rpc_then_text(agent)

    # The RPC turn skipped the model; the text turn called it once.
    (llm_request,) = model.requests
    assert _a2ui_messages(llm_request.contents) == []
    assert _texts(llm_request.contents) == ["hello"]
    # The session still holds the call and its reply.
    assert _a2ui_messages(session_contents) == [CALL, REPLY]
    assert "hello" in _texts(session_contents)
