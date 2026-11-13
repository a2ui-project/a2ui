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

import json
import os
import sys
from typing import Any
from unittest.mock import patch

from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessageAssistant,
    ModelName,
    ModelOutput,
)
from inspect_ai.solver import TaskState
import pytest

sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from a2ui_eval.decision_common import (
    DECISION_METADATA_KEYS,
    build_decision_backend,
)
from a2ui_eval.strategies.decision import (
    compile_decision_payload,
    decision_system_prompt,
)
from decision_fixtures import (
    HOST_ANSWERS,
    HOST_BLOCK,
    TRANSFER_ANSWERS,
    TRANSFER_BLOCK,
    scripted_backend,
)


def _make_state(
    metadata: dict[str, Any],
    completion: str | None = None,
    messages: list[Any] | None = None,
) -> TaskState:
    """Constructs a synthetic Inspect AI TaskState for solver unit tests."""
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
    """No-op generate callback that returns `state` unchanged."""
    del args, kwargs
    return state


@pytest.mark.asyncio
async def test_decision_system_prompt_injection() -> None:
    """Verifies decision_system_prompt injects the role and `<a2ui>` decision schema."""
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
    assert '"actions"' in system_content


@pytest.mark.asyncio
async def test_decision_solver_scripted_success() -> None:
    """Verifies compile_decision_payload synthesizes A2UI JSON and populates metadata."""
    backend = scripted_backend(HOST_ANSWERS, model_id="mock-v1")
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

    for key in DECISION_METADATA_KEYS:
        assert key in state.metadata, f"Missing decision metadata key: {key}"
    assert state.metadata["decision_stage"] == "archetype"
    assert state.metadata["decision_family"] == "monitor"
    assert state.metadata["decision_archetype"] == "dashboard"
    assert state.metadata["decision_backend"] == "mock"
    assert state.metadata["decision_backend_kind"] == "mock"
    assert state.metadata["decision_model_id"] == "mock-v1"
    assert isinstance(state.metadata["decision_block"], dict)
    assert "intent" in state.metadata["decision_block"]
    assert isinstance(state.metadata["decision_blocks"], list)
    assert len(state.metadata["decision_blocks"]) > 0
    assert state.metadata["decision_calls"] > 0
    assert state.metadata["decision_latency_ms"] >= 0.0
    assert state.metadata["decision_fallback_source"] is None


@pytest.mark.asyncio
async def test_decision_solver_actions_map_and_exclude_round_trip() -> None:
    """Verifies actions map compilation and excluded pointer omission."""
    backend = scripted_backend(TRANSFER_ANSWERS, model_id="mock-act")
    block_dict = json.loads(TRANSFER_BLOCK)
    block_dict["payload"]["internalDebugToken"] = "secret-debug"
    block_dict["exclude"] = ["/internalDebugToken"]
    completion = f"<a2ui>\n{json.dumps(block_dict)}\n</a2ui>"
    state = _make_state(
        metadata={
            "catalog": "catalogs/basic/v1/catalog.json",
            "allowed_surface_ids": ["main"],
        },
        completion=completion,
    )

    with patch(
        "a2ui_eval.strategies.decision.build_decision_backend",
        return_value=backend,
    ):
        step = compile_decision_payload("1.0", decision_backend="mock")
        state = await step(state, _dummy_generate)

    assert state.metadata.get("pass_at_1") is True
    assert state.output is not None
    serialized = state.output.completion
    assert '"name": "send"' in serialized
    assert '"name": "cancel"' in serialized
    assert "internalDebugToken" not in json.dumps(
        state.metadata["compiled_messages"][0].get("createSurface", {})
    )


