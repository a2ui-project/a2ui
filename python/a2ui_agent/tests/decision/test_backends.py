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

"""Tests for the decision backends: protocol, calibration, timeouts, factory."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import json
import math
from pathlib import Path
import time
from typing import Any

import httpx
import pytest

from a2ui.core import A2uiError, A2uiValidationError
from a2ui.inference_formats.decision import (
    DEFAULT_GEMINI_DECISION_MODEL,
    DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_TYPESAFE_MODEL,
    BackendCapabilities,
    Calibration,
    DecisionAnswer,
    DecisionBackend,
    DecisionBackendError,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuestion,
    DecisionWireFormat,
    DeterministicMockBackend,
    JevHttpBackend,
    QuestionKind,
    StepZeroLogprobBackend,
    create_decision_backend,
)

_BACKEND_ENV = (
    "A2UI_DECISION_BACKEND",
    "A2UI_DECISION_URL",
    "A2UI_DECISION_MODEL",
    "A2UI_DECISION_AUTH",
    "A2UI_DECISION_TOKEN",
    "JEV_API_KEY",
    "TYPESAFE_API_KEY",
    "JEV_MODEL",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_DECISION_MODEL",
)


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Removes every environment variable `create_decision_backend` reads."""
    for name in _BACKEND_ENV:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def _choice(
    question_id: str, *options: str, allow_none: bool = False, **kw: Any
) -> DecisionQuestion:
    return DecisionQuestion(
        id=question_id,
        kind=QuestionKind.CHOICE,
        prompt=kw.pop("prompt", "Pick one"),
        options=options,
        allow_none=allow_none,
        **kw,
    )


def _batch(*questions: DecisionQuestion, **shared: Any) -> DecisionBatch:
    return DecisionBatch(shared_context=shared, questions=questions)


def _json_client(
    handler: Callable[[httpx.Request], httpx.Response],
) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _logprob_response(top: dict[str, float]) -> httpx.Response:
    return httpx.Response(
        200, json={"choices": [{"logprobs": {"top_logprobs": [top]}}]}
    )


# --- Protocol and capabilities ------------------------------------------------


def test_backends_satisfy_the_protocol_with_kind_model_and_capabilities() -> None:
    jev = JevHttpBackend("http://jev.local/predict", model="jev-1.14.0")
    step0 = StepZeroLogprobBackend("http://vllm.local/v1/completions", "gemma")
    mock = DeterministicMockBackend()

    for backend in (jev, step0, mock):
        assert isinstance(backend, DecisionBackend)
    assert (jev.backend_kind, jev.model_id) == ("jev", "jev-1.14.0")
    assert (step0.backend_kind, step0.model_id) == ("step0", "gemma")
    assert (mock.backend_kind, mock.model_id) == ("mock", "mock")
    assert jev.capabilities == BackendCapabilities(two_stage=False)
    assert step0.capabilities.two_stage is True
    assert mock.capabilities.two_stage is False
    assert mock.capabilities.max_questions_per_call is None


def test_mock_backend_reports_configured_capabilities_and_model() -> None:
    capabilities = BackendCapabilities(two_stage=True, max_questions_per_call=12)
    mock = DeterministicMockBackend(capabilities=capabilities, model_id="scripted")
    assert mock.capabilities is capabilities
    assert mock.model_id == "scripted"


@pytest.mark.parametrize(
    "backend",
    [
        JevHttpBackend("http://jev.local/predict"),
        StepZeroLogprobBackend("http://vllm.local/v1/completions", "m"),
        DeterministicMockBackend(),
    ],
)
@pytest.mark.asyncio
async def test_empty_batch_is_answered_without_a_request(
    backend: DecisionBackend,
) -> None:
    assert await backend.answer(_batch()) == ()


def test_http_backends_default_to_documented_timeout() -> None:
    assert DEFAULT_TIMEOUT_SECONDS == 30.0
    assert JevHttpBackend("http://jev.local/predict")._timeout_seconds == 30.0
    step0 = StepZeroLogprobBackend("http://vllm.local/v1/completions", "m")
    assert step0._timeout_seconds == 30.0


# --- Calibration --------------------------------------------------------------


def test_bundled_calibration_pins_jev_1_14_0_temperature() -> None:
    jev = JevHttpBackend("https://api.example.com/v1/systemone", model="jev-1.14.0")
    assert jev.calibration == Calibration(temperature=1.0)
    other = JevHttpBackend("https://api.example.com/v1/systemone", model="jev-v9")
    assert other.calibration == Calibration()
    step0 = StepZeroLogprobBackend("http://vllm.local/v1/completions", "jev-1.14.0")
    assert step0.calibration == Calibration()


