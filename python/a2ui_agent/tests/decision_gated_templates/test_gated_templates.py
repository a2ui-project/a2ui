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

"""Unit tests for `a2ui.inference_formats.experimental.decision_gated_templates`."""

from __future__ import annotations

from typing import Any
import warnings

import pytest

from a2ui.core import A2uiCatalogError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.experimental.decision import (
    DecisionAnswer,
    DecisionBatch,
    DecisionDistribution,
    DeterministicMockBackend,
    QuestionKind,
    lower_for_transport,
)
from a2ui.inference_formats.experimental.decision_gated_templates import (
    GATE_EXTENSION_KEY,
    VARIANT_EXTENSION_KEY,
    GatedTemplateEvaluator,
    GatedTemplateSpec,
    extract_gates_and_variants,
    prune_components,
)


def _basic() -> BasicCatalog:
    return BasicCatalog(ProtocolVersion.V1_0)


class _ScriptedBackend(DeterministicMockBackend):
    """Test backend returning explicit scripted answers and recording batches."""

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


def _incident_components() -> list[dict[str, Any]]:
    return [
        {"id": "root", "component": "Card", "child": "main_col"},
        {
            "id": "main_col",
            "component": "Column",
            "children": [
                "header_text",
                "rollback_card",
                "metrics_compact",
                "metrics_detailed",
            ],
        },
        {
            "id": "header_text",
            "component": "Text",
            "text": {"@path": "/service"},
            "@metadata": {
                "extensions": {
                    "vendor_tag": "keep-me",
                }
            },
        },
        {
            "id": "rollback_card",
            "component": "Card",
            "child": "rollback_text",
            "@metadata": {
                "extensions": {
                    GATE_EXTENSION_KEY: {
                        "condition": "Show rollback alert when service is degraded.",
                        "threshold": 0.5,
                    },
                    "vendor_keep": True,
                }
            },
        },
        {
            "id": "rollback_text",
            "component": "Text",
            "text": "Initiate rollback immediately.",
        },
        {
            "id": "metrics_compact",
            "component": "Row",
            "children": ["cpu_compact"],
            "@metadata": {
                "extensions": {
                    VARIANT_EXTENSION_KEY: {
                        "group": "metrics_layout",
                        "name": "compact",
                        "description": "Compact single-row summary.",
                        "prompt": "Choose metrics layout density.",
                    }
                }
            },
        },
        {"id": "cpu_compact", "component": "Text", "text": {"@path": "/cpu"}},
        {
            "id": "metrics_detailed",
            "component": "Column",
            "children": ["cpu_detail", "err_detail"],
            "@metadata": {
                "extensions": {
                    VARIANT_EXTENSION_KEY: {
                        "group": "metrics_layout",
                        "name": "detailed",
                        "description": "Detailed multi-row breakdown.",
                    }
                }
            },
        },
        {"id": "cpu_detail", "component": "Text", "text": {"@path": "/cpu"}},
        {"id": "err_detail", "component": "Text", "text": {"@path": "/errorRate"}},
    ]


def test_unpruned_gated_template_is_valid_v1_0_wire_json() -> None:
    basic = _basic()
    wire = [
        {
            "version": "1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": basic.catalog_id},
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": _incident_components(),
            },
        },
    ]
    # Validates cleanly directly against BasicCatalog v1.0 without any pruning!
    models = to_message_models(wire)
    validated = lower_for_transport(models, transport_catalogs=[basic])
    assert len(validated) == 2


