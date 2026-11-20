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

"""Tests for `A2uiInstruction`."""

from __future__ import annotations

from collections.abc import AsyncGenerator
import logging
from typing import Any
from unittest.mock import MagicMock

from google.adk.agents.llm_agent import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import InMemoryRunner
from google.genai import types as genai_types
import pytest

from a2ui.adk import A2uiInstruction, A2uiProcessorStore, SendA2uiToClientToolset
from a2ui.core import Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_format import InferenceFormatFactory
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.inference_formats.experimental.atom import AtomFormatFactory
from a2ui.inference_formats.experimental.elemental import ElementalFormatFactory
from a2ui.inference_formats.express import ExpressFormatFactory
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState

_APP = "app"
_USER = "user"

# Session state keys that the A2UI prompts could be read as templates for, if
# ADK read templates out of them.
_COLLIDING_STATE = {
    "expression": "OVERRIDDEN",
    "temp": "OVERRIDDEN",
    "change": "OVERRIDDEN",
    "XID_Start": "OVERRIDDEN",
    "XID_Continue": "OVERRIDDEN",
    "true": "OVERRIDDEN",
}

_FORMATS: list[tuple[str, InferenceFormatFactory]] = [
    ("express", ExpressFormatFactory()),
    ("direct_json", DirectJsonFormatFactory()),
    ("elemental", ElementalFormatFactory()),
    ("atom", AtomFormatFactory()),
]
_VERSIONS = ["0.8", "0.9", "1.0"]
# Elemental rejects v0.8 catalogs.
_FORMAT_VERSIONS = [
    pytest.param(factory, version, id=f"{name}-{version}")
    for name, factory in _FORMATS
    for version in _VERSIONS
    if not (name == "elemental" and version == "0.8")
]


def _catalog(version: str) -> CatalogApi:
    return BasicCatalog(version)


def _turn(catalog: CatalogApi, version: str) -> list[Any]:
    """An example turn whose text holds data bindings, as the examples do."""
    text = "${temp}° and ${change}%"
    if version == "0.8":
        messages = [
            {
                "version": "v0.8",
                "beginRendering": {"surfaceId": "s1", "root": "root"},
            },
            {
                "version": "v0.8",
                "surfaceUpdate": {
                    "surfaceId": "s1",
                    "components": [{
                        "id": "root",
                        "component": {"Text": {"text": {"literalString": text}}},
                    }],
                },
            },
        ]
    else:
        # v1.0 messages carry the version without the "v" prefix.
        wire = "1.0" if version == "1.0" else f"v{version}"
        messages = [
            {
                "version": wire,
                "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
            },
            {
                "version": wire,
                "updateComponents": {
                    "surfaceId": "s1",
                    "components": [{"id": "root", "component": "Text", "text": text}],
                },
            },
        ]
    return to_message_models(messages)


def _processor(
    version: str = "0.9",
    format_factory: InferenceFormatFactory | None = None,
    examples: bool = False,
    catalogs: list[CatalogApi] | None = None,
    state: RendererState | None = None,
) -> A2uiRequestProcessor:
    catalogs = catalogs or [_catalog(version)]
    turns = [_turn(catalogs[0], version)] if examples else None
    return A2uiRequestProcessor(
        catalogs, examples=turns, format_factory=format_factory, state=state
    )


def _inline_catalog() -> CatalogApi:
    """A client's catalog whose descriptions look like ADK state templates."""
    return Catalog.from_json(
        {
            "catalogId": "inline",
            "components": {
                "Badge": {
                    "type": "object",
                    "description": (
                        "Shows {user:secret}, {app:token} and {artifact.report}."
                    ),
                    "properties": {
                        "component": {"const": "Badge"},
                        "label": {
                            "$ref": "common_types.json#/$defs/DynamicString",
                            "description": "Label such as {temp:scratch}.",
                        },
                    },
                    "required": ["component", "label"],
                }
            },
        },
        protocol_version="0.9",
    )


class _CapturingLlm(BaseLlm):
    """A model that records each request and answers with fixed text."""

    model: str = "capturing"
    requests: list[LlmRequest] = []

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.requests.append(llm_request)
        yield LlmResponse(
            content=genai_types.Content(
                role="model", parts=[genai_types.Part(text="ok")]
            )
        )


