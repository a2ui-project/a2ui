# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Tests for the conformance feature registry, schema, and coverage checker."""

from __future__ import annotations

import json
from pathlib import Path
import sys

import jsonschema
import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import check_feature_coverage as cfc  # pylint: disable=wrong-import-position

CONFORMANCE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = CONFORMANCE_DIR.parent
FEATURES_YAML_PATH = CONFORMANCE_DIR / "features.yaml"
FEATURES_SCHEMA_PATH = CONFORMANCE_DIR / "features.schema.json"
CONFORMANCE_SCHEMA_PATH = CONFORMANCE_DIR / "conformance_schema.json"


def _write_temp_corpus(
    tmp_path: Path,
    features: list[dict[str, object]],
    cases: list[dict[str, object]],
) -> tuple[Path, Path, Path]:
    """Creates a minimal repo_root, registry.yaml, and corpus_dir under `tmp_path`."""
    repo_root = tmp_path / "repo"
    spec_file = repo_root / "specification" / "spec.md"
    bp_file = repo_root / "blueprints" / "bp.md"
    spec_file.parent.mkdir(parents=True, exist_ok=True)
    bp_file.parent.mkdir(parents=True, exist_ok=True)
    spec_file.write_text("# Spec Heading\n\nBody line 3.\n", encoding="utf-8")
    bp_file.write_text("# Blueprint Heading\n\nBody line 3.\n", encoding="utf-8")

    conformance_dir = repo_root / "conformance"
    core_dir = conformance_dir / "core"
    core_dir.mkdir(parents=True, exist_ok=True)
    (conformance_dir / "features.schema.json").write_text(
        FEATURES_SCHEMA_PATH.read_text(encoding="utf-8"), encoding="utf-8"
    )
    registry_path = conformance_dir / "features.yaml"
    registry_path.write_text(
        yaml.safe_dump(features, sort_keys=False), encoding="utf-8"
    )
    (core_dir / "sample_suite.yaml").write_text(
        yaml.safe_dump(cases, sort_keys=False), encoding="utf-8"
    )
    return repo_root, registry_path, conformance_dir