def test_calibration_load_looks_up_kind_and_model(tmp_path: Path) -> None:
    path = tmp_path / "profiles.json"
    path.write_text(
        json.dumps({"step0/gemma": {"temperature": 2.5}, "jev/x": {}}),
        encoding="utf-8",
    )
    assert Calibration.load(path, backend_kind="step0", model_id="gemma") == (
        Calibration(temperature=2.5)
    )
    assert Calibration.load(path, backend_kind="jev", model_id="x") == Calibration()
    assert Calibration.load(path, backend_kind="jev", model_id="gemma") == (
        Calibration()
    )

    step0 = StepZeroLogprobBackend(
        "http://vllm.local/v1/completions", "gemma", calibration=path
    )
    assert step0.calibration.temperature == 2.5


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("[]", "JSON object"),
        ('{"jev/m": 4.0}', "must be an object"),
        ('{"jev/m": {"temperature": 0}}', "positive"),
    ],
)
def test_calibration_load_rejects_malformed_profiles(
    tmp_path: Path, content: str, message: str
) -> None:
    path = tmp_path / "profiles.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        Calibration.load(path, backend_kind="jev", model_id="m")


def test_calibration_apply_divides_log_probabilities_by_temperature() -> None:
    scaled = Calibration(temperature=2.0).apply({"a": 0.8, "b": 0.2, "c": 0.0})
    expected_a = math.sqrt(0.8) / (math.sqrt(0.8) + math.sqrt(0.2))
    assert scaled["a"] == pytest.approx(expected_a)
    assert scaled["c"] == 0.0
    assert Calibration().apply({"a": 0.8, "b": 0.2}) == {"a": 0.8, "b": 0.2}
    sharp = Calibration(temperature=1e-4).apply({"a": 0.8, "b": 0.2})
    assert sharp == {"a": pytest.approx(1.0), "b": pytest.approx(0.0)}


@pytest.mark.asyncio
async def test_jev_backend_applies_calibration_to_answers() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(
            200,
            json={
                "answers": {
                    "family": {
                        "probabilities": {"browse": 0.8, "inspect": 0.2},
                        "confidence": 0.8,
                    }
                }
            },
        )

    async with _json_client(handler) as client:
        backend = JevHttpBackend(
            "https://api.example.com/v1/systemone",
            model="jev-1.14.0",
            client=client,
            calibration=Calibration(temperature=4.0),
        )
        (answer,) = await backend.answer(_batch(_choice("family", "browse", "inspect")))

    expected = 0.8**0.25 / (0.8**0.25 + 0.2**0.25)
    assert answer.top() == ("browse", pytest.approx(expected))
    assert answer.distribution.top_logit_margin == pytest.approx(
        math.log(0.8 / 0.2) / 4.0
    )


# --- Timeouts and failures ----------------------------------------------------


def _delayed_client(delay_seconds: float) -> httpx.AsyncClient:
    async def handler(request: httpx.Request) -> httpx.Response:
        del request
        await asyncio.sleep(delay_seconds)
        return httpx.Response(200, json={"answers": {"q": {"probabilities": {"a": 1}}}})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_slow_backend_raises_backend_error_after_the_timeout() -> None:
    async with _delayed_client(1.0) as client:
        backend = JevHttpBackend(
            "http://jev.local/predict", model="m", client=client, timeout_seconds=0.2
        )
        started = time.monotonic()
        with pytest.raises(DecisionBackendError, match="timed out after 0.2 s") as info:
            await backend.answer(_batch(_choice("q", "a", "b")))
        elapsed = time.monotonic() - started

    assert 0.2 <= elapsed < 0.9
    assert isinstance(info.value, A2uiError)
    assert info.value.backend_kind == "jev"
    assert info.value.model_id == "m"
    assert info.value.cause is not None


@pytest.mark.asyncio
async def test_response_within_the_timeout_is_not_cut_short() -> None:
    async with _delayed_client(0.2) as client:
        backend = JevHttpBackend(
            "http://jev.local/predict", client=client, timeout_seconds=2.0
        )
        (answer,) = await backend.answer(_batch(_choice("q", "a", "b")))
    assert answer.top() == ("a", pytest.approx(1.0))


