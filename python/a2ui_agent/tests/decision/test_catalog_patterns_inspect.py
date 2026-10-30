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

"""Unit tests for Track 2A (`inspect_catalog.py`)."""

from __future__ import annotations

import json
from pathlib import Path

from .catalog_patterns_fixtures import (
    REPO_ROOT,
    design_system_catalog_dict,
    ensure_scripts_on_path,
    fixed_forms_catalog_dict,
    hybrid_catalog_dict,
    write_json,
)

ensure_scripts_on_path()

import _common  # noqa: E402
import inspect_catalog  # noqa: E402


def test_inspect_composable_design_system_catalog(tmp_path: Path) -> None:
    ext_dir = tmp_path / "my_design_repo" / "catalog"
    cat_path = write_json(ext_dir, "catalog.json", design_system_catalog_dict("1.0"))
    loaded = _common.load_catalog(cat_path)
    report = inspect_catalog.inspect_catalog(loaded)

    assert report.mode == "composable"
    assert report.page_candidates == ("Stack",)
    assert report.target_dir == str(ext_dir.resolve())
    assert report.recommended_files == (
        str(ext_dir.resolve() / "patterns.json"),
        str(ext_dir.resolve() / "sample_payloads.json"),
    )
    assert report.template_candidates == ()

    blocks_by_id = {b.block_id: b for b in report.blocks}
    assert "Stat" in blocks_by_id["headline"].candidates
    assert "Figure" in blocks_by_id["picture"].candidates
    assert "Trigger" in blocks_by_id["actions"].candidates
    assert "Entry" in blocks_by_id["form"].candidates


def test_inspect_fixed_forms_catalog(tmp_path: Path) -> None:
    forms_dir = tmp_path / "forms_repo"
    cat_path = write_json(forms_dir, "catalog.json", fixed_forms_catalog_dict("1.0"))
    loaded = _common.load_catalog(cat_path)
    report = inspect_catalog.inspect_catalog(loaded)

    assert report.mode == "fixed_surface"
    assert report.page_candidates == ()
    assert all(b.candidates == () for b in report.blocks)
    assert report.recommended_files == (
        str(forms_dir.resolve() / "templates.json"),
        str(forms_dir.resolve() / "sample_payloads.json"),
    )

    tpl_ids = [t.suggested_template_id for t in report.template_candidates]
    assert tpl_ids == [
        "order_entry_ticket",
        "wire_transfer_form",
        "tax_withholding_form",
    ]
    ticket = report.template_candidates[0]
    assert ticket.suggested_required_pointers == ("/symbol", "/shares")
    assert ticket.is_mutable is True
    assert any("fixed_surface" in n for n in report.notes)


def test_inspect_hybrid_catalog(tmp_path: Path) -> None:
    hybrid_dir = tmp_path / "hybrid_repo"
    cat_path = write_json(hybrid_dir, "catalog.json", hybrid_catalog_dict("1.0"))
    loaded = _common.load_catalog(cat_path)
    report = inspect_catalog.inspect_catalog(loaded)

    assert report.mode == "hybrid"
    assert report.page_candidates == ("Stack",)
    assert [t.suggested_template_id for t in report.template_candidates] == [
        "order_entry_ticket"
    ]
    assert report.recommended_files == (
        str(hybrid_dir.resolve() / "patterns.json"),
        str(hybrid_dir.resolve() / "templates.json"),
        str(hybrid_dir.resolve() / "sample_payloads.json"),
    )


def test_inspect_basic_catalog_and_markdown_roundtrip() -> None:
    basic_path = REPO_ROOT / "catalogs" / "basic" / "v1" / "catalog.json"
    loaded = _common.load_catalog(basic_path)
    report = inspect_catalog.inspect_catalog(loaded)

    assert report.mode == "composable"
    assert "Column" in report.page_candidates
    assert "Row" in report.page_candidates
    blocks_by_id = {b.block_id: b for b in report.blocks}
    assert "Image" in blocks_by_id["picture"].candidates
    assert "Button" in blocks_by_id["actions"].candidates

    md = inspect_catalog.report_to_markdown(report)
    assert "## Layout Grammar Block Candidates" in md
    assert "None" not in md

    as_dict = inspect_catalog.report_to_dict(report)
    encoded = json.dumps(as_dict)
    assert json.loads(encoded)["mode"] == "composable"
