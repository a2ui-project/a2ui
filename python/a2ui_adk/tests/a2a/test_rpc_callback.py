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

"""Tests for a2ui_rpc_callback, run through ADK's own converters and runner.

No model is called: the agent is a stub that answers with fixed text, so a
test can tell whether it ran.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Iterator
from typing import Any
from unittest.mock import MagicMock
import uuid

from a2a.server.agent_execution import RequestContext
from a2a.server.events import EventQueue
from a2a.types import (
    DataPart,
    Message,
    MessageSendParams,
    Part,
    Role,
    TaskArtifactUpdateEvent,
    TaskStatusUpdateEvent,
    TextPart,
)
from google.adk.a2a.converters import part_converter
from google.adk.a2a.executor.a2a_agent_executor import (
    A2aAgentExecutor,
    A2aAgentExecutorConfig,
)
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events.event import Event
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types
import pytest

from a2ui.a2a import A2UI_MIME_TYPE, create_a2ui_part, get_a2ui_messages
from a2ui.adk import A2uiProcessorStore
from a2ui.adk.a2a import A2uiEventConverter, A2uiPartConverter, a2ui_rpc_callback
from a2ui.core import AgentFunction, AgentFunctionContext, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiRequestProcessor

CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
AGENT_TEXT = "the agent ran"


async def _fetch_fx_rate(args: dict[str, Any], context: AgentFunctionContext) -> str:
    return f"1 {args['base']} = 1.1 {args['target']}"


FX_RATE = AgentFunction(
    "fetchFxRate",
    handler=_fetch_fx_rate,
    return_type="string",
    schema={
        "type": "object",
        "properties": {
            "base": {"type": "string"},
            "target": {"type": "string", "default": "USD"},
        },
        "required": ["base"],
        "additionalProperties": False,
    },
)


async def _never_returns(args: dict[str, Any]) -> str:
    await asyncio.Event().wait()
    return "unreachable"


SLOW = AgentFunction("slow", handler=_never_returns, return_type="string")
CATALOG = BasicCatalog(ProtocolVersion.V1_0).copy_with(agent_functions=[FX_RATE, SLOW])


def _call(call_id: str = "call-1", base: str = "EUR") -> dict[str, Any]:
    return {
        "version": "1.0",
        "callAgentFunction": {
            "functionCallId": call_id,
            "surfaceId": "s1",
            "callFunction": {
                "@call": "fetchFxRate",
                "catalogId": CATALOG_ID,
                "args": {"base": base},
            },
        },
    }


def _reply(call_id: str = "call-1", base: str = "EUR") -> dict[str, Any]:
    return {
        "version": "1.0",
        "agentFunctionResponse": {
            "functionCallId": call_id,
            "value": f"1 {base} = 1.1 USD",
        },
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


def _genai_part(message: dict[str, Any]) -> genai_types.Part:
    """Converts an A2UI message the way `A2aAgentExecutor` converts a request."""
    genai_part = part_converter.convert_a2a_part_to_genai_part(
        create_a2ui_part(message)
    )
    assert genai_part is not None
    return genai_part


def _content(*parts: genai_types.Part) -> genai_types.Content:
    return genai_types.Content(role="user", parts=list(parts))


def _callback_context(
    content: genai_types.Content | None, session_id: str = "session-1"
) -> MagicMock:
    ctx = MagicMock(spec=CallbackContext)
    ctx.user_content = content
    ctx.session.id = session_id
    return ctx


def _messages(content: genai_types.Content) -> list[dict[str, Any]]:
    """The A2UI messages in content, read back with ADK's converter."""
    a2a_parts = [
        part_converter.convert_genai_part_to_a2a_part(part)
        for part in content.parts or []
    ]
    assert all(part is not None for part in a2a_parts)
    return get_a2ui_messages([part for part in a2a_parts if part is not None])


class _StubAgent(BaseAgent):
    """Answers every turn with fixed text."""

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            content=genai_types.Content(
                role="model", parts=[genai_types.Part.from_text(text=AGENT_TEXT)]
            ),
        )


async def _run(agent: BaseAgent, content: genai_types.Content) -> list[Event]:
    """Runs one turn through ADK's runner, as the executor does."""
    runner = Runner(
        app_name="app", agent=agent, session_service=InMemorySessionService()
    )
    session = await runner.session_service.create_session(app_name="app", user_id="u")
    return [
        event
        async for event in runner.run_async(
            user_id="u", session_id=session.id, new_message=content
        )
    ]