@pytest.mark.asyncio
async def test_transport_and_status_failures_raise_backend_error() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    async with _json_client(refuse) as client:
        backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions", "gemma", client=client
        )
        with pytest.raises(DecisionBackendError, match="connection refused") as info:
            await backend.answer(_batch(_choice("q", "a", "b")))
    assert isinstance(info.value.cause, httpx.ConnectError)
    assert info.value.backend_kind == "step0"

    def server_error(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(503, json={"error": {"message": "overloaded"}})

    async with _json_client(server_error) as client:
        backend_jev = JevHttpBackend("http://jev.local/predict", client=client)
        with pytest.raises(DecisionBackendError, match="overloaded"):
            await backend_jev.answer(_batch(_choice("q", "a", "b")))

    def not_json(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(200, text="<html>")

    async with _json_client(not_json) as client:
        backend_jev = JevHttpBackend("http://jev.local/predict", client=client)
        with pytest.raises(DecisionBackendError, match="not JSON"):
            await backend_jev.answer(_batch(_choice("q", "a", "b")))


# --- Jev ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jev_http_backend_answer_native_and_systemone() -> None:
    native_requests: list[dict[str, Any]] = []

    def native_handler(request: httpx.Request) -> httpx.Response:
        native_requests.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "calibrated": True,
                "answers": {
                    "family": {
                        "probabilities": {"browse": 0.1, "inspect": 0.8, "none": 0.1}
                    },
                    "gate:picture": {"probabilities": {"yes": 0.9, "no": 0.1}},
                    "stakes": {
                        "probabilities": {"low": 0.0, "medium": 0.5, "high": 0.5}
                    },
                },
            },
        )

    batch = _batch(
        _choice("family", "browse", "inspect", allow_none=True, prompt="Family?"),
        DecisionQuestion(id="gate:picture", kind=QuestionKind.BOOLEAN, prompt="Pic?"),
        DecisionQuestion(
            id="stakes",
            kind=QuestionKind.SCORE,
            prompt="Stakes?",
            options=("low", "medium", "high"),
        ),
        intent="Show overview",
    )

    async with _json_client(native_handler) as client:
        jev_native = JevHttpBackend("http://jev.local/predict", client=client)
        native_answers = await jev_native.answer(batch)

    assert len(native_requests) == 1
    assert native_requests[0]["shared_context"] == {"intent": "Show overview"}
    assert [q["kind"] for q in native_requests[0]["questions"]] == [
        "choice",
        "boolean",
        "score",
    ]
    assert native_answers[0].top() == ("inspect", pytest.approx(0.8))
    assert native_answers[1].yes == pytest.approx(0.9)
    assert native_answers[2].expected == pytest.approx(1.5)

    sys1_requests: list[dict[str, Any]] = []

    def sys1_handler(request: httpx.Request) -> httpx.Response:
        sys1_requests.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "answers": {
                    "family": {
                        "probabilities": {"browse": 0.2, "inspect": 0.8, "none": 0.0},
                        "confidence": 0.8,
                    },
                    "gate:picture": {"type": "noul", "noul": 0.75},
                    "stakes": {
                        "score": 0.5,
                        "probabilities": {"0": 0.5, "1": 0.5, "2": 0.0},
                        "confidence": 0.8,
                    },
                },
            },
        )

    async with _json_client(sys1_handler) as client:
        jev_sys1 = JevHttpBackend(
            "https://api.example.com/v1/systemone",
            model="jev-1.14.0",
            auth="secret-bearer-token",
            client=client,
        )
        sys1_answers = await jev_sys1.answer(batch)

    assert len(sys1_requests) == 1
    assert sys1_requests[0]["model"] == "jev-1.14.0"
    assert sys1_requests[0]["state"] == "User intent: Show overview"
    assert sys1_requests[0]["questions"]["gate:picture"]["type"] == "noul"
    assert sys1_requests[0]["questions"]["stakes"] == {
        "type": "score",
        "instructions": "Stakes?",
        "criteria": ["low", "medium", "high"],
    }
    assert sys1_answers[0].top() == ("inspect", pytest.approx(0.8))
    assert sys1_answers[1].yes == pytest.approx(0.75)
    assert sys1_answers[2].expected == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_jev_native_filters_unrequested_options_and_fails_closed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(
            200,
            json={
                "answers": [{
                    "id": "q",
                    "probabilities": {"a": "0.1", "Unlisted": 0.85, "b": "x"},
                }]
            },
        )

    async with _json_client(handler) as client:
        backend = JevHttpBackend("http://jev.local/predict", client=client)
        (answer,) = await backend.answer(_batch(_choice("q", "a", "b")))
    # Sub-unit mass is not inflated, and a missing `calibrated` flag means False.
    assert answer.distribution.probabilities == {
        "a": pytest.approx(0.1),
        "b": pytest.approx(0.0),
    }
    assert answer.distribution.calibrated is False


@pytest.mark.asyncio
async def test_jev_systemone_short_circuits_single_option_choices() -> None:
    requests: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(200, json={"answers": {}})

    async with _json_client(handler) as client:
        backend = JevHttpBackend("http://local/v1/systemone", client=client)
        only = await backend.answer(_batch(_choice("only", "single")))
        (empty,) = await backend.answer(_batch(_choice("q", "a", "b")))

    assert only[0].top() == ("single", 1.0)
    assert len(requests) == 1
    assert empty.distribution.probabilities == {"a": 0.0, "b": 0.0}

    def partial_handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(
            200,
            json={"answers": {"q": {"probabilities": {"a": 0.9, "b": 0.1}}}},
        )

    async with _json_client(partial_handler) as client:
        partial_backend = JevHttpBackend("http://local/v1/systemone", client=client)
        first, missing = await partial_backend.answer(
            _batch(_choice("q", "a", "b"), _choice("other", "a", "b"))
        )
    assert first.distribution.probabilities == {
        "a": pytest.approx(0.9),
        "b": pytest.approx(0.1),
    }
    assert missing.distribution.probabilities == {"a": 0.0, "b": 0.0}