def test_real_registry_validates_against_schema_and_resolves_anchors() -> None:
    """Asserts that `conformance/features.yaml` validates and all anchors resolve."""
    raw_features = yaml.safe_load(FEATURES_YAML_PATH.read_text(encoding="utf-8"))
    schema = json.loads(FEATURES_SCHEMA_PATH.read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator(schema).validate(raw_features)

    features = cfc.load_registry(FEATURES_YAML_PATH)
    assert len(features) == 145

    for feature in features:
        assert cfc.resolve_anchor(
            REPO_ROOT, feature.spec_anchor
        ), f"{feature.id} has unresolved specAnchor: {feature.spec_anchor}"
        assert cfc.resolve_anchor(
            REPO_ROOT, feature.blueprint_anchor
        ), f"{feature.id} has unresolved blueprintAnchor: {feature.blueprint_anchor}"

    exit_code = cfc.main([
        "--static",
        "--report-only",
        "--repo-root",
        str(REPO_ROOT),
        "--registry",
        str(FEATURES_YAML_PATH),
        "--corpus-dir",
        str(CONFORMANCE_DIR),
    ])
    assert exit_code == 0

    static_findings = cfc.check_static(
        repo_root=REPO_ROOT,
        registry_path=FEATURES_YAML_PATH,
        corpus_dir=CONFORMANCE_DIR,
    )
    schema_or_anchor_errors = [
        f
        for f in static_findings
        if f.kind in ("schema_error", "broken_anchor", "unknown_tag")
    ]
    assert not schema_or_anchor_errors


def test_unknown_tag_finding(tmp_path: Path) -> None:
    """Detects an unknown `F-` feature tag referenced in a conformance YAML case."""
    repo_root, registry_path, corpus_dir = _write_temp_corpus(
        tmp_path,
        features=[{
            "id": "F-CORE-01",
            "title": "Create surface",
            "specAnchor": "specification/spec.md#spec-heading",
            "blueprintAnchor": "blueprints/bp.md#blueprint-heading",
            "claimedBy": ["python-core"],
        }],
        cases=[{
            "id": "case_1",
            "features": ["F-CORE-01", "F-CORE-99"],
        }],
    )
    findings = cfc.check_static(repo_root, registry_path, corpus_dir)
    unknown = [f for f in findings if f.kind == "unknown_tag"]
    assert len(unknown) == 1
    assert unknown[0].feature_id == "F-CORE-99"


def test_broken_anchor_finding(tmp_path: Path) -> None:
    """Detects broken file, heading slug, and line-number anchors in `features.yaml`."""
    repo_root, registry_path, corpus_dir = _write_temp_corpus(
        tmp_path,
        features=[{
            "id": "F-CORE-01",
            "title": "Broken anchors",
            "specAnchor": "specification/spec.md#nonexistent-heading",
            "blueprintAnchor": "blueprints/bp.md#L999",
            "claimedBy": ["python-core"],
            "uncovered": "Tracked gap.",
        }],
        cases=[],
    )
    findings = cfc.check_static(repo_root, registry_path, corpus_dir)
    broken = [f for f in findings if f.kind == "broken_anchor"]
    assert len(broken) == 2
    assert {f.feature_id for f in broken} == {"F-CORE-01"}


def test_untagged_claimed_feature_finding(tmp_path: Path) -> None:
    """Detects a feature without `uncovered` that has zero tagged conformance cases."""
    repo_root, registry_path, corpus_dir = _write_temp_corpus(
        tmp_path,
        features=[{
            "id": "F-CORE-01",
            "title": "Untagged feature",
            "specAnchor": "specification/spec.md#L1",
            "blueprintAnchor": "blueprints/bp.md#blueprint-heading",
            "claimedBy": ["python-core"],
        }],
        cases=[{
            "id": "case_without_tags",
        }],
    )
    findings = cfc.check_static(repo_root, registry_path, corpus_dir)
    untagged = [f for f in findings if f.kind == "untagged_feature"]
    assert len(untagged) == 1
    assert untagged[0].feature_id == "F-CORE-01"


def test_unexecuted_claimed_feature_in_harness_manifest(tmp_path: Path) -> None:
    """Detects when a claiming harness did not execute any case tagged with a feature."""
    _, registry_path, corpus_dir = _write_temp_corpus(
        tmp_path,
        features=[
            {
                "id": "F-CORE-01",
                "title": "Executed feature",
                "specAnchor": "specification/spec.md#spec-heading",
                "blueprintAnchor": "blueprints/bp.md#blueprint-heading",
                "claimedBy": ["python-core"],
            },
            {
                "id": "F-CORE-02",
                "title": "Skipped feature",
                "specAnchor": "specification/spec.md#spec-heading",
                "blueprintAnchor": "blueprints/bp.md#blueprint-heading",
                "claimedBy": ["python-core"],
            },
        ],
        cases=[
            {"id": "case_exec", "features": ["F-CORE-01"]},
            {"id": "case_skip", "features": ["F-CORE-02"]},
        ],
    )
    manifest_dir = tmp_path / "manifests"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    records = [
        {
            "corpus": "core",
            "suite": "core/sample_suite.yaml",
            "id": "case_exec",
            "harness": "python-core",
            "status": "executed",
        },
        {
            "corpus": "core",
            "suite": "core/sample_suite.yaml",
            "id": "case_skip",
            "harness": "python-core",
            "status": "skipped",
            "reason": "Not yet wired",
        },
    ]
    (manifest_dir / "python-core.jsonl").write_text(
        "\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8"
    )

    findings = cfc.check_harness(
        manifest_dir=manifest_dir,
        harness="python-core",
        registry_path=registry_path,
        corpus_dir=corpus_dir,
    )
    assert len(findings) == 1
    assert findings[0].kind == "unexecuted_feature"
    assert findings[0].feature_id == "F-CORE-02"


def test_every_conformance_schema_case_def_accepts_features_array() -> None:
    """Meta-test: every case `$def` in `conformance_schema.json` accepts `features`."""
    schema = json.loads(CONFORMANCE_SCHEMA_PATH.read_text(encoding="utf-8"))
    defs = schema.get("$defs", {})
    assert "FeatureTags" in defs

    case_def_names: list[str] = []
    for entry in schema.get("items", {}).get("anyOf", []):
        ref = entry.get("$ref", "")
        if ref.startswith("#/$defs/"):
            case_def_names.append(ref.split("/")[-1])

    tests_items = schema.get("properties", {}).get("tests", {}).get("items", {})
    if "$ref" in tests_items and tests_items["$ref"].startswith("#/$defs/"):
        case_def_names.append(tests_items["$ref"].split("/")[-1])
    for entry in tests_items.get("anyOf", []):
        ref = entry.get("$ref", "")
        if ref.startswith("#/$defs/"):
            case_def_names.append(ref.split("/")[-1])

    assert case_def_names
    feature_tags_validator = jsonschema.Draft202012Validator(defs["FeatureTags"])
    feature_tags_validator.validate(["F-CORE-01", "F-AGT-12", "F-RND-05", "F-BP-16"])

    for def_name in sorted(set(case_def_names)):
        case_def = defs[def_name]
        props = case_def.get("properties", {})
        assert props.get("features") == {
            "$ref": "#/$defs/FeatureTags"
        }, f"$defs/{def_name} is missing features property ref"
