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

"""Unit tests for `a2ui.inference_formats.experimental.decision_prose_upgrade`."""

from __future__ import annotations

from typing import Any
import warnings

import pytest

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.experimental.decision import (
    DecisionAnswer,
    DecisionBackendError,
    DecisionBatch,
    DecisionDistribution,
    DeterministicMockBackend,
    ExpressSurfaceSpec,
    QuestionKind,
)
from a2ui.inference_formats.experimental.decision_prose_upgrade import (
    DeterministicMockExtractor,
    ExtractedField,
    ExtractionThresholds,
    FieldExtractionError,
    FieldType,
    ProseSurfaceUpgrader,
    ProseTemplateSpec,
    StructuredOutputExtractor,
    TypedFieldSpec,
)


def _basic() -> BasicCatalog:
    return BasicCatalog(ProtocolVersion.V1_0)


class _ScriptedBackend(DeterministicMockBackend):
    def __init__(self, answers: dict[str, tuple[str, float] | float]) -> None:
        super().__init__()
        self._answers = answers
        self.batches: list[DecisionBatch] = []

    async def answer(
        self,
        batch: DecisionBatch,
        *,
        timeout_seconds: float | None = None,
    ) -> tuple[DecisionAnswer, ...]:
        del timeout_seconds
        self.batches.append(batch)
        out: list[DecisionAnswer] = []
        for q in batch.questions:
            spec = self._answers.get(q.id)
            if q.kind is QuestionKind.BOOLEAN:
                yes_p = float(spec) if isinstance(spec, (int, float)) else 0.5
                dist = DecisionDistribution(
                    probabilities={"yes": yes_p, "no": 1.0 - yes_p}
                )
            else:
                if isinstance(spec, tuple):
                    choice, prob = spec
                else:
                    choice, prob = (q.options[0] if q.options else "none"), 0.9
                probs = {opt: 0.0 for opt in q.options}
                if q.allow_none:
                    probs["none"] = 0.0
                probs[choice] = prob
                dist = DecisionDistribution(probabilities=probs)
            out.append(DecisionAnswer(question_id=q.id, distribution=dist))
        return tuple(out)


def _order_template() -> ProseTemplateSpec:
    return ProseTemplateSpec(
        id="order_status",
        description="Order status card with order ID, status, and optional carrier",
        surface=ExpressSurfaceSpec(
            id="order_status",
            description="Order status card",
            dsl=(
                'root = Card(Column([Text("### Order Status"),'
                ' Text($/orderId), Text($/status), Text($/carrier)]))'
            ),
            required_paths=("/orderId", "/status"),
        ),
        fields=(
            TypedFieldSpec("/orderId", FieldType.TEXT, "Order identifier"),
            TypedFieldSpec("/status", FieldType.TEXT, "Shipping status"),
            TypedFieldSpec(
                "/carrier", FieldType.TEXT, "Shipping carrier", required=False
            ),
            TypedFieldSpec(
                "/uptimeHours", FieldType.NUMBER, "Optional numeric metric", required=False
            ),
            TypedFieldSpec(
                "/tags", FieldType.LIST_TEXT, "Optional tags", required=False
            ),
        ),
    )


def test_typed_field_spec_rejects_nested_pointers_and_unescapes_rfc6901() -> None:
    with pytest.raises(ValueError, match="single-segment JSON Pointer"):
        TypedFieldSpec("/nested/field", FieldType.TEXT, "Nested")
    with pytest.raises(ValueError, match="single-segment JSON Pointer"):
        TypedFieldSpec("no_slash", FieldType.TEXT, "No slash")

    spec = TypedFieldSpec("/a~1b~0c", FieldType.TEXT, "Escaped key")
    assert spec.key == "a/b~c"
    assert f"{FieldType.LIST_TEXT}" == "list_text"