def test_from_messages_collects_create_surface_and_update_components() -> None:
    basic = _basic()
    wire = to_message_models([
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": basic.catalog_id,
            },
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": _incident_components(),
            },
        },
    ])
    spec = GatedTemplateSpec.from_messages(
        "incident",
        "Service incident dashboard",
        wire,
        required_paths=("/service",),
    )
    assert spec.catalog_id == basic.catalog_id
    assert len(spec.components) == len(_incident_components())
    assert spec.required_paths == ("/service",)

    # Also supports v1.0 inline createSurface.components dict form.
    inline_spec = GatedTemplateSpec.from_messages(
        "inline_incident",
        "Inline components",
        [
            {
                "version": "1.0",
                "createSurface": {
                    "surfaceId": "s2",
                    "catalogId": basic.catalog_id,
                    "components": [
                        {"id": "root", "component": "Text", "text": "Hello"}
                    ],
                },
            }
        ],
    )
    assert len(inline_spec.components) == 1
    assert inline_spec.catalog_id == basic.catalog_id


@pytest.mark.asyncio
async def test_evaluate_prunes_gate_and_non_winning_variant_and_strips_metadata() -> None:
    basic = _basic()
    spec = GatedTemplateSpec(
        id="incident",
        description="Incident dashboard",
        components=tuple(_incident_components()),
        catalog_id=basic.catalog_id,
    )
    backend = _ScriptedBackend({
        "gate:rollback_card": 0.15,
        "variant:metrics_layout": ("compact", 0.91),
    })
    evaluator = GatedTemplateEvaluator(
        backend, transport_catalogs=[basic], templates=[spec]
    )
    result = await evaluator.evaluate(
        "incident",
        "Show healthy service status",
        {
            "service": "checkout-api",
            "cpu": "24%",
            "errorRate": "0.01%",
            "apiKey": "sk_live_" + ("9" * 64),
        },
        surface_id="s_healthy",
    )

    assert not result.abstained
    assert result.decision_calls == 1
    assert "rollback_card" in result.pruned_component_ids
    assert "rollback_text" in result.pruned_component_ids
    assert "metrics_detailed" in result.pruned_component_ids
    assert "cpu_detail" in result.pruned_component_ids
    assert "err_detail" in result.pruned_component_ids
    assert "metrics_compact" in result.kept_component_ids
    assert "cpu_compact" in result.kept_component_ids

    dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in result.messages]
    comps = {
        c["id"]: c for c in dumped[1]["updateComponents"]["components"]
    }
    assert comps["main_col"]["children"] == ["header_text", "metrics_compact"]
    # Unrelated vendor extension preserved; a2ui_variant stripped cleanly.
    assert comps["header_text"]["@metadata"]["extensions"] == {"vendor_tag": "keep-me"}
    assert "@metadata" not in comps["metrics_compact"]
    # Secret field redacted from updateDataModel.
    assert dumped[2]["updateDataModel"]["value"] == {
        "service": "checkout-api",
        "cpu": "24%",
        "errorRate": "0.01%",
    }


@pytest.mark.asyncio
async def test_evaluate_keeps_gate_and_preserves_sibling_vendor_extension() -> None:
    basic = _basic()
    spec = GatedTemplateSpec(
        id="incident",
        description="Incident dashboard",
        components=tuple(_incident_components()),
        catalog_id=basic.catalog_id,
    )
    backend = _ScriptedBackend({
        "gate:rollback_card": 0.92,
        "variant:metrics_layout": ("detailed", 0.88),
    })
    evaluator = GatedTemplateEvaluator(
        backend, transport_catalogs=[basic], templates=[spec]
    )
    result = await evaluator.evaluate(
        "incident",
        "Show degraded service incident",
        {"service": "checkout-api", "cpu": "94%", "errorRate": "8.2%"},
    )
    assert not result.abstained
    dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in result.messages]
    comps = {c["id"]: c for c in dumped[1]["updateComponents"]["components"]}
    assert "rollback_card" in comps
    assert comps["rollback_card"]["@metadata"]["extensions"] == {"vendor_keep": True}
    assert comps["main_col"]["children"] == [
        "header_text",
        "rollback_card",
        "metrics_detailed",
    ]