def _system_instruction(llm_request: LlmRequest) -> str:
    """The system instruction the model got.

    ADK appends its own identity line to it, so compare with `startswith`.
    """
    instruction = llm_request.config.system_instruction
    assert isinstance(instruction, str)
    return instruction


async def _run(
    instruction: Any,
    state: dict[str, Any] | None = None,
    tools: list[Any] | None = None,
) -> LlmRequest:
    """Runs one turn of an agent and returns the request the model got."""
    llm = _CapturingLlm(requests=[])
    agent = LlmAgent(
        model=llm, name="agent", instruction=instruction, tools=tools or []
    )
    runner = InMemoryRunner(agent=agent, app_name=_APP)
    session = await runner.session_service.create_session(
        app_name=_APP, user_id=_USER, state=state or {}
    )
    async for _ in runner.run_async(
        user_id=_USER,
        session_id=session.id,
        new_message=genai_types.Content(
            role="user", parts=[genai_types.Part(text="hi")]
        ),
    ):
        pass
    assert len(llm.requests) == 1
    return llm.requests[0]


def _ctx(session_id: str = "session", state: dict[str, Any] | None = None) -> Any:
    """A readonly context with the session that `inject_session_state` reads."""
    ctx = MagicMock(spec=ReadonlyContext)
    ctx.session.id = session_id
    ctx._invocation_context = MagicMock()
    ctx._invocation_context.session.state = state or {}
    return ctx


_CTX = _ctx()


# region Runner Tests
"""End-to-end tests through ADK's runner, which reads the instruction."""


@pytest.mark.parametrize(("format_factory", "version"), _FORMAT_VERSIONS)
@pytest.mark.asyncio
async def test_runner_gets_the_prompt_snippet_as_it_is(format_factory, version):
    processor = _processor(version, format_factory, examples=True)

    llm_request = await _run(
        A2uiInstruction("Role.", a2ui_processor=processor), state=_COLLIDING_STATE
    )

    text = _system_instruction(llm_request)
    assert text.startswith(f"Role.\n\n{processor.prompt_snippet}")
    assert "OVERRIDDEN" not in text


@pytest.mark.asyncio
async def test_string_instruction_fails_as_a_template_in_the_runner():
    processor = _processor()

    with pytest.raises(KeyError, match="expression"):
        await _run(processor.prompt_snippet)


@pytest.mark.asyncio
async def test_runner_reads_state_templates_from_the_agents_instruction():
    processor = _processor()

    llm_request = await _run(
        A2uiInstruction(
            "Serve assets from {base_url} for {user_name}.",
            a2ui_processor=processor,
        ),
        state={"base_url": "http://localhost:1", "user_name": "Bob"},
    )

    assert _system_instruction(llm_request).startswith(
        "Serve assets from http://localhost:1 for Bob.\n\n"
    )


@pytest.mark.asyncio
async def test_runner_raises_for_a_missing_state_template():
    processor = _processor()

    with pytest.raises(KeyError, match="base_url"):
        await _run(A2uiInstruction("Serve from {base_url}.", a2ui_processor=processor))


@pytest.mark.asyncio
async def test_inline_catalog_descriptions_are_not_read_as_templates():
    # Direct JSON, since Express takes several catalogs only from v1.0.
    processor = _processor(
        catalogs=[_inline_catalog(), _catalog("0.9")],
        format_factory=DirectJsonFormatFactory(),
    )
    snippet = processor.prompt_snippet
    assert "{user:secret}" in snippet and "{artifact.report}" in snippet

    llm_request = await _run(
        A2uiInstruction("Role.", a2ui_processor=processor),
        state={"user:secret": "LEAKED", "app:token": "LEAKED"},
    )

    assert _system_instruction(llm_request).startswith(f"Role.\n\n{snippet}")


