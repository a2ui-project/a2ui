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

from a2ui.inference_formats.decision.backends import (
    DecisionBackend,
    DeterministicMockBackend,
    JevHttpBackend,
    LocalCrossEncoderBackend,
    StepZeroLogprobBackend,
    create_decision_backend,
)
from a2ui.inference_formats.decision.models import (
    DecisionDistribution,
    DecisionQuery,
)


def test_backends_satisfy_runtime_protocol() -> None:
    jev = JevHttpBackend("http://localhost:8080/predict")
    step_zero = StepZeroLogprobBackend("http://localhost:8000/v1/completions", "m")
    mock = DeterministicMockBackend()
    local = LocalCrossEncoderBackend()
    assert isinstance(jev, DecisionBackend)
    assert isinstance(step_zero, DecisionBackend)
    assert isinstance(mock, DecisionBackend)
    assert isinstance(local, DecisionBackend)


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


def test_local_cross_encoder_satisfies_protocol() -> None:
    backend = LocalCrossEncoderBackend(temperature=1.0)
    assert isinstance(backend, DecisionBackend)
    with pytest.raises(ValueError, match="temperature"):
        LocalCrossEncoderBackend(temperature=0.0)
    with pytest.raises(ValueError, match="temperature"):
        LocalCrossEncoderBackend(temperature=-1.0)


@pytest.mark.asyncio
async def test_local_cross_encoder_missing_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import builtins

    real_import = builtins.__import__

    def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name in ("onnxruntime", "tokenizers", "huggingface_hub"):
            raise ImportError(f"No module named '{name}'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    backend = LocalCrossEncoderBackend()
    with pytest.raises(ImportError, match="decision-local"):
        await backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("A", "B"))
        )


@pytest.mark.asyncio
async def test_local_cross_encoder_empty_and_single_candidate() -> None:
    backend = LocalCrossEncoderBackend()
    dist_empty = await backend.predict(
        DecisionQuery(task="t", prompt="p", candidates=())
    )
    assert dist_empty.probabilities == {}
    assert dist_empty.top_logit_margin == 0.0

    dist_single = await backend.predict(
        DecisionQuery(task="t", prompt="p", candidates=("OnlyOne",))
    )
    assert dist_single.probabilities == {"OnlyOne": 1.0}
    assert math.isinf(dist_single.top_logit_margin or 0.0)


@dataclass
class _FakeEncoding:
    ids: list[int]
    attention_mask: list[int]
    type_ids: list[int]


class _FakeTokenizer:

    def __init__(self) -> None:
        self.captured_pairs: list[tuple[str, str]] = []

    def encode_batch(self, pairs: list[tuple[str, str]]) -> list[_FakeEncoding]:
        self.captured_pairs = pairs
        return [
            _FakeEncoding(ids=[101, 102], attention_mask=[1, 1], type_ids=[0, 0])
            for _ in pairs
        ]


class _FakeSessionInput:

    def __init__(self, name: str) -> None:
        self.name = name


class _FakeSession:

    def __init__(self, logits: list[float]) -> None:
        self.logits = logits
        self.captured_feeds: list[dict[str, Any]] = []

    def get_inputs(self) -> list[_FakeSessionInput]:
        return [
            _FakeSessionInput("input_ids"),
            _FakeSessionInput("attention_mask"),
            _FakeSessionInput("token_type_ids"),
        ]

    def run(self, output_names: Any, feeds: dict[str, Any]) -> list[Any]:
        del output_names
        self.captured_feeds.append(feeds)
        import numpy as np

        return [np.array(self.logits, dtype=np.float32)[:, np.newaxis]]


@pytest.mark.asyncio
async def test_local_cross_encoder_scoring_and_context_formatting() -> None:
    tok = _FakeTokenizer()
    sess = _FakeSession(logits=[2.0, 0.0])
    backend = LocalCrossEncoderBackend(session=sess, tokenizer=tok, temperature=1.0)

    query = DecisionQuery(
        task="child_component",
        prompt="Show task progress",
        candidates=("ProgressBar", "Collapsible"),
        context={
            "parent": "Card",
            "parent_description": "Card container",
            "slot": "body",
            "slot_description": "Main body child slot",
            "pointers": ["/progress/percent"],
            "candidate_descriptions": {
                "ProgressBar": "Visual progress meter with percentage",
                "Collapsible": "Expandable section",
            },
        },
    )

    dist = await backend.predict(query)
    assert len(tok.captured_pairs) == 2
    query_text, passage_0 = tok.captured_pairs[0]
    _, passage_1 = tok.captured_pairs[1]

    assert "Show task progress" in query_text
    assert (
        "Selecting child component for Card container, slot Main body child slot"
        in query_text
    )
    assert "Available data fields: /progress/percent" in query_text
    assert passage_0 == "ProgressBar: Visual progress meter with percentage"
    assert passage_1 == "Collapsible: Expandable section"

    assert dist.calibrated is True
    assert dist.top_logit_margin == pytest.approx(2.0)
    expected_prob = math.exp(2.0) / (math.exp(2.0) + math.exp(0.0))
    assert dist.probabilities["ProgressBar"] == pytest.approx(expected_prob)
    assert dist.probabilities["Collapsible"] == pytest.approx(1.0 - expected_prob)


def test_decision_module_lazy_import_isolation() -> None:
    """Verifies that importing a2ui.inference_formats.decision does not eagerly import ONNX or tokenizers."""
    import a2ui.inference_formats.decision as decision_mod

    assert hasattr(decision_mod, "LocalCrossEncoderBackend")
    assert "onnxruntime" not in sys.modules
    assert "tokenizers" not in sys.modules


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


def test_create_decision_backend_mock_and_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 1. Explicit mock
    b_mock = create_decision_backend("mock")
    assert isinstance(b_mock, DeterministicMockBackend)

    # 2. Env mock
    monkeypatch.setenv("A2UI_DECISION_BACKEND", "mock")
    b_env_mock = create_decision_backend()
    assert isinstance(b_env_mock, DeterministicMockBackend)

    # 3. Explicit local
    b_local = create_decision_backend("local", model="test-model", temperature=0.7)
    assert isinstance(b_local, LocalCrossEncoderBackend)
    assert b_local.model_id == "test-model"
    assert b_local.temperature == 0.7

    # 4. Unknown type
    with pytest.raises(ValueError, match="Unknown decision backend type"):
        create_decision_backend("unknown_kind")


def test_create_decision_backend_auto_inference_and_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 1. URL ending in /v1/systemone auto-infers systemone
    monkeypatch.delenv("A2UI_DECISION_BACKEND", raising=False)
    b_sys1 = create_decision_backend(
        endpoint_url="https://api.example.com/v1/systemone", model="gemma"
    )
    assert isinstance(b_sys1, JevHttpBackend)
    assert b_sys1._wire_format == "systemone"
    assert b_sys1._model == "gemma"

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

    # 4. HTTP backends without URL raise ValueError
    with pytest.raises(ValueError, match="requires an endpoint URL"):
        create_decision_backend("systemone")
    with pytest.raises(ValueError, match="requires an endpoint URL"):
        create_decision_backend("jev")
    with pytest.raises(ValueError, match="requires an endpoint URL"):
        create_decision_backend("step0")


def test_decision_synthesizer_from_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from a2ui.core import Catalog
    from a2ui.inference_formats.decision import DecisionSynthesizer

    monkeypatch.setenv("A2UI_DECISION_BACKEND", "mock")
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
