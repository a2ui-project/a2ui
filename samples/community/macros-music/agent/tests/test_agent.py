# Copyright 2026 Google LLC
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

"""Tests for how the live agent handles model failures."""

from __future__ import annotations

import asyncio
from typing import Any

from google.genai import errors, types

from liner_notes.agent import MusicAgent


def _response(text: str) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(content=types.ModelContent(parts=[types.Part(text=text)]))
        ]
    )


class _ScriptedModel:
    """Stands in for `MusicAgent._generate`, returning queued results in order."""

    def __init__(self, *results: Any) -> None:
        self.results = list(results)
        self.calls: list[list[types.Content]] = []
        self.allow_tools: list[bool] = []

    async def __call__(
        self, contents: list[types.Content], allow_tools: bool = True
    ) -> Any:
        self.calls.append(list(contents))
        self.allow_tools.append(allow_tools)
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def _agent(model: _ScriptedModel) -> MusicAgent:
    agent = MusicAgent(api_key="test-key")
    agent._generate = model  # type: ignore[method-assign]
    return agent


def test_invalid_a2ui_is_retried_with_the_error_message():
    model = _ScriptedModel(
        _response('Hi\n<a2ui>\nroot = Discography("taylor-swift")\n</a2ui>'),
        _response('Fixed\n<a2ui>\nroot = Discography("bts")\n</a2ui>'),
    )
    turn = asyncio.run(_agent(model).respond("c", "albums?"))

    assert turn.attempts == 2
    assert turn.error is None
    assert turn.macro_calls == ["Discography"]
    retry_prompt = model.calls[1][-1].parts[0].text
    assert "Unknown artistId 'taylor-swift'" in retry_prompt
    assert model.allow_tools == [True, False]


def test_two_invalid_replies_return_the_text_without_ui():
    bad = _response('Here you go\n<a2ui>\nroot = Discography("nobody")\n</a2ui>')
    turn = asyncio.run(_agent(_ScriptedModel(bad, bad)).respond("c", "albums?"))

    assert turn.messages == []
    assert turn.text == "Here you go"
    assert "nobody" in (turn.error or "")


def test_api_errors_become_an_error_turn():
    model = _ScriptedModel(errors.ServerError(503, {"error": {"message": "busy"}}))
    turn = asyncio.run(_agent(model).respond("c", "albums?"))

    assert turn.messages == []
    assert "Gemini API error" in (turn.error or "")


def test_empty_reply_is_retried_without_tools():
    model = _ScriptedModel(
        _response(""),
        _response('Done\n<a2ui>\nroot = ArtistProfile("bjork")\n</a2ui>'),
    )
    turn = asyncio.run(_agent(model).respond("c", "who won awards?"))

    assert turn.attempts == 2
    assert turn.macro_calls == ["ArtistProfile"]
    assert model.allow_tools == [True, False]
    assert "facts you already have" in model.calls[1][-1].parts[0].text
