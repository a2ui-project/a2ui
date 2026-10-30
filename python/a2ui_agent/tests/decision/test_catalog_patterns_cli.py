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

"""End-to-end CLI tests for `catalog_patterns_tool.py`."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import sys

import pytest

from .catalog_patterns_fixtures import (
    BROKEN_PATTERNS,
    BROKEN_TEMPLATES,
    DESIGN_SYSTEM_PATTERNS,
    DESIGN_SYSTEM_SAMPLE_PAYLOADS,
    FIXED_FORMS_SAMPLE_PAYLOADS,
    FIXED_FORMS_TEMPLATES,
    HYBRID_CATALOG_ID,
    design_system_catalog_dict,
    fixed_forms_catalog_dict,
    hybrid_catalog_dict,
    write_json,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPTS_DIR = (
    REPO_ROOT / ".agents" / "skills" / "a2ui-generate-catalog-patterns" / "scripts"
)
TOOL_SCRIPT = SCRIPTS_DIR / "catalog_patterns_tool.py"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import catalog_patterns_tool  # noqa: E402


def test_cli_inspect_external_directories_and_modes(tmp_path: Path) -> None:
    comp_dir = tmp_path / "external_composable"
    comp_cat = write_json(comp_dir, "catalog.json", design_system_catalog_dict("1.0"))
    comp_out = tmp_path / "comp_inspect.json"

    rc = catalog_patterns_tool.main(
        ["inspect", str(comp_cat), "--format", "json", "--out", str(comp_out)]
    )
    assert rc == 0
    comp_data = json.loads(comp_out.read_text(encoding="utf-8"))
    assert comp_data["mode"] == "composable"
    assert Path(comp_data["targetDir"]) == comp_dir.resolve()
    assert str(comp_dir.resolve() / "patterns.json") in comp_data["recommendedFiles"]

    fixed_dir = tmp_path / "external_fixed"
    fixed_cat = write_json(fixed_dir, "catalog.json", fixed_forms_catalog_dict("1.0"))
    fixed_out = tmp_path / "fixed_inspect.json"

    rc_fixed = catalog_patterns_tool.main(
        ["inspect", str(fixed_cat), "--format", "json", "--out", str(fixed_out)]
    )
    assert rc_fixed == 0
    fixed_data = json.loads(fixed_out.read_text(encoding="utf-8"))
    assert fixed_data["mode"] == "fixed_surface"
    assert str(fixed_dir.resolve() / "templates.json") in fixed_data["recommendedFiles"]

    hybrid_dir = tmp_path / "external_hybrid"
    hybrid_cat = write_json(hybrid_dir, "catalog.json", hybrid_catalog_dict("1.0"))
    custom_out_dir = tmp_path / "custom_out"
    hybrid_out = tmp_path / "hybrid_inspect.json"

    rc_hybrid = catalog_patterns_tool.main([
        "inspect",
        str(hybrid_cat),
        "--out-dir",
        str(custom_out_dir),
        "--format",
        "json",
        "--out",
        str(hybrid_out),
    ])
    assert rc_hybrid == 0
    hybrid_data = json.loads(hybrid_out.read_text(encoding="utf-8"))
    assert hybrid_data["mode"] == "hybrid"
    assert Path(hybrid_data["targetDir"]) == custom_out_dir.resolve()


def test_cli_validate_exit_codes_and_auto_discovery(tmp_path: Path) -> None:
    ext_dir = tmp_path / "design_system_repo"
    cat_path = write_json(ext_dir, "catalog.json", design_system_catalog_dict("1.0"))
    write_json(ext_dir, "patterns.json", DESIGN_SYSTEM_PATTERNS)
    pay_path = write_json(
        ext_dir, "sample_payloads.json", DESIGN_SYSTEM_SAMPLE_PAYLOADS
    )
    out_md = tmp_path / "report.md"

    rc_ok = catalog_patterns_tool.main([
        "validate",
        "--catalog",
        str(cat_path),
        "--payload",
        str(pay_path),
        "--format",
        "markdown",
        "--out",
        str(out_md),
    ])
    assert rc_ok == 0
    assert "# Catalog Validation (PASSED)" in out_md.read_text(encoding="utf-8")

    # Unknown pattern name triggers exit code 1 under --strict.
    with_unknown = copy.deepcopy(DESIGN_SYSTEM_PATTERNS)
    with_unknown["patterns"]["custom_extra"] = copy.deepcopy(
        DESIGN_SYSTEM_PATTERNS["patterns"]["prose"]
    )
    unk_pat = write_json(tmp_path, "unknown_patterns.json", with_unknown)
    rc_non_strict = catalog_patterns_tool.main([
        "validate",
        str(unk_pat),
        "--catalog",
        str(cat_path),
        "--payload",
        str(pay_path),
    ])
    assert rc_non_strict == 0

    rc_strict = catalog_patterns_tool.main([
        "validate",
        str(unk_pat),
        "--catalog",
        str(cat_path),
        "--payload",
        str(pay_path),
        "--strict",
    ])
    assert rc_strict == 1

    # Broken patterns trigger exit code 1.
    broken_pat = write_json(tmp_path, "broken_patterns.json", BROKEN_PATTERNS)
    rc_broken = catalog_patterns_tool.main([
        "validate",
        "--catalog",
        str(cat_path),
        "--patterns",
        str(broken_pat),
        "--payload",
        str(pay_path),
    ])
    assert rc_broken == 1

    # Broken templates trigger exit code 1.
    fixed_dir = tmp_path / "fixed_repo"
    fixed_cat = write_json(fixed_dir, "catalog.json", fixed_forms_catalog_dict("1.0"))
    broken_tpl = write_json(fixed_dir, "templates.json", BROKEN_TEMPLATES)
    fixed_pay = write_json(
        fixed_dir, "sample_payloads.json", FIXED_FORMS_SAMPLE_PAYLOADS
    )
    rc_broken_tpl = catalog_patterns_tool.main([
        "validate",
        str(broken_tpl),
        "--catalog",
        str(fixed_cat),
        "--payload",
        str(fixed_pay),
    ])
    assert rc_broken_tpl == 1

    # ToolError (missing catalog or mismatched catalogId) triggers exit code 2.
    rc_missing = catalog_patterns_tool.main(
        ["inspect", str(tmp_path / "does_not_exist.json")]
    )
    assert rc_missing == 2

    mismatched_tpl = copy.deepcopy(FIXED_FORMS_TEMPLATES)
    mismatched_tpl["catalogId"] = HYBRID_CATALOG_ID
    mismatch_path = write_json(tmp_path, "mismatched_templates.json", mismatched_tpl)
    rc_mismatch = catalog_patterns_tool.main([
        "validate",
        "--catalog",
        str(fixed_cat),
        "--templates",
        str(mismatch_path),
        "--payload",
        str(fixed_pay),
    ])
    assert rc_mismatch == 2


def test_cli_requires_payload_flag(tmp_path: Path) -> None:
    cat_path = write_json(tmp_path, "catalog.json", design_system_catalog_dict("1.0"))
    with pytest.raises(SystemExit) as exc_info:
        catalog_patterns_tool.main(["validate", "--catalog", str(cat_path)])
    assert exc_info.value.code != 0


def test_cli_subprocess_smoke_on_basic_catalog(tmp_path: Path) -> None:
    basic_cat = REPO_ROOT / "catalogs" / "basic" / "v1" / "catalog.json"
    basic_pat = REPO_ROOT / "catalogs" / "basic" / "v1" / "patterns.json"
    pay_path = write_json(
        tmp_path, "sample_payloads.json", DESIGN_SYSTEM_SAMPLE_PAYLOADS
    )
    out_json = tmp_path / "basic_report.json"

    proc = subprocess.run(
        [
            sys.executable,
            str(TOOL_SCRIPT),
            "validate",
            str(basic_pat),
            "--catalog",
            str(basic_cat),
            "--payload",
            str(pay_path),
            "--format",
            "json",
            "--out",
            str(out_json),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    report = json.loads(out_json.read_text(encoding="utf-8"))
    assert report["ok"] is True
    assert len([a for a in report["archetypes"] if a["eligible"]]) == 14
    assert len(report["payloadEligible"]) >= 8
