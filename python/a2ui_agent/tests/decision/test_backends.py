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

"""Unit tests for local decision-model inference backends."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import sys
from typing import Any

import httpx
import pytest

from a2ui.inference_formats.decision import (
    DecisionBackend,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuery,
    DecisionQuestion,
    DeterministicMockBackend,
    JevHttpBackend,
    PredictOnlyBackend,
    QuestionKind,
    StepZeroLogprobBackend,
    create_decision_backend,
    ensure_batch_backend,
)


def test_backends_satisfy_runtime_protocol() -> None:
    jev = JevHttpBackend("http://localhost:8080/predict")
    step_zero = StepZeroLogprobBackend("http://localhost:8000/v1/completions", "m")
    mock = DeterministicMockBackend()
    assert isinstance(jev, DecisionBackend)
    assert isinstance(step_zero, DecisionBackend)
    assert isinstance(mock, DecisionBackend)


@pytest.mark.asyncio
async def test_predict_only_backends_are_adapted_to_the_full_protocol() -> None:
    """A third-party object with only `predict` (and optionally `aclose`) still works."""
    closed = False

    class LegacyPredictOnly:

        async def predict(self, query: DecisionQuery) -> DecisionDistribution:
            first = query.candidates[0]
            return DecisionDistribution(
                probabilities={c: 0.9 if c == first else 0.1 for c in query.candidates}
            )

        async def aclose(self) -> None:
            nonlocal closed
            closed = True

    legacy = LegacyPredictOnly()
    assert not isinstance(legacy, DecisionBackend)
    adapted = ensure_batch_backend(legacy)
    assert isinstance(adapted, DecisionBackend)
    assert isinstance(adapted, PredictOnlyBackend)
    batch = DecisionBatch(
        shared_context={},
        questions=(
            DecisionQuestion(
                id="gate:prose", kind=QuestionKind.BOOLEAN, prompt="Prose?"
            ),
            DecisionQuestion(
                id="family",
                kind=QuestionKind.CHOICE,
                prompt="Family?",
                options=("browse", "inspect"),
                allow_none=False,
            ),
        ),
    )
    answers = await adapted.answer(batch)
    assert [a.question_id for a in answers] == ["gate:prose", "family"]
    assert answers[0].yes == pytest.approx(0.9)
    assert answers[1].top()[0] == "browse"
    await adapted.aclose_current_loop()
    async with adapted:
        pass
    assert closed

    # Objects that already satisfy the protocol are returned unchanged.
    mock = DeterministicMockBackend()
    assert ensure_batch_backend(mock) is mock
    with pytest.raises(TypeError, match="predict"):
        ensure_batch_backend(object())


@pytest.mark.asyncio
async def test_jev_http_backend_normalizes_and_filters_probabilities() -> None:
    captured_Bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_Bodies.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "probabilities": {
                    "PortfolioCard": 0.6,
                    "OrderTicket": 0.2,
                    "UnrequestedWidget": 0.9,
                },
                "calibrated": False,
                "top_logit_margin": 1.85,
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = JevHttpBackend("http://jev.local/predict", client=client)
        query = DecisionQuery(
            task="root_component",
            prompt="Show portfolio summary",
            candidates=("PortfolioCard", "OrderTicket", "MissingCard"),
            context={"pointers": ["/totalValue"]},
        )
        dist = await backend.predict(query)

    assert len(captured_Bodies) == 1
    assert captured_Bodies[0] == {
        "task": "root_component",
        "prompt": "Show portfolio summary",
        "candidates": ["PortfolioCard", "OrderTicket", "MissingCard"],
        "context": {"pointers": ["/totalValue"]},
    }
    assert dist.calibrated is False
    assert dist.top_logit_margin == pytest.approx(1.85)
    assert set(dist.probabilities.keys()) == {
        "PortfolioCard",
        "OrderTicket",
        "MissingCard",
    }
    assert dist.probabilities["PortfolioCard"] == pytest.approx(0.75)
    assert dist.probabilities["OrderTicket"] == pytest.approx(0.25)
    assert dist.probabilities["MissingCard"] == pytest.approx(0.0)
    assert dist.top_choice() == ("PortfolioCard", pytest.approx(0.75))


@pytest.mark.asyncio
async def test_jev_http_backend_handles_all_zero_and_empty_candidates() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(
            200,
            json={"probabilities": {"Other": 0.5}, "calibrated": True},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = JevHttpBackend("http://jev.local/predict", client=client)
        dist_zero = await backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("A", "B"))
        )
        assert dist_zero.probabilities == {"A": 0.0, "B": 0.0}
        assert dist_zero.calibrated is True
        assert dist_zero.top_logit_margin is None

        dist_empty = await backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=())
        )
        assert dist_empty.probabilities == {}


def test_step_zero_logprob_backend_rejects_non_positive_temperature() -> None:
    with pytest.raises(ValueError, match="temperature"):
        StepZeroLogprobBackend(
            "http://localhost:8000/v1/completions", "model", temperature=0.0
        )
    with pytest.raises(ValueError, match="temperature"):
        StepZeroLogprobBackend(
            "http://localhost:8000/v1/completions", "model", temperature=-0.5
        )


@pytest.mark.asyncio
async def test_step_zero_logprob_backend_softmax_and_temperature_scaling() -> None:
    captured_requests: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "choices": [{
                    "logprobs": {
                        "top_logprobs": [{
                            " VitalsCard": -0.5,
                            "LabTable": -2.5,
                            "IgnoredToken": -0.1,
                        }]
                    }
                }]
            },
        )

    transport = httpx.MockTransport(handler)
    query = DecisionQuery(
        task="root_component",
        prompt="Show patient vitals",
        candidates=("VitalsCard", "LabTable"),
    )

    async with httpx.AsyncClient(transport=transport) as client:
        uncalibrated_backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions",
            "gemma-decision",
            temperature=1.0,
            client=client,
        )
        dist_t1 = await uncalibrated_backend.predict(query)

        sharp_backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions",
            "gemma-decision",
            temperature=0.5,
            client=client,
        )
        dist_t05 = await sharp_backend.predict(query)

        flat_backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions",
            "gemma-decision",
            temperature=2.0,
            client=client,
        )
        dist_t2 = await flat_backend.predict(query)

    assert captured_requests[0]["model"] == "gemma-decision"
    assert "Task: root_component" in captured_requests[0]["prompt"]
    assert "Candidates: [A: VitalsCard, B: LabTable]" in captured_requests[0]["prompt"]
    assert "Intent: Show patient vitals" in captured_requests[0]["prompt"]
    assert captured_requests[0]["max_tokens"] == 1
    assert captured_requests[0]["temperature"] == 0.0
    assert captured_requests[0]["logprobs"] == 5
    assert dist_t1.calibrated is False
    assert dist_t05.calibrated is True
    assert dist_t2.calibrated is True

    assert dist_t1.top_logit_margin == pytest.approx(2.0)
    assert dist_t05.top_logit_margin == pytest.approx(2.0)
    assert dist_t2.top_logit_margin == pytest.approx(2.0)

    expected_t1_vitals = 1.0 / (1.0 + math.exp(-2.0))
    assert dist_t1.probabilities["VitalsCard"] == pytest.approx(expected_t1_vitals)
    assert dist_t1.probabilities["LabTable"] == pytest.approx(1.0 - expected_t1_vitals)
    assert (
        dist_t05.probabilities["VitalsCard"]
        > dist_t1.probabilities["VitalsCard"]
        > dist_t2.probabilities["VitalsCard"]
    )


@pytest.mark.asyncio
async def test_step_zero_logprob_backend_missing_and_empty_candidates() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(
            200,
            json={"choices": [{"logprobs": {"top_logprobs": [{"OnlyOne": -1.0}]}}]},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions",
            "gemma-decision",
            temperature=1.2,
            client=client,
        )
        dist_single = await backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("OnlyOne",))
        )
        assert dist_single.probabilities == {"OnlyOne": pytest.approx(1.0)}
        assert dist_single.top_logit_margin is not None
        assert math.isinf(dist_single.top_logit_margin)

        dist_missing = await backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("MissingA", "MissingB"))
        )
        assert dist_missing.probabilities == {
            "MissingA": pytest.approx(0.5),
            "MissingB": pytest.approx(0.5),
        }
        assert dist_missing.top_logit_margin == pytest.approx(0.0)

        dist_empty = await backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=())
        )
        assert dist_empty.probabilities == {}
        assert dist_empty.top_logit_margin == pytest.approx(0.0)
        assert dist_empty.calibrated is True


@pytest.mark.asyncio
async def test_deterministic_mock_backend_scorer_and_scripted() -> None:
    custom_dist = DecisionDistribution(
        probabilities={"Custom": 1.0}, calibrated=False, top_logit_margin=0.9
    )
    scored_backend = DeterministicMockBackend(scorer=lambda q: custom_dist)
    res = await scored_backend.predict(
        DecisionQuery(task="any", prompt="any", candidates=("Custom",))
    )
    assert res == custom_dist

    scripted_backend = DeterministicMockBackend(
        scripted={
            "root_component": {"CardA": 3.0, "CardB": 1.0, "Extra": 5.0},
            "root_component:specific prompt": {"CardB": 4.0, "CardA": 1.0},
        },
        calibrated=False,
        default_logit_margin=3.2,
    )
    dist_task = await scripted_backend.predict(
        DecisionQuery(
            task="root_component",
            prompt="general prompt",
            candidates=("CardA", "CardB", "CardC"),
        )
    )
    assert dist_task.calibrated is False
    assert dist_task.top_logit_margin == pytest.approx(3.2)
    assert dist_task.probabilities == {
        "CardA": pytest.approx(0.75),
        "CardB": pytest.approx(0.25),
        "CardC": pytest.approx(0.0),
    }

    dist_specific = await scripted_backend.predict(
        DecisionQuery(
            task="root_component",
            prompt="specific prompt",
            candidates=("CardA", "CardB"),
        )
    )
    assert dist_specific.probabilities == {
        "CardA": pytest.approx(0.20),
        "CardB": pytest.approx(0.80),
    }


@pytest.mark.asyncio
async def test_deterministic_mock_backend_heuristic_and_edge_cases() -> None:
    backend = DeterministicMockBackend()
    query = DecisionQuery(
        task="root_component",
        prompt="Display cluster cpu metrics and incident alerts",
        candidates=("PortfolioSummary", "ClusterMetricsPanel", "PatientVitals"),
        context={"pointers": ["/cluster/cpu", "/incidents"]},
    )
    dist1 = await backend.predict(query)
    dist2 = await backend.predict(query)
    assert dist1 == dist2
    assert sum(dist1.probabilities.values()) == pytest.approx(1.0)
    top_cand, top_prob = dist1.top_choice()
    assert top_cand == "ClusterMetricsPanel"
    assert top_prob >= 0.85

    dist_single = await backend.predict(
        DecisionQuery(task="t", prompt="p", candidates=("SingleComp",))
    )
    assert dist_single.probabilities == {"SingleComp": 1.0}

    dist_empty = await backend.predict(
        DecisionQuery(task="t", prompt="p", candidates=())
    )
    assert dist_empty.probabilities == {}
    assert dist_empty.top_logit_margin == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_normalize_probabilities_preserves_sub_unit_mass_and_fail_closed_calibration() -> (
    None
):
    """Verifies H3 (sub-1.0 mass is not inflated to 1.0) and M2 (missing calibrated is False)."""

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(
            200,
            json={
                "probabilities": {"LowConfCandidate": 0.10, "Unlisted": 0.85},
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = JevHttpBackend("http://jev.local/predict", client=client)
        dist = await backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("LowConfCandidate",))
        )
    assert dist.calibrated is False
    assert dist.probabilities["LowConfCandidate"] == pytest.approx(0.10)
    assert dist.top_choice() == ("LowConfCandidate", pytest.approx(0.10))


@pytest.mark.asyncio
async def test_step_zero_logprob_backend_caps_logprobs_at_20_and_closes_owned_client() -> (
    None
):
    """Verifies Q1 (logprobs capped at 20 for >20 candidates) and M6 (aclose on owned client)."""
    captured: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={"choices": [{"logprobs": {"top_logprobs": [{"C0": -0.2}]}}]},
        )

    with pytest.raises(ValueError, match="max_logprobs"):
        StepZeroLogprobBackend(
            "http://localhost:8000/v1/completions", "m", max_logprobs=25
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions",
            "gemma",
            max_logprobs=8,
            client=client,
        )
        ten_candidates = tuple(f"C{i}" for i in range(10))
        await backend.predict(
            DecisionQuery(
                task="root_component",
                prompt="Pick one",
                candidates=ten_candidates,
                context={"k": "v"},
            )
        )
    assert captured[0]["logprobs"] == 8
    assert "Context: {'k': 'v'}" in captured[0]["prompt"]

    owned_jev = JevHttpBackend("http://jev.local/predict")
    c1 = owned_jev._get_client()
    c2 = owned_jev._get_client()
    assert c1 is c2
    await owned_jev.aclose()

    owned_step = StepZeroLogprobBackend("http://vllm.local/v1/completions", "m")
    s1 = owned_step._get_client()
    s2 = owned_step._get_client()
    assert s1 is s2
    await owned_step.aclose()


@pytest.mark.asyncio
async def test_normalize_probabilities_ignores_non_numeric_values() -> None:
    """Safely ignores non-numeric probability values during normalization."""

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(
            200,
            json={
                "probabilities": {
                    "ValidCard": "0.75",
                    "InvalidCard": "not-a-number",
                    "NullMeta": None,
                    "ObjectMeta": {"nested": 1},
                },
                "calibrated": True,
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = JevHttpBackend("http://jev.local/predict", client=client)
        dist = await backend.predict(
            DecisionQuery(
                task="root_component",
                prompt="p",
                candidates=("ValidCard", "InvalidCard"),
            )
        )
    assert dist.probabilities == {
        "ValidCard": pytest.approx(0.75),
        "InvalidCard": pytest.approx(0.0),
    }


@pytest.mark.asyncio
async def test_jev_http_backend_systemone_auto_detection_and_payload() -> None:
    captured_requests: list[dict[str, Any]] = []
    captured_headers: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(json.loads(request.content.decode("utf-8")))
        captured_headers.append(dict(request.headers))
        return httpx.Response(
            200,
            json={
                "answers": {
                    "q": {
                        "probabilities": {
                            "CardA": 0.8,
                            "CardB": 0.2,
                        },
                        "confidence": 0.8,
                    }
                }
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = JevHttpBackend(
            "https://api.example.com/v1/systemone",
            model="decisiongemma",
            auth="secret-bearer-token",
            client=client,
        )
        query = DecisionQuery(
            task="child_component",
            prompt="Render telemetry metric",
            candidates=("CardA", "CardB"),
            context={
                "parent_description": "TelemetryGrid",
                "slot_description": "metrics slot",
                "pointers": ["/cpu"],
                "candidate_descriptions": {
                    "CardA": "Card displaying metric",
                    "CardB": "Card displaying chart",
                },
            },
        )
        dist = await backend.predict(query)

    assert len(captured_requests) == 1
    req = captured_requests[0]
    assert req["model"] == "decisiongemma"
    assert "User intent: Render telemetry metric" in req["state"]
    assert "Parent container: TelemetryGrid. Slot: metrics slot" in req["state"]
    assert "Payload data fields: /cpu" in req["state"]
    assert req["questions"]["q"]["criteria"]["CardA"] == "Card displaying metric"
    assert req["questions"]["q"]["criteria"]["CardB"] == "Card displaying chart"

    assert captured_headers[0]["authorization"] == "Bearer secret-bearer-token"
    assert dist.calibrated is True
    assert dist.probabilities["CardA"] == pytest.approx(0.8)
    assert dist.probabilities["CardB"] == pytest.approx(0.2)
    assert dist.top_logit_margin == pytest.approx(math.log(0.8 / 0.2))


@pytest.mark.asyncio
async def test_jev_http_backend_auth_callable_and_adc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_headers: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.append(dict(request.headers))
        return httpx.Response(200, json={"probabilities": {"A": 1.0}})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        # 1. Callable auth
        callable_backend = JevHttpBackend(
            "http://local/predict",
            auth=lambda: "callable-token",
            client=client,
        )
        await callable_backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("A",))
        )
        assert captured_headers[-1]["authorization"] == "Bearer callable-token"

        # 2. ADC auth mock: the token cache lives on the backend instance, so a
        # fresh instance starts without a cached token.
        from a2ui.inference_formats.decision import backends

        adc_calls: list[int] = []

        def fake_adc_token() -> str:
            adc_calls.append(1)
            return "mocked-adc-token"

        monkeypatch.setattr(backends, "_get_adc_token_sync", fake_adc_token)

        adc_backend = JevHttpBackend(
            "http://local/predict",
            auth="adc",
            client=client,
        )
        await adc_backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("A",))
        )
        assert captured_headers[-1]["authorization"] == "Bearer mocked-adc-token"

        # A second predict on the same instance reuses the cached token.
        await adc_backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("A",))
        )
        assert len(adc_calls) == 1

        # A different instance does not share the cache.
        other_backend = JevHttpBackend(
            "http://local/predict", auth="adc", client=client
        )
        await other_backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("A",))
        )
        assert len(adc_calls) == 2


@pytest.mark.asyncio
async def test_jev_http_backend_systemone_empty_and_fallback() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(200, json={"answers": {}})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = JevHttpBackend(
            "http://local/v1/systemone",
            client=client,
        )
        dist = await backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("A", "B"))
        )
        assert dist.probabilities == {"A": 0.0, "B": 0.0}
        assert dist.top_logit_margin == 0.0


def test_create_decision_backend_mock_and_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("A2UI_DECISION_BACKEND", raising=False)
    monkeypatch.delenv("A2UI_DECISION_URL", raising=False)
    monkeypatch.delenv("A2UI_DECISION_AUTH", raising=False)
    monkeypatch.delenv("A2UI_DECISION_TOKEN", raising=False)
    monkeypatch.delenv("JEV_API_KEY", raising=False)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)

    # 1. Default with no env vars returns DeterministicMockBackend
    b_default = create_decision_backend()
    assert isinstance(b_default, DeterministicMockBackend)

    # 2. Explicit mock
    b_mock = create_decision_backend("mock")
    assert isinstance(b_mock, DeterministicMockBackend)

    # 3. Env mock
    monkeypatch.setenv("A2UI_DECISION_BACKEND", "mock")
    b_env_mock = create_decision_backend()
    assert isinstance(b_env_mock, DeterministicMockBackend)

    # 4. Unknown type (including removed 'local')
    with pytest.raises(ValueError, match="Unknown decision backend type"):
        create_decision_backend("unknown_kind")
    with pytest.raises(ValueError, match="Unknown decision backend type"):
        create_decision_backend("local")


def test_create_decision_backend_auto_inference_and_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 1. URL ending in /v1/systemone auto-infers systemone
    monkeypatch.delenv("A2UI_DECISION_BACKEND", raising=False)
    monkeypatch.delenv("A2UI_DECISION_AUTH", raising=False)
    monkeypatch.delenv("A2UI_DECISION_TOKEN", raising=False)
    monkeypatch.delenv("JEV_API_KEY", raising=False)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    b_sys1 = create_decision_backend(
        endpoint_url="https://api.example.com/v1/systemone", model="gemma"
    )
    assert isinstance(b_sys1, JevHttpBackend)
    assert b_sys1._wire_format == "systemone"
    assert b_sys1.model == "gemma"
    assert b_sys1.endpoint_url == "https://api.example.com/v1/systemone"

    # 2. URL ending in /v1/completions auto-infers step0
    b_step0 = create_decision_backend(
        endpoint_url="http://localhost:8000/v1/completions",
        model="gemma-step0",
    )
    assert isinstance(b_step0, StepZeroLogprobBackend)
    assert b_step0._model == "gemma-step0"

    # 3. Generic URL auto-infers jev
    b_jev = create_decision_backend(endpoint_url="http://localhost:8080/predict")
    assert isinstance(b_jev, JevHttpBackend)
    assert b_jev._wire_format == "jev"

    # 4. HTTP backends without URL or JEV_API_KEY raise ValueError
    with pytest.raises(ValueError, match="requires an endpoint URL"):
        create_decision_backend("systemone")
    with pytest.raises(ValueError, match="requires an endpoint URL"):
        create_decision_backend("jev")
    with pytest.raises(ValueError, match="requires an endpoint URL"):
        create_decision_backend("step0")

    # 5. JEV_API_KEY auto-configures TypeSafe /v1/systemone or Vercel AI Gateway /typesafe/v1/systemone
    monkeypatch.setenv("JEV_API_KEY", "ts-test-key")
    b_typesafe = create_decision_backend("jev")
    assert isinstance(b_typesafe, JevHttpBackend)
    assert b_typesafe.endpoint_url == "https://api.typesafe.ai/v1/systemone"
    assert b_typesafe.model == "jev-latest"

    monkeypatch.setenv("JEV_API_KEY", "vcp_vercel_gateway_key")
    b_vercel = create_decision_backend("jev")
    assert isinstance(b_vercel, JevHttpBackend)
    assert b_vercel.endpoint_url == "https://ai-gateway.vercel.sh/typesafe/v1/systemone"
    assert b_vercel.model == "jev"


@pytest.mark.asyncio
async def test_non_finite_weights_adc_lock_and_off_thread_ensure_loaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies M1 (_ensure_loaded off event loop), M4 (non-finite weight rejection), and M9 (ADC lock)."""
    import asyncio
    import threading
    from a2ui.inference_formats.decision import backends

    # M4: "inf" and NaN weights are treated as 0.0 instead of producing NaN probabilities.
    norm = backends._normalize_probabilities(
        {"A": "inf", "B": float("nan"), "C": 2.0}, ("A", "B", "C")
    )
    assert norm == {"A": 0.0, "B": 0.0, "C": 1.0}
    assert all(math.isfinite(v) for v in norm.values())

    # M9: Concurrent ADC requests only refresh the token once.
    adc_call_count = 0

    def slow_adc_token() -> str:
        nonlocal adc_call_count
        import time

        time.sleep(0.02)
        adc_call_count += 1
        return "concurrent-adc-token"

    monkeypatch.setattr(backends, "_get_adc_token_sync", slow_adc_token)
    transport = httpx.MockTransport(
        lambda req: httpx.Response(200, json={"probabilities": {"A": 1.0}})
    )
    async with httpx.AsyncClient(transport=transport) as client:
        jev = JevHttpBackend("http://local/predict", auth="adc", client=client)
        q = DecisionQuery(task="t", prompt="p", candidates=("A",))
        await asyncio.gather(jev.predict(q), jev.predict(q), jev.predict(q))
    assert adc_call_count == 1


