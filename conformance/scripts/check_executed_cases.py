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

"""Compares executed conformance case manifests against YAML suite corpora."""

from __future__ import annotations

import argparse
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import json
from pathlib import Path
import re
import sys
from typing import Any

import jsonschema
import yaml

CONFORMANCE_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = CONFORMANCE_ROOT / "executed_case_manifest.schema.json"
CORPORA_PATH = CONFORMANCE_ROOT / "manifest_corpora.json"

STATUSES: tuple[str, ...] = ("passed", "failed", "skipped", "xfailed")
REASON_REQUIRED_STATUSES: frozenset[str] = frozenset({"skipped", "xfailed"})

_SCHEMA: dict[str, Any] = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
_VALIDATOR = jsonschema.Draft202012Validator(_SCHEMA)


@dataclass(frozen=True)
class ManifestRecord:
    """Single executed-case manifest entry."""

    harness: str
    suite: str
    case: str
    status: str
    reason: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class Finding:
    """Fatal discrepancy discovered while comparing a manifest to a corpus."""

    kind: str
    suite: str
    case: str | None
    message: str

    def __str__(self) -> str:
        return f"{self.kind}: {self.message}"


def _translate_glob_segment(segment: str) -> str:
    parts: list[str] = []
    for char in segment:
        if char == "*":
            parts.append("[^/]*")
        elif char == "?":
            parts.append("[^/]")
        else:
            parts.append(re.escape(char))
    return "".join(parts)


def _glob_to_regex(pattern: str) -> re.Pattern[str]:
    normalized = pattern.replace("\\", "/").strip("/")
    segments = [seg for seg in normalized.split("/") if seg]
    regex_parts: list[str] = ["^"]
    last_idx = len(segments) - 1
    for idx, seg in enumerate(segments):
        is_last = idx == last_idx
        if seg == "**":
            regex_parts.append("(?:.+)" if is_last else "(?:[^/]+/)*")
        else:
            regex_parts.append(_translate_glob_segment(seg))
            if not is_last:
                regex_parts.append("/")
    regex_parts.append("$")
    return re.compile("".join(regex_parts))


def _matches_any_glob(suite: str, patterns: Sequence[str]) -> bool:
    return any(_glob_to_regex(pat).match(suite) is not None for pat in patterns)