@pytest.mark.asyncio
async def test_decision_solver_requires_explicit_backend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies compile_decision_payload raises ValueError when no backend is selected."""
    monkeypatch.delenv("A2UI_DECISION_BACKEND", raising=False)
    state = _make_state(
        metadata={
            "catalog": "catalogs/basic/v1/catalog.json",
            "allowed_surface_ids": ["main"],
        },
        completion=f"<a2ui>\n{HOST_BLOCK}\n</a2ui>",
    )
    step = compile_decision_payload("1.0", decision_backend=None)
    with pytest.raises(ValueError, match="A2UI_DECISION_BACKEND"):
        await step(state, _dummy_generate)


@pytest.mark.asyncio
async def test_decision_solver_unscripted_abstain_fails() -> None:
    """Verifies an empty payload abstention marks pass_at_1 False."""
    # Unparseable tag / empty payload with no fallback messages
    invalid_completion = '<a2ui>\n{"intent": "Unknown intent", "payload": {}}\n</a2ui>'
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
    """Verifies validation retry re-prompts the host LLM and succeeds on attempt 2."""
    backend = scripted_backend(HOST_ANSWERS)
    call_count = 0

    async def retry_generate(st: TaskState, *args: Any, **kwargs: Any) -> TaskState:
        """Replaces the invalid attempt-1 output with a valid `<a2ui>` block."""
        nonlocal call_count
        del args, kwargs
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


@pytest.mark.asyncio
async def test_decision_solver_clears_stale_metadata_across_retry_attempts() -> None:
    """Verifies per-attempt decision metadata is cleared on retry while calls accumulate."""
    backend = scripted_backend(HOST_ANSWERS, model_id="mock-retry")

    async def retry_with_malformed_json(
        st: TaskState, *args: Any, **kwargs: Any
    ) -> TaskState:
        """Emits malformed `<a2ui>` JSON on attempt 2 so parsing fails before synthesis."""
        del args, kwargs
        st.output = ModelOutput(
            model="mock/model",
            choices=[
                ChatCompletionChoice(
                    message=ChatMessageAssistant(content="<a2ui>{bad json</a2ui>")
                )
            ],
        )
        return st

    state = _make_state(
        metadata={"catalog": "catalogs/basic/v1/catalog.json"},
        completion=f"<a2ui>\n{HOST_BLOCK}\n</a2ui>",
    )

    # Attempt 1 synthesizes and records decision metadata, then fails schema
    # validation; attempt 2 fails JSON parsing before synthesis.
    with (
        patch(
            "a2ui_eval.strategies.decision.build_decision_backend",
            return_value=backend,
        ),
        patch(
            "a2ui_eval.strategies.decision.parse_and_validate",
            side_effect=ValueError("forced validation error after synthesis"),
        ),
    ):
        step = compile_decision_payload(
            "1.0", decision_backend="mock", max_validation_retries=1
        )
        state = await step(state, retry_with_malformed_json)

    assert state.metadata.get("pass_at_1") is False
    assert state.metadata.get("pass_at_k") is False
    # Stale per-attempt keys from attempt 1 must be cleared when attempt 2 fails early,
    # while cumulative decision_calls and decision_latency_ms remain intact.
    assert "decision_archetype" not in state.metadata
    assert "decision_family" not in state.metadata
    assert "decision_stage" not in state.metadata
    assert state.metadata.get("decision_calls", 0) > 0


def test_build_decision_backend_jev_missing_key() -> None:
    """Verifies build_decision_backend('jev') raises ValueError when API keys are absent."""
    with patch.dict(os.environ, {}, clear=True):
        with pytest.raises(ValueError, match="JEV_API_KEY"):
            build_decision_backend("jev")


@pytest.mark.asyncio
async def test_compile_decision_payload_closes_factory_if_create_format_raises() -> (
    None
):
    """Verifies compile_decision_payload closes the factory even when create_format fails."""
    closed = False

    class _BoomFactory:
        """Test stub that raises from create_format and tracks aclose calls."""

        def __init__(self, **kwargs: object) -> None:
            """Ignores constructor keyword arguments."""
            del kwargs

        def create_format(self, catalogs: object) -> object:
            """Raises RuntimeError to simulate format initialization failure."""
            del catalogs
            raise RuntimeError("create_format boom")

        async def aclose(self) -> None:
            """Marks the factory as closed."""
            nonlocal closed
            closed = True

    state = _make_state(
        metadata={"catalog": "catalogs/basic/v1/catalog.json"},
        completion="<a2ui>{}</a2ui>",
    )

    async def noop_generate(st: object) -> object:
        """Returns `st` unchanged."""
        return st

    with (
        patch(
            "a2ui_eval.strategies.decision.build_decision_backend",
            return_value=scripted_backend(HOST_ANSWERS),
        ),
        patch(
            "a2ui_eval.strategies.decision.DecisionFormatFactory",
            _BoomFactory,
        ),
    ):
        step = compile_decision_payload("1.0", decision_backend="mock")
        with pytest.raises(RuntimeError, match="create_format boom"):
            await step(state, noop_generate)  # type: ignore[arg-type]

    assert closed is True