@pytest.mark.asyncio
async def test_jev_http_backend_auth_callable_and_cached_adc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from a2ui.inference_formats.decision import backends

    captured_headers: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.append(dict(request.headers))
        return httpx.Response(200, json={"answers": {"q": {"probabilities": {}}}})

    adc_timeouts: list[float] = []

    def fake_adc_token(timeout_seconds: float) -> str:
        time.sleep(0.02)
        adc_timeouts.append(timeout_seconds)
        return "mocked-adc-token"

    monkeypatch.setattr(backends, "_get_adc_token_sync", fake_adc_token)
    batch = _batch(_choice("q", "a", "b"))
    async with _json_client(handler) as client:
        callable_backend = JevHttpBackend(
            "http://local/predict", auth=lambda: "callable-token", client=client
        )
        await callable_backend.answer(batch)
        assert captured_headers[-1]["authorization"] == "Bearer callable-token"

        adc_backend = JevHttpBackend(
            "http://local/predict", auth="adc", client=client, timeout_seconds=7.0
        )
        await asyncio.gather(*(adc_backend.answer(batch) for _ in range(3)))
        assert captured_headers[-1]["authorization"] == "Bearer mocked-adc-token"
        # Concurrent calls refresh once, with the backend's timeout.
        assert adc_timeouts == [7.0]

        other_backend = JevHttpBackend(
            "http://local/predict", auth="adc", client=client
        )
        await other_backend.answer(batch)
        assert len(adc_timeouts) == 2

    direct_jev = JevHttpBackend("http://local/predict", auth=None)
    assert await direct_jev._resolve_auth_token() is None


def test_extract_native_answer_entry_does_not_match_other_ids_by_index() -> None:
    from a2ui.inference_formats.decision import backends

    reordered = [{"id": "q2", "probabilities": {"B": 1.0}}]
    assert backends._extract_native_answer_entry(reordered, "q1", 0) == {}
    anon = [{"probabilities": {"A": 1.0}}]
    assert backends._extract_native_answer_entry(anon, "q1", 0) == anon[0]


def test_normalize_probabilities_treats_non_finite_weights_as_zero() -> None:
    from a2ui.inference_formats.decision import backends

    norm = backends._normalize_probabilities(
        {"A": "inf", "B": float("nan"), "C": 2.0}, ("A", "B", "C")
    )
    assert norm == {"A": 0.0, "B": 0.0, "C": 1.0}


@pytest.mark.asyncio
async def test_owned_clients_are_reused_and_closed() -> None:
    owned_jev = JevHttpBackend("http://jev.local/predict")
    client = owned_jev._get_client()
    assert owned_jev._get_client() is client
    await owned_jev.aclose()
    assert client.is_closed

    async with StepZeroLogprobBackend("http://vllm.local/v1/completions", "m") as step0:
        step_client = step0._get_client()
    assert step_client.is_closed


# --- Step 0 -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_step_zero_softmax_uses_calibration_temperature() -> None:
    captured: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content.decode("utf-8")))
        return _logprob_response({" A": -0.5, "B": -2.5, "IgnoredToken": -0.1})

    question = _choice("root", "VitalsCard", "LabTable", prompt="Show patient vitals")
    answers: dict[float, DecisionAnswer] = {}
    async with _json_client(handler) as client:
        for temperature in (1.0, 0.5, 2.0):
            backend = StepZeroLogprobBackend(
                "http://vllm.local/v1/completions",
                "gemma-decision",
                client=client,
                calibration=Calibration(temperature=temperature),
            )
            (answers[temperature],) = await backend.answer(_batch(question))

    assert captured[0]["model"] == "gemma-decision"
    assert "Candidates: [A: VitalsCard, B: LabTable]" in captured[0]["prompt"]
    assert "Intent: Show patient vitals" in captured[0]["prompt"]
    assert (captured[0]["max_tokens"], captured[0]["temperature"]) == (1, 0.0)
    assert captured[0]["logprobs"] == 5
    assert answers[1.0].distribution.calibrated is False
    assert answers[0.5].distribution.calibrated is True
    expected_t1 = 1.0 / (1.0 + math.exp(-2.0))
    assert answers[1.0].top() == ("VitalsCard", pytest.approx(expected_t1))
    assert answers[0.5].top()[1] > answers[1.0].top()[1] > answers[2.0].top()[1]


@pytest.mark.asyncio
async def test_step_zero_answer_shares_prefix_and_rejects_over_ten_options() -> None:
    prompts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        prompts.append(json.loads(request.content.decode("utf-8"))["prompt"])
        return _logprob_response({" A": -2.0, " B": -0.2, " C": -4.0})

    async with _json_client(handler) as client:
        backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions", "gemma-step0", client=client
        )
        eleven = tuple(f"opt_{i}" for i in range(11))
        with pytest.raises(A2uiValidationError, match="at most 10"):
            await backend.answer(_batch(_choice("too_many", *eleven)))
        assert prompts == []

        answers = await backend.answer(
            _batch(
                _choice("family", "browse", "inspect", allow_none=True),
                DecisionQuestion(
                    id="gate:picture", kind=QuestionKind.BOOLEAN, prompt="Pic?"
                ),
                intent="Show resort",
            )
        )
    assert len(prompts) == 2
    assert prompts[0].splitlines()[0] == prompts[1].splitlines()[0]
    assert prompts[0].startswith("Shared context: {'intent': 'Show resort'}")
    assert answers[0].top()[0] == "inspect"
    # "B" is "no" for a boolean question.
    assert answers[1].yes < 0.5