def _extract_suite_cases(suite_path: Path) -> set[str]:
    data = yaml.safe_load(suite_path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {
            str(item["name"])
            for item in data
            if isinstance(item, dict) and item.get("name")
        }
    if isinstance(data, dict) and isinstance(data.get("tests"), list):
        return {
            str(item.get("id") or item.get("name"))
            for item in data["tests"]
            if isinstance(item, dict) and (item.get("id") or item.get("name"))
        }
    raise ValueError(f"Unsupported suite YAML structure in {suite_path}")


def _iter_pattern_files(conformance_root: Path, patterns: Sequence[str]) -> list[Path]:
    files: list[Path] = []
    for pattern in patterns:
        files.extend(
            path for path in sorted(conformance_root.glob(pattern)) if path.is_file()
        )
    return files


def load_corpus(
    conformance_root: Path,
    corpus_names: Sequence[str],
    only: Sequence[str] | None = None,
) -> dict[str, set[str]]:
    """Loads suite-to-case sets for the named corpora from manifest_corpora.json."""
    corpora_file = conformance_root / "manifest_corpora.json"
    corpora_spec: dict[str, Any] = json.loads(corpora_file.read_text(encoding="utf-8"))
    corpus: dict[str, set[str]] = {}
    for name in corpus_names:
        if name not in corpora_spec:
            raise ValueError(f"Unknown corpus {name!r} in {corpora_file}")
        patterns: Sequence[str] = corpora_spec[name].get("include", [])
        for suite_path in _iter_pattern_files(conformance_root, patterns):
            rel_suite = suite_path.relative_to(conformance_root).as_posix()
            corpus[rel_suite] = _extract_suite_cases(suite_path)
    if not only:
        return corpus
    return {
        suite: cases
        for suite, cases in corpus.items()
        if _matches_any_glob(suite, only)
    }


def _is_unreasoned_only(raw: Mapping[str, Any]) -> bool:
    if raw.get("status") not in REASON_REQUIRED_STATUSES:
        return False
    reason = raw.get("reason")
    if reason is not None and not isinstance(reason, str):
        return False
    if isinstance(reason, str) and reason.strip():
        return False
    probe = {**raw, "reason": "placeholder"}
    return next(_VALIDATOR.iter_errors(probe), None) is None


def _parse_manifest_line(
    line: str,
    source: str,
    harness: str,
) -> ManifestRecord | None:
    try:
        raw = json.loads(line)
    except json.JSONDecodeError as err:
        return ManifestRecord(
            harness=harness,
            suite="",
            case="",
            status="invalid",
            error=f"{source}: invalid JSON: {err.msg}",
        )
    if not isinstance(raw, dict):
        return ManifestRecord(
            harness=harness,
            suite="",
            case="",
            status="invalid",
            error=f"{source}: record must be a JSON object",
        )
    rec_harness = raw.get("harness")
    if isinstance(rec_harness, str) and rec_harness != harness:
        return None
    first_error = next(_VALIDATOR.iter_errors(raw), None)
    if first_error is None or _is_unreasoned_only(raw):
        raw_reason = raw.get("reason")
        return ManifestRecord(
            harness=str(raw["harness"]),
            suite=str(raw["suite"]),
            case=str(raw["case"]),
            status=str(raw["status"]),
            reason=raw_reason if isinstance(raw_reason, str) else None,
        )
    return ManifestRecord(
        harness=str(rec_harness or harness),
        suite=str(raw.get("suite") or ""),
        case=str(raw.get("case") or ""),
        status=str(raw.get("status") or "invalid"),
        reason=raw.get("reason") if isinstance(raw.get("reason"), str) else None,
        error=f"{source}: {first_error.message}",
    )


def load_records(manifest_dir: Path, harness: str) -> list[ManifestRecord]:
    """Loads and schema-validates JSONL manifest records for the given harness."""
    if not manifest_dir.exists():
        return []
    records: list[ManifestRecord] = []
    for jsonl_path in sorted(manifest_dir.glob("*.jsonl")):
        lines = jsonl_path.read_text(encoding="utf-8").splitlines()
        for lineno, raw_line in enumerate(lines, start=1):
            stripped = raw_line.strip()
            if not stripped:
                continue
            source = f"{jsonl_path.name}:{lineno}"
            parsed = _parse_manifest_line(stripped, source, harness)
            if parsed is not None:
                records.append(parsed)
    return records


def _record_schema_error(record: ManifestRecord) -> str | None:
    if record.error is not None:
        return record.error
    payload: dict[str, Any] = {
        "harness": record.harness,
        "suite": record.suite,
        "case": record.case,
        "status": record.status,
    }
    if record.reason is not None:
        payload["reason"] = record.reason
    first_error = next(_VALIDATOR.iter_errors(payload), None)
    if first_error is None or _is_unreasoned_only(payload):
        return None
    return str(first_error.message)


def _check_single_record(
    record: ManifestRecord,
    corpus: Mapping[str, set[str]],
    excluded_map: Mapping[str, str],
    seen: dict[tuple[str, str], int],
) -> list[Finding]:
    schema_err = _record_schema_error(record)
    if schema_err is not None:
        return [
            Finding(
                kind="INVALID_RECORD",
                suite=record.suite,
                case=record.case or None,
                message=schema_err,
            )
        ]
    if record.suite not in corpus or record.suite in excluded_map:
        return []
    if record.case not in corpus[record.suite]:
        return [
            Finding(
                kind="UNKNOWN_CASE",
                suite=record.suite,
                case=record.case,
                message=f"Unknown case {record.case!r} in suite {record.suite}",
            )
        ]
    findings: list[Finding] = []
    key = (record.suite, record.case)
    seen[key] = seen.get(key, 0) + 1
    if seen[key] > 1:
        findings.append(
            Finding(
                kind="DUPLICATE",
                suite=record.suite,
                case=record.case,
                message=f"Duplicate record for {record.suite}#{record.case}",
            )
        )
    if record.status in REASON_REQUIRED_STATUSES and not (
        record.reason and record.reason.strip()
    ):
        findings.append(
            Finding(
                kind="UNREASONED",
                suite=record.suite,
                case=record.case,
                message=(
                    f"Status {record.status!r} requires a non-empty reason for"
                    f" {record.suite}#{record.case}"
                ),
            )
        )
    if record.status == "failed":
        findings.append(
            Finding(
                kind="FAILED",
                suite=record.suite,
                case=record.case,
                message=f"Case failed: {record.suite}#{record.case}",
            )
        )
    return findings


def compare(
    corpus: Mapping[str, set[str]],
    records: Sequence[ManifestRecord],
    excluded: Mapping[str, str] | None = None,
) -> list[Finding]:
    """Compares manifest records against expected corpus suites and cases."""
    excluded_map = dict(excluded or {})
    findings: list[Finding] = []
    seen: dict[tuple[str, str], int] = {}

    for record in records:
        findings.extend(_check_single_record(record, corpus, excluded_map, seen))

    for suite in sorted(corpus):
        if suite in excluded_map:
            continue
        for case in sorted(corpus[suite]):
            if (suite, case) not in seen:
                findings.append(
                    Finding(
                        kind="MISSING",
                        suite=suite,
                        case=case,
                        message=f"Missing record for {suite}#{case}",
                    )
                )
    return findings


def render_matrix(records: Sequence[ManifestRecord]) -> str:
    """Renders a Markdown table of suite-by-status counts."""
    counts: dict[str, dict[str, int]] = {}
    for record in records:
        if record.error is not None or not record.suite:
            continue
        suite_counts = counts.setdefault(
            record.suite, {status: 0 for status in STATUSES}
        )
        if record.status in suite_counts:
            suite_counts[record.status] += 1

    lines = [
        "| Suite | Passed | Failed | Skipped | XFailed | Total |",
        "| :--- | ---: | ---: | ---: | ---: | ---: |",
    ]
    totals = {status: 0 for status in STATUSES}
    for suite in sorted(counts):
        row = counts[suite]
        row_total = sum(row.values())
        for status in STATUSES:
            totals[status] += row[status]
        lines.append(
            f"| `{suite}` | {row['passed']} | {row['failed']} | {row['skipped']} |"
            f" {row['xfailed']} | {row_total} |"
        )
    grand_total = sum(totals.values())
    lines.append(
        f"| **Total** | **{totals['passed']}** | **{totals['failed']}** |"
        f" **{totals['skipped']}** | **{totals['xfailed']}** |"
        f" **{grand_total}** |"
    )
    return "\n".join(lines) + "\n"


def _parse_exclusions(
    raw_excludes: Sequence[str],
    parser: argparse.ArgumentParser,
) -> dict[str, str]:
    excluded: dict[str, str] = {}
    for item in raw_excludes:
        suite, sep, reason = item.partition("=")
        suite = suite.strip()
        reason = reason.strip()
        if not sep or not suite or not reason:
            parser.error(
                f"Invalid --exclude value {item!r}; expected SUITE=REASON with a"
                " non-empty reason."
            )
        excluded[suite] = reason
    return excluded


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Verify that an A2UI conformance harness recorded every case in its"
            " target corpora."
        )
    )
    parser.add_argument(
        "--manifest-dir",
        type=Path,
        required=True,
        help="Directory containing JSONL manifest files.",
    )
    parser.add_argument(
        "--harness",
        type=str,
        required=True,
        help="Harness name to check.",
    )
    parser.add_argument(
        "--corpus",
        action="append",
        required=True,
        dest="corpora",
        help="Corpus name from manifest_corpora.json (repeatable).",
    )
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="SUITE_GLOB",
        help="Narrow the corpus to suites matching a glob (repeatable).",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="SUITE=REASON",
        help="Exclude a suite with a required reason (repeatable).",
    )
    parser.add_argument(
        "--matrix-out",
        type=Path,
        default=None,
        help="Optional path to write the Markdown suite status matrix.",
    )
    parser.add_argument(
        "--conformance-root",
        type=Path,
        default=CONFORMANCE_ROOT,
        help="Path to the conformance directory (defaults to conformance/).",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point for checking executed conformance cases."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    excluded = _parse_exclusions(args.exclude, parser)
    for suite, reason in sorted(excluded.items()):
        print(f"Excluded {suite}: {reason}")

    corpus = load_corpus(args.conformance_root, args.corpora, only=args.only)
    records = load_records(args.manifest_dir, args.harness)
    findings = compare(corpus, records, excluded)

    if args.matrix_out is not None:
        in_corpus_records = [
            rec for rec in records if rec.suite in corpus and rec.error is None
        ]
        args.matrix_out.parent.mkdir(parents=True, exist_ok=True)
        args.matrix_out.write_text(render_matrix(in_corpus_records), encoding="utf-8")

    if findings:
        for finding in findings:
            print(finding, file=sys.stderr)
        return 1

    total_cases = sum(
        len(cases) for suite, cases in corpus.items() if suite not in excluded
    )
    print(
        f"OK ({args.harness}): verified {total_cases} cases across"
        f" {len(corpus) - len(excluded & corpus.keys())} active suites."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
