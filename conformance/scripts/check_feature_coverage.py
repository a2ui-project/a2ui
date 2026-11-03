#!/usr/bin/env python3
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

"""Feature registry and conformance coverage checker.

Provides static verification of `conformance/features.yaml` (schema validity,
specification and blueprint anchor resolution, unknown feature tags in YAML
suites, and untagged claimed features) as well as per-harness coverage checks
against executed-case JSONL manifests.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import re
import sys
from typing import Any

import jsonschema
import yaml

CONFORMANCE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = CONFORMANCE_DIR.parent
DEFAULT_REGISTRY_PATH = CONFORMANCE_DIR / "features.yaml"
DEFAULT_SCHEMA_PATH = CONFORMANCE_DIR / "features.schema.json"
CORPUS_SUBDIRS = ("core", "adapter", "agent", "extensions", "e2e")
LINE_ANCHOR_RE = re.compile(r"^L([0-9]+)(?:-L?([0-9]+))?$")
HEADING_LINE_RE = re.compile(r"^(#{1,6})\s+(.+)$")

HARNESS_ALIASES: dict[str, frozenset[str]] = {
    "python-core": frozenset({"python-core"}),
    "ts-web-core": frozenset({"ts-web-core", "web_core"}),
    "web_core": frozenset({"ts-web-core", "web_core"}),
    "dart-core": frozenset({"dart-core"}),
    "swift-core": frozenset({"swift-core"}),
    "python-agent": frozenset({"python-agent", "python-a2a", "python-adk"}),
    "python-a2a": frozenset({"python-a2a", "python-agent"}),
    "python-adk": frozenset({"python-adk", "python-agent"}),
    "ts-agent": frozenset({"ts-agent"}),
    "dart-agent": frozenset({"dart-agent"}),
    "lit-renderer": frozenset({"lit-renderer", "lit"}),
    "lit": frozenset({"lit-renderer", "lit"}),
    "react-renderer": frozenset({"react-renderer", "react"}),
    "react": frozenset({"react-renderer", "react"}),
    "angular-renderer": frozenset({"angular-renderer", "angular"}),
    "angular": frozenset({"angular-renderer", "angular"}),
    "flutter-renderer": frozenset({"flutter-renderer", "flutter"}),
    "flutter": frozenset({"flutter-renderer", "flutter"}),
    "swiftui-renderer": frozenset({"swiftui-renderer", "swiftui"}),
    "swiftui": frozenset({"swiftui-renderer", "swiftui"}),
    "markdown-it-renderer": frozenset(
        {"markdown-it-renderer", "markdown-it", "markdown_it"}
    ),
    "markdown-it": frozenset({"markdown-it-renderer", "markdown-it", "markdown_it"}),
    "markdown_it": frozenset({"markdown-it-renderer", "markdown-it", "markdown_it"}),
}


@dataclass(frozen=True)
class Feature:
  """Single entry from `conformance/features.yaml`."""

  id: str
  title: str
  spec_anchor: str
  blueprint_anchor: str
  claimed_by: tuple[str, ...]
  uncovered: str | None = None

  @property
  def specAnchor(self) -> str:  # pylint: disable=invalid-name
    """Alias matching the YAML property name."""
    return self.spec_anchor

  @property
  def blueprintAnchor(self) -> str:  # pylint: disable=invalid-name
    """Alias matching the YAML property name."""
    return self.blueprint_anchor

  @property
  def claimedBy(self) -> tuple[str, ...]:  # pylint: disable=invalid-name
    """Alias matching the YAML property name."""
    return self.claimed_by


@dataclass(frozen=True, order=True)
class CaseRef:
  """Reference to a single conformance test case inside a YAML suite."""

  suite: str
  case_id: str

  @property
  def id(self) -> str:
    """Case identifier."""
    return self.case_id

  @property
  def name(self) -> str:
    """Case name alias."""
    return self.case_id

  def __str__(self) -> str:
    return f"{self.suite}::{self.case_id}"


@dataclass(frozen=True)
class Finding:
  """Coverage or registry validation finding."""

  kind: str
  message: str
  feature_id: str | None = None
  location: str | None = None

  def format(self) -> str:
    """Formats the finding for terminal output."""
    prefix = f"[{self.kind}]"
    if self.feature_id:
      prefix = f"{prefix} {self.feature_id}"
    if self.location:
      prefix = f"{prefix} ({self.location})"
    return f"{prefix}: {self.message}"


def _extract_raw_entries(raw_data: Any) -> list[dict[str, Any]]:
  """Extracts feature mapping entries from loaded YAML content."""
  if isinstance(raw_data, dict) and isinstance(raw_data.get("features"), list):
    raw_data = raw_data["features"]
  if not isinstance(raw_data, list):
    raise ValueError("Feature registry must be a YAML list of feature objects.")
  entries: list[dict[str, Any]] = []
  for item in raw_data:
    if isinstance(item, dict):
      entries.append(item)
  return entries


def load_registry(path: Path | str = DEFAULT_REGISTRY_PATH) -> list[Feature]:
  """Loads and parses `conformance/features.yaml` into `Feature` records."""
  registry_path = Path(path)
  raw_data = yaml.safe_load(registry_path.read_text(encoding="utf-8"))
  entries = _extract_raw_entries(raw_data)
  features: list[Feature] = []
  for item in entries:
    claimed_raw = item.get("claimedBy") or []
    claimed_tuple = tuple(str(h) for h in claimed_raw)
    uncovered_val = item.get("uncovered")
    features.append(
        Feature(
            id=str(item.get("id", "")),
            title=str(item.get("title", "")),
            spec_anchor=str(item.get("specAnchor", "")),
            blueprint_anchor=str(item.get("blueprintAnchor", "")),
            claimed_by=claimed_tuple,
            uncovered=str(uncovered_val) if uncovered_val is not None else None,
        )
    )
  return features


def _iter_suite_files(corpus_dir: Path) -> list[Path]:
  """Returns sorted conformance YAML suite files under `corpus_dir`."""
  discovered: set[Path] = set()
  for subdir in CORPUS_SUBDIRS:
    candidate = corpus_dir / subdir
    if candidate.is_dir():
      discovered.update(candidate.rglob("*.yaml"))
  if not discovered:
    for path in corpus_dir.rglob("*.yaml"):
      rel_parts = path.relative_to(corpus_dir).parts
      if path.name == "features.yaml" or "test_data" in rel_parts:
        continue
      discovered.add(path)
  return sorted(discovered)


def _extract_cases_from_yaml(data: Any) -> list[dict[str, Any]]:
  """Extracts test case dicts from either a list suite or a `{macros, tests}` map suite."""
  if isinstance(data, list):
    return [item for item in data if isinstance(item, dict)]
  if isinstance(data, dict) and isinstance(data.get("tests"), list):
    return [item for item in data["tests"] if isinstance(item, dict)]
  return []


def collect_tags(
    corpus_dir: Path | str = CONFORMANCE_DIR,
) -> dict[str, set[CaseRef]]:
  """Collects `features` tags across all conformance YAML suites in `corpus_dir`."""
  root = Path(corpus_dir)
  tags: dict[str, set[CaseRef]] = {}
  for yaml_path in _iter_suite_files(root):
    rel_suite = yaml_path.relative_to(root).as_posix()
    raw_data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    for case in _extract_cases_from_yaml(raw_data):
      case_id = str(case.get("id") or case.get("name") or "").strip()
      feature_list = case.get("features")
      if not case_id or not isinstance(feature_list, list):
        continue
      ref = CaseRef(suite=rel_suite, case_id=case_id)
      for tag in feature_list:
        tag_str = str(tag).strip()
        if tag_str:
          tags.setdefault(tag_str, set()).add(ref)
  return tags


def _slugify_heading(heading_text: str) -> str:
  """Converts a Markdown heading line into its GitHub-flavored slug."""
  text = heading_text.strip().lower()
  text = re.sub(r"`([^`]*)`", r"\1", text)
  text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
  text = re.sub(r"[^\w\s-]", "", text)
  return re.sub(r"\s+", "-", text).strip("-")


def _collect_markdown_slugs(lines: list[str]) -> set[str]:
  """Extracts heading slugs (including GitHub duplicate suffixes) from lines."""
  slugs: set[str] = set()
  counts: dict[str, int] = {}
  for line in lines:
    match = HEADING_LINE_RE.match(line)
    if not match:
      continue
    base_slug = _slugify_heading(match.group(2))
    if not base_slug:
      continue
    slugs.add(base_slug)
    seen = counts.get(base_slug, 0)
    if seen > 0:
      slugs.add(f"{base_slug}-{seen}")
    counts[base_slug] = seen + 1
  return slugs


def resolve_anchor(repo_root: Path | str, anchor: str) -> bool:
  """Verifies that `anchor` points to an existing file and heading slug or line number."""
  cleaned = anchor.strip()
  if not cleaned:
    return False
  file_part, sep, fragment = cleaned.partition("#")
  if not file_part:
    return False
  target_path = Path(repo_root) / file_part
  if not target_path.is_file():
    return False
  if not sep:
    return True
  if not fragment:
    return False
  lines = target_path.read_text(encoding="utf-8").splitlines()
  line_match = LINE_ANCHOR_RE.match(fragment)
  if line_match:
    start_line = int(line_match.group(1))
    end_line = int(line_match.group(2) or start_line)
    return 1 <= start_line <= end_line <= len(lines)
  slugs = _collect_markdown_slugs(lines)
  return fragment.lower() in slugs


def _validate_registry_schema(registry_path: Path, schema_path: Path) -> list[Finding]:
  """Validates `registry_path` against `features.schema.json`."""
  try:
    raw_data = yaml.safe_load(registry_path.read_text(encoding="utf-8"))
  except Exception as exc:  # pylint: disable=broad-exception-caught
    return [
        Finding(
            kind="schema_error",
            message=f"Failed to parse registry YAML: {exc}",
            location=str(registry_path),
        )
    ]
  if isinstance(raw_data, dict) and isinstance(raw_data.get("features"), list):
    raw_data = raw_data["features"]
  schema = json.loads(schema_path.read_text(encoding="utf-8"))
  validator = jsonschema.Draft202012Validator(schema)
  findings: list[Finding] = []
  for err in validator.iter_errors(raw_data):
    findings.append(
        Finding(
            kind="schema_error",
            message=f"{err.json_path}: {err.message}",
            location=str(registry_path),
        )
    )
  if isinstance(raw_data, list):
    seen_ids: set[str] = set()
    for item in raw_data:
      if not isinstance(item, dict):
        continue
      fid = str(item.get("id", ""))
      if fid in seen_ids:
        findings.append(
            Finding(
                kind="schema_error",
                feature_id=fid,
                message=f"Duplicate feature id '{fid}' in registry.",
                location=str(registry_path),
            )
        )
      seen_ids.add(fid)
  return findings


def _check_feature_anchors(
    root_path: Path, features: list[Feature], reg_path: Path
) -> list[Finding]:
  """Checks that every feature's specAnchor and blueprintAnchor resolve."""
  findings: list[Finding] = []
  for feature in features:
    if not resolve_anchor(root_path, feature.spec_anchor):
      findings.append(
          Finding(
              kind="broken_anchor",
              feature_id=feature.id,
              message=f"Unresolved specAnchor '{feature.spec_anchor}'.",
              location=str(reg_path),
          )
      )
    if not resolve_anchor(root_path, feature.blueprint_anchor):
      findings.append(
          Finding(
              kind="broken_anchor",
              feature_id=feature.id,
              message=f"Unresolved blueprintAnchor '{feature.blueprint_anchor}'.",
              location=str(reg_path),
          )
      )
  return findings


