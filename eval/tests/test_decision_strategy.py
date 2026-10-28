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

"""Unit tests for the decision inference evaluation strategy."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import patch

from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessageAssistant,
    ModelName,
    ModelOutput,
)
from inspect_ai.solver import Generate, TaskState
import pytest
from tests.decision_fixtures import (
    HOST_ANSWERS,
    HOST_BLOCK,
    scripted_backend,
)

from a2ui_eval.decision_common import (
    DECISION_METADATA_KEYS,
    build_decision_backend,
)
from a2ui_eval.strategies.decision import (
    compile_decision_payload,
    decision_solver,
    decision_system_prompt,
)


def _make_state(
    metadata: dict[str, Any],
    completion: str | None = None,
    messages: list[Any] | None = None,
) -> TaskState:
    output = (
        ModelOutput(
            model="mock/model",
            choices=[
                ChatCompletionChoice(message=ChatMessageAssistant(content=completion))
            ],
        )
        if completion is not None
        else None
    )
    return TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=messages or [],
        metadata=metadata,
        output=output,
    )


async def _dummy_generate(state: TaskState, *args: Any, **kwargs: Any) -> TaskState:
    return state


@pytest.mark.asyncio
async def test_decision_system_prompt_injection() -> None:
    state = _make_state(
        metadata={
            "catalog": "catalogs/basic/v1/catalog.json",
            "protocol_role": "You are a UI generator.",
        }
    )
    step = decision_system_prompt("1.0")
    state = await step(state, _dummy_generate)
    assert len(state.messages) == 1
    system_content = str(state.messages[0].content)
    assert "You are a UI generator." in system_content
    assert "<a2ui>" in system_content


@pytest.mark.asyncio
async def test_decision_solver_scripted_success() -> None:
    backend = scripted_backend(HOST_ANSWERS)
    valid_completion = f"<a2ui>\n{HOST_BLOCK}\n</a2ui>"
    state = _make_state(
        metadata={
            "catalog": "catalogs/basic/v1/catalog.json",
            "allowed_surface_ids": ["main"],
        },
        completion=valid_completion,
    )

    with patch(
        "a2ui_eval.strategies.decision.build_decision_backend",
        return_value=backend,
    ):
        step = compile_decision_payload("1.0", decision_backend="mock")
        state = await step(state, _dummy_generate)

    assert state.metadata.get("pass_at_1") is True
    assert state.metadata.get("pass_at_k") is True
    assert state.metadata.get("compiled_messages") is not None
    assert len(state.metadata["compiled_messages"]) > 0
    assert state.output is not None
    assert "<a2ui-json>" in state.output.completion

    # Metadata keys
    for key in DECISION_METADATA_KEYS:
        assert key in state.metadata, f"Missing decision metadata key: {key}"
    assert state.metadata["decision_archetype"] == "dashboard"
    assert state.metadata["decision_backend"] == "mock"
    assert state.metadata["decision_calls"] > 0
    assert state.metadata["decision_latency_ms"] >= 0.0


@pytest.mark.asyncio
async def test_decision_solver_unscripted_abstain_fails() -> None:
    # Deliberately unparseable / abstaining block with no fallback
    invalid_completion = (
        '<a2ui-decision>\n{"intent": "Unknown intent", "payload": {}}\n</a2ui-decision>'
    )
    state = _make_state(
        metadata={
            "catalog": "catalogs/basic/v1/catalog.json",
            "allowed_surface_ids": ["main"],
        },
        completion=invalid_completion,
    )

    step = compile_decision_payload("1.0", decision_backend="mock")
    state = await step(state, _dummy_generate)

    assert state.metadata.get("pass_at_1") is False
    assert state.output is not None
    assert (
        state.output.completion.startswith("Compilation/validation failed:")
        or "abstained" in state.output.completion.lower()
    )


@pytest.mark.asyncio
async def test_decision_solver_validation_retries() -> None:
    backend = scripted_backend(HOST_ANSWERS)
    call_count = 0

    async def retry_generate(st: TaskState, *args: Any, **kwargs: Any) -> TaskState:
        nonlocal call_count
        call_count += 1
        st.output = ModelOutput(
            model="mock/model",
            choices=[
                ChatCompletionChoice(
                    message=ChatMessageAssistant(
                        content=f"<a2ui>\n{HOST_BLOCK}\n</a2ui>"
                    )
                )
            ],
        )
        return st

    # Initially starts with invalid JSON
    state = _make_state(
        metadata={
            "catalog": "catalogs/basic/v1/catalog.json",
            "allowed_surface_ids": ["main"],
        },
        completion="<a2ui>\n{not valid json\n</a2ui>",
    )

    with patch(
        "a2ui_eval.strategies.decision.build_decision_backend",
        return_value=backend,
    ):
        step = compile_decision_payload(
            "1.0", decision_backend="mock", max_validation_retries=1
        )
        state = await step(state, retry_generate)

    assert call_count == 1
    assert state.metadata.get("pass_at_1") is False
    assert state.metadata.get("pass_at_k") is True
    assert state.metadata.get("validation_retries_used") == 1
    assert state.metadata.get("compiled_messages") is not None
    assert any("Validation failed:" in str(m.content) for m in state.messages)


def test_build_decision_backend_jev_missing_key() -> None:
    with patch.dict(os.environ, {}, clear=True):
        with pytest.raises(ValueError, match="JEV_API_KEY"):
            build_decision_backend("jev")
