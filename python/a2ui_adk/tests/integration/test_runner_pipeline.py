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

"""In-process integration tests for the ADK runner and A2A executor pipeline."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

from a2a.server.agent_execution import RequestContext
from a2a.server.events import Event as A2AEvent
from a2a.server.events.event_queue import EventQueue
from a2a.types import DataPart, Message, MessageSendParams, Part, Role, TaskState, TaskStatusUpdateEvent, TextPart
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor
from google.adk.a2a.executor.config import A2aAgentExecutorConfig
from google.adk.agents.llm_agent import LlmAgent
from google.adk.events.event import Event
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import InMemoryRunner
from google.genai import types as genai_types
import pytest

from a2ui.a2a import A2UI_MIME_TYPE, DEPRECATED_A2UI_MIME_TYPE, is_a2ui_part
from a2ui.adk import A2uiEventConverter, A2uiInstruction, SendA2uiToClientToolset
from a2ui.constants import A2UI_TOOL_ERROR_KEY, A2UI_TOOL_NAME, A2UI_VALIDATED_JSON_KEY
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState

from .scripted_llm import ScriptedLlm, make_function_call_response, make_text_response

_APP = "integration_app"
_USER = "integration_user"
_PAYLOAD_ARG = SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_PAYLOAD_ARG_NAME


def _wire_version(version: str) -> str:
    return "1.0" if version == "1.0" else f"v{version}"


def _sample_messages(
    version: str, catalog_id: str, surface_id: str = "s1", text: str = "Hello"
) -> list[dict[str, Any]]:
    wire = _wire_version(version)
    return [
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


def _direct_json_processor(
    version: str,
    *,
    examples: bool = False,
    state: RendererState | None = None,
) -> tuple[str, A2uiRequestProcessor]:
    catalog = BasicCatalog(version)
    example_turns = (
        [to_message_models(_sample_messages(version, catalog.catalog_id))]
        if examples
        else None
    )
    processor = A2uiRequestProcessor(
        [catalog],
        examples=example_turns,
        format_factory=DirectJsonFormatFactory(),
        state=state,
    )
    return catalog.catalog_id, processor


def _system_instruction_text(llm_request: LlmRequest) -> str:
    assert llm_request.config is not None
    instruction = llm_request.config.system_instruction
    assert isinstance(instruction, str)
    return instruction


async def _run_agent_turn(
    agent: LlmAgent, message_text: str = "Render UI"
) -> list[Event]:
    runner = InMemoryRunner(agent=agent, app_name=_APP)
    session = await runner.session_service.create_session(app_name=_APP, user_id=_USER)
    events: list[Event] = []
    async for event in runner.run_async(
        user_id=_USER,
        session_id=session.id,
        new_message=genai_types.Content(
            role="user", parts=[genai_types.Part(text=message_text)]
        ),
    ):
        events.append(event)
    return events


async def _drain_queue(event_queue: EventQueue) -> list[A2AEvent]:
    events: list[A2AEvent] = []
    while not event_queue.queue.empty():
        events.append(await event_queue.dequeue_event(no_wait=True))
    return events


def _make_a2a_request_context(
    text: str = "Render UI",
    *,
    message_id: str = "msg-1",
    context_id: str | None = None,
) -> RequestContext:
    return RequestContext(
        request=MessageSendParams(
            message=Message(
                message_id=message_id,
                role=Role.user,
                parts=[Part(root=TextPart(text=text))],
            )
        ),
        context_id=context_id,
    )


# region Part 1: InMemoryRunner + SendA2uiToClientToolset


@pytest.mark.parametrize("version", ["0.9", "1.0"], ids=["v0.9", "1.0"])
@pytest.mark.asyncio
async def test_runner_includes_processor_prompt_snippet_once(
    version: str,
) -> None:
    _, processor = _direct_json_processor(version, examples=True)
    toolset = SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=processor)
    llm = ScriptedLlm(responses=[make_text_response("Ready.")])
    agent = LlmAgent(
        model=llm,
        name="ui_agent",
        instruction=A2uiInstruction(
            "You are a UI assistant.", a2ui_processor=processor
        ),
        tools=[toolset],
    )

    await _run_agent_turn(agent)

    assert len(llm.requests) == 1
    system_instruction = _system_instruction_text(llm.requests[0])
    assert system_instruction.count(processor.prompt_snippet) == 1
    tool_instruction = toolset._ui_tool._tool_instruction()
    assert system_instruction.count(tool_instruction) == 1
    prefix = f"You are a UI assistant.\n\n{processor.prompt_snippet}"
    assert system_instruction.startswith(prefix)
    assert system_instruction.endswith(tool_instruction)
    between = system_instruction[len(prefix) : -len(tool_instruction)]
    assert "A2UI" not in between


@pytest.mark.parametrize("version", ["0.9", "1.0"], ids=["v0.9", "1.0"])
@pytest.mark.asyncio
async def test_runner_valid_send_a2ui_tool_call_returns_validated_messages(
    version: str,
) -> None:
    catalog_id, processor = _direct_json_processor(version)
    expected_messages = _sample_messages(
        version, catalog_id, surface_id="card_1", text="Confirmed"
    )
    toolset = SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=processor)
    llm = ScriptedLlm(
        responses=[
            make_function_call_response(
                A2UI_TOOL_NAME,
                {_PAYLOAD_ARG: json.dumps(expected_messages)},
            )
        ]
    )
    agent = LlmAgent(
        model=llm,
        name="ui_agent",
        instruction=A2uiInstruction("Role.", a2ui_processor=processor),
        tools=[toolset],
    )

    events = await _run_agent_turn(agent)

    # skip_summarization prevents a second LLM round-trip after a valid UI tool call.
    assert len(llm.requests) == 1
    function_responses = [
        fr for event in events for fr in event.get_function_responses()
    ]
    assert len(function_responses) == 1
    assert function_responses[0].name == A2UI_TOOL_NAME
    assert function_responses[0].response == {
        A2UI_VALIDATED_JSON_KEY: expected_messages
    }


@pytest.mark.parametrize("version", ["0.9", "1.0"], ids=["v0.9", "1.0"])
@pytest.mark.asyncio
async def test_runner_invalid_send_a2ui_tool_call_feeds_error_to_second_request(
    version: str,
) -> None:
    catalog_id, processor = _direct_json_processor(version)
    wire = _wire_version(version)
    invalid_messages = [
        {
            "version": wire,
            "createSurface": {
                "surfaceId": "bad_surface",
                "catalogId": catalog_id,
            },
        },
        {
            "version": wire,
            "updateComponents": {
                "surfaceId": "bad_surface",
                # Missing required 'text' property on Text component.
                "components": [{"id": "root", "component": "Text"}],
            },
        },
    ]
    valid_messages = _sample_messages(
        version, catalog_id, surface_id="good_surface", text="Fixed"
    )
    toolset = SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=processor)
    llm = ScriptedLlm(
        responses=[
            make_function_call_response(
                A2UI_TOOL_NAME,
                {_PAYLOAD_ARG: json.dumps(invalid_messages)},
            ),
            make_function_call_response(
                A2UI_TOOL_NAME,
                {_PAYLOAD_ARG: json.dumps(valid_messages)},
            ),
        ]
    )
    agent = LlmAgent(
        model=llm,
        name="ui_agent",
        instruction=A2uiInstruction("Role.", a2ui_processor=processor),
        tools=[toolset],
    )

    events = await _run_agent_turn(agent)

    assert len(llm.requests) == 2
    second_request_responses = [
        part.function_response
        for content in llm.requests[1].contents
        if content.parts
        for part in content.parts
        if part.function_response is not None
    ]
    assert len(second_request_responses) == 1
    first_tool_output = second_request_responses[0].response
    assert isinstance(first_tool_output, dict)
    assert A2UI_TOOL_ERROR_KEY in first_tool_output
    assert (
        f"Failed to call A2UI tool {A2UI_TOOL_NAME}"
        in first_tool_output[A2UI_TOOL_ERROR_KEY]
    )
    assert "'text' is a required property" in first_tool_output[A2UI_TOOL_ERROR_KEY]

    all_function_responses = [
        fr for event in events for fr in event.get_function_responses()
    ]
    assert len(all_function_responses) == 2
    assert all_function_responses[1].response == {
        A2UI_VALIDATED_JSON_KEY: valid_messages
    }


# endregion

# region Part 2: A2aAgentExecutor + A2uiEventConverter + EventQueue


@pytest.mark.parametrize(
    ("version", "expected_mime"),
    [
        ("0.9", DEPRECATED_A2UI_MIME_TYPE),
        ("0.9.1", A2UI_MIME_TYPE),
        ("1.0", A2UI_MIME_TYPE),
    ],
    ids=["v0.9", "v0.9.1", "1.0"],
)
@pytest.mark.asyncio
async def test_executor_streams_partial_a2ui_json_chunks_in_emission_order(
    version: str, expected_mime: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog_id, processor = _direct_json_processor(version)
    messages = _sample_messages(
        version, catalog_id, surface_id="stream_s1", text="Streamed"
    )
    chunk_1 = f"<a2ui-json>[{json.dumps(messages[0])}"
    chunk_2 = f", {json.dumps(messages[1])}]</a2ui-json>"
    full_text = chunk_1 + chunk_2

    open_stream_spy = MagicMock(wraps=processor.open_stream)
    monkeypatch.setattr(processor, "open_stream", open_stream_spy)

    llm = ScriptedLlm(
        responses=[
            [
                make_text_response(chunk_1, partial=True),
                make_text_response(chunk_2, partial=True),
                make_text_response(full_text, partial=False),
            ],
            [
                make_text_response(chunk_1, partial=True),
                make_text_response(chunk_2, partial=True),
                make_text_response(full_text, partial=False),
            ],
        ]
    )
    agent = LlmAgent(model=llm, name="stream_agent")
    runner = InMemoryRunner(agent=agent, app_name=_APP)
    converter = A2uiEventConverter(a2ui_processor=processor)
    executor = A2aAgentExecutor(
        runner=runner,
        config=A2aAgentExecutorConfig(event_converter=converter),
    )

    queue_1 = EventQueue()
    await executor.execute(
        _make_a2a_request_context("first turn", message_id="m1"),
        queue_1,
    )
    events_1 = await _drain_queue(queue_1)

    # Exactly one stream was opened for the first invocation and closed on completion.
    assert open_stream_spy.call_count == 1
    assert converter._streams == {}

    status_updates = [
        event for event in events_1 if isinstance(event, TaskStatusUpdateEvent)
    ]
    a2ui_data_parts: list[DataPart] = []
    for event in status_updates:
        if event.status.message and event.status.message.parts:
            for part in event.status.message.parts:
                if is_a2ui_part(part) and isinstance(part.root, DataPart):
                    assert part.root.metadata is not None
                    assert part.root.metadata.get("mimeType") == expected_mime
                    a2ui_data_parts.append(part.root)

    assert [dp.data for dp in a2ui_data_parts] == messages
    assert status_updates[-1].final is True
    assert status_updates[-1].status.state == TaskState.completed

    # A second invocation opens a separate stream for that invocation.
    queue_2 = EventQueue()
    await executor.execute(
        _make_a2a_request_context("second turn", message_id="m2"),
        queue_2,
    )
    await _drain_queue(queue_2)
    assert open_stream_spy.call_count == 2
    assert converter._streams == {}


@pytest.mark.parametrize("version", ["0.9", "1.0"], ids=["v0.9", "1.0"])
@pytest.mark.asyncio
async def test_executor_rejected_a2ui_json_block_terminates_in_failed_state(
    version: str,
) -> None:
    catalog_id, processor = _direct_json_processor(version)
    wire = _wire_version(version)
    rejected_messages = [
        {
            "version": wire,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": catalog_id,
            },
        },
        {
            "version": wire,
            "updateComponents": {
                "surfaceId": "s1",
                # References a child component 'dangling_child' that does not exist.
                "components": [{
                    "id": "root",
                    "component": "Column",
                    "children": ["dangling_child"],
                }],
            },
        },
    ]
    rejected_block = f"<a2ui-json>{json.dumps(rejected_messages)}</a2ui-json>"

    llm = ScriptedLlm(
        responses=[[
            make_text_response(rejected_block, partial=True),
            LlmResponse(
                partial=False,
                error_code="A2UI_VALIDATION_FAILED",
                error_message="Rejected A2UI block",
            ),
        ]]
    )
    agent = LlmAgent(model=llm, name="stream_agent")
    runner = InMemoryRunner(agent=agent, app_name=_APP)
    converter = A2uiEventConverter(a2ui_processor=processor)
    executor = A2aAgentExecutor(
        runner=runner,
        config=A2aAgentExecutorConfig(event_converter=converter),
    )

    queue = EventQueue()
    await executor.execute(_make_a2a_request_context("fail turn"), queue)
    events = await _drain_queue(queue)

    status_updates = [
        event for event in events if isinstance(event, TaskStatusUpdateEvent)
    ]
    emitted_a2ui_parts = [
        part
        for event in status_updates
        if event.status.message and event.status.message.parts
        for part in event.status.message.parts
        if is_a2ui_part(part)
    ]
    assert emitted_a2ui_parts == []
    assert converter._streams == {}
    assert status_updates[-1].final is True
    assert status_updates[-1].status.state == TaskState.failed


# endregion