@pytest.mark.asyncio
async def test_step_zero_missing_tokens_and_logprob_cap() -> None:
    captured: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content.decode("utf-8")))
        return _logprob_response({"Unrelated": -1.0})

    with pytest.raises(ValueError, match="max_logprobs"):
        StepZeroLogprobBackend("http://x/v1/completions", "m", max_logprobs=25)

    async with _json_client(handler) as client:
        backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions", "gemma", max_logprobs=8, client=client
        )
        (missing,) = await backend.answer(_batch(_choice("q", "MissingA", "MissingB")))
        await backend.answer(_batch(_choice("ten", *(f"C{i}" for i in range(10)))))

    assert missing.distribution.probabilities == {
        "MissingA": pytest.approx(0.5),
        "MissingB": pytest.approx(0.5),
    }
    assert missing.distribution.top_logit_margin == pytest.approx(0.0)
    assert captured[1]["logprobs"] == 8

    def non_finite_handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(
            200,
            text=json.dumps(
                {
                    "choices": [{
                        "logprobs": {
                            "top_logprobs": [{
                                "A": float("-inf"),
                                "B": float("nan"),
                                "C": "bad",
                            }]
                        }
                    }]
                },
                allow_nan=True,
            ),
        )

    async with _json_client(non_finite_handler) as client:
        nf_backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions", "gemma", client=client
        )
        (nf_answer,) = await nf_backend.answer(_batch(_choice("q", "OptA", "OptB")))
    assert nf_answer.distribution.probabilities == {
        "OptA": pytest.approx(0.5),
        "OptB": pytest.approx(0.5),
    }
    assert nf_answer.distribution.top_logit_margin == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_step_zero_chat_completions_case_insensitive_and_bearer_auth() -> None:
    captured_headers: list[dict[str, str]] = []
    captured_bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.append(dict(request.headers))
        captured_bodies.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "choices": [{
                    "logprobs": {
                        "content": [{
                            "token": "b",
                            "logprob": -0.05,
                            "top_logprobs": [
                                {"token": " b", "logprob": -0.05},
                                {"token": "A", "logprob": -3.10},
                            ],
                        }]
                    }
                }]
            },
        )

    async with _json_client(handler) as client:
        backend = StepZeroLogprobBackend(
            "https://api.openai.com/v1/chat/completions",
            "gpt-4o-mini",
            auth="sk-test-123",
            client=client,
        )
        (answer,) = await backend.answer(
            _batch(_choice("family", "browse", "monitor", "inspect"))
        )
    assert captured_headers[0].get("authorization") == "Bearer sk-test-123"
    assert captured_bodies[0]["logprobs"] is True
    assert captured_bodies[0]["top_logprobs"] == 5
    assert "messages" in captured_bodies[0]
    assert answer.top()[0] == "monitor"


@pytest.mark.asyncio
async def test_step_zero_auth_headers(clean_env: pytest.MonkeyPatch) -> None:
    from a2ui.inference_formats.decision import backends

    clean_env.setenv("A2UI_DECISION_TOKEN", "env-step0-token")
    b_step0 = create_decision_backend(
        "step0", endpoint_url="http://localhost:8000/v1/completions"
    )
    assert isinstance(b_step0, StepZeroLogprobBackend)
    assert await b_step0._build_headers() == {"Authorization": "Bearer env-step0-token"}

    callable_step0 = StepZeroLogprobBackend(
        "http://localhost:8000/v1/completions", "m", auth=lambda: "from-callable"
    )
    assert await callable_step0._build_headers() == {
        "Authorization": "Bearer from-callable"
    }

    async def async_auth() -> str:
        return "from-async-callable"

    async_step0 = StepZeroLogprobBackend(
        "http://localhost:8000/v1/completions", "m", auth=async_auth
    )
    assert await async_step0._build_headers() == {
        "Authorization": "Bearer from-async-callable"
    }

    clean_env.setattr(
        backends, "_get_adc_token_sync", lambda timeout: f"adc-{timeout:g}"
    )
    adc_step0 = StepZeroLogprobBackend(
        "http://localhost:8000/v1/completions", "m", auth="adc", timeout_seconds=9
    )
    assert await adc_step0._build_headers() == {"Authorization": "Bearer adc-9"}


