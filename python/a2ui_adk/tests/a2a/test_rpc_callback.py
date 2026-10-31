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

from collections.abc import AsyncGenerator
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
from google.adk.a2a.executor.config import ExecuteInterceptor
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events.event import Event
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types
import pytest

from a2ui.a2a import A2UI_MIME_TYPE, create_a2ui_part, get_a2ui_messages
from a2ui.adk import A2uiProcessorStore, A2uiRendererCallsStore
from a2ui.adk.a2a import (
    A2uiEventConverter,
    A2uiPartConverter,
    a2ui_rpc_callback,
    a2ui_rpc_interceptor,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.catalog import AgentFunction, AgentFunctionContext
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiRequestProcessor
from a2ui.rpc import AgentFunctionRegistry

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
CATALOG = BasicCatalog(ProtocolVersion.V1_0).copy_with(agent_functions=[FX_RATE])


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


class _SilentAgent(BaseAgent):
    """Sends nothing."""

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        return
        yield


def _texts(events: list[Event]) -> list[str]:
    return [
        part.text
        for event in events
        if event.content
        for part in event.content.parts or []
        if part.text
    ]


def test_needs_a_registry_or_renderer_calls() -> None:
    with pytest.raises(ValueError):
        a2ui_rpc_callback()


@pytest.mark.asyncio
async def test_answers_call_agent_function_as_a2ui_data() -> None:
    callback = a2ui_rpc_callback(agent_functions=AgentFunctionRegistry([CATALOG]))

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
    callback = a2ui_rpc_callback(agent_functions=AgentFunctionRegistry([CATALOG]))
    content = await callback(_callback_context(_content(_genai_part(_call()))))
    assert content is not None
    converter = A2uiPartConverter(A2uiRequestProcessor([CATALOG]))

    (a2a_part,) = converter.convert((content.parts or [])[0])

    assert get_a2ui_messages([a2a_part]) == [_reply()]


@pytest.mark.asyncio
async def test_answers_several_calls_in_order() -> None:
    callback = a2ui_rpc_callback(agent_functions=AgentFunctionRegistry([CATALOG]))

    content = await callback(
        _callback_context(
            _content(_genai_part(_call("a", "EUR")), _genai_part(_call("b", "GBP")))
        )
    )

    assert content is not None
    assert _messages(content) == [_reply("a", "EUR"), _reply("b", "GBP")]


@pytest.mark.asyncio
async def test_registry_provider_is_called_with_the_context() -> None:
    registry = AgentFunctionRegistry([CATALOG])
    seen: list[Any] = []

    async def provider(ctx: Any) -> AgentFunctionRegistry:
        seen.append(ctx)
        return registry

    callback = a2ui_rpc_callback(agent_functions=provider)
    ctx = _callback_context(_content(_genai_part(_call())))

    content = await callback(ctx)

    assert seen == [ctx]
    assert content is not None
    assert _messages(content) == [_reply()]


@pytest.mark.asyncio
async def test_lets_the_agent_run_without_a_registry() -> None:
    callback = a2ui_rpc_callback(agent_functions=lambda ctx: None)

    assert await callback(_callback_context(_content(_genai_part(_call())))) is None


@pytest.mark.asyncio
async def test_lets_the_agent_run_for_mixed_content() -> None:
    callback = a2ui_rpc_callback(agent_functions=AgentFunctionRegistry([CATALOG]))

    content = _content(genai_types.Part.from_text(text="hi"), _genai_part(_call()))

    assert await callback(_callback_context(content)) is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content",
    [
        None,
        genai_types.Content(role="user", parts=[]),
        genai_types.Content(role="user", parts=[genai_types.Part.from_text(text="hi")]),
        genai_types.Content(role="user", parts=[_genai_part(ACTION)]),
        genai_types.Content(
            role="user", parts=[_genai_part(ACTION), _genai_part(_call())]
        ),
    ],
    ids=["none", "empty", "text", "action", "action-and-call"],
)
async def test_lets_the_agent_run_for_other_content(
    content: genai_types.Content | None,
) -> None:
    callback = a2ui_rpc_callback(agent_functions=AgentFunctionRegistry([CATALOG]))

    assert await callback(_callback_context(content)) is None