def _texts(events: list[Event]) -> list[str]:
    return [
        part.text
        for event in events
        if event.content
        for part in event.content.parts or []
        if part.text
    ]


def _error_code(message: dict[str, Any]) -> str:
    return message["agentFunctionResponse"]["error"]["code"]


RENDERER_FUNCTION_RESPONSE = {
    "version": "1.0",
    "rendererFunctionResponse": {"functionCallId": "c1", "value": "Paris"},
}
ERROR = {
    "version": "1.0",
    "error": {"code": "VALIDATION_FAILED", "surfaceId": "s1", "message": "bad"},
}


@pytest.mark.parametrize("timeout", [0, -1])
def test_rejects_a_timeout_that_is_not_positive(timeout: float) -> None:
    with pytest.raises(ValueError):
        a2ui_rpc_callback(catalogs=[CATALOG], agent_function_timeout=timeout)


@pytest.mark.asyncio
async def test_answers_call_agent_function_as_a2ui_data() -> None:
    callback = a2ui_rpc_callback(catalogs=[CATALOG])

    content = await callback(_callback_context(_content(_genai_part(_call()))))

    assert content is not None
    assert content.role == "model"
    (part,) = content.parts or []
    a2a_part = part_converter.convert_genai_part_to_a2a_part(part)
    assert a2a_part is not None
    assert isinstance(a2a_part.root, DataPart)
    assert a2a_part.root.metadata == {"mimeType": A2UI_MIME_TYPE}
    assert a2a_part.root.data == _reply()


@pytest.mark.asyncio
async def test_reply_converts_to_a2ui_data_through_a2ui_part_converter() -> None:
    callback = a2ui_rpc_callback(catalogs=[CATALOG])
    content = await callback(_callback_context(_content(_genai_part(_call()))))
    assert content is not None
    converter = A2uiPartConverter(A2uiRequestProcessor([CATALOG]))

    (a2a_part,) = converter.convert((content.parts or [])[0])

    assert get_a2ui_messages([a2a_part]) == [_reply()]


@pytest.mark.asyncio
async def test_answers_several_calls_in_order() -> None:
    callback = a2ui_rpc_callback(catalogs=[CATALOG])

    content = await callback(
        _callback_context(
            _content(_genai_part(_call("a", "EUR")), _genai_part(_call("b", "GBP")))
        )
    )

    assert content is not None
    assert _messages(content) == [_reply("a", "EUR"), _reply("b", "GBP")]


@pytest.mark.asyncio
async def test_reads_an_iterable_of_catalogs_once() -> None:
    def catalogs() -> Iterator[CatalogApi]:
        yield CATALOG

    callback = a2ui_rpc_callback(catalogs=catalogs())

    for call_id in ("a", "b"):
        content = await callback(
            _callback_context(_content(_genai_part(_call(call_id))))
        )
        assert content is not None
        assert _messages(content) == [_reply(call_id)]


@pytest.mark.asyncio
async def test_async_catalogs_provider_is_called_with_the_context() -> None:
    seen: list[Any] = []

    async def provider(ctx: Any) -> list[CatalogApi]:
        seen.append(ctx)
        return [CATALOG]

    callback = a2ui_rpc_callback(catalogs=provider)
    ctx = _callback_context(_content(_genai_part(_call())))

    content = await callback(ctx)

    assert seen == [ctx]
    assert content is not None
    assert _messages(content) == [_reply()]


@pytest.mark.asyncio
async def test_reads_the_active_catalogs_of_the_session_processor() -> None:
    processors = A2uiProcessorStore()
    processors.set("session-1", A2uiRequestProcessor([CATALOG]))

    def active_catalogs(ctx: Any) -> list[CatalogApi] | None:
        processor = processors.get(ctx)
        return processor.active_catalogs if processor else None

    callback = a2ui_rpc_callback(catalogs=active_catalogs)

    content = await callback(_callback_context(_content(_genai_part(_call()))))
    assert content is not None
    assert _messages(content) == [_reply()]
    # A session without a processor has no catalogs, so the agent runs.
    other_session = _callback_context(_content(_genai_part(_call())), "session-2")
    assert await callback(other_session) is None


@pytest.mark.asyncio
async def test_lets_the_agent_run_without_catalogs() -> None:
    callback = a2ui_rpc_callback(catalogs=lambda ctx: None)

    assert await callback(_callback_context(_content(_genai_part(_call())))) is None