# --- Mock ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mock_backend_scripted_answers_and_batches_recording() -> None:
    q_explicit = _choice("anatomy:layout", "rows", "cards")
    explicit_ans = DecisionAnswer(
        question_id="anatomy:layout",
        distribution=DecisionDistribution({"rows": 0.15, "cards": 0.85}),
    )
    backend = DeterministicMockBackend(
        scripted={"family": {"browse": 0.9, "inspect": 0.1, "none": 0.0}},
        scripted_answers={
            "family": "inspect",
            "gate:picture": 0.85,
            "stakes": 2.4,
            "anatomy:layout": explicit_ans,
        },
    )
    batch = _batch(
        _choice("family", "browse", "inspect", allow_none=True),
        DecisionQuestion(id="gate:picture", kind=QuestionKind.BOOLEAN, prompt="Pic?"),
        DecisionQuestion(
            id="stakes",
            kind=QuestionKind.SCORE,
            prompt="Stakes?",
            options=("low", "medium", "high", "critical"),
        ),
        q_explicit,
        DecisionQuestion(id="gate:facts", kind=QuestionKind.BOOLEAN, prompt="Facts?"),
        DecisionQuestion(
            id="urgency",
            kind=QuestionKind.SCORE,
            prompt="Urgent?",
            options=("none", "soon", "now", "immediate"),
        ),
        intent="Inspect the resort",
    )
    answers = await backend.answer(batch)

    assert backend.batches == [batch]
    assert answers[0].top() == ("inspect", pytest.approx(0.9))
    assert answers[1].yes == pytest.approx(0.85)
    assert answers[2].expected == pytest.approx(2.4)
    assert answers[3] == explicit_ans
    assert answers[4].yes == pytest.approx(0.5)
    assert answers[5].expected == pytest.approx(1.5)


@pytest.mark.asyncio
async def test_mock_backend_scorer_scripted_and_heuristic() -> None:
    custom = DecisionDistribution({"Custom": 1.0}, calibrated=False)
    seen: list[str] = []

    def scorer(question: DecisionQuestion) -> DecisionDistribution:
        seen.append(question.id)
        return custom

    (scored,) = await DeterministicMockBackend(scorer=scorer).answer(
        _batch(_choice("any", "Custom"))
    )
    assert scored.distribution == custom
    assert seen == ["any"]

    scripted = DeterministicMockBackend(
        scripted={
            "archetype": {"CardA": 3.0, "CardB": 1.0, "Extra": 5.0},
            "archetype:specific prompt": {"CardB": 4.0, "CardA": 1.0},
        },
        calibrated=False,
        default_logit_margin=3.2,
    )
    by_task, by_prompt = await scripted.answer(
        _batch(
            _choice("archetype:1", "CardA", "CardB", "CardC", prompt="general"),
            _choice("archetype:2", "CardA", "CardB", prompt="specific prompt"),
        )
    )
    assert by_task.distribution.calibrated is False
    assert by_task.distribution.top_logit_margin == pytest.approx(3.2)
    assert by_task.distribution.probabilities == {
        "CardA": pytest.approx(0.75),
        "CardB": pytest.approx(0.25),
        "CardC": pytest.approx(0.0),
    }
    assert by_prompt.top() == ("CardB", pytest.approx(0.8))

    heuristic = DeterministicMockBackend()
    question = _choice(
        "archetype",
        "PortfolioSummary",
        "ClusterMetricsPanel",
        "PatientVitals",
        prompt="Display cluster cpu metrics and incident alerts",
    )
    first = await heuristic.answer(_batch(question, pointers=["/cluster/cpu"]))
    second = await heuristic.answer(_batch(question, pointers=["/cluster/cpu"]))
    assert first == second
    assert first[0].top()[0] == "ClusterMetricsPanel"
    assert first[0].top()[1] >= 0.85
    (single,) = await heuristic.answer(_batch(_choice("one", "Only")))
    assert single.distribution.probabilities == {"Only": 1.0}


@pytest.mark.asyncio
async def test_mock_backend_rejects_numeric_script_for_choice() -> None:
    backend = DeterministicMockBackend(scripted_answers={"q": 0.5})
    with pytest.raises(ValueError, match="requires boolean or score"):
        await backend.answer(_batch(_choice("q", "a", "b")))


# --- Factory ------------------------------------------------------------------


def test_create_decision_backend_requires_a_configured_kind(
    clean_env: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValueError, match="A2UI_DECISION_BACKEND"):
        create_decision_backend()
    # A URL alone no longer picks a backend.
    with pytest.raises(ValueError, match="A2UI_DECISION_BACKEND"):
        create_decision_backend(endpoint_url="http://localhost:8000/v1/completions")

    assert isinstance(create_decision_backend("mock"), DeterministicMockBackend)
    clean_env.setenv("A2UI_DECISION_BACKEND", "MOCK")
    assert isinstance(create_decision_backend(), DeterministicMockBackend)

    for unknown in ("unknown_kind", "local"):
        with pytest.raises(ValueError, match="Unknown decision backend type"):
            create_decision_backend(unknown)


