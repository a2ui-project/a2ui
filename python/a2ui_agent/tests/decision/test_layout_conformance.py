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

"""Conformance harness for `conformance/agent/decision/archetypes.yaml`."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any

from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    ArchetypeGrammar,
    BlockBindings,
    CatalogDecisionGraph,
    LayoutPlanner,
    PatternExpander,
    PatternLibrary,
    SlotBinding,
    SynthesisConfig,
    eligible_archetypes,
    inspect_payload_pointers,
)
import pytest

from ..conformance.conformance_helpers import load_conformance_yaml
from .layout_fixtures import ScriptedAnswers, ScriptedValue

CASES: list[dict[str, Any]] = load_conformance_yaml("agent/decision/archetypes.yaml")


def _two_component_catalog() -> Catalog:
    """Two-component domain catalog (`TelemetryBadge`, `AlertFrame`)."""
    return Catalog.from_json({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/telemetry/v1/catalog.json",
        "protocolVersion": "1.0",
        "components": {
            "TelemetryBadge": {
                "type": "object",
                "properties": {
                    "component": {"const": "TelemetryBadge"},
                    "metric": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "required": ["component", "metric"],
            },
            "AlertFrame": {
                "type": "object",
                "properties": {
                    "component": {"const": "AlertFrame"},
                    "child": {"$ref": "common_types.json#/$defs/ComponentId"},
                },
                "required": ["component", "child"],
            },
        },
        "functions": {},
    })


def _coerce_scripted(raw: Mapping[str, Any]) -> dict[str, ScriptedValue]:
    """Converts YAML list pairs `[choice, prob]` into `(choice, prob)` tuples."""
    out: dict[str, ScriptedValue] = {}
    for k, v in raw.items():
        if isinstance(v, list) and len(v) == 2:
            out[k] = (str(v[0]), float(v[1]))
        else:
            out[k] = v
    return out


def _slot_from_spec(spec: Mapping[str, Any]) -> SlotBinding:
    """Builds a `SlotBinding` from a YAML slot dict."""
    if "items" in spec:
        items = tuple(
            {
                field_name: _slot_from_spec(field_spec)
                for field_name, field_spec in item.items()
            }
            for item in spec["items"]
        )
        return SlotBinding(items=items)
    return SlotBinding(
        pointer=spec.get("pointer"),
        literal=spec.get("literal"),
    )


def _run_grammar_case(expect: Mapping[str, Any]) -> None:
    grammar = ArchetypeGrammar.default()
    assert grammar.version == expect["version"]
    assert list(grammar.families()) == expect["families"]
    assert len(grammar.archetypes) == expect["archetype_count"]
    assert len(grammar.blocks) == expect["block_count"]


def _run_eligibility_case(case: Mapping[str, Any]) -> None:
    args = case["args"]
    expect = case["expect"]
    grammar = ArchetypeGrammar.default()
    catalog = (
        BasicCatalog("v1.0")
        if args["catalog"] == "basic_v1"
        else _two_component_catalog()
    )
    lib = PatternLibrary.for_catalogs([catalog])
    pointers = inspect_payload_pointers(
        case["input"], mutable_paths=args.get("mutable_paths", ())
    )
    actual_ids = [a.id for a in eligible_archetypes(grammar, lib, pointers)]
    if "exact_archetypes" in expect:
        assert actual_ids == expect["exact_archetypes"]
    if "contains_archetypes" in expect:
        for arch_id in expect["contains_archetypes"]:
            assert arch_id in actual_ids


def _run_plan_case(case: Mapping[str, Any]) -> None:
    args = case["args"]
    expect = case["expect"]
    grammar = ArchetypeGrammar.default()
    lib = PatternLibrary.for_catalogs([BasicCatalog("v1.0")])
    planner = LayoutPlanner(grammar, SynthesisConfig(), capabilities=lib)
    pointers = inspect_payload_pointers(
        case["input"], mutable_paths=args.get("mutable_paths", ())
    )
    batch, state = planner.build_batch(
        intent=args["intent"],
        pointers=pointers,
        payload=case["input"],
    )
    sa = ScriptedAnswers(answers=_coerce_scripted(args["scripted_answers"]))
    answers = asyncio.run(sa.backend().answer(batch))
    outcome = planner.read(state, answers)
    assert outcome.reason == expect["reason"]
    if expect["reason"] != "planned":
        assert outcome.plan is None
        return
    assert outcome.plan is not None
    plan = outcome.plan
    assert plan.family == expect["family"]
    assert plan.archetype == expect["archetype"]
    assert list(plan.block_ids()) == expect["blocks"]
    assert plan.actions_allowed is expect["actions_allowed"]
    by_id = {b.block_id: dict(b.variant_knobs) for b in plan.blocks}
    for block_id, expected_knobs in expect.get("block_knobs", {}).items():
        for knob_k, knob_v in expected_knobs.items():
            assert by_id[block_id].get(knob_k) == knob_v


def _run_expand_block_case(case: Mapping[str, Any]) -> None:
    args = case["args"]
    cat = BasicCatalog("v1.0")
    expander = PatternExpander(
        PatternLibrary.for_catalogs([cat]), CatalogDecisionGraph([cat])
    )
    slots = {
        slot_name: _slot_from_spec(slot_spec)
        for slot_name, slot_spec in args.get("slots", {}).items()
    }
    components = expander.expand_block(
        args["block_id"],
        args["pattern"],
        BlockBindings(slots=slots),
        knobs=args.get("knobs"),
    )
    assert components == case["expect"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_layout_conformance(case: Mapping[str, Any]) -> None:
    """Executes one case from `conformance/agent/decision/archetypes.yaml`."""
    kind = case["args"]["kind"]
    if kind == "grammar":
        _run_grammar_case(case["expect"])
    elif kind == "eligibility":
        _run_eligibility_case(case)
    elif kind == "plan":
        _run_plan_case(case)
    elif kind == "expand_block":
        _run_expand_block_case(case)
    else:
        pytest.fail(f"Unknown conformance case kind: {kind!r}")