@pytest.mark.asyncio
async def test_does_not_resolve_catalogs_for_other_content() -> None:
    def provider(ctx: Any) -> list[CatalogApi]:
        raise AssertionError("not needed")

    callback = a2ui_rpc_callback(catalogs=provider)

    content = _content(genai_types.Part.from_text(text="hi"))
    assert await callback(_callback_context(content)) is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content",
    [
        None,
        genai_types.Content(role="user", parts=[]),
        genai_types.Content(role="user", parts=[genai_types.Part.from_text(text="hi")]),
        genai_types.Content(
            role="user",
            parts=[genai_types.Part.from_text(text="hi"), _genai_part(_call())],
        ),
        genai_types.Content(role="user", parts=[_genai_part(ACTION)]),
        genai_types.Content(role="user", parts=[_genai_part(ERROR)]),
        genai_types.Content(
            role="user", parts=[_genai_part(RENDERER_FUNCTION_RESPONSE)]
        ),
        genai_types.Content(
            role="user", parts=[_genai_part(ACTION), _genai_part(_call())]
        ),
        genai_types.Content(
            role="user",
            parts=[_genai_part(RENDERER_FUNCTION_RESPONSE), _genai_part(_call())],
        ),
    ],
    ids=[
        "none",
        "empty",
        "text",
        "text-and-call",
        "action",
        "error",
        "renderer-function-response",
        "action-and-call",
        "renderer-function-response-and-call",
    ],
)
async def test_lets_the_agent_run_for_other_content(
    content: genai_types.Content | None,
) -> None:
    callback = a2ui_rpc_callback(catalogs=[CATALOG])

    assert await callback(_callback_context(content)) is None


@pytest.mark.asyncio
async def test_drops_a_call_without_a_function_call_id() -> None:
    callback = a2ui_rpc_callback(catalogs=[CATALOG])
    malformed = {"version": "1.0", "callAgentFunction": {"surfaceId": "s1"}}

    content = await callback(
        _callback_context(_content(_genai_part(malformed), _genai_part(_call())))
    )

    assert content is not None
    assert _messages(content) == [_reply()]


@pytest.mark.asyncio
async def test_answers_a_call_with_an_empty_surface_id_with_an_error() -> None:
    callback = a2ui_rpc_callback(catalogs=[CATALOG])
    call = _call()
    call["callAgentFunction"]["surfaceId"] = ""

    content = await callback(_callback_context(_content(_genai_part(call))))

    assert content is not None
    (reply,) = _messages(content)
    assert reply["agentFunctionResponse"]["functionCallId"] == "call-1"
    assert _error_code(reply) == "INVALID_FUNCTION_CALL"


@pytest.mark.asyncio
async def test_answers_an_unknown_function_with_an_error() -> None:
    callback = a2ui_rpc_callback(catalogs=[CATALOG])
    call = _call()
    call["callAgentFunction"]["callFunction"]["@call"] = "nope"

    content = await callback(_callback_context(_content(_genai_part(call))))

    assert content is not None
    (reply,) = _messages(content)
    assert _error_code(reply) == "UNKNOWN_FUNCTION"


@pytest.mark.asyncio
async def test_agent_function_timeout_ends_a_slow_call() -> None:
    callback = a2ui_rpc_callback(catalogs=[CATALOG], agent_function_timeout=0.01)
    call = _call()
    call["callAgentFunction"]["callFunction"] = {
        "@call": "slow",
        "catalogId": CATALOG_ID,
        "args": {},
    }

    content = await callback(_callback_context(_content(_genai_part(call))))

    assert content is not None
    (reply,) = _messages(content)
    assert _error_code(reply) == "EXECUTION_ERROR"


@pytest.mark.asyncio
async def test_runner_skips_the_agent_for_agent_function_calls() -> None:
    agent = _StubAgent(
        name="agent", before_agent_callback=a2ui_rpc_callback(catalogs=[CATALOG])
    )

    events = await _run(agent, _content(_genai_part(_call())))

    assert AGENT_TEXT not in _texts(events)
    (event,) = [event for event in events if event.content]
    assert _messages(event.content) == [_reply()]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content",
    [
        _content(genai_types.Part.from_text(text="hi")),
        _content(_genai_part(ACTION)),
        _content(_genai_part(RENDERER_FUNCTION_RESPONSE)),
    ],
    ids=["text", "action", "renderer-function-response"],
)
async def test_runner_runs_the_agent_for_other_content(
    content: genai_types.Content,
) -> None:
    agent = _StubAgent(
        name="agent", before_agent_callback=a2ui_rpc_callback(catalogs=[CATALOG])
    )

    events = await _run(agent, content)

    assert _texts(events) == [AGENT_TEXT]