@pytest.mark.asyncio
async def test_mock_backend_scripted_answers_and_batches_recording() -> None:
    from a2ui.inference_formats.decision.models import (
        DecisionAnswer,
        DecisionBatch,
        DecisionQuestion,
        QuestionKind,
    )

    q_choice = DecisionQuestion(
        id="family",
        kind=QuestionKind.CHOICE,
        prompt="Browse or inspect?",
        options=("browse", "inspect"),
    )
    q_bool = DecisionQuestion(
        id="gate:picture",
        kind=QuestionKind.BOOLEAN,
        prompt="Show a picture?",
        context={"yes": "Visual item.", "no": "Plain text."},
    )
    q_score = DecisionQuestion(
        id="stakes",
        kind=QuestionKind.SCORE,
        prompt="How high are the stakes?",
        options=("low", "medium", "high", "critical"),
    )
    q_explicit = DecisionQuestion(
        id="anatomy:layout",
        kind=QuestionKind.CHOICE,
        prompt="Choose layout",
        options=("rows", "cards"),
        allow_none=False,
    )
    q_unscripted_bool = DecisionQuestion(
        id="gate:facts",
        kind=QuestionKind.BOOLEAN,
        prompt="Include facts?",
    )
    q_unscripted_score = DecisionQuestion(
        id="urgency",
        kind=QuestionKind.SCORE,
        prompt="How urgent?",
        options=("none", "soon", "now", "immediate"),
    )

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
    batch = DecisionBatch(
        shared_context={"intent": "Inspect the resort"},
        questions=(
            q_choice,
            q_bool,
            q_score,
            q_explicit,
            q_unscripted_bool,
            q_unscripted_score,
        ),
    )
    answers = await backend.answer(batch)

    assert backend.batches == [batch]
    # scripted_answers wins over scripted when both match
    assert answers[0].top() == ("inspect", pytest.approx(0.9))
    assert answers[1].yes == pytest.approx(0.85)
    assert answers[2].expected == pytest.approx(2.4)
    assert answers[3] == explicit_ans
    # Unscripted boolean defaults to 0.5 and unscripted score to midpoint 1.5
    assert answers[4].yes == pytest.approx(0.5)
    assert answers[5].expected == pytest.approx(1.5)


