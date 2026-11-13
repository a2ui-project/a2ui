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

"""Unit tests for decision_common utilities and decision_fixtures."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
from typing import Any

import jsonschema
import pytest
import yaml

sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from a2ui.inference_formats.decision import (
    DecisionBlock,
    DeterministicMockBackend,
    FallbackSource,
    JevHttpBackend,
    LayoutPlan,
    PlannedBlock,
    SynthesisOutput,
    SynthesisStage,
)
from a2ui_eval.decision_common import (
    DECISION_BACKEND_NAMES,
    DECISION_METADATA_KEYS,
    build_decision_backend,
    decision_metadata,
    is_transcrypt_ciphertext,
)
from decision_fixtures import (
    HOST_ANSWERS,
    HOST_BLOCK,
    HOST_DECISION_BLOCK,
    SETTINGS_ANSWERS,
    SETTINGS_BLOCK,
    SETTINGS_DECISION_BLOCK,
    TRANSFER_ANSWERS,
    TRANSFER_BLOCK,
    TRANSFER_DECISION_BLOCK,
    scripted_backend,
)


def test_build_decision_backend_known_names(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies build_decision_backend returns the expected backend instance."""
    monkeypatch.setenv("JEV_API_KEY", "test-jev-key")
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    assert DECISION_BACKEND_NAMES == (
        "mock",
        "jev",
        "gemini",
        "systemone",
        "step0",
    )
    mock_backend = build_decision_backend("mock", model="mock-v1")
    assert isinstance(mock_backend, DeterministicMockBackend)
    assert mock_backend.backend_kind == "mock"
    assert mock_backend.model_id == "mock-v1"
    assert isinstance(build_decision_backend("jev"), JevHttpBackend)
    gemini_backend = build_decision_backend("gemini")
    assert isinstance(gemini_backend, JevHttpBackend)
    assert gemini_backend.backend_kind == "gemini"
    assert gemini_backend.model_id == "gemini-decision-1"