@pytest.mark.parametrize(
    "format_factory", [f for _, f in _FORMATS[:2]], ids=["express", "direct_json"]
)
@pytest.mark.asyncio
async def test_toolset_adds_only_its_tool_instruction_to_the_prompt(
    format_factory,
):
    processor = _processor(format_factory=format_factory, examples=True)
    toolset = SendA2uiToClientToolset(True, processor)

    llm_request = await _run(
        A2uiInstruction("Role.", a2ui_processor=processor),
        tools=[toolset],
    )

    text = _system_instruction(llm_request)
    tool_instruction = toolset._ui_tool._tool_instruction()
    prefix = f"Role.\n\n{processor.prompt_snippet}"
    assert text.startswith(prefix)
    assert text.endswith(tool_instruction)
    # Between the two there is only ADK's identity line: no rules, catalogs or
    # examples added a second time.
    between = text[len(prefix) : -len(tool_instruction)]
    assert "A2UI" not in between, between


@pytest.mark.asyncio
async def test_cloned_agent_keeps_the_instruction():
    processor = _processor()
    agent = LlmAgent(
        model=_CapturingLlm(requests=[]),
        name="agent",
        instruction=A2uiInstruction("Role.", a2ui_processor=processor),
    )

    clone = agent.clone()

    assert clone.instruction is agent.instruction
    instruction, bypass = await clone.canonical_instruction(_CTX)
    assert bypass is True
    assert instruction == f"Role.\n\n{processor.prompt_snippet}"


# endregion

# region Provider Tests
"""Tests that call the provider directly."""


@pytest.mark.asyncio
async def test_default_instruction_is_the_snippet_alone():
    processor = _processor()

    assert await A2uiInstruction(a2ui_processor=processor)(_CTX) == (
        processor.prompt_snippet
    )


@pytest.mark.asyncio
async def test_instruction_provider_is_called_and_kept_as_it_is():
    processor = _processor()

    async def provider(ctx: ReadonlyContext) -> str:
        assert ctx is _CTX
        return "Keep {this} as it is."

    text = await A2uiInstruction(provider, a2ui_processor=processor)(_CTX)

    assert text == f"Keep {{this}} as it is.\n\n{processor.prompt_snippet}"


@pytest.mark.asyncio
async def test_processor_store_provides_the_processor_per_context():
    processors = A2uiProcessorStore()
    processor = _processor()
    processors.set(_CTX.session.id, processor)
    instruction = A2uiInstruction(
        "Role.", a2ui_enabled=processors.is_enabled, a2ui_processor=processors.get
    )

    assert await instruction(_CTX) == f"Role.\n\n{processor.prompt_snippet}"
    assert await instruction(_ctx("other")) == "Role."


@pytest.mark.asyncio
async def test_async_providers_are_awaited():
    processor = _processor()

    async def enabled(_ctx: ReadonlyContext) -> bool:
        return True

    async def get(_ctx: ReadonlyContext) -> A2uiRequestProcessor:
        return processor

    instruction = A2uiInstruction("Role.", a2ui_enabled=enabled, a2ui_processor=get)

    assert await instruction(_CTX) == f"Role.\n\n{processor.prompt_snippet}"


@pytest.mark.asyncio
async def test_disabled_falls_back_to_the_instruction():
    instruction = A2uiInstruction(
        "Role.", a2ui_enabled=False, a2ui_processor=_processor()
    )

    assert await instruction(_CTX) == "Role."


@pytest.mark.asyncio
async def test_disabled_uses_the_fallback_instruction():
    async def fallback(_ctx: ReadonlyContext) -> str:
        return "Text only."

    instruction = A2uiInstruction(
        "Role.",
        a2ui_enabled=False,
        a2ui_processor=_processor(),
        fallback_instruction=fallback,
    )

    assert await instruction(_CTX) == "Text only."


@pytest.mark.asyncio
async def test_enabled_without_a_processor_raises():
    instruction = A2uiInstruction("Role.", a2ui_processor=lambda _ctx: None)

    with pytest.raises(TypeError, match="has no processor"):
        await instruction(_CTX)


def test_shared_processor_with_a_bound_state_warns(caplog):
    processor = _processor()
    state = processor.create_state()

    with caplog.at_level(logging.WARNING, logger="a2ui.adk.instruction"):
        A2uiInstruction(a2ui_processor=_processor(state=state))

    assert "every conversation shares that state" in caplog.text


# endregion
