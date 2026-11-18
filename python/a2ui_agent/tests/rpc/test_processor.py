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

"""Tests for how RendererToAgentMessageProcessor routes renderer messages."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from a2ui.core import A2uiValidationError, AgentFunction, AgentFunctionContext, Catalog
from a2ui.core.schema.v1_0 import (
    A2uiRendererActionMessage,
    A2uiRendererErrorMessage,
    AgentFunctionResponseMessage,
    CallAgentFunctionMessage,
    RendererFunctionResponseMessage,
)
from a2ui.rpc import ProcessResult, RendererToAgentMessageProcessor

CATALOG = "https://example.com/fin/v1/catalog.json"


def _double(args: dict[str, Any], context: AgentFunctionContext) -> Any:
    return args["n"] * 2


def _catalogs() -> list[Any]:
    schema = {
        "type": "object",
        "properties": {"n": {"type": "number"}},
        "required": ["n"],
    }
    return [
        Catalog(
            CATALOG,
            "1.0",
            functions=[AgentFunction("double", handler=_double, schema=schema)],
        )
    ]


CALL: dict[str, Any] = {
    "version": "1.0",
    "callAgentFunction": {
        "surfaceId": "s1",
        "functionCallId": "c1",
        "callFunction": {"@call": "double", "catalogId": CATALOG, "args": {"n": 21}},
    },
}

ACTION: dict[str, Any] = {
    "version": "1.0",
    "action": {
        "name": "submit",
        "surfaceId": "s1",
        "sourceComponentId": "b1",
        "timestamp": "2026-01-01T00:00:00Z",
        "context": {},
    },
}

ERROR: dict[str, Any] = {
    "version": "1.0",
    "error": {
        "code": "EXPRESSION_ERROR",
        "message": "formatDate failed",
        "surfaceId": "s1",
    },
}

RESPONSE: dict[str, Any] = {
    "version": "1.0",
    "rendererFunctionResponse": {"functionCallId": "r1", "value": "12:00"},
}

MODELS: dict[str, type[Any]] = {
    "action": A2uiRendererActionMessage,
    "error": A2uiRendererErrorMessage,
    "rendererFunctionResponse": RendererFunctionResponseMessage,
}

MESSAGES: dict[str, dict[str, Any]] = {
    "action": ACTION,
    "error": ERROR,
    "rendererFunctionResponse": RESPONSE,
}

CALLBACK_OPTIONS = {
    "action": "on_action",
    "error": "on_error",
    "rendererFunctionResponse": "on_renderer_function_response",
}


class TestCallAgentFunction:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("as_model", [False, True])
    async def test_is_handled_with_one_response(self, as_model: bool) -> None:
        processor = RendererToAgentMessageProcessor(_catalogs())
        message: Any = (
            CallAgentFunctionMessage.model_validate(CALL) if as_model else CALL
        )

        result = await processor.process_message(message)

        assert result.handled
        assert len(result.replies) == 1
        assert isinstance(result.replies[0], AgentFunctionResponseMessage)
        assert result.replies[0].model_dump(by_alias=True, exclude_unset=True) == {
            "version": "1.0",
            "agentFunctionResponse": {"functionCallId": "c1", "value": 42},
        }

    @pytest.mark.asyncio
    async def test_is_handled_without_any_agent_function(self) -> None:
        processor = RendererToAgentMessageProcessor([])

        result = await processor.process_message(CALL)

        assert result.handled
        body = result.replies[0].model_dump(by_alias=True, exclude_unset=True)
        assert body["agentFunctionResponse"]["error"]["code"] == "UNKNOWN_FUNCTION"


class TestCallbacks:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", list(MESSAGES))
    @pytest.mark.parametrize("is_async", [False, True])
    async def test_callback_receives_the_validated_model(
        self, kind: str, is_async: bool
    ) -> None:
        received: list[Any] = []

        def sync_callback(message: Any) -> None:
            received.append(message)

        async def async_callback(message: Any) -> None:
            await asyncio.sleep(0)
            received.append(message)

        processor = RendererToAgentMessageProcessor(
            _catalogs(),
            **{CALLBACK_OPTIONS[kind]: async_callback if is_async else sync_callback},
        )

        result = await processor.process_message(MESSAGES[kind])

        assert result == ProcessResult(handled=True, replies=[])
        assert len(received) == 1
        assert isinstance(received[0], MODELS[kind])
        assert (
            received[0].model_dump(by_alias=True, exclude_unset=True) == MESSAGES[kind]
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", list(MESSAGES))
    async def test_callback_receives_a_model_as_given(self, kind: str) -> None:
        received: list[Any] = []
        processor = RendererToAgentMessageProcessor(
            _catalogs(), **{CALLBACK_OPTIONS[kind]: received.append}
        )
        message = MODELS[kind].model_validate(MESSAGES[kind])

        result = await processor.process_message(message)

        assert result.handled
        assert received == [message]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", list(MESSAGES))
    async def test_without_its_callback_a_message_is_not_handled(
        self, kind: str
    ) -> None:
        processor = RendererToAgentMessageProcessor(_catalogs())

        result = await processor.process_message(MESSAGES[kind])

        assert result == ProcessResult(handled=False, replies=[])

    @pytest.mark.asyncio
    async def test_without_its_callback_a_malformed_message_is_not_validated(
        self,
    ) -> None:
        processor = RendererToAgentMessageProcessor(_catalogs())

        result = await processor.process_message(
            {"version": "1.0", "action": {"name": 3}}
        )

        assert result == ProcessResult(handled=False, replies=[])

    @pytest.mark.asyncio
    async def test_other_callbacks_do_not_handle_a_message(self) -> None:
        received: list[Any] = []
        processor = RendererToAgentMessageProcessor(
            _catalogs(),
            on_error=received.append,
            on_renderer_function_response=received.append,
        )

        result = await processor.process_message(ACTION)

        assert not result.handled
        assert received == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", list(MESSAGES))
    async def test_a_malformed_message_for_a_callback_raises(self, kind: str) -> None:
        received: list[Any] = []
        processor = RendererToAgentMessageProcessor(
            _catalogs(), **{CALLBACK_OPTIONS[kind]: received.append}
        )

        with pytest.raises(A2uiValidationError, match="Malformed"):
            await processor.process_message({"version": "1.0", kind: {"bogus": 1}})
        assert received == []

    @pytest.mark.asyncio
    async def test_an_exception_from_a_callback_propagates(self) -> None:
        async def on_action(message: Any) -> None:
            raise RuntimeError("agent turn failed")

        processor = RendererToAgentMessageProcessor(_catalogs(), on_action=on_action)

        with pytest.raises(RuntimeError, match="agent turn failed"):
            await processor.process_message(ACTION)


class TestInvalidMessages:

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("message", "detail"),
        [
            ({"version": "1.0", "updateComponents": {}}, "Unknown"),
            ({"version": "1.0"}, "exactly one"),
            ({"version": "1.0", "callAgentFunction": {}, "action": {}}, "exactly one"),
            ("not an object", "must be an object"),
            (None, "must be an object"),
        ],
        ids=["unknown key", "no key", "two keys", "string", "none"],
    )
    async def test_raises(self, message: Any, detail: str) -> None:
        processor = RendererToAgentMessageProcessor(
            _catalogs(),
            on_action=lambda m: None,
            on_error=lambda m: None,
            on_renderer_function_response=lambda m: None,
        )

        with pytest.raises(A2uiValidationError, match=detail):
            await processor.process_message(message)


class TestVersion:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", ["callAgentFunction", *MESSAGES])
    @pytest.mark.parametrize("version", [None, "v1.0", "0.9", 1.0])
    async def test_parsed_json_needs_version_1_0(self, kind: str, version: Any) -> None:
        received: list[Any] = []
        processor = RendererToAgentMessageProcessor(
            _catalogs(), **{CALLBACK_OPTIONS.get(kind, "on_action"): received.append}
        )
        message = dict({**MESSAGES, "callAgentFunction": CALL}[kind])
        if version is None:
            del message["version"]
        else:
            message["version"] = version

        with pytest.raises(A2uiValidationError, match="version"):
            await processor.process_message(message)
        assert received == []

    @pytest.mark.asyncio
    async def test_parsed_json_without_version_raises_even_without_callback(
        self,
    ) -> None:
        processor = RendererToAgentMessageProcessor(_catalogs())

        with pytest.raises(A2uiValidationError, match="version"):
            await processor.process_message({"action": ACTION["action"]})

    @pytest.mark.asyncio
    async def test_rejects_another_schema_model(self) -> None:
        from a2ui.core.schema.v0_9 import A2uiClientActionMessage

        processor = RendererToAgentMessageProcessor(
            _catalogs(), on_action=lambda m: None
        )
        message = A2uiClientActionMessage.model_validate({"action": ACTION["action"]})

        with pytest.raises(A2uiValidationError, match="not a v1.0"):
            await processor.process_message(message)  # type: ignore[arg-type]


class TestDeclining:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", list(MESSAGES))
    @pytest.mark.parametrize("is_async", [False, True])
    async def test_a_callback_returning_false_declines(
        self, kind: str, is_async: bool
    ) -> None:
        received: list[Any] = []

        def sync_callback(message: Any) -> bool:
            received.append(message)
            return False

        async def async_callback(message: Any) -> bool:
            received.append(message)
            return False

        processor = RendererToAgentMessageProcessor(
            _catalogs(),
            **{CALLBACK_OPTIONS[kind]: async_callback if is_async else sync_callback},
        )

        result = await processor.process_message(MESSAGES[kind])

        assert result == ProcessResult(handled=False, replies=[])
        assert len(received) == 1

    @pytest.mark.asyncio
    @pytest.mark.parametrize("returned", [True, None, 0, ""])
    async def test_anything_but_false_means_handled(self, returned: Any) -> None:
        processor = RendererToAgentMessageProcessor(
            _catalogs(), on_action=lambda m: returned
        )

        result = await processor.process_message(ACTION)

        assert result.handled


class TestApi:

    def test_has_no_process_messages(self) -> None:
        assert not hasattr(RendererToAgentMessageProcessor, "process_messages")

    def test_reexports_the_v1_0_message_classes(self) -> None:
        import a2ui.rpc as rpc
        from a2ui.core.schema import v1_0

        for name in (
            "A2uiRendererActionMessage",
            "A2uiRendererErrorMessage",
            "AgentFunctionResponseMessage",
            "CallAgentFunctionMessage",
            "RendererFunctionResponseMessage",
            "RendererToAgentMessage",
        ):
            assert getattr(rpc, name) is getattr(v1_0, name)
            assert name in rpc.__all__
