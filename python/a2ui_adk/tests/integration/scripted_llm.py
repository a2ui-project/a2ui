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

"""Deterministic in-process LLM fake for ADK integration tests."""

from __future__ import annotations

from collections.abc import AsyncGenerator, Sequence
from typing import Any

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types as genai_types
from pydantic import Field


class ScriptedLlm(BaseLlm):
    """Records incoming `LlmRequest`s and yields scripted `LlmResponse`s.

    Each entry in `responses` may be either:
    - A single `LlmResponse`. Consecutive entries with `partial=True` are
      yielded within the same `generate_content_async` call until an entry with
      `partial` not equal to `True` terminates that model turn.
    - A sequence of `LlmResponse` objects to yield in a single
      `generate_content_async` call.
    """

    model: str = "scripted"
    requests: list[LlmRequest] = Field(default_factory=list)
    responses: list[LlmResponse | Sequence[LlmResponse]] = Field(default_factory=list)

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        del stream
        self.requests.append(llm_request)
        if not self.responses:
            yield LlmResponse(
                content=genai_types.Content(
                    role="model", parts=[genai_types.Part(text="ok")]
                )
            )
            return

        head = self.responses.pop(0)
        if isinstance(head, LlmResponse):
            yield head
            while head.partial is True and self.responses:
                nxt = self.responses[0]
                if not isinstance(nxt, LlmResponse):
                    break
                head = self.responses.pop(0)
                assert isinstance(head, LlmResponse)
                yield head
            return

        for response in head:
            yield response


def make_text_response(text: str, *, partial: bool | None = None) -> LlmResponse:
    """Builds a model `LlmResponse` containing a single text part."""
    return LlmResponse(
        partial=partial,
        content=genai_types.Content(role="model", parts=[genai_types.Part(text=text)]),
    )


def make_function_call_response(name: str, args: dict[str, Any]) -> LlmResponse:
    """Builds a model `LlmResponse` containing a single tool function call."""
    return LlmResponse(
        content=genai_types.Content(
            role="model",
            parts=[
                genai_types.Part(
                    function_call=genai_types.FunctionCall(name=name, args=args)
                )
            ],
        )
    )