def check_static(
    repo_root: Path | str = REPO_ROOT,
    registry_path: Path | str = DEFAULT_REGISTRY_PATH,
    corpus_dir: Path | str = CONFORMANCE_DIR,
) -> list[Finding]:
  """Runs static feature registry and conformance corpus checks."""
  root_path = Path(repo_root)
  reg_path = Path(registry_path)
  corp_path = Path(corpus_dir)
  schema_path = reg_path.parent / "features.schema.json"
  if not schema_path.is_file():
    schema_path = DEFAULT_SCHEMA_PATH

  findings = _validate_registry_schema(reg_path, schema_path)
  try:
    features = load_registry(reg_path)
  except Exception as exc:  # pylint: disable=broad-exception-caught
    findings.append(
        Finding(
            kind="schema_error",
            message=f"Unable to load feature registry: {exc}",
            location=str(reg_path),
        )
    )
    return findings

  findings.extend(_check_feature_anchors(root_path, features, reg_path))
  known_ids = {f.id for f in features}
  collected_tags = collect_tags(corp_path)
  for tag, refs in sorted(collected_tags.items()):
    if tag not in known_ids:
      sample_loc = str(sorted(refs)[0])
      findings.append(
          Finding(
              kind="unknown_tag",
              feature_id=tag,
              message=f"Unknown feature tag '{tag}' referenced in {sample_loc}.",
              location=sample_loc,
          )
      )

  for feature in features:
    if not feature.uncovered and not collected_tags.get(feature.id):
      findings.append(
          Finding(
              kind="untagged_feature",
              feature_id=feature.id,
              message=(
                  f"Feature '{feature.id}' ({feature.title}) has no "
                  "uncovered reason and zero tagged conformance cases."
              ),
              location=str(reg_path),
          )
      )
  return findings