def test_prune_components_cascades_upward_across_card_button_modal_tabs_and_childlist_template() -> None:
    components = [
        {"id": "root", "component": "Column", "children": [
            "keep_text",
            "card_wrap",
            "btn_wrap",
            "modal_wrap",
            "tabs_partial",
            "tabs_empty",
            "list_kept",
            "list_pruned",
        ]},
        {"id": "keep_text", "component": "Text", "text": "Header"},
        # Card whose child is pruned -> Card cascades upward.
        {"id": "card_wrap", "component": "Card", "child": "card_inner"},
        {"id": "card_inner", "component": "Text", "text": "Drop me"},
        # Button whose child is pruned -> Button cascades upward.
        {
            "id": "btn_wrap",
            "component": "Button",
            "child": "btn_label",
            "action": {"event": {"name": "go"}},
        },
        {"id": "btn_label", "component": "Text", "text": "Drop btn"},
        # Modal whose trigger is pruned -> Modal cascades upward and content becomes orphan.
        {
            "id": "modal_wrap",
            "component": "Modal",
            "trigger": "modal_trigger",
            "content": "modal_body",
        },
        {"id": "modal_trigger", "component": "Text", "text": "Open"},
        {"id": "modal_body", "component": "Text", "text": "Modal Body"},
        # Tabs with 1 surviving tab and 1 pruned tab -> Tabs survives with 1 tab.
        {
            "id": "tabs_partial",
            "component": "Tabs",
            "tabs": [
                {"title": "A", "child": "tab_a"},
                {"title": "B", "child": "tab_b"},
            ],
        },
        {"id": "tab_a", "component": "Text", "text": "Tab A"},
        {"id": "tab_b", "component": "Text", "text": "Tab B"},
        # Tabs with all tabs pruned -> Tabs cascades upward (minItems: 1).
        {
            "id": "tabs_empty",
            "component": "Tabs",
            "tabs": [{"title": "Only", "child": "tab_only"}],
        },
        {"id": "tab_only", "component": "Text", "text": "Gone"},
        # List with ChildList template object kept -> template item stays reachable.
        {
            "id": "list_kept",
            "component": "List",
            "children": {"componentId": "item_kept", "path": "/items"},
        },
        {"id": "item_kept", "component": "Text", "text": {"@path": "name"}},
        # List with ChildList template componentId pruned -> List cascades upward.
        {
            "id": "list_pruned",
            "component": "List",
            "children": {"componentId": "item_pruned", "path": "/other"},
        },
        {"id": "item_pruned", "component": "Text", "text": {"@path": "name"}},
    ]

    surviving, pruned = prune_components(
        components,
        {"card_inner", "btn_label", "modal_trigger", "tab_b", "tab_only", "item_pruned"},
    )
    by_id = {c["id"]: c for c in surviving}
    assert set(by_id.keys()) == {
        "root",
        "keep_text",
        "tabs_partial",
        "tab_a",
        "list_kept",
        "item_kept",
    }
    assert by_id["root"]["children"] == ["keep_text", "tabs_partial", "list_kept"]
    assert by_id["tabs_partial"]["tabs"] == [{"title": "A", "child": "tab_a"}]
    assert "modal_wrap" in pruned
    assert "modal_body" in pruned
    assert "tabs_empty" in pruned
    assert "list_pruned" in pruned


@pytest.mark.asyncio
async def test_root_losing_required_child_abstains() -> None:
    basic = _basic()
    spec = GatedTemplateSpec(
        id="fragile",
        description="Fragile card",
        components=(
            {"id": "root", "component": "Card", "child": "only_child"},
            {
                "id": "only_child",
                "component": "Text",
                "text": "Hello",
                "@metadata": {
                    "extensions": {
                        GATE_EXTENSION_KEY: {"condition": "Keep only child?"}
                    }
                },
            },
        ),
        catalog_id=basic.catalog_id,
    )
    backend = _ScriptedBackend({"gate:only_child": 0.1})
    evaluator = GatedTemplateEvaluator(
        backend, transport_catalogs=[basic], templates=[spec]
    )
    res = await evaluator.evaluate("fragile", "Test", {"a": 1})
    assert res.abstained
    assert "root" in res.reason