def test_create_decision_backend_http_kinds(clean_env: pytest.MonkeyPatch) -> None:
    sys1 = create_decision_backend(
        "jev",
        endpoint_url="https://api.example.com/v1/systemone",
        model="gemma",
        timeout_seconds=12.0,
        calibration=Calibration(temperature=3.0),
    )
    assert isinstance(sys1, JevHttpBackend)
    assert (sys1._wire_format, sys1.model_id) == ("systemone", "gemma")
    assert sys1._timeout_seconds == 12.0
    assert sys1.calibration.temperature == 3.0

    step0 = create_decision_backend(
        "step0", endpoint_url="http://localhost:8000/v1/completions", model="g"
    )
    assert isinstance(step0, StepZeroLogprobBackend)
    assert step0.model_id == "g"

    native = create_decision_backend("jev", endpoint_url="http://localhost:8080/p")
    assert isinstance(native, JevHttpBackend)
    assert (native._wire_format, native.model_id) == ("jev", "default")

    native_custom = create_decision_backend(
        "jev", endpoint_url="http://localhost:8080/p", model="custom-jev"
    )
    assert isinstance(native_custom, JevHttpBackend)
    assert (native_custom._wire_format, native_custom.model_id) == ("jev", "custom-jev")

    for kind in ("systemone", "jev", "gemini", "step0"):
        with pytest.raises(ValueError, match="requires an endpoint URL"):
            create_decision_backend(kind)


def test_create_decision_backend_pins_hosted_models(
    clean_env: pytest.MonkeyPatch,
) -> None:
    assert DEFAULT_TYPESAFE_MODEL == "jev-1.14.0"
    assert DEFAULT_GEMINI_DECISION_MODEL == "gemini-decision-1"
    clean_env.setenv("JEV_API_KEY", "ts-test-key")
    typesafe = create_decision_backend("jev")
    assert isinstance(typesafe, JevHttpBackend)
    assert typesafe.endpoint_url == "https://api.typesafe.ai/v1/systemone"
    assert typesafe.model_id == "jev-1.14.0"
    assert typesafe.calibration.temperature == 1.0

    clean_env.setenv("JEV_API_KEY", "vcp_vercel_gateway_key")
    vercel = create_decision_backend("jev")
    assert isinstance(vercel, JevHttpBackend)
    assert vercel.endpoint_url == "https://ai-gateway.vercel.sh/typesafe/v1/systemone"
    assert vercel.model_id == "jev"

    clean_env.setenv("JEV_MODEL", "jev-v1")
    assert create_decision_backend("jev").model_id == "jev-v1"

    clean_env.setenv("GEMINI_API_KEY", "gem-test-key")
    gemini = create_decision_backend("gemini")
    assert isinstance(gemini, JevHttpBackend)
    assert gemini.backend_kind == "gemini"
    assert (
        gemini.endpoint_url
        == "https://generativelanguage.googleapis.com/v1beta/decisions"
    )
    assert gemini.model_id == "gemini-decision-1"
    assert gemini._wire_format == DecisionWireFormat.GEMINI_DECISIONS.value

    clean_env.setenv("GEMINI_DECISION_MODEL", "gemini-decision-2")
    assert create_decision_backend("gemini").model_id == "gemini-decision-2"


def test_generic_token_does_not_select_the_hosted_url(
    clean_env: pytest.MonkeyPatch,
) -> None:
    clean_env.setenv("A2UI_DECISION_TOKEN", "generic")
    with pytest.raises(ValueError, match="requires an endpoint URL"):
        create_decision_backend("jev")


def test_decision_synthesizer_from_env(clean_env: pytest.MonkeyPatch) -> None:
    from a2ui.core import Catalog
    from a2ui.inference_formats.decision import DecisionSynthesizer

    clean_env.setenv("A2UI_DECISION_BACKEND", "mock")
    cat = Catalog.from_json({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/cat",
        "protocolVersion": "1.0",
        "components": {
            "Card": {
                "type": "object",
                "properties": {"component": {"const": "Card"}},
                "required": ["component"],
            }
        },
    })
    synth = DecisionSynthesizer.from_env([cat])
    assert isinstance(synth.backend, DeterministicMockBackend)


def test_step_zero_completion_payload_handles_query_parameters() -> None:
    chat_backend = StepZeroLogprobBackend(
        "https://example.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2024-06-01",
        "gpt",
    )
    chat_payload = chat_backend._completion_payload("Pick A or B", 5)
    assert "messages" in chat_payload
    assert "prompt" not in chat_payload

    legacy_backend = StepZeroLogprobBackend(
        "http://localhost:8000/v1/completions?target=/chat/completions",
        "gpt",
    )
    legacy_payload = legacy_backend._completion_payload("Pick A or B", 5)
    assert "prompt" in legacy_payload
    assert "messages" not in legacy_payload


