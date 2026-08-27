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

"""Unit tests for the a2ui-codegen CLI."""

from pathlib import Path
import pytest
from a2ui.codegen.cli import main


def test_cli_execution(tmp_path: Path):
    repo_root = Path(__file__).resolve().parents[4]
    schema_path = repo_root / "specification" / "v0_9_1" / "catalogs" / "basic" / "catalog.json"
    out_dir = tmp_path / "generated"

    exit_code = main(["--catalog", str(schema_path), "--out", str(out_dir)])
    assert exit_code == 0
    assert (out_dir / "components.py").exists()
    assert (out_dir / "types.py").exists()
    assert (out_dir / "functions.py").exists()
    assert (out_dir / "__init__.py").exists()
    assert (out_dir / "py.typed").exists()


def test_cli_missing_catalog(tmp_path: Path):
    exit_code = main(["--catalog", str(tmp_path / "non_existent.json"), "--out", str(tmp_path)])
    assert exit_code == 1


def test_cli_corrupted_json(tmp_path: Path):
    bad_file = tmp_path / "bad.json"
    bad_file.write_text("{invalid json", encoding="utf-8")
    exit_code = main(["--catalog", str(bad_file), "--out", str(tmp_path / "out")])
    assert exit_code == 1


def test_cli_custom_base_import(tmp_path: Path):
    repo_root = Path(__file__).resolve().parents[4]
    schema_path = repo_root / "specification" / "v0_9_1" / "catalogs" / "basic" / "catalog.json"
    out_dir = tmp_path / "custom_out"

    exit_code = main([
        "--catalog",
        str(schema_path),
        "--out",
        str(out_dir),
        "--base-import",
        "custom.runtime.base",
    ])
    assert exit_code == 0
    components_code = (out_dir / "components.py").read_text(encoding="utf-8")
    assert "from custom.runtime.base import (" in components_code