@pytest.mark.asyncio
async def test_upgrade_happy_path_with_optional_omission_and_secret_redaction() -> None:
    basic = _basic()
    tmpl = ProseTemplateSpec(
        id="host_card",
        description="Host health summary",
        surface=ExpressSurfaceSpec(
            id="host_card",
            description="Host health",
            dsl='root = Card(Column([Text($/host), Text($/status)]))',
            required_paths=("/host", "/status"),
        ),
        fields=(
            TypedFieldSpec("/host", FieldType.TEXT, "Hostname"),
            TypedFieldSpec("/status", FieldType.TEXT, "Status"),
            TypedFieldSpec("/note", FieldType.TEXT, "Optional note", required=False),
            TypedFieldSpec("/apiKey", FieldType.TEXT, "Sensitive key", required=False),
        ),
    )
    backend = _ScriptedBackend({
        "gate:has_structured_content": 0.96,
        "select:template": ("host_card", 0.94),
    })
    extractor = DeterministicMockExtractor({
        "/host": ExtractedField(
            "/host", "prod-1", found=True, confidence=0.95, p_null=0.01, source_span="prod-1"
        ),
        "/status": ExtractedField(
            "/status", "healthy", found=True, confidence=0.92, p_null=0.02, source_span="healthy"
        ),
        # Low-confidence optional field is omitted cleanly.
        "/note": ExtractedField(
            "/note", "maybe", found=True, confidence=0.40, p_null=0.10, source_span="maybe"
        ),
        # Secret key is redacted from updateDataModel.
        "/apiKey": ExtractedField(
            "/apiKey", "sk_live_" + ("0" * 40), found=True, confidence=0.99, p_null=0.0, source_span="sk_live_"
        ),
    })
    upgrader = ProseSurfaceUpgrader(
        backend,
        extractor,
        transport_catalogs=[basic],
        templates=[tmpl],
        extraction_thresholds=ExtractionThresholds(require_grounded_span=True),
    )
    prose = "Host prod-1 is healthy (sk_live_0000)."
    res = await upgrader.upgrade(prose, surface_id="s_host")

    assert not res.abstained
    assert res.template_id == "host_card"
    assert res.decision_calls == 1
    assert res.extracted_data == {"host": "prod-1", "status": "healthy"}
    dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in res.messages]
    assert dumped[0]["createSurface"]["surfaceId"] == "s_host"
    assert dumped[-1]["updateDataModel"]["value"] == {
        "host": "prod-1",
        "status": "healthy",
    }


@pytest.mark.asyncio
async def test_upgrade_abstains_at_gate_and_template_selection() -> None:
    basic = _basic()
    tmpl = _order_template()
    extractor = DeterministicMockExtractor()

    # Low gate probability -> abstains without calling extractor.
    low_gate = _ScriptedBackend({
        "gate:has_structured_content": 0.12,
        "select:template": ("order_status", 0.90),
    })
    up1 = ProseSurfaceUpgrader(
        low_gate, extractor, transport_catalogs=[basic], templates=[tmpl]
    )
    r1 = await up1.upgrade("The capital of France is Paris.")
    assert r1.abstained
    assert "gate_threshold" in r1.reason

    # Template chose none -> abstains.
    chose_none = _ScriptedBackend({
        "gate:has_structured_content": 0.90,
        "select:template": ("none", 0.95),
    })
    up2 = ProseSurfaceUpgrader(
        chose_none, extractor, transport_catalogs=[basic], templates=[tmpl]
    )
    r2 = await up2.upgrade("Some structured text without a matching template.")
    assert r2.abstained
    assert "chose none" in r2.reason

    # Template below min_template_confidence -> abstains.
    low_tmpl = _ScriptedBackend({
        "gate:has_structured_content": 0.90,
        "select:template": ("order_status", 0.45),
    })
    up3 = ProseSurfaceUpgrader(
        low_tmpl, extractor, transport_catalogs=[basic], templates=[tmpl]
    )
    r3 = await up3.upgrade("Order maybe.")
    assert r3.abstained
    assert "min_template_confidence" in r3.reason


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("bad_field", "expected_substr"),
    [
        (ExtractedField("/orderId", None, found=False), "missing field"),
        (ExtractedField("/orderId", "ORD-1", truncated=True, source_span="ORD-1"), "truncated"),
        (ExtractedField("/orderId", "ORD-1", needs_review=True, source_span="ORD-1"), "needs_review"),
        (ExtractedField("/orderId", "ORD-1", p_null=0.6, source_span="ORD-1"), "p_null"),
        (ExtractedField("/orderId", "ORD-1", confidence=0.5, source_span="ORD-1"), "confidence"),
        (ExtractedField("/orderId", "ORD-999", source_span="ORD-999"), "not grounded"),
        (ExtractedField("/orderId", 12345, source_span="ORD-1"), "type mismatch"),
    ],
)
async def test_upgrade_abstains_when_required_field_fails_guards(
    bad_field: ExtractedField, expected_substr: str
) -> None:
    basic = _basic()
    tmpl = _order_template()
    backend = _ScriptedBackend({
        "gate:has_structured_content": 0.95,
        "select:template": ("order_status", 0.95),
    })
    extractor = DeterministicMockExtractor({
        "/orderId": bad_field,
        "/status": ExtractedField("/status", "Shipped", source_span="Shipped"),
    })
    upgrader = ProseSurfaceUpgrader(
        backend,
        extractor,
        transport_catalogs=[basic],
        templates=[tmpl],
        extraction_thresholds=ExtractionThresholds(require_grounded_span=True),
    )
    res = await upgrader.upgrade("Order ORD-1 is Shipped.")
    assert res.abstained
    assert expected_substr in res.reason
    assert res.messages == []


