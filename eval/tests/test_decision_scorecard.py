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

"""Unit tests for the multi-backend Wave 6 decision_scorecard CLI."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

import pytest

sys.path.append(os.path.abspath(os.path.dirname(__file__)))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../bin")))

import decision_scorecard


def _write_scorecard_datasets(ds_dir: Path) -> None:
    """Writes synthetic tuning (`v1.yaml`) and heldout (`heldout_v1.yaml`) datasets."""
    ds_dir.mkdir(parents=True, exist_ok=True)
    (ds_dir / "v1.yaml").write_text(
        """
- name: tuning_host
  intent: "Display CPU load for prod-1"
  payload:
    host: "prod-1"
    cpu: 0.72
  mode: "tool"
  tool_name: "render_tuning_host"
  expected:
    family: "monitor"
    archetypes: ["dashboard"]
    bindings:
      headline.items: "/cpu"
  split: "tuning"
  verified: true
""",
        encoding="utf-8",
    )
    (ds_dir / "heldout_v1.yaml").write_text(
        """
- name: heldout_game_board
  intent: "Open a 2D physics sandbox with draggable rigid bodies"
  payload:
    gravity: 9.81
    bodiesCount: 14
  expected:
    family: "none"
    archetypes: []
  split: "heldout"
  verified: false

- name: heldout_transfer
  intent: "Review wire payment to Acme Corp"
  payload:
    recipient: "Acme Corp"
    amount: 950
    apiSecret: "sk-live-secret-token"
  actions:
    approve: "Approve Wire"
  exclude: ["/apiSecret"]
  sensitive: ["/apiSecret"]
  expected:
    family: "act"
    archetypes: ["confirm"]
    actions:
      approve: []
  split: "heldout"
  verified: false
""",
        encoding="utf-8",
    )


def test_ensure_mock_baseline_and_yaml_config_loading(tmp_path: Path) -> None:
    """Verifies scorecard YAML configuration parsing and mock baseline injection."""
    cfg_path = tmp_path / "backends.yaml"
    cfg_path.write_text(
        """
backends:
  - name: jev_hosted
    backend: systemone
    model: jev-1.14.0
    p95_target_ms: 250
  - name: gemini_hosted
    backend: gemini
    model: gemini-decision-1
    endpoint_url: https://generativelanguage.googleapis.com/v1beta/decisions
    p95_target_ms: 500
""",
        encoding="utf-8",
    )
    specs = decision_scorecard.load_scorecard_config(cfg_path)
    assert len(specs) == 2
    assert specs[0].target_ms == 250.0
    assert specs[1].backend == "gemini"

    with_baseline = decision_scorecard.ensure_mock_baseline(specs)
    assert len(with_baseline) == 3
    assert with_baseline[-1].backend == "mock"
    assert len(decision_scorecard.ensure_mock_baseline(with_baseline)) == 3


def test_decision_scorecard_generates_markdown_and_json_across_splits(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verifies decision_scorecard CLI emits Markdown and JSON reports across splits."""
    monkeypatch.delenv("JEV_API_KEY", raising=False)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.delenv("A2UI_DECISION_URL", raising=False)

    ds_dir = tmp_path / "decision_plans"
    _write_scorecard_datasets(ds_dir)

    cfg_path = tmp_path / "scorecard.yaml"
    cfg_path.write_text(
        """
backends:
  - name: jev_hosted
    backend: systemone
    model: jev-1.14.0
    p95_target_ms: 250
  - name: mock_ref
    backend: mock
    model: mock-v1
    p95_target_ms: 250
""",
        encoding="utf-8",
    )
    md_out = tmp_path / "scorecard.md"
    json_out = tmp_path / "scorecard.json"

    rc = decision_scorecard.main([
        "--config",
        str(cfg_path),
        "--dataset",
        str(ds_dir),
        "--split",
        "all",
        "--paraphrase",
        "--template-arm",
        "--out",
        str(md_out),
        "--json",
        str(json_out),
    ])
    assert rc == 0
    md_text = md_out.read_text(encoding="utf-8")
    assert "# A2UI Decision Model Scorecard" in md_text
    assert "## Split: `tuning`" in md_text
    assert "## Split: `heldout`" in md_text
    assert "[UNFROZEN HELDOUT]" in md_text
    assert "Forced-Fit (<=5%)" in md_text
    assert "False No-Fit (<=10%)" in md_text
    assert "< 250 ms" in md_text
    assert "## Skipped backends" in md_text
    assert "`jev_hosted`" in md_text

    parsed = json.loads(json_out.read_text(encoding="utf-8"))
    assert set(parsed["splits"]) == {"tuning", "heldout"}
    assert len(parsed["splits"]["heldout"]) == 1
    assert parsed["splits"]["heldout"][0]["display_name"] == "mock_ref"
    assert len(parsed["skipped_backends"]) == 1

    # `--strict` exits 1 when `jev_hosted` lacks credentials
    rc_strict = decision_scorecard.main([
        "--config",
        str(cfg_path),
        "--dataset",
        str(ds_dir),
        "--strict",
    ])
    assert rc_strict == 1