@pytest.mark.asyncio
async def test_composes_with_another_callback_in_a_list() -> None:
    other_calls: list[Any] = []

    def other(callback_context: CallbackContext) -> genai_types.Content:
        other_calls.append(callback_context)
        return genai_types.Content(
            role="model", parts=[genai_types.Part.from_text(text="other callback")]
        )

    agent = _StubAgent(
        name="agent",
        before_agent_callback=[a2ui_rpc_callback(catalogs=[CATALOG]), other],
    )

    rpc_events = await _run(agent, _content(_genai_part(_call())))
    assert not other_calls
    assert _messages([e for e in rpc_events if e.content][0].content) == [_reply()]

    text_events = await _run(agent, _content(genai_types.Part.from_text(text="hi")))
    assert len(other_calls) == 1
    assert _texts(text_events) == ["other callback"]


async def _execute(
    agent: BaseAgent, request_parts: list[Part], session_id: str
) -> list[Any]:
    """Runs one A2A request through ADK's `A2aAgentExecutor`.

    The executor uses `A2uiEventConverter`, and the A2A context ID is the ADK
    session ID.
    """
    processors = A2uiProcessorStore()
    processors.set(session_id, A2uiRequestProcessor([CATALOG]))
    runner = Runner(
        app_name="app", agent=agent, session_service=InMemorySessionService()
    )
    executor = A2aAgentExecutor(
        runner=runner,
        config=A2aAgentExecutorConfig(
            event_converter=A2uiEventConverter(a2ui_processor=processors.get)
        ),
    )
    request = RequestContext(
        request=MessageSendParams(
            message=Message(
                message_id=str(uuid.uuid4()),
                role=Role.user,
                parts=request_parts,
                context_id=session_id,
            )
        ),
        task_id=str(uuid.uuid4()),
        context_id=session_id,
    )
    queue = EventQueue()
    await executor.execute(request, queue)
    events = []
    while not queue.queue.empty():
        events.append(await queue.dequeue_event(no_wait=True))
    return events


def _agent_status_parts(events: list[Any]) -> list[Any]:
    return [
        part
        for event in events
        if isinstance(event, TaskStatusUpdateEvent)
        and event.status.message is not None
        and event.status.message.role == Role.agent
        for part in event.status.message.parts
    ]


def _assert_completed(events: list[Any]) -> None:
    final = events[-1]
    assert isinstance(final, TaskStatusUpdateEvent)
    assert final.final
    assert final.status.state == "completed"


@pytest.mark.asyncio
async def test_a2a_agent_executor_sends_the_reply_as_an_a2ui_part() -> None:
    agent = _StubAgent(
        name="agent", before_agent_callback=a2ui_rpc_callback(catalogs=[CATALOG])
    )

    events = await _execute(agent, [create_a2ui_part(_call())], str(uuid.uuid4()))

    # The reply goes out in the working status update, from the agent, and
    # again as the task's artifact.
    status_parts = _agent_status_parts(events)
    artifact_parts = [
        part
        for event in events
        if isinstance(event, TaskArtifactUpdateEvent)
        for part in event.artifact.parts
    ]
    assert get_a2ui_messages(status_parts) == [_reply()]
    assert get_a2ui_messages(artifact_parts) == [_reply()]
    assert all(
        not isinstance(part.root, TextPart) for part in status_parts + artifact_parts
    )
    _assert_completed(events)


@pytest.mark.asyncio
async def test_a2a_agent_executor_passes_a_renderer_function_response_to_the_agent() -> (
    None
):
    agent = _StubAgent(
        name="agent", before_agent_callback=a2ui_rpc_callback(catalogs=[CATALOG])
    )

    events = await _execute(
        agent, [create_a2ui_part(RENDERER_FUNCTION_RESPONSE)], str(uuid.uuid4())
    )

    assert [
        part.root.text
        for part in _agent_status_parts(events)
        if isinstance(part.root, TextPart)
    ] == [AGENT_TEXT]
    _assert_completed(events)