@pytest.mark.asyncio
async def test_structured_output_extractor_and_error_handling() -> None:
    basic = _basic()
    tmpl = _order_template()
    backend = _ScriptedBackend({
        "gate:has_structured_content": 0.98,
        "select:template": ("order_status", 0.97),
    })

    async def _fake_caller(
        prompt: str, schema: dict[str, Any], timeout: float | None
    ) -> dict[str, Any]:
        assert "ORD-42" in prompt
        assert "fields" in schema["properties"]
        del timeout
        return {
            "fields": {
                "orderId": {
                    "found": True,
                    "value": "ORD-42",
                    "source_span": "ORD-42",
                    "confidence": 0.99,
                    "p_null": 0.0,
                },
                "status": {
                    "found": True,
                    "value": "Delivered",
                    "source_span": "Delivered",
                    "confidence": 0.98,
                    "p_null": 0.0,
                },
                "carrier": {
                    "found": True,
                    "value": "UPS",
                    "source_span": "UPS",
                    "confidence": 0.95,
                    "p_null": 0.0,
                },
                "uptimeHours": {
                    "found": False,
                    "value": None,
                    "source_span": None,
                    "confidence": 0.0,
                    "p_null": 1.0,
                },
                "tags": {
                    "found": True,
                    "value": ["express", "signed"],
                    "source_span": "express",
                    "confidence": 0.9,
                    "p_null": 0.0,
                },
            }
        }

    extractor = StructuredOutputExtractor(_fake_caller, model_id="test-flash")
    upgrader = ProseSurfaceUpgrader(
        backend,
        extractor,
        transport_catalogs=[basic],
        templates=[tmpl],
        extraction_thresholds=ExtractionThresholds(require_grounded_span=True),
    )
    res = await upgrader.upgrade("Order ORD-42 was Delivered via UPS express.")
    assert not res.abstained
    assert res.extracted_data == {
        "orderId": "ORD-42",
        "status": "Delivered",
        "carrier": "UPS",
        "tags": ["express", "signed"],
    }

    # Failing caller raises FieldExtractionError by default, or abstains when configured.
    async def _boom(
        prompt: str, schema: dict[str, Any], timeout: float | None
    ) -> dict[str, Any]:
        del prompt, schema, timeout
        raise RuntimeError("upstream 503")

    failing_extractor = StructuredOutputExtractor(_boom, model_id="boom-flash")
    up_raise = ProseSurfaceUpgrader(
        backend, failing_extractor, transport_catalogs=[basic], templates=[tmpl]
    )
    with pytest.raises(FieldExtractionError, match="upstream 503"):
        await up_raise.upgrade("Order ORD-42 was Delivered.")

    up_abstain = ProseSurfaceUpgrader(
        backend,
        failing_extractor,
        transport_catalogs=[basic],
        templates=[tmpl],
        abstain_on_extractor_error=True,
    )
    ab_res = await up_abstain.upgrade("Order ORD-42 was Delivered.")
    assert ab_res.abstained
    assert "extractor failed" in ab_res.reason


@pytest.mark.asyncio
async def test_backend_error_propagates_and_experimental_warning_fires(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("A2UI_SUPPRESS_EXPERIMENTAL_FEATURE_WARNINGS", raising=False)
    basic = _basic()
    tmpl = _order_template()

    class _EmptyBackend(DeterministicMockBackend):
        async def answer(
            self, batch: DecisionBatch, *, timeout_seconds: float | None = None
        ) -> tuple[DecisionAnswer, ...]:
            del batch, timeout_seconds
            return ()

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        upgrader = ProseSurfaceUpgrader(
            _EmptyBackend(),
            DeterministicMockExtractor(),
            transport_catalogs=[basic],
            templates=[tmpl],
        )
    assert any(
        "[EXPERIMENTAL]" in str(w.message) and "ProseSurfaceUpgrader" in str(w.message)
        for w in caught
    )

    with pytest.raises(DecisionBackendError, match="omitted"):
        await upgrader.upgrade("Order ORD-42 was Delivered.")
