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

"""Unit tests for Track 2B (`synthetic_bindings.py` and `validate_patterns.py`)."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import pytest

from a2ui.inference_formats.decision import (
    ArchetypeGrammar,
    CatalogDecisionGraph,
    PatternLibrary,
    resolve_fallback_pattern,
)

from .catalog_patterns_fixtures import (
    BROKEN_PATTERNS,
    BROKEN_TEMPLATES,
    DESIGN_SYSTEM_PATTERNS,
    DESIGN_SYSTEM_SAMPLE_PAYLOADS,
    FIXED_FORMS_SAMPLE_PAYLOADS,
    FIXED_FORMS_TEMPLATES,
    HYBRID_CATALOG_ID,
    REPO_ROOT,
    build_design_system_catalog,
    design_system_catalog_dict,
    ensure_scripts_on_path,
    fixed_forms_catalog_dict,
    hybrid_catalog_dict,
    write_json,
)

ensure_scripts_on_path()

import _common  # noqa: E402
import synthetic_bindings  # noqa: E402
import validate_patterns  # noqa: E402


def test_basic_catalog_oracle_and_payload_eligibility(tmp_path: Path) -> None:
    basic_cat = REPO_ROOT / "catalogs" / "basic" / "v1" / "catalog.json"
    basic_pat = REPO_ROOT / "catalogs" / "basic" / "v1" / "patterns.json"
    payload_file = write_json(
        tmp_path,
        "sample_payloads.json",
        DESIGN_SYSTEM_SAMPLE_PAYLOADS,
    )

    loaded = _common.load_catalog(basic_cat)
    report = validate_patterns.validate_catalog_artifacts(
        loaded,
        payload_path=payload_file,
        patterns_path=basic_pat,
    )

    assert report.ok is True
    assert report.failures == ()
    assert report.expansions_run > 17
    assert len(report.archetypes) == 14
    assert all(a.eligible for a in report.archetypes)

    arch_by_id = {a.archetype_id: a for a in report.archetypes}
    assert arch_by_id["timeline"].degraded_required == ("timeline",)
    assert arch_by_id["location"].degraded_required == ("map",)

    block_by_id = {b.block_id: b for b in report.blocks}
    assert block_by_id["chart"].resolution == "fallback"
    assert block_by_id["chart"].via == "headline"
    assert block_by_id["timeline"].resolution == "fallback"
    assert block_by_id["timeline"].via == "steps"
    assert block_by_id["map"].resolution == "fallback"
    assert block_by_id["map"].via == "facts"
    assert block_by_id["comparison"].resolution == "direct"

    assert "feed" in report.payload_eligible
    assert "timeline" not in report.payload_eligible
    assert "location" not in report.payload_eligible


def test_basic_patterns_asset_parity() -> None:
    from a2ui.inference_formats.decision.archetypes import asset_path

    src_pat = REPO_ROOT / "catalogs" / "basic" / "v1" / "patterns.json"
    bundled_pat = asset_path("patterns", "basic_v1_0.json")
    assert json.loads(src_pat.read_text(encoding="utf-8")) == json.loads(
        bundled_pat.read_text(encoding="utf-8")
    )


def test_composable_design_system_validation_and_broken_patterns(
    tmp_path: Path,
) -> None:
    cat_path = write_json(tmp_path, "catalog.json", design_system_catalog_dict("1.0"))
    pat_path = write_json(tmp_path, "patterns.json", DESIGN_SYSTEM_PATTERNS)
    pay_path = write_json(
        tmp_path, "sample_payloads.json", DESIGN_SYSTEM_SAMPLE_PAYLOADS
    )

    loaded = _common.load_catalog(cat_path)
    report = validate_patterns.validate_catalog_artifacts(loaded, payload_path=pay_path)
    assert report.ok is True
    assert report.patterns_path == pat_path.resolve()
    assert "feed" in report.payload_eligible

    grammar = ArchetypeGrammar.default()
    lib = PatternLibrary.from_json(DESIGN_SYSTEM_PATTERNS)
    cmp_resolved = resolve_fallback_pattern(grammar.blocks["comparison"], lib)
    arch_by_id = {a.archetype_id: a for a in report.archetypes}
    assert arch_by_id["compare"].eligible is (cmp_resolved is not None)

    broken_path = write_json(tmp_path, "broken_patterns.json", BROKEN_PATTERNS)
    broken_report = validate_patterns.validate_catalog_artifacts(
        loaded,
        payload_path=pay_path,
        patterns_path=broken_path,
    )
    assert broken_report.ok is False
    stages_by_pattern = {f.pattern: f.stage for f in broken_report.failures}
    assert stages_by_pattern["headline"] == "schema"
    assert stages_by_pattern["actions"] == "expand"


def test_fixed_forms_templates_validation_and_broken_templates(
    tmp_path: Path,
) -> None:
    forms_dir = tmp_path / "forms"
    cat_path = write_json(forms_dir, "catalog.json", fixed_forms_catalog_dict("1.0"))
    tpl_path = write_json(forms_dir, "templates.json", FIXED_FORMS_TEMPLATES)
    pay_path = write_json(
        forms_dir, "sample_payloads.json", FIXED_FORMS_SAMPLE_PAYLOADS
    )

    loaded = _common.load_catalog(cat_path)
    report = validate_patterns.validate_catalog_artifacts(loaded, payload_path=pay_path)
    assert report.ok is True
    assert report.templates_path == tpl_path.resolve()
    assert report.templates_validated == 3
    assert report.template_failures == ()

    broken_tpl_path = write_json(forms_dir, "broken_templates.json", BROKEN_TEMPLATES)
    broken_report = validate_patterns.validate_catalog_artifacts(
        loaded,
        payload_path=pay_path,
        templates_path=broken_tpl_path,
    )
    assert broken_report.ok is False
    tpl_stages = {tf.template_id: tf.stage for tf in broken_report.template_failures}
    assert tpl_stages["order_entry_ticket"] == "schema"
    assert tpl_stages["tax_withholding_form"] == "payload"


def test_hybrid_catalog_auto_discovers_both_sidecars(tmp_path: Path) -> None:
    hybrid_dir = tmp_path / "hybrid"
    cat_path = write_json(hybrid_dir, "catalog.json", hybrid_catalog_dict("1.0"))
    hybrid_patterns = copy.deepcopy(DESIGN_SYSTEM_PATTERNS)
    hybrid_patterns["catalogIds"] = [HYBRID_CATALOG_ID]
    write_json(hybrid_dir, "patterns.json", hybrid_patterns)

    hybrid_templates = {
        "version": "1.0",
        "catalogId": HYBRID_CATALOG_ID,
        "protocolVersion": "1.0",
        "templates": {
            "order_entry_ticket": copy.deepcopy(
                FIXED_FORMS_TEMPLATES["templates"]["order_entry_ticket"]
            )
        },
    }
    write_json(hybrid_dir, "templates.json", hybrid_templates)

    hybrid_payloads = {
        "samples": {
            **DESIGN_SYSTEM_SAMPLE_PAYLOADS["samples"],
            "order_ticket": FIXED_FORMS_SAMPLE_PAYLOADS["samples"]["order_ticket"],
        }
    }
    pay_path = write_json(hybrid_dir, "sample_payloads.json", hybrid_payloads)

    loaded = _common.load_catalog(cat_path)
    report = validate_patterns.validate_catalog_artifacts(loaded, payload_path=pay_path)
    assert report.ok is True
    assert report.patterns_path == (hybrid_dir / "patterns.json").resolve()
    assert report.templates_path == (hybrid_dir / "templates.json").resolve()
    assert report.templates_validated == 1
    assert "feed" in report.payload_eligible


def test_catalog_id_mismatch_and_synthetic_helpers(tmp_path: Path) -> None:
    cat_path = write_json(tmp_path, "catalog.json", fixed_forms_catalog_dict("1.0"))
    pat_path = write_json(tmp_path, "patterns.json", DESIGN_SYSTEM_PATTERNS)
    pay_path = write_json(
        tmp_path, "sample_payloads.json", DESIGN_SYSTEM_SAMPLE_PAYLOADS
    )
    loaded = _common.load_catalog(cat_path)
    with pytest.raises(_common.ToolError, match="catalogIds"):
        validate_patterns.validate_catalog_artifacts(
            loaded, payload_path=pay_path, patterns_path=pat_path
        )

    grammar = ArchetypeGrammar.default()
    coll_bindings = synthetic_bindings.synthetic_block_bindings(
        grammar.blocks["collection"]
    )
    assert "headline" in coll_bindings.slots["items"].fields

    head_bindings = synthetic_bindings.synthetic_block_bindings(
        grammar.blocks["headline"]
    )
    assert len(head_bindings.slots["items"].items) == 2

    # Ensure non-SemanticType entries in `from` ('mutable', 'action', 'key', 'any') do not raise
    synthetic_bindings.synthetic_block_bindings(grammar.blocks["form"])
    synthetic_bindings.synthetic_block_bindings(grammar.blocks["actions"])

    basic_lib = PatternLibrary.from_file(
        REPO_ROOT / "catalogs" / "basic" / "v1" / "patterns.json"
    )
    combos, truncated = synthetic_bindings.knob_combinations(
        basic_lib.get("collection"),  # type: ignore[arg-type]
        limit=5,
    )
    assert combos[0] == {}
    assert len(combos) == 5
    assert truncated is True

    g_v10 = CatalogDecisionGraph([build_design_system_catalog("1.0")])
    g_v09 = CatalogDecisionGraph([build_design_system_catalog("0.9")])
    assert validate_patterns.surface_messages(g_v10, [], {})[0]["version"] == "v1.0"
    assert validate_patterns.surface_messages(g_v09, [], {})[0]["version"] == "v0.9"