@pytest.mark.asyncio
async def test_variant_min_confidence_and_allow_none_behavior() -> None:
    basic = _basic()

    def _make_spec(allow_none: bool) -> GatedTemplateSpec:
        return GatedTemplateSpec(
            id="vtest",
            description="Variant test",
            components=(
                {"id": "root", "component": "Column", "children": ["opt_a", "opt_b"]},
                {
                    "id": "opt_a",
                    "component": "Text",
                    "text": "A",
                    "@metadata": {
                        "extensions": {
                            VARIANT_EXTENSION_KEY: {
                                "group": "mode",
                                "name": "a",
                                "description": "Option A",
                                "allowNone": allow_none,
                                "minConfidence": 0.75,
                            }
                        }
                    },
                },
                {
                    "id": "opt_b",
                    "component": "Text",
                    "text": "B",
                    "@metadata": {
                        "extensions": {
                            VARIANT_EXTENSION_KEY: {
                                "group": "mode",
                                "name": "b",
                                "description": "Option B",
                                "allowNone": allow_none,
                                "minConfidence": 0.75,
                            }
                        }
                    },
                },
            ),
            catalog_id=basic.catalog_id,
        )

    low_conf_backend = _ScriptedBackend({"variant:mode": ("a", 0.55)})

    # allowNone=False abstains when below minConfidence.
    ev_strict = GatedTemplateEvaluator(
        low_conf_backend, transport_catalogs=[basic], templates=[_make_spec(False)]
    )
    strict_res = await ev_strict.evaluate("vtest", "Pick", {"x": 1})
    assert strict_res.abstained
    assert "min_confidence" in strict_res.reason

    # allowNone=True prunes all options in the group when below minConfidence.
    ev_opt = GatedTemplateEvaluator(
        low_conf_backend, transport_catalogs=[basic], templates=[_make_spec(True)]
    )
    opt_res = await ev_opt.evaluate("vtest", "Pick", {"x": 1})
    assert not opt_res.abstained
    assert "opt_a" in opt_res.pruned_component_ids
    assert "opt_b" in opt_res.pruned_component_ids


@pytest.mark.asyncio
async def test_select_and_evaluate_single_call_and_two_call_split() -> None:
    basic = _basic()
    spec = GatedTemplateSpec(
        id="incident",
        description="Incident dashboard",
        components=tuple(_incident_components()),
        catalog_id=basic.catalog_id,
        required_paths=("/service",),
    )
    answers = {
        "select:template": ("incident", 0.94),
        "gate:incident:rollback_card": 0.85,
        "variant:incident:metrics_layout": ("compact", 0.90),
    }

    # 1 batch call when max_pairs is large enough.
    backend_one = _ScriptedBackend(answers)
    ev_one = GatedTemplateEvaluator(
        backend_one, transport_catalogs=[basic], templates=[spec], max_pairs=100
    )
    res_one = await ev_one.select_and_evaluate(
        "Show incident", {"service": "api", "cpu": "80%", "errorRate": "2%"}
    )
    assert not res_one.abstained
    assert res_one.decision_calls == 1
    assert res_one.template_id == "incident"

    # 2 batch calls when total_pairs exceeds max_pairs.
    backend_two = _ScriptedBackend(answers)
    ev_two = GatedTemplateEvaluator(
        backend_two, transport_catalogs=[basic], templates=[spec], max_pairs=2
    )
    res_two = await ev_two.select_and_evaluate(
        "Show incident", {"service": "api", "cpu": "80%", "errorRate": "2%"}
    )
    assert not res_two.abstained
    assert res_two.decision_calls == 2


