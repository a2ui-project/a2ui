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

import json
import math
from typing import Any

import httpx
import pytest

from a2ui.inference_formats.decision.backends import (
    DecisionBackend,
    DeterministicMockBackend,
    JevHttpBackend,
    StepZeroLogprobBackend,
)
from a2ui.inference_formats.decision.models import (
    DecisionDistribution,
    DecisionQuery,
)


def test_backends_satisfy_runtime_protocol() -> None:
    jev = JevHttpBackend("http://localhost:8080/predict")
    step_zero = StepZeroLogprobBackend("http://localhost:8000/v1/completions", "m")
    mock = DeterministicMockBackend()
    assert isinstance(jev, DecisionBackend)
    assert isinstance(step_zero, DecisionBackend)
    assert isinstance(mock, DecisionBackend)


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
    assert "Candidates: [VitalsCard, LabTable]" in captured_requests[0]["prompt"]
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
        assert dist_single.top_logit_margin == pytest.approx(0.0)

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
            "http://vllm.local/v1/completions", "gemma", client=client
        )
        many_candidates = tuple(f"C{i}" for i in range(30))
        await backend.predict(
            DecisionQuery(
                task="root_component",
                prompt="Pick one",
                candidates=many_candidates,
                context={"k": "v"},
            )
        )
    assert captured[0]["logprobs"] == 20
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