@pytest.mark.asyncio
async def test_renderer_function_response_settles_the_pending_call() -> None:
    store = A2uiRendererCallsStore()
    calls = store.get_for_session("session-1")
    message, result = calls.call(catalog_id=CATALOG_ID, name="getLocation")
    response = {
        "version": "1.0",
        "rendererFunctionResponse": {
            "functionCallId": message.call_renderer_function.function_call_id,
            "value": "Paris",
        },
    }
    callback = a2ui_rpc_callback(renderer_calls=store.get)

    content = await callback(_callback_context(_content(_genai_part(response))))

    assert content is not None
    assert content.parts == []
    assert await result == "Paris"


@pytest.mark.asyncio
async def test_renderer_function_response_goes_to_the_agent_without_renderer_calls() -> (
    None
):
    callback = a2ui_rpc_callback(agent_functions=AgentFunctionRegistry([CATALOG]))
    response = {
        "version": "1.0",
        "rendererFunctionResponse": {"functionCallId": "c1", "value": 1},
    }

    assert await callback(_callback_context(_content(_genai_part(response)))) is None


@pytest.mark.asyncio
async def test_drops_a_call_without_a_function_call_id() -> None:
    callback = a2ui_rpc_callback(agent_functions=AgentFunctionRegistry([CATALOG]))
    malformed = {"version": "1.0", "callAgentFunction": {"surfaceId": "s1"}}

    content = await callback(
        _callback_context(_content(_genai_part(malformed), _genai_part(_call())))
    )

    assert content is not None
    assert _messages(content) == [_reply()]


@pytest.mark.asyncio
async def test_drops_calls_of_a_disposed_registry() -> None:
    registry = AgentFunctionRegistry([CATALOG])
    registry.dispose()
    callback = a2ui_rpc_callback(agent_functions=registry)

    content = await callback(_callback_context(_content(_genai_part(_call()))))

    assert content is not None
    assert content.parts == []


@pytest.mark.asyncio
async def test_runner_skips_the_agent_for_rpc_messages() -> None:
    agent = _StubAgent(
        name="agent",
        before_agent_callback=a2ui_rpc_callback(
            agent_functions=AgentFunctionRegistry([CATALOG])
        ),
    )

    events = await _run(agent, _content(_genai_part(_call())))

    assert AGENT_TEXT not in _texts(events)
    (event,) = [event for event in events if event.content]
    assert _messages(event.content) == [_reply()]


@pytest.mark.asyncio
async def test_runner_runs_the_agent_for_other_content() -> None:
    agent = _StubAgent(
        name="agent",
        before_agent_callback=a2ui_rpc_callback(
            agent_functions=AgentFunctionRegistry([CATALOG])
        ),
    )

    events = await _run(agent, _content(genai_types.Part.from_text(text="hi")))

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
        before_agent_callback=[
            a2ui_rpc_callback(agent_functions=AgentFunctionRegistry([CATALOG])),
            other,
        ],
    )

    rpc_events = await _run(agent, _content(_genai_part(_call())))
    assert not other_calls
    assert _messages([e for e in rpc_events if e.content][0].content) == [_reply()]

    text_events = await _run(agent, _content(genai_types.Part.from_text(text="hi")))
    assert len(other_calls) == 1
    assert _texts(text_events) == ["other callback"]