def test_extract_gates_and_variants_rejects_invalid_declarations() -> None:
    # Missing root
    with pytest.raises(A2uiCatalogError, match="root"):
        extract_gates_and_variants([{"id": "a", "component": "Text", "text": "x"}])

    # Gated root
    with pytest.raises(A2uiCatalogError, match="Root component"):
        extract_gates_and_variants([
            {
                "id": "root",
                "component": "Text",
                "text": "x",
                "@metadata": {"extensions": {GATE_EXTENSION_KEY: {"condition": "Yes?"}}},
            }
        ])

    # Both gate and variant on one component
    with pytest.raises(A2uiCatalogError, match="cannot declare both"):
        extract_gates_and_variants([
            {"id": "root", "component": "Column", "children": ["a"]},
            {
                "id": "a",
                "component": "Text",
                "text": "x",
                "@metadata": {
                    "extensions": {
                        GATE_EXTENSION_KEY: {"condition": "Show?"},
                        VARIANT_EXTENSION_KEY: {
                            "group": "g",
                            "name": "n",
                            "description": "d",
                        },
                    }
                },
            },
        ])

    # Duplicate variant name in a group
    with pytest.raises(A2uiCatalogError, match="Duplicate variant name"):
        extract_gates_and_variants([
            {"id": "root", "component": "Column", "children": ["a", "b"]},
            {
                "id": "a",
                "component": "Text",
                "text": "x",
                "@metadata": {
                    "extensions": {
                        VARIANT_EXTENSION_KEY: {
                            "group": "g",
                            "name": "same",
                            "description": "d1",
                        }
                    }
                },
            },
            {
                "id": "b",
                "component": "Text",
                "text": "y",
                "@metadata": {
                    "extensions": {
                        VARIANT_EXTENSION_KEY: {
                            "group": "g",
                            "name": "same",
                            "description": "d2",
                        }
                    }
                },
            },
        ])


def test_gated_template_evaluator_emits_experimental_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("A2UI_SUPPRESS_EXPERIMENTAL_FEATURE_WARNINGS", raising=False)
    basic = _basic()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        GatedTemplateEvaluator(
            DeterministicMockBackend(), transport_catalogs=[basic]
        )
    assert any(
        "[EXPERIMENTAL]" in str(w.message) and "GatedTemplateEvaluator" in str(w.message)
        for w in caught
    )


@pytest.mark.asyncio
async def test_excluded_paths_are_redacted_from_decision_batch_state() -> None:
    basic = _basic()
    spec = GatedTemplateSpec(
        id="incident",
        description="Incident dashboard",
        components=tuple(_incident_components()),
        catalog_id=basic.catalog_id,
    )
    backend = _ScriptedBackend({
        "gate:rollback_card": 0.9,
        "variant:metrics_layout": ("compact", 0.9),
    })
    evaluator = GatedTemplateEvaluator(
        backend, transport_catalogs=[basic], templates=[spec]
    )
    await evaluator.evaluate(
        "incident",
        "Show status",
        {
            "service": "checkout-api",
            "cpu": "40%",
            "errorRate": "0.1%",
            "internal_secret_note": "TOP_SECRET_MARKER",
        },
        exclude=("/internal_secret_note",),
    )
    assert backend.batches
    assert "TOP_SECRET_MARKER" not in (backend.batches[0].state or "")


def test_conflicting_variant_prompts_raise_catalog_error() -> None:
    with pytest.raises(A2uiCatalogError, match="conflicting 'prompt'"):
        extract_gates_and_variants([
            {"id": "root", "component": "Column", "children": ["a", "b"]},
            {
                "id": "a",
                "component": "Text",
                "text": "x",
                "@metadata": {
                    "extensions": {
                        VARIANT_EXTENSION_KEY: {
                            "group": "g",
                            "name": "a",
                            "description": "Option A",
                            "prompt": "Prompt one",
                        }
                    }
                },
            },
            {
                "id": "b",
                "component": "Text",
                "text": "y",
                "@metadata": {
                    "extensions": {
                        VARIANT_EXTENSION_KEY: {
                            "group": "g",
                            "name": "b",
                            "description": "Option B",
                            "prompt": "Prompt two",
                        }
                    }
                },
            },
        ])