@pytest.mark.asyncio
async def test_step_zero_logprob_backend_single_char_labels_batch_and_over_10_error() -> (
    None
):
    from a2ui.core import A2uiValidationError
    from a2ui.inference_formats.decision.models import (
        DecisionBatch,
        DecisionQuestion,
        QuestionKind,
    )

    captured_prompts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured_prompts.append(body["prompt"])
        return httpx.Response(
            200,
            json={
                "choices": [{
                    "logprobs": {
                        "top_logprobs": [{
                            " A": -2.0,
                            " B": -0.2,
                            " C": -4.0,
                        }]
                    }
                }]
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions",
            "gemma-step0",
            temperature=1.0,
            client=client,
        )

        # 1. Single-char label mapping on predict
        dist = await backend.predict(
            DecisionQuery(
                task="family",
                prompt="Pick family",
                candidates=("browse", "inspect", "monitor"),
            )
        )
        assert dist.top_choice()[0] == "inspect"
        assert "Candidates: [A: browse, B: inspect, C: monitor]" in captured_prompts[0]

        # 2. >10 options raises A2uiValidationError on both predict and answer
        eleven_opts = tuple(f"opt_{i}" for i in range(11))
        with pytest.raises(A2uiValidationError, match="at most 10"):
            await backend.predict(
                DecisionQuery(task="t", prompt="p", candidates=eleven_opts)
            )
        with pytest.raises(A2uiValidationError, match="at most 10"):
            await backend.answer(
                DecisionBatch(
                    shared_context={},
                    questions=(
                        DecisionQuestion(
                            id="too_many",
                            kind=QuestionKind.CHOICE,
                            prompt="?",
                            options=eleven_opts,
                            allow_none=False,
                        ),
                    ),
                )
            )

        # 3. answer() issues concurrent requests with one shared prefix string
        captured_prompts.clear()
        q1 = DecisionQuestion(
            id="family",
            kind=QuestionKind.CHOICE,
            prompt="What job?",
            options=("browse", "inspect"),
        )
        q2 = DecisionQuestion(
            id="gate:picture",
            kind=QuestionKind.BOOLEAN,
            prompt="Show picture?",
        )
        answers = await backend.answer(
            DecisionBatch(
                shared_context={"intent": "Show resort"},
                questions=(q1, q2),
            )
        )
        assert len(answers) == 2
        assert len(captured_prompts) == 2
        first_line_0 = captured_prompts[0].splitlines()[0]
        first_line_1 = captured_prompts[1].splitlines()[0]
        assert first_line_0 == first_line_1
        assert first_line_0.startswith("Shared context:")
        assert answers[0].top()[0] == "inspect"
        # "B" is "no" for boolean ("yes", "no") so "yes" is lower than "no"
        assert answers[1].yes < 0.5


@pytest.mark.asyncio
async def test_jev_http_backend_answer_native_and_systemone() -> None:
    from a2ui.inference_formats.decision.models import (
        DecisionBatch,
        DecisionQuestion,
        QuestionKind,
    )

    native_requests: list[dict[str, Any]] = []

    def native_handler(request: httpx.Request) -> httpx.Response:
        native_requests.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "calibrated": True,
                "answers": {
                    "family": {
                        "probabilities": {
                            "browse": 0.1,
                            "inspect": 0.8,
                            "none": 0.1,
                        }
                    },
                    "gate:picture": {"probabilities": {"yes": 0.9, "no": 0.1}},
                    "stakes": {
                        "probabilities": {
                            "low": 0.0,
                            "medium": 0.5,
                            "high": 0.5,
                        }
                    },
                },
            },
        )

    batch = DecisionBatch(
        shared_context={"intent": "Show overview"},
        questions=(
            DecisionQuestion(
                id="family",
                kind=QuestionKind.CHOICE,
                prompt="Family?",
                options=("browse", "inspect"),
            ),
            DecisionQuestion(
                id="gate:picture",
                kind=QuestionKind.BOOLEAN,
                prompt="Picture?",
            ),
            DecisionQuestion(
                id="stakes",
                kind=QuestionKind.SCORE,
                prompt="Stakes?",
                options=("low", "medium", "high"),
            ),
        ),
    )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(native_handler)
    ) as client:
        jev_native = JevHttpBackend("http://jev.local/predict", client=client)
        native_answers = await jev_native.answer(batch)

    assert len(native_requests) == 1
    assert native_requests[0]["shared_context"] == {"intent": "Show overview"}
    assert [q["id"] for q in native_requests[0]["questions"]] == [
        "family",
        "gate:picture",
        "stakes",
    ]
    assert [q["kind"] for q in native_requests[0]["questions"]] == [
        "choice",
        "boolean",
        "score",
    ]
    assert native_answers[0].top() == ("inspect", pytest.approx(0.8))
    assert native_answers[1].yes == pytest.approx(0.9)
    assert native_answers[2].expected == pytest.approx(1.5)

    # systemone sends one batched /v1/systemone request with choice, noul, and score
    sys1_requests: list[dict[str, Any]] = []

    def sys1_handler(request: httpx.Request) -> httpx.Response:
        sys1_requests.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "model": "vertex/decision-gemma",
                "answers": {
                    "family": {
                        "type": "choice",
                        "choice": "inspect",
                        "probabilities": {
                            "browse": 0.2,
                            "inspect": 0.8,
                            "none": 0.0,
                        },
                        "confidence": 0.8,
                    },
                    "gate:picture": {
                        "type": "noul",
                        "noul": 0.75,
                    },
                    "stakes": {
                        "type": "score",
                        "score": 0.5,
                        "legend": {"0": "low", "1": "medium", "2": "high"},
                        "probabilities": {
                            "0": 0.5,
                            "1": 0.5,
                            "2": 0.0,
                        },
                        "confidence": 0.8,
                    },
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(sys1_handler)) as client:
        jev_sys1 = JevHttpBackend(
            "https://api.example.com/v1/systemone",
            model="vertex/decision-gemma",
            client=client,
        )
        sys1_answers = await jev_sys1.answer(batch)

    assert len(sys1_requests) == 1
    assert sys1_requests[0]["model"] == "vertex/decision-gemma"
    assert sys1_requests[0]["state"] == "User intent: Show overview"
    assert sys1_requests[0]["questions"]["family"]["type"] == "choice"
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
async def test_batching_decision_backend_coalesces_20_predicts_and_isolates_failure() -> (
    None
):
    import asyncio
    from a2ui.inference_formats.decision.batching import (
        BatchingDecisionBackend,
    )
    from a2ui.inference_formats.decision.models import (
        DecisionAnswer,
        DecisionBatch,
    )

    inner = DeterministicMockBackend()
    async with BatchingDecisionBackend(inner, window_ms=2.0) as batcher:
        queries = [
            DecisionQuery(
                task="root_component",
                prompt=f"Render component {i} with Target_{i}",
                candidates=(f"Target_{i}", f"Other_{i}"),
            )
            for i in range(20)
        ]
        results = await asyncio.gather(*(batcher.predict(q) for q in queries))

    assert len(inner.batches) == 1
    assert len(inner.batches[0].questions) == 20
    for idx, dist in enumerate(results):
        top_cand, _ = dist.top_choice()
        assert top_cand == f"Target_{idx}"

    # Verify one failing call propagates its exception without poisoning the other 19
    class _SelectiveFailBackend(DeterministicMockBackend):

        async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
            for q in batch.questions:
                if "POISON" in q.prompt:
                    raise RuntimeError(f"failed on {q.id}")
            return await super().answer(batch)

    selective_inner = _SelectiveFailBackend()
    async with BatchingDecisionBackend(selective_inner, window_ms=2.0) as batcher:
        mixed_queries = [
            DecisionQuery(
                task="root_component",
                prompt="POISON query" if i == 7 else f"Valid query Target_{i}",
                candidates=(f"Target_{i}", f"Other_{i}"),
            )
            for i in range(20)
        ]
        outcomes = await asyncio.gather(
            *(batcher.predict(q) for q in mixed_queries),
            return_exceptions=True,
        )

    assert isinstance(outcomes[7], RuntimeError)
    for idx, item in enumerate(outcomes):
        if idx == 7:
            continue
        assert isinstance(item, DecisionDistribution)
        assert item.top_choice()[0] == f"Target_{idx}"

    # H1: truncated answer tuple raises ValueError on all chunk futures instead of hanging
    class _TruncatedAnswerBackend(DeterministicMockBackend):

        async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
            full = await super().answer(batch)
            return full[:-1]

    trunc_inner = _TruncatedAnswerBackend()
    async with BatchingDecisionBackend(trunc_inner, window_ms=2.0) as batcher:
        with pytest.raises(ValueError, match="Expected .* answers from backend"):
            await asyncio.gather(
                batcher.predict(
                    DecisionQuery(task="t", prompt="q1", candidates=("A", "B"))
                ),
                batcher.predict(
                    DecisionQuery(task="t", prompt="q2", candidates=("A", "B"))
                ),
            )
    await batcher.aclose_current_loop()


