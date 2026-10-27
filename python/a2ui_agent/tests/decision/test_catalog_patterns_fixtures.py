# Copyright 2026 Google LLC
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

"""Unit tests for Wave 1 SDK sidecar loaders, `_common.py`, and catalog fixtures."""

from __future__ import annotations

from pathlib import Path
import pytest

from a2ui.core import A2uiValidationError
from a2ui.inference_formats.decision import (
    CatalogDecisionGraph,
    PatternLibrary,
    SurfaceTemplate,
    TemplateRegistry,
)

from .catalog_patterns_fixtures import (
    DESIGN_SYSTEM_CATALOG_ID,
    DESIGN_SYSTEM_PATTERNS,
    DESIGN_SYSTEM_SAMPLE_PAYLOADS,
    FIXED_FORMS_CATALOG_ID,
    FIXED_FORMS_SAMPLE_PAYLOADS,
    FIXED_FORMS_TEMPLATES,
    build_design_system_catalog,
    build_fixed_forms_catalog,
    build_hybrid_catalog,
    design_system_catalog_dict,
    ensure_scripts_on_path,
    write_json,
)

ensure_scripts_on_path()

import _common  # noqa: E402


def test_fixture_catalogs_and_decision_graphs() -> None:
    design = build_design_system_catalog("1.0")
    design_graph = CatalogDecisionGraph([design])
    container_names = {c.name for c in design_graph.container_candidates()}
    assert "Stack" in container_names
    assert "Panel" in container_names

    fixed = build_fixed_forms_catalog("1.0")
    fixed_graph = CatalogDecisionGraph([fixed])
    assert fixed_graph.container_candidates() == ()
    assert {c.name for c in fixed_graph.leaf_candidates()} == {
        "OrderEntryTicket",
        "WireTransferForm",
        "TaxWithholdingForm",
    }

    hybrid = build_hybrid_catalog("1.0")
    hybrid_graph = CatalogDecisionGraph([hybrid])
    assert "Stack" in {c.name for c in hybrid_graph.container_candidates()}
    assert "OrderEntryTicket" in {c.name for c in hybrid_graph.leaf_candidates()}


def test_pattern_library_from_file_and_directory(tmp_path: Path) -> None:
    patterns_file = write_json(tmp_path, "patterns.json", DESIGN_SYSTEM_PATTERNS)
    lib_from_file = PatternLibrary.from_file(patterns_file)
    lib_from_dir = PatternLibrary.from_file(tmp_path)
    assert lib_from_file.catalog_ids == (DESIGN_SYSTEM_CATALOG_ID,)
    assert set(lib_from_file.patterns.keys()) == set(lib_from_dir.patterns.keys())
    assert lib_from_dir.has_pattern("collection", "rows")


def test_template_registry_from_json_file_and_round_trip(
    tmp_path: Path,
) -> None:
    templates_file = write_json(tmp_path, "templates.json", FIXED_FORMS_TEMPLATES)
    reg_from_file = TemplateRegistry.from_file(templates_file)
    reg_from_dir = TemplateRegistry.from_file(tmp_path)
    assert len(reg_from_file.list_templates()) == 3
    assert len(reg_from_dir.list_templates()) == 3

    ticket = reg_from_dir.get("order_entry_ticket")
    assert ticket is not None
    assert ticket.catalog_id == FIXED_FORMS_CATALOG_ID
    assert ticket.required_pointers == ("/symbol", "/shares")
    assert ticket.is_mutable is True

    dumped = reg_from_dir.to_dict(
        catalog_id=FIXED_FORMS_CATALOG_ID, protocol_version="1.0"
    )
    reloaded = TemplateRegistry.from_json(dumped)
    assert [t.template_id for t in reloaded.list_templates()] == [
        "order_entry_ticket",
        "wire_transfer_form",
        "tax_withholding_form",
    ]


def test_surface_template_from_json_validation_errors() -> None:
    with pytest.raises(A2uiValidationError, match="non-empty 'description'"):
        SurfaceTemplate.from_json("bad", {"description": "", "components": []})

    with pytest.raises(A2uiValidationError, match="must start with '/'"):
        SurfaceTemplate.from_json(
            "bad_ptr",
            {
                "description": "Valid description",
                "requiredPointers": ["symbol"],
                "components": [{"id": "root", "component": "OrderEntryTicket"}],
            },
        )


def test_common_loaders_and_target_dir_resolution(tmp_path: Path) -> None:
    ext_repo_dir = tmp_path / "external_repo" / "catalogs" / "custom"
    cat_path = write_json(
        ext_repo_dir, "catalog.json", design_system_catalog_dict("1.0")
    )
    loaded = _common.load_catalog(cat_path)
    assert loaded.path == cat_path.resolve()
    assert loaded.target_dir == ext_repo_dir.resolve()
    assert loaded.graph.protocol_version == "v1.0"

    override_dir = tmp_path / "custom_out"
    loaded_override = _common.load_catalog(cat_path, out_dir=override_dir)
    assert loaded_override.target_dir == override_dir.resolve()

    bad_json = ext_repo_dir / "broken.json"
    bad_json.write_text("{not valid json", encoding="utf-8")
    with pytest.raises(_common.ToolError, match="Malformed JSON"):
        _common.load_catalog(bad_json)


def test_load_sample_payloads_named_and_single(tmp_path: Path) -> None:
    named_path = write_json(
        tmp_path, "sample_payloads.json", DESIGN_SYSTEM_SAMPLE_PAYLOADS
    )
    named = _common.load_sample_payloads(named_path)
    assert set(named.keys()) == {"browse_catalog", "monitor_metrics"}

    single_path = write_json(
        tmp_path,
        "single.json",
        FIXED_FORMS_SAMPLE_PAYLOADS["samples"]["order_ticket"],
    )
    single = _common.load_sample_payloads(single_path)
    assert list(single.keys()) == ["default"]
    assert single["default"]["symbol"] == "GOOG"

    empty_path = write_json(tmp_path, "empty.json", {})
    with pytest.raises(_common.ToolError, match="must not be empty"):
        _common.load_sample_payloads(empty_path)
