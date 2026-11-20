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

"""Unit tests for the shared experimental decision kernel."""

from __future__ import annotations

import json
from typing import Any
import warnings

import httpx
import pytest

from a2ui.core import A2uiValidationError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.experimental.decision import (
    Calibration,
    DecisionBackendError,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuestion,
    DecisionWireFormat,
    ExpressSurfaceSpec,
    JevHttpBackend,
    QuestionKind,
    SemanticType,
    StepZeroLogprobBackend,
    TextInputPart,
    classify_scalar,
    create_decision_backend,
    inspect_pointers,
    lower_for_transport,
)
from a2ui.transformers.macros import macro
from a2ui.utils import RendererState


def test_create_decision_backend_does_not_leak_jev_key_to_step0(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("JEV_API_KEY", "secret-jev-key")
    monkeypatch.delenv("A2UI_DECISION_AUTH", raising=False)
    monkeypatch.delenv("A2UI_DECISION_TOKEN", raising=False)

    backend = create_decision_backend(
        "step0",
        endpoint_url="http://localhost:8000/v1/completions",
        model="local-model",
    )
    assert isinstance(backend, StepZeroLogprobBackend)
    assert backend._auth is None


def test_jev_http_backend_validates_wire_format_and_parses_query_url() -> None:
    with pytest.raises(ValueError):
        JevHttpBackend(
            "https://example.invalid/v1/systemone",
            wire_format="not-a-wire-format",
        )

    backend = JevHttpBackend(
        "https://generativelanguage.googleapis.com/v1beta/decisions?alt=json",
        wire_format=DecisionWireFormat.AUTO,
    )
    assert backend._is_gemini_decisions() is True
    assert backend._is_systemone() is False


@pytest.mark.asyncio
async def test_native_jev_and_step0_include_text_input_parts() -> None:
    captured_native: dict[str, Any] = {}

    def native_handler(request: httpx.Request) -> httpx.Response:
        captured_native["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "answers": [{
                    "question_id": "q1",
                    "probabilities": {"yes": 0.9, "no": 0.1},
                }]
            },
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(native_handler)
    ) as client:
        backend = JevHttpBackend(
            "https://jev.invalid/decide",
            wire_format=DecisionWireFormat.JEV,
            client=client,
        )
        batch = DecisionBatch(
            state="Primary state",
            input_parts=(TextInputPart("Supplemental text"),),
            questions=(
                DecisionQuestion(
                    id="q1",
                    kind=QuestionKind.BOOLEAN,
                    prompt="Is this valid?",
                ),
            ),
        )
        answers = await backend.answer(batch)
        assert len(answers) == 1
        assert "Supplemental text" in captured_native["body"]["shared_context"]["state"]

    captured_step0: dict[str, Any] = {}

    def step0_handler(request: httpx.Request) -> httpx.Response:
        captured_step0["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "logprobs": {
                            "top_logprobs": [{"A": -0.1, "B": -2.3}],
                        }
                    }
                ]
            },
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(step0_handler)
    ) as client:
        step0 = StepZeroLogprobBackend(
            "http://localhost:8000/v1/completions",
            "local-model",
            client=client,
        )
        answers = await step0.answer(batch)
        assert len(answers) == 1
        assert "Supplemental text" in captured_step0["body"]["prompt"]


def test_calibration_scales_distribution_deterministically() -> None:
    probs = {"a": 0.8, "b": 0.2}
    sharper = Calibration(temperature=0.5).apply(probs)
    flatter = Calibration(temperature=2.0).apply(probs)
    assert sharper["a"] > probs["a"]
    assert flatter["a"] < probs["a"]


def test_classify_scalar_and_long_camel_case_api_key_redaction() -> None:
    sem, _ = classify_scalar("https://example.com/photo.png", key="avatarUrl")
    assert sem is SemanticType.IMAGE_URL

    long_secret = "sk_live_" + ("a" * 80)
    pointers = inspect_pointers({
        "title": "Dashboard",
        "apiKey": long_secret,
        "api-key": long_secret,
        "userApiKey": long_secret,
    })
    paths = {p.path for p in pointers}
    assert "/title" in paths
    assert "/apiKey" not in paths
    assert "/api-key" not in paths
    assert "/userApiKey" not in paths


def test_lower_for_transport_with_renderer_state_runs_topology_and_rolls_back() -> None:
    basic = BasicCatalog("v1.0")
    state = RendererState([basic])
    invalid_messages = to_message_models([
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "broken",
                "catalogId": basic.catalog_id,
            },
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "broken",
                "components": [
                    {"id": "root", "component": "Column", "children": ["missing_id"]}
                ],
            },
        },
    ])

    with pytest.raises(A2uiValidationError):
        lower_for_transport(
            invalid_messages,
            transport_catalogs=[basic],
            renderer_state=state,
        )
    assert state.get_surface("broken") is None


def test_bare_str_rejected_for_macro_constraints_and_express_surface_spec() -> None:
    with pytest.raises(TypeError, match="allowed_parents"):

        @macro(allowed_parents="Column")  # type: ignore[arg-type]
        def _BadParents(title: str) -> list[dict[str, Any]]:
            return [{"id": "root", "component": "Text", "text": title}]

    with pytest.raises(TypeError, match="allowed_children"):

        @macro(allowed_children="Text")  # type: ignore[arg-type]
        def _BadChildren(title: str) -> list[dict[str, Any]]:
            return [{"id": "root", "component": "Text", "text": title}]

    with pytest.raises(TypeError, match="required_paths"):
        ExpressSurfaceSpec(
            id="card",
            description="Card",
            dsl='root = Text("hi")',
            required_paths="/title",  # type: ignore[arg-type]
        )


def test_kernel_entry_points_emit_experimental_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("A2UI_SUPPRESS_EXPERIMENTAL_FEATURE_WARNINGS", raising=False)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        create_decision_backend("mock")
    assert any(
        "[EXPERIMENTAL] create_decision_backend" in str(w.message) for w in caught
    )