@pytest.mark.asyncio
async def test_step_zero_chat_completions_and_bearer_auth() -> None:
    """`StepZeroLogprobBackend` supports `/v1/chat/completions` and Bearer auth."""
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
                            "token": "B",
                            "logprob": -0.05,
                            "top_logprobs": [
                                {"token": "B", "logprob": -0.05},
                                {"token": "A", "logprob": -3.10},
                            ],
                        }]
                    }
                }]
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = StepZeroLogprobBackend(
            "https://api.openai.com/v1/chat/completions",
            "gpt-4o-mini",
            auth="sk-test-123",
            client=client,
        )
        dist = await backend.predict(
            DecisionQuery(
                task="family",
                prompt="What is the user trying to do?",
                candidates=("browse", "monitor", "inspect"),
            )
        )
    assert captured_headers[0].get("authorization") == "Bearer sk-test-123"
    assert captured_bodies[0]["logprobs"] is True
    assert captured_bodies[0]["top_logprobs"] == 5
    assert "messages" in captured_bodies[0]
    assert dist.top_choice()[0] == "monitor"


@pytest.mark.asyncio
async def test_step_zero_logprob_case_insensitive_fallback_and_non_mapping_choice() -> (
    None
):
    """Matches lowercase/whitespace logprob tokens and ignores non-mapping choices."""
    responses = [
        {"choices": [{"logprobs": {"top_logprobs": [{" b": -0.1, " a": -2.5}]}}]},
        {"choices": ["malformed-non-mapping-choice"]},
    ]
    call_idx = 0

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        nonlocal call_idx
        body = responses[call_idx]
        call_idx += 1
        return httpx.Response(200, json=body)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        backend = StepZeroLogprobBackend(
            "http://vllm.local/v1/completions", "gemma", client=client
        )
        dist = await backend.predict(
            DecisionQuery(task="family", prompt="p", candidates=("browse", "monitor"))
        )
        assert dist.top_choice()[0] == "monitor"

        dist_malformed = await backend.predict(
            DecisionQuery(task="family", prompt="p", candidates=("browse", "monitor"))
        )
        assert dist_malformed.probabilities == {
            "browse": pytest.approx(0.5),
            "monitor": pytest.approx(0.5),
        }
