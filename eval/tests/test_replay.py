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

"""Unit tests for the completion replay store and the format solver retry loop."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from inspect_ai.log import (
    EvalConfig,
    EvalDataset,
    EvalLog,
    EvalSample,
    EvalSpec,
    write_eval_log,
)
from inspect_ai.model import (
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageUser,
    ModelName,
    ModelOutput,
)
from inspect_ai.solver import TaskState

from a2ui_eval.bridges import DEFAULT_PARSE_TIMEOUT_SEC, BridgeOptions
from a2ui_eval.replay import CompletionReplayStore, RecordedCompletion, prompt_sha256
from a2ui_eval.shared.utils import GIT_ROOT
from a2ui_eval.strategies.format import (
    compile_format_payload,
    format_solver,
    generate_or_replay,
)

V1_CATALOG = GIT_ROOT / "catalogs/basic/v1/catalog.json"
EXPRESS_OK = '<a2ui>\nroot = Text("Hello")\n</a2ui>'
DIRECT_OK = (
    '<a2ui-json>\n[{"version": "v1.0", "createSurface": {"surfaceId": "main",'
    ' "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"}}]'
    "\n</a2ui-json>"
)


def _state(
    metadata: dict[str, Any],
    completion: str | None = None,
    messages: list[Any] | None = None,
) -> TaskState:
    output = (
        ModelOutput.from_content("mock/model", completion)
        if completion is not None
        else None
    )
    return TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=messages if messages is not None else [],
        metadata=metadata,
        output=output,
    )


class _ScriptedGenerate:
    """A `generate` stand-in that returns scripted completions in order."""

    def __init__(self, completions: list[str]) -> None:
        self.completions = list(completions)
        self.calls: list[list[Any]] = []

    async def __call__(self, state: TaskState, *args: Any, **kwargs: Any) -> TaskState:
        self.calls.append(list(state.messages))
        completion = self.completions.pop(0)
        state.output = ModelOutput.from_content("mock/model", completion)
        state.messages.append(ChatMessageAssistant(content=completion))
        return state


class _FakeBridge:
    """Fake SDK bridge whose parse_and_validate outcomes are scripted."""

    def __init__(self, outcomes: list[Exception | None]) -> None:
        self.outcomes = list(outcomes)
        self.parse_calls: list[dict[str, Any]] = []

    def generate_prompt(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str = "main",
        *,
        options: BridgeOptions | None = None,
    ) -> str:
        return "PROMPT"

    def parse_and_validate(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str,
        completion: str,
        timeout_sec: float = DEFAULT_PARSE_TIMEOUT_SEC,
        require_complete_tags: bool = False,
        *,
        validate: bool = True,
        options: BridgeOptions | None = None,
    ) -> dict[str, Any]:
        self.parse_calls.append({
            "format_name": format_name,
            "completion": completion,
            "options": options,
        })
        outcome = self.outcomes.pop(0)
        if outcome is not None:
            raise outcome
        return {"compiled_jsons": [{"version": "v1.0"}], "parts": []}


# --- CompletionReplayStore -------------------------------------------------


def test_store_round_trips_jsonl(tmp_path: Path) -> None:
    path = tmp_path / "completions.jsonl"
    store = CompletionReplayStore(path)
    store.record("sample_a", "express", "1.0", EXPRESS_OK, prompt_sha256("SYS"))
    store.record("sample_a", "express", "1.0", "second", prompt_sha256("SYS"))
    store.record("sample_b", "direct", "1.0", DIRECT_OK, "abc")

    lines = [json.loads(l) for l in path.read_text().splitlines()]
    assert len(lines) == 3
    assert set(lines[0]) == {
        "sample_name",
        "strategy",
        "version",
        "completion",
        "prompt_sha256",
    }

    loaded = CompletionReplayStore.load(path)
    assert len(loaded) == 2
    assert loaded.lookup("sample_a", "express", "1.0") == RecordedCompletion(
        "sample_a", "express", "1.0", "second", prompt_sha256("SYS")
    )
    assert loaded.lookup("sample_b", "direct", "1.0").completion == DIRECT_OK


def test_store_lookup_miss_and_missing_file(tmp_path: Path) -> None:
    store = CompletionReplayStore.load(tmp_path / "absent.jsonl")
    assert len(store) == 0
    assert store.lookup("nope", "express", "1.0") is None
    store.record("x", "direct", "1.0", "c", "h")
    assert store.lookup("x", "express", "1.0") is None
    assert store.lookup("x", "direct", "0.9.1") is None
    assert store.lookup("x", "direct", "1.0") is not None


def _write_eval_log(path: Path, **spec_overrides: Any) -> None:
    spec = dict(
        created="2026-01-01T00:00:00",
        task="a2ui_eval",
        dataset=EvalDataset(),
        model="mock/model",
        config=EvalConfig(),
    )
    spec.update(spec_overrides)
    samples = [
        EvalSample(
            id=1,
            epoch=1,
            input="hi",
            target="",
            metadata={"name": "sample_a"},
            messages=[
                ChatMessageSystem(content="SYS A"),
                ChatMessageUser(content="hi"),
                ChatMessageAssistant(content=EXPRESS_OK),
            ],
            output=ModelOutput.from_content("mock/model", EXPRESS_OK),
        ),
        EvalSample(
            id=2,
            epoch=1,
            input="hi",
            target="",
            metadata={},
            output=ModelOutput.from_content("mock/model", "unnamed"),
        ),
        EvalSample(
            id=3,
            epoch=1,
            input="hi",
            target="",
            metadata={"name": "sample_c"},
            messages=[ChatMessageAssistant(content="from messages")],
        ),
    ]
    write_eval_log(EvalLog(eval=EvalSpec(**spec), samples=samples), path)


def test_store_from_eval_log_uses_task_args(tmp_path: Path) -> None:
    log_path = tmp_path / "run.eval"
    _write_eval_log(log_path, task_args={"strategy": "express", "version": "1.0"})

    store = CompletionReplayStore.from_eval_log(log_path)

    assert len(store) == 2
    rec = store.lookup("sample_a", "express", "1.0")
    assert rec is not None
    assert rec.completion == EXPRESS_OK
    assert rec.prompt_sha256 == prompt_sha256("SYS A")
    rec_c = store.lookup("sample_c", "express", "1.0")
    assert rec_c is not None
    assert rec_c.completion == "from messages"
    assert rec_c.prompt_sha256 == prompt_sha256("")


def test_store_from_eval_log_falls_back_to_eval_metadata(tmp_path: Path) -> None:
    log_path = tmp_path / "run.eval"
    _write_eval_log(log_path, metadata={"strategy": "direct", "version": "0.9.1"})

    store = CompletionReplayStore.from_eval_log(log_path)
    assert store.lookup("sample_a", "direct", "0.9.1") is not None
    assert store.lookup("sample_a", "express", "1.0") is None


# --- generate_or_replay ----------------------------------------------------


@pytest.mark.asyncio
async def test_generate_or_replay_replays_without_generating(tmp_path: Path) -> None:
    path = tmp_path / "completions.jsonl"
    CompletionReplayStore(path).record(
        "sample_a", "express", "1.0", EXPRESS_OK, prompt_sha256("SYS")
    )
    generate = _ScriptedGenerate(["should not be used"])
    solver = generate_or_replay(
        replay_path=str(path), strategy_name="express", version="1.0"
    )
    state = _state({"name": "sample_a"}, messages=[ChatMessageSystem(content="SYS")])

    state = await solver(state, generate)

    assert generate.calls == []
    assert state.output.completion == EXPRESS_OK
    assert state.messages[-1].role == "assistant"
    assert state.metadata["replayed"] is True
    assert state.metadata["inference_duration_seconds"] == 0.0
    assert state.metadata["replay_prompt_matches"] is True


@pytest.mark.asyncio
async def test_generate_or_replay_missing_recording_raises(tmp_path: Path) -> None:
    path = tmp_path / "completions.jsonl"
    CompletionReplayStore(path).record("other", "express", "1.0", EXPRESS_OK, "h")
    solver = generate_or_replay(
        replay_path=str(path), strategy_name="express", version="1.0"
    )
    with pytest.raises(ValueError, match="sample_a"):
        await solver(_state({"name": "sample_a"}), _ScriptedGenerate([]))


@pytest.mark.asyncio
async def test_generate_or_replay_records_completion(tmp_path: Path) -> None:
    path = tmp_path / "out" / "completions.jsonl"
    generate = _ScriptedGenerate([EXPRESS_OK])
    solver = generate_or_replay(
        record_path=str(path), strategy_name="express", version="1.0"
    )
    state = _state({"name": "sample_a"}, messages=[ChatMessageSystem(content="SYS")])

    state = await solver(state, generate)

    assert len(generate.calls) == 1
    assert state.output.completion == EXPRESS_OK
    assert "replayed" not in state.metadata
    assert "inference_duration_seconds" in state.metadata
    rec = CompletionReplayStore.load(path).lookup("sample_a", "express", "1.0")
    assert rec == RecordedCompletion(
        "sample_a", "express", "1.0", EXPRESS_OK, prompt_sha256("SYS")
    )


# --- compile_format_payload ------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "format_name,completion",
    [("direct_json", DIRECT_OK), ("express", EXPRESS_OK)],
)
async def test_compile_success_sets_compiled_messages(
    format_name: str, completion: str
) -> None:
    bridge = _FakeBridge([None])
    solver = compile_format_payload(format_name, version="1.0")
    state = _state({"catalog": str(V1_CATALOG)}, completion=completion)

    with patch("a2ui_eval.strategies.format.get_sdk_bridge", return_value=bridge):
        state = await solver(state, _ScriptedGenerate([]))

    assert state.metadata["compiled_messages"] == [{"version": "v1.0"}]
    assert state.metadata["pass_at_1"] is True
    assert state.metadata["pass_at_k"] is True
    assert state.metadata["validation_retries_used"] == 0
    assert "<a2ui-json>" in state.output.completion
    assert bridge.parse_calls[0]["format_name"] == format_name
    assert isinstance(bridge.parse_calls[0]["options"], BridgeOptions)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "format_name,bad,good",
    [
        ("direct_json", "<a2ui-json>[]</a2ui-json>", DIRECT_OK),
        ("express", "bad", EXPRESS_OK),
    ],
)
async def test_compile_retry_recovers(format_name: str, bad: str, good: str) -> None:
    bridge = _FakeBridge([ValueError("missing root"), None])
    generate = _ScriptedGenerate([good])
    solver = compile_format_payload(
        format_name, version="1.0", max_validation_retries=1
    )
    state = _state(
        {"catalog": str(V1_CATALOG), "inference_duration_seconds": 1.5}, completion=bad
    )

    with patch("a2ui_eval.strategies.format.get_sdk_bridge", return_value=bridge):
        state = await solver(state, generate)

    assert state.metadata["pass_at_1"] is False
    assert state.metadata["pass_at_k"] is True
    assert state.metadata["validation_retries_used"] == 1
    assert state.metadata["compiled_messages"] == [{"version": "v1.0"}]
    assert "<a2ui-json>" in state.output.completion
    assert "Compilation/validation failed" not in state.output.completion
    # The retry prompt carries the validation error to the model.
    assert len(generate.calls) == 1
    retry_message = generate.calls[0][-1]
    assert retry_message.role == "user"
    assert "missing root" in retry_message.text
    assert [c["completion"] for c in bridge.parse_calls] == [bad, good]
    # Inference cost accumulates across the retry rather than being replaced.
    assert state.metadata["inference_duration_seconds"] >= 1.5


@pytest.mark.asyncio
async def test_compile_retries_exhausted_fails() -> None:
    bridge = _FakeBridge([ValueError("e1"), ValueError("e2"), ValueError("e3")])
    generate = _ScriptedGenerate(["try2", "try3"])
    solver = compile_format_payload("express", version="1.0", max_validation_retries=2)
    state = _state({"catalog": str(V1_CATALOG)}, completion="try1")

    with patch("a2ui_eval.strategies.format.get_sdk_bridge", return_value=bridge):
        state = await solver(state, generate)

    assert state.metadata["pass_at_1"] is False
    assert state.metadata["pass_at_k"] is False
    assert state.metadata["validation_retries_used"] == 2
    assert "compiled_messages" not in state.metadata
    assert state.output.completion.startswith("Compilation/validation failed: e3")
    assert "Raw output:\ntry3" in state.output.completion
    assert len(generate.calls) == 2


@pytest.mark.asyncio
async def test_compile_without_retries_fails_once() -> None:
    bridge = _FakeBridge([ValueError("e1")])
    generate = _ScriptedGenerate(["unused"])
    solver = compile_format_payload("direct_json", version="1.0")
    state = _state({"catalog": str(V1_CATALOG)}, completion="bad")

    with patch("a2ui_eval.strategies.format.get_sdk_bridge", return_value=bridge):
        state = await solver(state, generate)

    assert generate.calls == []
    assert state.metadata["pass_at_1"] is False
    assert state.metadata["pass_at_k"] is False
    assert state.metadata["validation_retries_used"] == 0
    assert "Compilation/validation failed: e1" in state.output.completion


@pytest.mark.asyncio
async def test_compile_never_retries_replayed_completion() -> None:
    bridge = _FakeBridge([ValueError("e1")])
    generate = _ScriptedGenerate(["unused"])
    solver = compile_format_payload("express", version="1.0", max_validation_retries=2)
    state = _state({"catalog": str(V1_CATALOG), "replayed": True}, completion="bad")

    with patch("a2ui_eval.strategies.format.get_sdk_bridge", return_value=bridge):
        state = await solver(state, generate)

    assert generate.calls == []
    assert len(bridge.parse_calls) == 1
    assert state.metadata["pass_at_1"] is False
    assert state.metadata["pass_at_k"] is False
    assert state.metadata["validation_retries_used"] == 0


@pytest.mark.asyncio
async def test_compile_express_with_real_python_bridge() -> None:
    """End to end with the real Python bridge: compiled_messages holds the payload."""
    solver = compile_format_payload("express", version="1.0")
    state = _state({"catalog": str(V1_CATALOG)}, completion=EXPRESS_OK)
    state = await solver(state, _ScriptedGenerate([]))
    assert state.metadata["pass_at_1"] is True
    compiled = state.metadata["compiled_messages"]
    assert isinstance(compiled, list) and compiled
    assert '"component": "Text"' in state.output.completion


# --- format_solver ---------------------------------------------------------


@pytest.mark.parametrize("format_name", ["direct_json", "express"])
def test_format_solver_chain_length(format_name: str) -> None:
    assert len(format_solver(format_name, "1.0")) == 3
    assert (
        len(
            format_solver(
                format_name,
                "1.0",
                max_validation_retries=1,
                record_path="/tmp/x.jsonl",
                strategy_name="custom",
            )
        )
        == 3
    )
