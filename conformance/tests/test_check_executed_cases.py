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

"""Unit tests for conformance/scripts/check_executed_cases.py."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
from typing import Any

import pytest
import yaml

CONFORMANCE_DIR = Path(__file__).resolve().parent.parent
SCRIPT_PATH = CONFORMANCE_DIR / "scripts" / "check_executed_cases.py"

_SPEC = importlib.util.spec_from_file_location("check_executed_cases", SCRIPT_PATH)
assert _SPEC is not None and _SPEC.loader is not None
check_executed_cases = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = check_executed_cases
_SPEC.loader.exec_module(check_executed_cases)

Finding = check_executed_cases.Finding
ManifestRecord = check_executed_cases.ManifestRecord
compare = check_executed_cases.compare
load_corpus = check_executed_cases.load_corpus
load_records = check_executed_cases.load_records
main = check_executed_cases.main
render_matrix = check_executed_cases.render_matrix


def _create_temp_conformance(tmp_path: Path) -> tuple[Path, Path]:
    """Creates a temporary conformance root and manifest directory."""
    conf_root = tmp_path / "conformance"
    (conf_root / "core").mkdir(parents=True)
    (conf_root / "agent" / "builder").mkdir(parents=True)
    (conf_root / "extensions" / "a2a").mkdir(parents=True)
    (conf_root / "extensions" / "adk").mkdir(parents=True)

    corpora = {
        "core": {"include": ["core/*.yaml"]},
        "agent": {"include": ["agent/**/*.yaml"]},
        "extensions": {"include": ["extensions/**/*.yaml"]},
    }
    (conf_root / "manifest_corpora.json").write_text(
        json.dumps(corpora), encoding="utf-8"
    )

    (conf_root / "core" / "alpha.yaml").write_text(
        yaml.safe_dump([
            {"name": "case_one", "action": "validate"},
            {"name": "case_two", "action": "validate"},
        ]),
        encoding="utf-8",
    )
    (conf_root / "core" / "beta.yaml").write_text(
        yaml.safe_dump([
            {"name": "case_three", "action": "validate"},
        ]),
        encoding="utf-8",
    )
    (conf_root / "agent" / "builder" / "builder.yaml").write_text(
        yaml.safe_dump({
            "suite": "builder_suite",
            "macros": [],
            "tests": [
                {"id": "01_primitive"},
                {"id": "02_nested"},
            ],
        }),
        encoding="utf-8",
    )
    (conf_root / "extensions" / "a2a" / "a2a_integration.yaml").write_text(
        yaml.safe_dump([{"name": "a2a_case", "action": "convert"}]),
        encoding="utf-8",
    )
    (conf_root / "extensions" / "adk" / "adk_extensions.yaml").write_text(
        yaml.safe_dump([{"name": "adk_case", "action": "convert"}]),
        encoding="utf-8",
    )

    manifest_dir = tmp_path / "manifest"
    manifest_dir.mkdir()
    return conf_root, manifest_dir


def _write_jsonl(path: Path, lines: list[dict[str, Any] | str]) -> None:
    serialized = [line if isinstance(line, str) else json.dumps(line) for line in lines]
    path.write_text("\n".join(serialized) + "\n", encoding="utf-8")


def test_manifest_corpora_globs_match_real_files() -> None:
    corpora_data = json.loads(
        (CONFORMANCE_DIR / "manifest_corpora.json").read_text(encoding="utf-8")
    )
    assert set(corpora_data) >= {"core", "agent", "extensions", "adapter"}
    for corpus_name, spec in corpora_data.items():
        patterns = spec.get("include", [])
        assert patterns, f"Corpus {corpus_name!r} has no include patterns"
        for pattern in patterns:
            matches = [p for p in CONFORMANCE_DIR.glob(pattern) if p.is_file()]
            assert (
                matches
            ), f"Glob {pattern!r} in corpus {corpus_name!r} matched 0 files"
        loaded = load_corpus(CONFORMANCE_DIR, [corpus_name])
        assert loaded, f"Corpus {corpus_name!r} loaded 0 suites"
        assert all(loaded.values()), f"Corpus {corpus_name!r} has an empty suite"


def test_passing_run_produces_no_findings(tmp_path: Path) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    _write_jsonl(
        manifest_dir / "python-core-1.jsonl",
        [
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_one",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_two",
                "status": "skipped",
                "reason": "feature not implemented yet",
            },
            {
                "harness": "python-core",
                "suite": "core/beta.yaml",
                "case": "case_three",
                "status": "xfailed",
                "reason": "known issue tracked separately",
            },
        ],
    )
    corpus = load_corpus(conf_root, ["core"])
    records = load_records(manifest_dir, "python-core")
    assert compare(corpus, records, {}) == []


def test_empty_manifest_directory_fails_with_missing_for_every_case(
    tmp_path: Path,
) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    corpus = load_corpus(conf_root, ["core"])
    records = load_records(manifest_dir, "python-core")
    findings = compare(corpus, records, {})
    assert len(findings) == 3
    assert {f.kind for f in findings} == {"MISSING"}
    assert {(f.suite, f.case) for f in findings} == {
        ("core/alpha.yaml", "case_one"),
        ("core/alpha.yaml", "case_two"),
        ("core/beta.yaml", "case_three"),
    }


def test_finding_missing(tmp_path: Path) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    _write_jsonl(
        manifest_dir / "python-core.jsonl",
        [
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_one",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/beta.yaml",
                "case": "case_three",
                "status": "passed",
            },
        ],
    )
    corpus = load_corpus(conf_root, ["core"])
    records = load_records(manifest_dir, "python-core")
    findings = compare(corpus, records, {})
    assert [f.kind for f in findings] == ["MISSING"]
    assert findings[0].suite == "core/alpha.yaml"
    assert findings[0].case == "case_two"


def test_finding_duplicate(tmp_path: Path) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    _write_jsonl(
        manifest_dir / "python-core.jsonl",
        [
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_one",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_one",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_two",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/beta.yaml",
                "case": "case_three",
                "status": "passed",
            },
        ],
    )
    corpus = load_corpus(conf_root, ["core"])
    records = load_records(manifest_dir, "python-core")
    findings = compare(corpus, records, {})
    assert [f.kind for f in findings] == ["DUPLICATE"]
    assert findings[0].suite == "core/alpha.yaml"
    assert findings[0].case == "case_one"


def test_finding_unknown_case(tmp_path: Path) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    _write_jsonl(
        manifest_dir / "python-core.jsonl",
        [
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_one",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_two",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "nonexistent_case",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/beta.yaml",
                "case": "case_three",
                "status": "passed",
            },
        ],
    )
    corpus = load_corpus(conf_root, ["core"])
    records = load_records(manifest_dir, "python-core")
    findings = compare(corpus, records, {})
    assert [f.kind for f in findings] == ["UNKNOWN_CASE"]
    assert findings[0].suite == "core/alpha.yaml"
    assert findings[0].case == "nonexistent_case"


@pytest.mark.parametrize("status", ["skipped", "xfailed"])
@pytest.mark.parametrize("reason", [None, "", "   "])
def test_finding_unreasoned(tmp_path: Path, status: str, reason: str | None) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    bad_record: dict[str, Any] = {
        "harness": "python-core",
        "suite": "core/alpha.yaml",
        "case": "case_one",
        "status": status,
    }
    if reason is not None:
        bad_record["reason"] = reason
    _write_jsonl(
        manifest_dir / "python-core.jsonl",
        [
            bad_record,
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_two",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/beta.yaml",
                "case": "case_three",
                "status": "passed",
            },
        ],
    )
    corpus = load_corpus(conf_root, ["core"])
    records = load_records(manifest_dir, "python-core")
    findings = compare(corpus, records, {})
    assert [f.kind for f in findings] == ["UNREASONED"]
    assert findings[0].suite == "core/alpha.yaml"
    assert findings[0].case == "case_one"


@pytest.mark.parametrize(
    "bad_line",
    [
        "{not valid json",
        {
            "harness": "python-core",
            "suite": "core/alpha.yaml",
            "case": "case_one",
            "status": "unknown_status",
        },
        {
            "harness": "python-core",
            "suite": "core/alpha.yaml",
            "case": "case_one",
            "status": "passed",
            "extraField": True,
        },
    ],
)
def test_finding_invalid_record(tmp_path: Path, bad_line: dict[str, Any] | str) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    _write_jsonl(
        manifest_dir / "python-core.jsonl",
        [
            bad_line,
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_one",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_two",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/beta.yaml",
                "case": "case_three",
                "status": "passed",
            },
        ],
    )
    corpus = load_corpus(conf_root, ["core"])
    records = load_records(manifest_dir, "python-core")
    findings = compare(corpus, records, {})
    assert [f.kind for f in findings] == ["INVALID_RECORD"]


def test_finding_failed(tmp_path: Path) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    _write_jsonl(
        manifest_dir / "python-core.jsonl",
        [
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_one",
                "status": "failed",
            },
            {
                "harness": "python-core",
                "suite": "core/alpha.yaml",
                "case": "case_two",
                "status": "passed",
            },
            {
                "harness": "python-core",
                "suite": "core/beta.yaml",
                "case": "case_three",
                "status": "passed",
            },
        ],
    )
    corpus = load_corpus(conf_root, ["core"])
    records = load_records(manifest_dir, "python-core")
    findings = compare(corpus, records, {})
    assert [f.kind for f in findings] == ["FAILED"]
    assert findings[0].suite == "core/alpha.yaml"
    assert findings[0].case == "case_one"


def test_map_form_suite_uses_id(tmp_path: Path) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    corpus = load_corpus(conf_root, ["agent"])
    assert corpus == {"agent/builder/builder.yaml": {"01_primitive", "02_nested"}}
    _write_jsonl(
        manifest_dir / "python-agent.jsonl",
        [
            {
                "harness": "python-agent",
                "suite": "agent/builder/builder.yaml",
                "case": "01_primitive",
                "status": "passed",
            },
            {
                "harness": "python-agent",
                "suite": "agent/builder/builder.yaml",
                "case": "02_nested",
                "status": "passed",
            },
        ],
    )
    records = load_records(manifest_dir, "python-agent")
    assert compare(corpus, records, {}) == []


def test_only_glob_narrows_corpus(tmp_path: Path) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    _write_jsonl(
        manifest_dir / "python-a2a.jsonl",
        [
            {
                "harness": "python-a2a",
                "suite": "extensions/a2a/a2a_integration.yaml",
                "case": "a2a_case",
                "status": "passed",
            },
        ],
    )
    exit_code = main([
        "--conformance-root",
        str(conf_root),
        "--manifest-dir",
        str(manifest_dir),
        "--harness",
        "python-a2a",
        "--corpus",
        "extensions",
        "--only",
        "extensions/a2a/**",
    ])
    assert exit_code == 0


def test_exclude_skips_suite_and_prints_reason(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    _write_jsonl(
        manifest_dir / "dart-core.jsonl",
        [
            {
                "harness": "dart-core",
                "suite": "core/alpha.yaml",
                "case": "case_one",
                "status": "passed",
            },
            {
                "harness": "dart-core",
                "suite": "core/alpha.yaml",
                "case": "case_two",
                "status": "passed",
            },
        ],
    )
    exit_code = main([
        "--conformance-root",
        str(conf_root),
        "--manifest-dir",
        str(manifest_dir),
        "--harness",
        "dart-core",
        "--corpus",
        "core",
        "--exclude",
        "core/beta.yaml=performance tagged suite",
    ])
    assert exit_code == 0
    captured = capsys.readouterr()
    assert "Excluded core/beta.yaml: performance tagged suite" in captured.out


def test_out_of_corpus_and_other_harness_records_are_ignored(
    tmp_path: Path,
) -> None:
    conf_root, manifest_dir = _create_temp_conformance(tmp_path)
    matrix_file = tmp_path / "matrix.md"
    _write_jsonl(
        manifest_dir / "mixed.jsonl",
        [
            {
                "harness": "web_core",
                "suite": "core/alpha.yaml",
                "case": "case_one",
                "status": "passed",
            },
            {
                "harness": "web_core",
                "suite": "core/alpha.yaml",
                "case": "case_two",
                "status": "skipped",
                "reason": "skip reason",
            },
            {
                "harness": "web_core",
                "suite": "core/beta.yaml",
                "case": "case_three",
                "status": "passed",
            },
            {
                "harness": "web_core",
                "suite": "agent/builder/builder.yaml",
                "case": "01_primitive",
                "status": "skipped",
                "reason": "agent suite skipped in web_core",
            },
            {
                "harness": "other-harness",
                "suite": "core/alpha.yaml",
                "case": "case_one",
                "status": "failed",
            },
        ],
    )
    exit_code = main([
        "--conformance-root",
        str(conf_root),
        "--manifest-dir",
        str(manifest_dir),
        "--harness",
        "web_core",
        "--corpus",
        "core",
        "--matrix-out",
        str(matrix_file),
    ])
    assert exit_code == 0
    matrix_text = matrix_file.read_text(encoding="utf-8")
    assert "| `core/alpha.yaml` | 1 | 0 | 1 | 0 | 2 |" in matrix_text
    assert "| `core/beta.yaml` | 1 | 0 | 0 | 0 | 1 |" in matrix_text
    assert "agent/builder/builder.yaml" not in matrix_text