def _load_executed_cases(
    manifest_dir: Path, harness_aliases: frozenset[str]
) -> tuple[set[CaseRef], set[str]]:
  """Loads executed `(suite, case_id)` pairs and bare case IDs for `harness_aliases`."""
  executed_refs: set[CaseRef] = set()
  executed_ids: set[str] = set()
  if not manifest_dir.is_dir():
    return executed_refs, executed_ids
  for jsonl_path in sorted(manifest_dir.rglob("*.jsonl")):
    for raw_line in jsonl_path.read_text(encoding="utf-8").splitlines():
      line = raw_line.strip()
      if not line:
        continue
      record = json.loads(line)
      if (
          record.get("status") != "executed"
          or str(record.get("harness", "")) not in harness_aliases
      ):
        continue
      suite = str(record.get("suite", "")).strip()
      case_id = str(record.get("id", "")).strip()
      if suite and case_id:
        executed_refs.add(CaseRef(suite=suite, case_id=case_id))
        executed_ids.add(case_id)
  return executed_refs, executed_ids


def _case_was_executed(
    tagged_refs: set[CaseRef],
    executed_refs: set[CaseRef],
    executed_ids: set[str],
) -> bool:
  """Checks whether any tagged case was recorded as executed by the harness."""
  if tagged_refs & executed_refs:
    return True
  for ref in tagged_refs:
    if ref.case_id in executed_ids:
      return True
  return False