def test_build_decision_backend_requires_explicit_selection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies build_decision_backend refuses implicit mock fallback when unset."""
    monkeypatch.delenv("A2UI_DECISION_BACKEND", raising=False)
    with pytest.raises(ValueError, match="A2UI_DECISION_BACKEND"):
        build_decision_backend(None)


def test_build_decision_backend_unknown_name() -> None:
    """Verifies build_decision_backend raises ValueError on unknown backend names."""
    with pytest.raises(ValueError, match="Unknown decision backend: invalid"):
        build_decision_backend("invalid")


def test_is_transcrypt_ciphertext(tmp_path: Path) -> None:
    """Verifies ciphertext detection distinguishes YAML from Transcrypt headers."""
    plain = tmp_path / "plain.yaml"
    plain.write_text("- name: host_health\n", encoding="utf-8")
    assert is_transcrypt_ciphertext(plain) is False

    salted_b64 = tmp_path / "enc_b64.yaml"
    salted_b64.write_bytes(b"U2FsdGVkX1+abcdef123456\n")
    assert is_transcrypt_ciphertext(salted_b64) is True

    salted_raw = tmp_path / "enc_raw.yaml"
    salted_raw.write_bytes(b"Salted__\x00\xff\xfe\xfd1234")
    assert is_transcrypt_ciphertext(salted_raw) is True


def test_decision_metadata_aggregation() -> None:
    """Verifies decision_metadata aggregates metrics and fallback fields cleanly."""
    plan1 = LayoutPlan(
        family="monitor",
        archetype="dashboard",
        blocks=(
            PlannedBlock(block_id="headline", pattern="headline"),
            PlannedBlock(block_id="facts", pattern="facts"),
        ),
    )
    out1 = SynthesisOutput(
        stage=SynthesisStage.ARCHETYPE,
        messages=[],
        confidence=0.85,
        entropy=0.15,
        layout_plan=plan1,
        decision_latency_ms=12.5,
        decision_calls=1,
        backend_kind="mock",
        model_id="mock-test",
    )
    out2 = SynthesisOutput(
        stage=SynthesisStage.ABSTAIN_FALLBACK,
        messages=[],
        confidence=0.92,
        entropy=0.08,
        decision_latency_ms=25.0,
        decision_calls=2,
        fallback_source=FallbackSource.FACTS,
        fallback_reason="family_confidence_below_threshold",
        backend_kind="mock",
        model_id="mock-test",
    )
    meta = decision_metadata(
        [out1, out2], backend_name="mock", block=HOST_DECISION_BLOCK
    )
    assert meta["decision_backend"] == "mock"
    assert meta["decision_backend_kind"] == "mock"
    assert meta["decision_model_id"] == "mock-test"
    assert meta["decision_latency_ms"] == 37.5
    assert meta["decision_calls"] == 3
    assert meta["decision_confidence"] == 0.85
    assert meta["decision_family"] == "monitor"
    assert meta["decision_archetype"] == "dashboard"
    assert meta["decision_blocks"] == ["headline", "facts"]
    assert meta["decision_answers"] == 0
    assert meta["decision_fallback_source"] == "fallback_facts"
    assert meta["decision_fallback_reason"] == "family_confidence_below_threshold"
    assert meta["decision_block"]["intent"] == HOST_DECISION_BLOCK.intent
    assert set(meta) == set(DECISION_METADATA_KEYS)


def test_decision_fixtures_integrity() -> None:
    """Verifies the standard decision block fixtures and canned answer dicts."""
    assert isinstance(HOST_DECISION_BLOCK, DecisionBlock)
    assert isinstance(TRANSFER_DECISION_BLOCK, DecisionBlock)
    assert isinstance(SETTINGS_DECISION_BLOCK, DecisionBlock)

    assert [a.id for a in TRANSFER_DECISION_BLOCK.actions] == ["send", "cancel"]
    assert "actions" not in TRANSFER_DECISION_BLOCK.payload

    assert "intent" in HOST_BLOCK
    assert "intent" in TRANSFER_BLOCK
    assert "intent" in SETTINGS_BLOCK

    assert HOST_ANSWERS["family"] == ("monitor", 0.90)
    assert TRANSFER_ANSWERS["family"] == ("act", 0.85)
    assert SETTINGS_ANSWERS["family"] == ("input", 0.80)

    backend = scripted_backend(HOST_ANSWERS)
    assert isinstance(backend, DeterministicMockBackend)


_DATASETS_DIR = Path(__file__).resolve().parent.parent / "datasets" / "decision_plans"
_SCHEMA_PATH = _DATASETS_DIR / "schema.json"
_V1_PATH = _DATASETS_DIR / "v1.yaml"
_HELDOUT_PATH = _DATASETS_DIR / "heldout_v1.yaml"


def _load_schema() -> dict[str, Any]:
    """Loads the JSON Schema for decision plan YAML datasets."""
    return dict(json.loads(_SCHEMA_PATH.read_text(encoding="utf-8")))


def _load_decrypted_yaml(path: Path) -> list[dict[str, Any]]:
    """Loads a decrypted decision plan YAML file or skips if encrypted."""
    if not path.is_file() or is_transcrypt_ciphertext(path):
        pytest.skip(f"Dataset file {path.name} is encrypted or absent.")
    return list(yaml.safe_load(path.read_text(encoding="utf-8")) or [])


def test_decision_plans_schema_validates_synthetic_wave6_cases(
    tmp_path: Path,
) -> None:
    """Verifies schema.json accepts Wave 6 fields in a synthetic YAML fixture."""
    schema = _load_schema()
    synthetic = [
        {
            "name": "synth_in_grammar_multi_turn",
            "mode": "tool",
            "tool_name": "render_synth_ops",
            "intent": "Surface cluster CPU and memory health",
            "payload": {"cpu": 0.72, "mem": 0.55, "secret_token": "tok_123"},
            "exclude": ["/secret_token"],
            "sensitive": ["/secret_token"],
            "labels": {"/cpu": "CPU load"},
            "actions": {
                "ack": {
                    "label": "Acknowledge",
                    "style": "primary",
                    "context": {"cpu": "/cpu"},
                }
            },
            "turns": [
                {
                    "surface_id": "ops",
                    "intent": "Surface cluster CPU and memory health",
                    "payload": {"cpu": 0.72, "mem": 0.55},
                    "expected_operation": "create",
                    "expected_cache_hit": False,
                },
                {
                    "surface_id": "ops",
                    "region": "headline",
                    "intent": "Refresh headline metrics",
                    "payload": {"cpu": 0.41, "mem": 0.50},
                    "expected_operation": "update_region",
                    "expected_cache_hit": False,
                },
            ],
            "expected": {
                "family": "monitor",
                "archetypes": ["dashboard"],
                "blocks": {"required": ["headline"]},
                "bindings": {"headline.items": ["/cpu", "/mem"]},
                "actions": {"ack": ["/cpu"]},
            },
            "split": "heldout",
            "tags": ["in_grammar", "multi_turn", "tool_mode"],
            "verified": False,
        },
        {
            "name": "synth_out_of_grammar_none",
            "intent": "Render an interactive 3D shader canvas",
            "payload": {"frag_shader": "void main() {}", "fps": 60},
            "fallback_dsl": "Text: Shader preview",
            "expected": {"family": "none", "archetypes": []},
            "split": "heldout",
            "tags": ["out_of_grammar"],
            "verified": False,
        },
    ]
    yaml_file = tmp_path / "synthetic_heldout.yaml"
    yaml_file.write_text(yaml.safe_dump(synthetic), encoding="utf-8")
    loaded = yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
    jsonschema.validate(instance=loaded, schema=schema)


def _has_large_array(payload: dict[str, Any], min_len: int = 100) -> bool:
    """Returns True when `payload` contains any list with at least `min_len` items."""
    return any(
        isinstance(val, list) and len(val) >= min_len for val in payload.values()
    )


def _assert_no_family_word_in_case(case: dict[str, Any]) -> None:
    """Asserts that `case['intent']` and turn intents do not contain the expected family word."""
    family = case["expected"]["family"]
    if family == "none":
        return
    pattern = re.compile(rf"\b{re.escape(family)}\b", re.IGNORECASE)
    assert not pattern.search(
        case["intent"]
    ), f"Case {case['name']} intent leaks family word {family!r}: {case['intent']!r}"
    for turn in case.get("turns", []):
        assert not pattern.search(turn["intent"]), (
            f"Case {case['name']} turn intent leaks family word {family!r}:"
            f" {turn['intent']!r}"
        )


def _assert_heldout_counts(heldout_cases: list[dict[str, Any]]) -> None:
    """Asserts that `heldout_cases` meets Wave 6 slice minimums."""
    assert len(heldout_cases) >= 100
    assert sum(1 for c in heldout_cases if c["expected"]["family"] == "none") >= 30
    assert sum(1 for c in heldout_cases if "turns" in c) >= 10
    assert sum(1 for c in heldout_cases if "actions" in c["expected"]) >= 10
    assert sum(1 for c in heldout_cases if c.get("mode") == "tool") >= 10
    assert sum(1 for c in heldout_cases if _has_large_array(c["payload"], 100)) >= 3


def _assert_zero_overlap(
    v1_cases: list[dict[str, Any]], heldout_cases: list[dict[str, Any]]
) -> None:
    """Asserts zero case name or `(intent, payload)` overlap between tuning and heldout splits."""
    v1_names = {c["name"] for c in v1_cases}
    heldout_names = {c["name"] for c in heldout_cases}
    assert len(heldout_names) == len(heldout_cases)
    assert not (v1_names & heldout_names)
    v1_sigs = {
        (c["intent"], json.dumps(c["payload"], sort_keys=True)) for c in v1_cases
    }
    heldout_sigs = {
        (c["intent"], json.dumps(c["payload"], sort_keys=True)) for c in heldout_cases
    }
    assert not (v1_sigs & heldout_sigs)


def test_on_disk_tuning_and_heldout_datasets_conformance() -> None:
    """Validates v1.yaml and heldout_v1.yaml against schema, counts, and leak rules."""
    schema = _load_schema()
    v1_cases = _load_decrypted_yaml(_V1_PATH)
    heldout_cases = _load_decrypted_yaml(_HELDOUT_PATH)

    jsonschema.validate(instance=v1_cases, schema=schema)
    jsonschema.validate(instance=heldout_cases, schema=schema)

    assert all(
        c.get("split") == "tuning" and c.get("verified") is True for c in v1_cases
    )
    assert all(c.get("split") == "heldout" for c in heldout_cases)

    _assert_heldout_counts(heldout_cases)
    for case in heldout_cases:
        _assert_no_family_word_in_case(case)
    _assert_zero_overlap(v1_cases, heldout_cases)