def test_get_adc_token_sync_resolves_gcloud_via_which(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import subprocess
    import google.auth
    from a2ui.inference_formats.decision import backends

    def fail_default(*args: Any, **kwargs: Any) -> Any:
        del args, kwargs
        raise RuntimeError("no adc")

    monkeypatch.setattr(google.auth, "default", fail_default)

    calls: list[list[str]] = []

    def fake_run(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        del kwargs
        calls.append(list(cmd))
        return subprocess.CompletedProcess(cmd, 0, stdout="gcloud-tok\n", stderr="")

    monkeypatch.setattr(backends.subprocess, "run", fake_run)
    monkeypatch.setattr(backends.shutil, "which", lambda name: None)
    assert backends._get_adc_token_sync(3.0) is None
    assert calls == []

    monkeypatch.setattr(backends.shutil, "which", lambda name: "/opt/bin/gcloud")
    assert backends._get_adc_token_sync(3.0) == "gcloud-tok"
    assert calls == [["/opt/bin/gcloud", "auth", "print-access-token"]]


@pytest.mark.asyncio
async def test_jev_http_backend_records_server_reported_latency_ms() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        if "questions" in body and isinstance(body["questions"], dict):
            return httpx.Response(
                200,
                json={
                    "answers": {"q": {"probabilities": {"a": 0.8, "b": 0.2}}},
                    "ms": 112.4,
                },
            )
        return httpx.Response(
            200,
            json={
                "answers": [{"id": "q", "probabilities": {"a": 0.7, "b": 0.3}}],
                "model_ms": 48.5,
            },
        )

    batch = _batch(_choice("q", "a", "b"))
    async with _json_client(handler) as client:
        sys1 = JevHttpBackend("http://local/v1/systemone", client=client)
        assert sys1.last_call_latency_ms is None
        await sys1.answer(batch)
        assert sys1.last_call_latency_ms == pytest.approx(112.4)

        native = JevHttpBackend("http://local/predict", client=client)
        await native.answer(batch)
        assert native.last_call_latency_ms == pytest.approx(48.5)


@pytest.mark.asyncio
async def test_gemini_decisions_wire_format_and_error_surfacing() -> None:
    captured_requests: list[tuple[dict[str, str], dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured_requests.append((dict(request.headers), body))
        if body.get("input", "").startswith("User intent: blocked"):
            return httpx.Response(
                400,
                json={
                    "error": {
                        "code": "safety",
                        "message": "Request blocked by safety filter.",
                    }
                },
            )
        return httpx.Response(
            200,
            json={
                "answers": {
                    "q_0": {"noul": 0.85, "confidence": 0.85},
                    "q_1": {
                        "choice": "primary",
                        "probabilities": {"primary": 0.75, "secondary": 0.25},
                        "confidence": 0.75,
                    },
                },
                "usage": {"total_input_tokens": 102},
            },
        )

    q_gate = DecisionQuestion(
        id="gate:banner",
        kind=QuestionKind.BOOLEAN,
        prompt="Does the payload include an urgent alert banner?",
        context={"yes": "Has an alert", "no": "No alert"},
    )
    q_salience = DecisionQuestion(
        id="salience:/cpu_percent",
        kind=QuestionKind.CHOICE,
        prompt="Which salience tier fits /cpu_percent?",
        options=("primary", "secondary"),
    )
    q_single = DecisionQuestion(
        id="single:only",
        kind=QuestionKind.CHOICE,
        prompt="Single option short-circuit",
        options=("only_one",),
        allow_none=False,
    )
    batch = DecisionBatch(
        shared_context={"intent": "Monitor CPU usage", "pointers": ["/cpu_percent"]},
        questions=(q_gate, q_salience, q_single),
    )

    async with _json_client(handler) as client:
        default_cal = JevHttpBackend(
            "https://generativelanguage.googleapis.com/v1beta/decisions",
            auth="gemini-secret-key",
            client=client,
        )
        assert default_cal.calibration.temperature == pytest.approx(0.25)

        backend = JevHttpBackend(
            "https://generativelanguage.googleapis.com/v1beta/decisions",
            auth="gemini-secret-key",
            calibration=Calibration(temperature=1.0),
            client=client,
        )
        assert backend.backend_kind == "gemini"
        assert backend.model_id == "gemini-decision-1"
        answers = await backend.answer(batch)

        assert len(captured_requests) == 1
        hdrs, payload = captured_requests[0]
        assert hdrs.get("x-goog-api-key") == "gemini-secret-key"
        assert "authorization" not in hdrs
        assert payload["model"] == "gemini-decision-1"
        assert "input" in payload and "state" not in payload
        assert "Monitor CPU usage" in payload["input"]
        assert set(payload["questions"].keys()) == {"q_0", "q_1"}
        assert payload["questions"]["q_0"]["criteria"] == {
            "true_description": "Has an alert",
            "false_description": "No alert",
        }

        assert [a.question_id for a in answers] == [
            "gate:banner",
            "salience:/cpu_percent",
            "single:only",
        ]
        assert answers[0].distribution.probabilities["yes"] == pytest.approx(0.85)
        assert answers[1].distribution.probabilities["primary"] == pytest.approx(0.75)
        assert answers[2].distribution.probabilities["only_one"] == pytest.approx(1.0)
        assert backend.last_call_latency_ms is None

        blocked_batch = DecisionBatch(
            shared_context={"intent": "blocked request"},
            questions=(q_gate,),
        )
        with pytest.raises(DecisionBackendError, match="safety: Request blocked"):
            await backend.answer(blocked_batch)
