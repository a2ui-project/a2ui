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

import os
import sys

import pytest

sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from a2ui.inference_formats.decision import (
    DecisionBlock,
    DeterministicMockBackend,
    JevHttpBackend,
    SynthesisOutput,
    SynthesisStage,
)
from a2ui_eval.decision_common import (
    DECISION_BACKEND_NAMES,
    DECISION_METADATA_KEYS,
    build_decision_backend,
    decision_metadata,
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
    assert DECISION_BACKEND_NAMES == ("mock", "jev", "step0")
    assert isinstance(build_decision_backend("mock"), DeterministicMockBackend)
    assert isinstance(build_decision_backend("jev"), JevHttpBackend)


def test_build_decision_backend_unknown_name() -> None:
    """Verifies build_decision_backend raises ValueError on unknown backend names."""
    with pytest.raises(ValueError, match="Unknown decision backend: invalid"):
        build_decision_backend("invalid")


def test_decision_metadata_aggregation() -> None:
    """Verifies decision_metadata aggregates metrics correctly."""
    out1 = SynthesisOutput(
        stage=SynthesisStage.ARCHETYPE,
        messages=[],
        confidence=0.85,
        entropy=0.15,
        component_tree_spec={"archetype": "dashboard"},
        decision_latency_ms=12.5,
        decision_calls=1,
    )
    out2 = SynthesisOutput(
        stage=SynthesisStage.ARCHETYPE,
        messages=[],
        confidence=0.92,
        entropy=0.08,
        component_tree_spec={"archetype": "form"},
        decision_latency_ms=25.0,
        decision_calls=2,
    )
    meta = decision_metadata([out1, out2], backend_name="mock")
    assert meta["decision_backend"] == "mock"
    assert meta["decision_latency_ms"] == 37.5
    assert meta["decision_calls"] == 3
    assert meta["decision_confidence"] == 0.85
    assert meta["decision_archetype"] == "dashboard"
    assert meta["decision_answers"] == 0
    assert meta["decision_fallback_source"] is None
    for key in DECISION_METADATA_KEYS:
        assert key in meta


def test_decision_fixtures_integrity() -> None:
    """Verifies the standard decision block fixtures and canned answer dicts."""
    assert isinstance(HOST_DECISION_BLOCK, DecisionBlock)
    assert isinstance(TRANSFER_DECISION_BLOCK, DecisionBlock)
    assert isinstance(SETTINGS_DECISION_BLOCK, DecisionBlock)

    assert "intent" in HOST_BLOCK
    assert "intent" in TRANSFER_BLOCK
    assert "intent" in SETTINGS_BLOCK

    assert HOST_ANSWERS["family"] == ("monitor", 0.90)
    assert TRANSFER_ANSWERS["family"] == ("act", 0.85)
    assert SETTINGS_ANSWERS["family"] == ("input", 0.80)

    backend = scripted_backend(HOST_ANSWERS)
    assert isinstance(backend, DeterministicMockBackend)