async def _execute(
    agent: BaseAgent,
    request_parts: list[Part],
    session_id: str,
    interceptors: list[ExecuteInterceptor] | None = None,
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
            event_converter=A2uiEventConverter(a2ui_processor=processors.get),
            execute_interceptors=interceptors,
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
        name="agent",
        before_agent_callback=a2ui_rpc_callback(
            agent_functions=AgentFunctionRegistry([CATALOG])
        ),
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
async def test_a2a_agent_executor_settles_a_renderer_function_call() -> None:
    session_id = str(uuid.uuid4())
    store = A2uiRendererCallsStore()
    message, result = store.get_for_session(session_id).call(
        catalog_id=CATALOG_ID, name="getLocation"
    )
    agent = _StubAgent(
        name="agent",
        before_agent_callback=a2ui_rpc_callback(renderer_calls=store.get),
    )
    response = {
        "version": "1.0",
        "rendererFunctionResponse": {
            "functionCallId": message.call_renderer_function.function_call_id,
            "value": "Paris",
        },
    }

    events = await _execute(agent, [create_a2ui_part(response)], session_id)

    assert await result == "Paris"
    assert _agent_status_parts(events) == []
    # With no reply to send, ADK's executor ends the task without a result, as
    # for any turn whose agent sends nothing.
    final = events[-1]
    assert isinstance(final, TaskStatusUpdateEvent)
    assert final.final


def _renderer_response(call_id: str, value: Any = "Paris") -> dict[str, Any]:
    return {
        "version": "1.0",
        "rendererFunctionResponse": {"functionCallId": call_id, "value": value},
    }


def _final_state(events: list[Any]) -> str:
    final = events[-1]
    assert isinstance(final, TaskStatusUpdateEvent)
    assert final.final
    return final.status.state


@pytest.mark.asyncio
async def test_interceptor_completes_an_rpc_only_task() -> None:
    session_id = str(uuid.uuid4())
    store = A2uiRendererCallsStore()
    message, result = store.get_for_session(session_id).call(
        catalog_id=CATALOG_ID, name="getLocation"
    )
    agent = _StubAgent(
        name="agent",
        before_agent_callback=a2ui_rpc_callback(renderer_calls=store.get),
    )
    response = _renderer_response(message.call_renderer_function.function_call_id)

    events = await _execute(
        agent, [create_a2ui_part(response)], session_id, [a2ui_rpc_interceptor()]
    )

    assert await result == "Paris"
    assert _final_state(events) == "completed"
    assert _agent_status_parts(events) == []


@pytest.mark.asyncio
async def test_interceptor_leaves_a_task_with_a_result_unchanged() -> None:
    agent = _StubAgent(
        name="agent",
        before_agent_callback=a2ui_rpc_callback(
            agent_functions=AgentFunctionRegistry([CATALOG])
        ),
    )

    events = await _execute(
        agent,
        [create_a2ui_part(_call())],
        str(uuid.uuid4()),
        [a2ui_rpc_interceptor()],
    )

    assert get_a2ui_messages(_agent_status_parts(events)) == [_reply()]
    assert _final_state(events) == "completed"


@pytest.mark.asyncio
async def test_interceptor_leaves_other_requests_unchanged() -> None:
    interceptor = a2ui_rpc_interceptor()
    callback = a2ui_rpc_callback(renderer_calls=A2uiRendererCallsStore().get)

    # A text request whose agent sends nothing stays `working`, as ADK reports.
    text_events = await _execute(
        _SilentAgent(name="agent", before_agent_callback=callback),
        [Part(root=TextPart(text="hi"))],
        str(uuid.uuid4()),
        [interceptor],
    )
    assert _final_state(text_events) == "working"

    # So does a request that mixes text and an RPC message, which the agent
    # handles.
    mixed_events = await _execute(
        _SilentAgent(name="agent", before_agent_callback=callback),
        [Part(root=TextPart(text="hi")), create_a2ui_part(_renderer_response("c1"))],
        str(uuid.uuid4()),
        [interceptor],
    )
    assert _final_state(mixed_events) == "working"

    # A normal turn with a reply completes as usual.
    normal_events = await _execute(
        _StubAgent(name="agent", before_agent_callback=callback),
        [Part(root=TextPart(text="hi"))],
        str(uuid.uuid4()),
        [interceptor],
    )
    assert _final_state(normal_events) == "completed"
    assert [
        part.root.text
        for part in _agent_status_parts(normal_events)
        if isinstance(part.root, TextPart)
    ] == [AGENT_TEXT]


@pytest.mark.asyncio
async def test_interceptor_leaves_a_failed_rpc_task_unchanged() -> None:
    session_id = str(uuid.uuid4())

    def failing_provider(ctx: Any) -> Any:
        raise RuntimeError("no calls")

    agent = _StubAgent(
        name="agent",
        before_agent_callback=a2ui_rpc_callback(renderer_calls=failing_provider),
    )

    events = await _execute(
        agent,
        [create_a2ui_part(_renderer_response("c1"))],
        session_id,
        [a2ui_rpc_interceptor()],
    )

    assert _final_state(events) == "failed"
