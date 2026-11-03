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

"""One payload that uses an agent function, checked by the agent and a renderer.

The agent's copy of the basic catalog declares the agent function and the
renderer's copy doesn't. The agent validates the model's output, and the same
messages then go into an `a2ui_core` `MessageProcessor` under the default
config, under strict validation, and under strict validation with a
schema-only declaration of the function. Where the renderer accepts them, its
`callAgentFunction` goes back through the agent's router and the response
reaches the bound value.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
import warnings

import pytest

from a2ui.core import (
    STRICT_VALIDATION,
    A2uiValidationError,
    DataContext,
    MessageProcessor,
    MessageProcessorOptions,
    ValidationConfig,
)
from a2ui.core.basic_catalog.v1_0 import BasicCatalog
from a2ui.core.catalog import (
    AgentFunction,
    AgentFunctionContext,
    Catalog,
    CatalogApi,
    FunctionApi,
)
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.parser import A2uiPart
from a2ui.processor import A2uiRequestProcessor
from a2ui.rpc import AgentFunctionRegistry, RendererMessageRouter
from a2ui.utils import validate_payload

FX_RATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "base": {"type": "string"},
        "target": {"type": "string", "default": "USD"},
    },
    "required": ["base"],
    "additionalProperties": False,
}

EXPRESS_RESPONSE = (
    '<a2ui>\nsurface("s1")\nroot = Text(fetchFxRate(base="EUR"))\n</a2ui>'
)


def _basic_catalog() -> CatalogApi:
    """The basic catalog as both sides load it: from its document."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        document = BasicCatalog().catalog_schema
    return Catalog.from_json(document, protocol_version="1.0")


def _fx_rate(args: dict[str, Any], context: AgentFunctionContext) -> str:
    return f"1 {args['base']} = 1.08 {args['target']}"


def _agent_catalog() -> CatalogApi:
    return _basic_catalog().copy_with(
        agent_functions=[
            AgentFunction(
                "fetchFxRate",
                handler=_fx_rate,
                return_type="string",
                schema=FX_RATE_SCHEMA,
                description="The exchange rate from base to target, as text.",
            )
        ]
    )


def _schema_only_renderer_catalog() -> CatalogApi:
    """The renderer's catalog with the agent function declared, not implemented."""
    basic = _basic_catalog()
    return basic.copy_with(
        functions=[
            *basic.functions.values(),
            FunctionApi("fetchFxRate", return_type="string", schema=FX_RATE_SCHEMA),
        ]
    )


def _direct_json_messages(catalog_id: str) -> list[dict[str, Any]]:
    return [
        {
            "version": "1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": catalog_id},
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": {"@call": "fetchFxRate", "args": {"base": "EUR"}},
                }],
            },
        },
    ]


def _agent_messages(fmt: str) -> list[dict[str, Any]]:
    """Parses the model's response on the agent, which validates it."""
    catalog = _agent_catalog()
    if fmt == "express":
        processor = A2uiRequestProcessor([catalog])
        parts = processor.parse_response(EXPRESS_RESPONSE)
    else:
        processor = A2uiRequestProcessor(
            [catalog], format_factory=DirectJsonFormatFactory()
        )
        parts = processor.parse_response(
            f"<a2ui-json>{json.dumps(_direct_json_messages(catalog.catalog_id))}</a2ui-json>"
        )
    messages = [
        message.model_dump(by_alias=True, exclude_unset=True)
        for part in parts
        if isinstance(part, A2uiPart)
        for message in part.a2ui
    ]
    validate_payload([catalog], messages)
    return messages


async def _flush() -> None:
    for _ in range(3):
        await asyncio.sleep(0)


FORMATS = ["express", "direct_json"]


class TestAgentSide:

    @pytest.mark.parametrize("fmt", FORMATS)
    def test_declared_agent_function_passes(self, fmt: str) -> None:
        messages = _agent_messages(fmt)

        assert "fetchFxRate" in json.dumps(messages)

    def test_undeclared_function_is_still_rejected(self) -> None:
        processor = A2uiRequestProcessor([_agent_catalog()])
        with pytest.raises(Exception, match="fetchUnknown"):
            processor.parse_response(
                EXPRESS_RESPONSE.replace("fetchFxRate", "fetchUnknown")
            )

        basic = _basic_catalog()
        with pytest.raises(A2uiValidationError, match="Unrecognized function"):
            validate_payload([basic], _direct_json_messages(basic.catalog_id))


class _Renderer:
    """A Python renderer core whose outbound messages go to the agent."""

    def __init__(self, catalog: CatalogApi, config: ValidationConfig | None) -> None:
        self.outbound: list[dict[str, Any]] = []
        self.errors: list[dict[str, Any]] = []
        self.processor = MessageProcessor(
            [catalog],
            options=MessageProcessorOptions(
                validation_config=config, outbound_listener=self.outbound.append
            ),
        )

    def show(self, messages: list[dict[str, Any]]) -> Any:
        """Processes the messages and evaluates the root Text's `text`."""
        self.processor.process_messages(messages)
        surface = self.processor.model.get_surface("s1")
        assert surface is not None
        surface.on_error.subscribe(self.errors.append)
        component = surface.components_model.get("root")
        assert component is not None
        return DataContext(surface, "/").resolve_dynamic_value(
            component.properties["text"], peek=False
        )


async def _round_trip(renderer: _Renderer, text: Any) -> dict[str, Any]:
    """Answers the renderer's call on the agent and returns the call sent."""
    assert len(renderer.outbound) == 1
    call = renderer.outbound[0]
    router = RendererMessageRouter(
        agent_functions=AgentFunctionRegistry([_agent_catalog()])
    )
    assert router.handles(call)
    replies = await router.dispatch(call)
    renderer.processor.process_messages(
        [reply.model_dump(by_alias=True, exclude_unset=True) for reply in replies]
    )
    await _flush()
    assert text.peek() == "1 EUR = 1.08 USD"
    assert renderer.errors == []
    return call


class TestRendererSide:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("fmt", FORMATS)
    async def test_default_config_accepts_and_routes_the_call(self, fmt: str) -> None:
        renderer = _Renderer(_basic_catalog(), None)

        text = renderer.show(_agent_messages(fmt))

        assert text.peek() is None, "pending until the agent answers"
        call = await _round_trip(renderer, text)
        assert call["callAgentFunction"]["callFunction"] == {
            "@call": "fetchFxRate",
            "catalogId": _basic_catalog().catalog_id,
            "args": {"base": "EUR"},
        }

    @pytest.mark.parametrize("fmt", FORMATS)
    def test_strict_config_rejects_the_payload(self, fmt: str) -> None:
        renderer = _Renderer(_basic_catalog(), STRICT_VALIDATION)

        with pytest.raises(A2uiValidationError, match="Unrecognized function"):
            renderer.show(_agent_messages(fmt))
        assert [list(message) for message in renderer.outbound] == [
            ["version", "error"]
        ], "the renderer reports the error and calls nothing"
        assert renderer.outbound[0]["error"]["code"] == "VALIDATION_FAILED"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("fmt", FORMATS)
    async def test_strict_config_with_schema_only_declaration_routes_the_call(
        self, fmt: str
    ) -> None:
        renderer = _Renderer(_schema_only_renderer_catalog(), STRICT_VALIDATION)

        text = renderer.show(_agent_messages(fmt))

        call = await _round_trip(renderer, text)
        assert call["callAgentFunction"]["callFunction"]["args"] == {
            "base": "EUR",
            "target": "USD",
        }, "a declared function is sent with its validated args"
