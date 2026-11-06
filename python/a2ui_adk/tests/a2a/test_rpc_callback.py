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
    TaskState,
    TaskStatus,
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
from a2ui.core import A2uiRpcError, AgentFunction, AgentFunctionContext, CatalogApi
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


def test_needs_catalogs_or_renderer_calls() -> None:
    with pytest.raises(ValueError):
        a2ui_rpc_callback()


@pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf"), True, "1"])
def test_rejects_a_timeout_that_is_not_a_finite_positive_number(timeout: Any) -> None:
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
        _content(
            genai_types.Part.from_bytes(data=b"\x89PNG", mime_type="image/png"),
            _genai_part(_call()),
        ),
        _content(
            genai_types.Part(inline_data=genai_types.Blob(mime_type="text/plain")),
            _genai_part(_call()),
        ),
        _content(
            genai_types.Part.from_bytes(
                data=b"<a2a_datapart_json>not json</a2a_datapart_json>",
                mime_type="text/plain",
            ),
            _genai_part(_call()),
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
        "media-and-call",
        "blob-without-data-and-call",
        "malformed-tagged-data-and-call",
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
async def test_logs_a_dropped_call_without_its_payload(
    caplog: pytest.LogCaptureFixture,
) -> None:
    callback = a2ui_rpc_callback(catalogs=[CATALOG])
    malformed = {
        "version": "1.0",
        "callAgentFunction": {"surfaceId": "s1", "callFunction": "hunter2"},
    }

    with caplog.at_level("WARNING"):
        await callback(
            _callback_context(_content(_genai_part(malformed), _genai_part(_call())))
        )

    assert "Dropped an A2UI RPC message that can't be answered" in caplog.text
    assert "hunter2" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("version", [None, "v1.0"])
async def test_drops_a_call_without_the_v1_0_version(version: str | None) -> None:
    callback = a2ui_rpc_callback(catalogs=[CATALOG])
    call = _call("bad")
    if version is None:
        del call["version"]
    else:
        call["version"] = version

    content = await callback(
        _callback_context(_content(_genai_part(call), _genai_part(_call())))
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


class _SilentAgent(BaseAgent):
    """Sends nothing."""

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        return
        yield


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
async def test_renderer_function_response_settles_the_pending_call() -> None:
    store = A2uiRendererCallsStore()
    calls = store.get_for_session("session-1")
    message, result = calls.call(catalog_id=CATALOG_ID, name="getLocation")
    response = _renderer_response(message.call_renderer_function.function_call_id)
    callback = a2ui_rpc_callback(renderer_calls=store.get)

    content = await callback(_callback_context(_content(_genai_part(response))))

    assert content is not None
    assert content.parts == []
    assert await result == "Paris"


@pytest.mark.asyncio
async def test_answers_calls_and_settles_responses_together() -> None:
    store = A2uiRendererCallsStore()
    message, result = store.get_for_session("session-1").call(
        catalog_id=CATALOG_ID, name="getLocation"
    )
    response = _renderer_response(message.call_renderer_function.function_call_id)
    callback = a2ui_rpc_callback(catalogs=[CATALOG], renderer_calls=store.get)

    content = await callback(
        _callback_context(_content(_genai_part(_call()), _genai_part(response)))
    )

    assert content is not None
    assert _messages(content) == [_reply()]
    assert await result == "Paris"


@pytest.mark.asyncio
async def test_response_to_an_unknown_call_goes_to_the_agent() -> None:
    # Such as a response to a call the model wrote, which the inference
    # formats compile into callRendererFunction without RendererFunctionCalls.
    store = A2uiRendererCallsStore()
    _, result = store.get_for_session("session-1").call(
        catalog_id=CATALOG_ID, name="getLocation"
    )
    callback = a2ui_rpc_callback(renderer_calls=store.get)

    content = await callback(
        _callback_context(_content(_genai_part(_renderer_response("call_1"))))
    )

    assert content is None
    assert not result.done()
    result.cancel()


@pytest.mark.asyncio
async def test_mixed_responses_settle_the_pending_call_and_go_to_the_agent() -> None:
    store = A2uiRendererCallsStore()
    message, result = store.get_for_session("session-1").call(
        catalog_id=CATALOG_ID, name="getLocation"
    )
    pending = _renderer_response(message.call_renderer_function.function_call_id)
    callback = a2ui_rpc_callback(renderer_calls=store.get)

    content = await callback(
        _callback_context(
            _content(_genai_part(pending), _genai_part(_renderer_response("call_1")))
        )
    )

    assert content is None
    assert await result == "Paris"


@pytest.mark.asyncio
async def test_pending_response_next_to_text_settles_the_call() -> None:
    store = A2uiRendererCallsStore()
    message, result = store.get_for_session("session-1").call(
        catalog_id=CATALOG_ID, name="getLocation"
    )
    pending = _renderer_response(message.call_renderer_function.function_call_id)
    callback = a2ui_rpc_callback(renderer_calls=store.get)

    content = await callback(
        _callback_context(
            _content(genai_types.Part.from_text(text="hi"), _genai_part(pending))
        )
    )

    assert content is None
    assert await result == "Paris"


@pytest.mark.asyncio
async def test_pending_response_with_a_call_and_no_catalogs_settles_the_call() -> None:
    store = A2uiRendererCallsStore()
    message, result = store.get_for_session("session-1").call(
        catalog_id=CATALOG_ID, name="getLocation"
    )
    pending = _renderer_response(message.call_renderer_function.function_call_id)
    callback = a2ui_rpc_callback(catalogs=lambda _ctx: None, renderer_calls=store.get)

    content = await callback(
        _callback_context(_content(_genai_part(_call()), _genai_part(pending)))
    )

    assert content is None
    assert await result == "Paris"


@pytest.mark.asyncio
async def test_a_settled_call_ignores_its_response_when_it_comes_again() -> None:
    store = A2uiRendererCallsStore()
    message, result = store.get_for_session("session-1").call(
        catalog_id=CATALOG_ID, name="getLocation"
    )
    call_id = message.call_renderer_function.function_call_id
    callback = a2ui_rpc_callback(renderer_calls=store.get)
    unknown = _genai_part(_renderer_response("call_1"))

    await callback(
        _callback_context(_content(_genai_part(_renderer_response(call_id)), unknown))
    )
    again = await callback(
        _callback_context(
            _content(_genai_part(_renderer_response(call_id, "Rome")), unknown)
        )
    )

    assert again is None
    assert await result == "Paris"


@pytest.mark.asyncio
async def test_malformed_response_fails_the_pending_call() -> None:
    store = A2uiRendererCallsStore()
    message, result = store.get_for_session("session-1").call(
        catalog_id=CATALOG_ID, name="getLocation"
    )
    malformed = {
        "version": "1.0",
        "rendererFunctionResponse": {
            "functionCallId": message.call_renderer_function.function_call_id,
        },
    }
    callback = a2ui_rpc_callback(renderer_calls=store.get)

    content = await callback(_callback_context(_content(_genai_part(malformed))))

    assert content is not None
    assert content.parts == []
    with pytest.raises(A2uiRpcError) as excinfo:
        await result
    assert excinfo.value.code == "UNKNOWN_ERROR"


@pytest.mark.asyncio
async def test_calls_go_to_the_agent_without_catalogs() -> None:
    callback = a2ui_rpc_callback(renderer_calls=A2uiRendererCallsStore().get)

    assert await callback(_callback_context(_content(_genai_part(_call())))) is None


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
    response = _renderer_response(message.call_renderer_function.function_call_id)

    events = await _execute(agent, [create_a2ui_part(response)], session_id)

    assert await result == "Paris"
    assert _agent_status_parts(events) == []
    # With no reply to send, ADK's executor ends the task without a result, as
    # for any turn whose agent sends nothing.
    final = events[-1]
    assert isinstance(final, TaskStatusUpdateEvent)
    assert final.final


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
        name="agent", before_agent_callback=a2ui_rpc_callback(catalogs=[CATALOG])
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


def _request_context(task_id: str, *parts: Part) -> MagicMock:
    context = MagicMock(spec=RequestContext)
    context.task_id = task_id
    context.message = Message(
        message_id=str(uuid.uuid4()), role=Role.user, parts=list(parts)
    )
    return context


def _working_event(task_id: str) -> TaskStatusUpdateEvent:
    return TaskStatusUpdateEvent(
        task_id=task_id,
        context_id="ctx",
        status=TaskStatus(state=TaskState.working),
        final=True,
    )


@pytest.mark.asyncio
async def test_interceptor_forgets_an_rpc_request_that_never_finished() -> None:
    interceptor = a2ui_rpc_interceptor()
    assert interceptor.before_agent is not None
    assert interceptor.after_agent is not None
    rpc_part = create_a2ui_part(_renderer_response("c1"))

    # The RPC-only request fails before `after_agent` runs.
    await interceptor.before_agent(_request_context("t1", rpc_part))
    # A later request on the task that isn't RPC-only keeps its `working`.
    await interceptor.before_agent(
        _request_context("t1", Part(root=TextPart(text="hi")))
    )
    event = await interceptor.after_agent(MagicMock(), _working_event("t1"))

    assert event.status.state == TaskState.working


@pytest.mark.asyncio
async def test_interceptor_keeps_a_task_it_sees_again_past_older_ones() -> None:
    interceptor = a2ui_rpc_interceptor()
    assert interceptor.before_agent is not None
    assert interceptor.after_agent is not None
    rpc_part = create_a2ui_part(_renderer_response("c1"))

    await interceptor.before_agent(_request_context("again", rpc_part))
    # The tracker keeps 1024 tasks, so it is full after 1023 more. "again"
    # comes once more before the next ones, so they drop older tasks instead.
    for index in range(1030):
        if index == 1023:
            await interceptor.before_agent(_request_context("again", rpc_part))
        await interceptor.before_agent(_request_context(f"t{index}", rpc_part))
    event = await interceptor.after_agent(MagicMock(), _working_event("again"))

    assert event.status.state == TaskState.completed


@pytest.mark.asyncio
async def test_malformed_response_to_a_pending_call_logs_no_pass_on_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    store = A2uiRendererCallsStore()
    message, result = store.get_for_session("session-1").call(
        catalog_id=CATALOG_ID, name="getLocation"
    )
    malformed = {
        "version": "1.0",
        "rendererFunctionResponse": {
            "functionCallId": message.call_renderer_function.function_call_id,
            "secret": "hunter2",
        },
    }
    callback = a2ui_rpc_callback(renderer_calls=store.get)

    with caplog.at_level("WARNING"):
        await callback(_callback_context(_content(_genai_part(malformed))))

    assert "Passing an invalid A2UI message on to the agent" not in caplog.text
    assert "hunter2" not in caplog.text
    with pytest.raises(A2uiRpcError):
        await result


@pytest.mark.asyncio
async def test_malformed_response_to_no_pending_call_warns_without_the_payload(
    caplog: pytest.LogCaptureFixture,
) -> None:
    malformed = {
        "version": "1.0",
        "rendererFunctionResponse": {"functionCallId": "c1", "secret": "hunter2"},
    }
    callback = a2ui_rpc_callback(renderer_calls=A2uiRendererCallsStore().get)

    with caplog.at_level("WARNING"):
        content = await callback(_callback_context(_content(_genai_part(malformed))))

    assert content is None
    assert "Passing an invalid A2UI message on to the agent" in caplog.text
    assert "hunter2" not in caplog.text