def check_harness(
    manifest_dir: Path | str,
    harness: str,
    registry_path: Path | str = DEFAULT_REGISTRY_PATH,
    corpus_dir: Path | str = CONFORMANCE_DIR,
) -> list[Finding]:
  """Checks that every covered feature claimed by `harness` has >= 1 executed case."""
  aliases = HARNESS_ALIASES.get(harness, frozenset({harness}))
  features = load_registry(registry_path)
  collected_tags = collect_tags(corpus_dir)
  executed_refs, executed_ids = _load_executed_cases(Path(manifest_dir), aliases)

  findings: list[Finding] = []
  for feature in features:
    if feature.uncovered:
      continue
    if not any(claimed in aliases for claimed in feature.claimed_by):
      continue
    tagged_refs = collected_tags.get(feature.id, set())
    if not _case_was_executed(tagged_refs, executed_refs, executed_ids):
      findings.append(
          Finding(
              kind="unexecuted_feature",
              feature_id=feature.id,
              message=(
                  f"Harness '{harness}' claims feature '{feature.id}' "
                  f"({feature.title}), but executed 0 tagged cases "
                  f"(tagged cases: {len(tagged_refs)})."
              ),
              location=str(manifest_dir),
          )
      )
  return findings


def main(argv: list[str] | None = None) -> int:
  """CLI entry point for `check_feature_coverage.py`."""
  parser = argparse.ArgumentParser(
      description="Verify A2UI conformance feature registry and per-harness coverage."
  )
  parser.add_argument(
      "--static",
      action="store_true",
      help="Run static feature registry, anchor, and tag checks.",
  )
  parser.add_argument(
      "--manifest-dir",
      type=Path,
      default=None,
      help="Directory containing executed-case JSONL manifests.",
  )
  parser.add_argument(
      "--harness",
      type=str,
      default=None,
      help="Harness name to check against --manifest-dir.",
  )
  parser.add_argument(
      "--report-only",
      action="store_true",
      help="Report findings without returning a non-zero exit code.",
  )
  parser.add_argument(
      "--registry",
      type=Path,
      default=DEFAULT_REGISTRY_PATH,
      help="Path to features.yaml.",
  )
  parser.add_argument(
      "--corpus-dir",
      type=Path,
      default=CONFORMANCE_DIR,
      help="Path to the conformance directory.",
  )
  parser.add_argument(
      "--repo-root",
      type=Path,
      default=REPO_ROOT,
      help="Path to the repository root.",
  )
  args = parser.parse_args(argv)

  if not args.static and (args.manifest_dir is None or args.harness is None):
    parser.error("Specify --static and/or both --manifest-dir and --harness.")

  findings: list[Finding] = []
  if args.static:
    findings.extend(
        check_static(
            repo_root=args.repo_root,
            registry_path=args.registry,
            corpus_dir=args.corpus_dir,
        )
    )
  if args.manifest_dir is not None and args.harness is not None:
    findings.extend(
        check_harness(
            manifest_dir=args.manifest_dir,
            harness=args.harness,
            registry_path=args.registry,
            corpus_dir=args.corpus_dir,
        )
    )

  if findings:
    for finding in findings:
      print(finding.format(), file=sys.stderr)
    if not args.report_only:
      return 1

  features = load_registry(args.registry)
  covered_count = sum(1 for f in features if not f.uncovered)
  print(
      f"Feature coverage check complete: {len(features)} features "
      f"({covered_count} covered, {len(features) - covered_count} uncovered), "
      f"{len(findings)} finding(s)."
  )
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
