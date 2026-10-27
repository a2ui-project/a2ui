#!/usr/bin/env python3
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

"""CLI entrypoint for inspecting custom catalogs and validating `patterns.json` and `templates.json`."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
import json
from pathlib import Path
import sys

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from _common import ToolError, load_catalog, write_report  # noqa: E402
from inspect_catalog import (  # noqa: E402
    inspect_catalog,
    report_to_dict as inspect_to_dict,
    report_to_markdown as inspect_to_markdown,
)
from validate_patterns import (  # noqa: E402
    report_to_dict as validation_to_dict,
    report_to_markdown as validation_to_markdown,
    validate_catalog_artifacts,
)


def build_parser() -> argparse.ArgumentParser:
    """Builds the `catalog_patterns_tool.py` argument parser."""
    parser = argparse.ArgumentParser(
        prog="catalog_patterns_tool.py",
        description=(
            "Inspect any A2UI catalog.json and validate its patterns.json,"
            " templates.json, and sample_payloads.json sidecars."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_p = subparsers.add_parser(
        "inspect",
        help=(
            "Inspect catalog.json and classify it as composable, fixed_surface, or"
            " hybrid."
        ),
    )
    inspect_p.add_argument(
        "catalog",
        type=Path,
        help="Path to the target catalog.json (in any repository).",
    )
    inspect_p.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help=(
            "Override target directory where sidecars will be written (defaults to"
            " catalog.json parent)."
        ),
    )
    inspect_p.add_argument(
        "--format",
        choices=("json", "markdown"),
        default="markdown",
        help="Output report format (default: markdown).",
    )
    inspect_p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Optional file path to write the report to instead of stdout.",
    )

    validate_p = subparsers.add_parser(
        "validate",
        help=(
            "Validate patterns.json and/or templates.json against catalog.json"
            " and required sample payloads."
        ),
    )
    validate_p.add_argument(
        "artifact",
        nargs="?",
        type=Path,
        default=None,
        help="Optional positional path to patterns.json or templates.json.",
    )
    validate_p.add_argument(
        "--catalog",
        type=Path,
        required=True,
        help="Path to the target catalog.json.",
    )
    validate_p.add_argument(
        "--payload",
        type=Path,
        required=True,
        help=(
            "Path to sample_payloads.json (required to verify runtime eligibility and"
            " template matching)."
        ),
    )
    validate_p.add_argument(
        "--patterns",
        type=Path,
        default=None,
        help=(
            "Explicit path to patterns.json (auto-discovered in target_dir when"
            " omitted)."
        ),
    )
    validate_p.add_argument(
        "--templates",
        type=Path,
        default=None,
        help=(
            "Explicit path to templates.json (auto-discovered in target_dir when"
            " omitted)."
        ),
    )
    validate_p.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help=(
            "Override directory for sidecar auto-discovery (defaults to catalog.json"
            " parent)."
        ),
    )
    validate_p.add_argument(
        "--format",
        choices=("json", "markdown"),
        default="markdown",
        help="Output report format (default: markdown).",
    )
    validate_p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Optional file path to write the report to instead of stdout.",
    )
    validate_p.add_argument(
        "--strict",
        action="store_true",
        help="Fail with exit code 1 if patterns.json defines unknown pattern names.",
    )
    return parser


def _resolve_positional_artifact(
    artifact: Path | None,
    patterns_path: Path | None,
    templates_path: Path | None,
) -> tuple[Path | None, Path | None]:
    """Routes an optional positional artifact path to `patterns_path` or `templates_path`."""
    if artifact is None:
        return patterns_path, templates_path
    is_templates = artifact.name == "templates.json"
    if not is_templates and artifact.is_file():
        try:
            raw = json.loads(artifact.read_text(encoding="utf-8"))
            is_templates = isinstance(raw, dict) and "templates" in raw
        except (OSError, json.JSONDecodeError):
            is_templates = False
    if is_templates:
        return patterns_path, templates_path or artifact
    return patterns_path or artifact, templates_path


def _emit_report(
    report_dict: dict[str, object],
    markdown_text: str,
    fmt: str,
    out_path: Path | None,
) -> None:
    """Writes `report_dict` or `markdown_text` to `out_path` or `sys.stdout`."""
    resolved_fmt = "json" if fmt == "json" else "markdown"
    if out_path is not None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as handle:
            write_report(
                report_dict,
                fmt=resolved_fmt,
                out=handle,
                markdown=markdown_text,
            )
    else:
        write_report(
            report_dict,
            fmt=resolved_fmt,
            out=sys.stdout,
            markdown=markdown_text,
        )


def _run_inspect(args: argparse.Namespace) -> int:
    """Executes the `inspect` subcommand."""
    loaded = load_catalog(args.catalog, out_dir=args.out_dir)
    report = inspect_catalog(loaded)
    _emit_report(
        inspect_to_dict(report),
        inspect_to_markdown(report),
        args.format,
        args.out,
    )
    return 0


def _run_validate(args: argparse.Namespace) -> int:
    """Executes the `validate` subcommand."""
    loaded = load_catalog(args.catalog, out_dir=args.out_dir)
    patterns_path, templates_path = _resolve_positional_artifact(
        args.artifact, args.patterns, args.templates
    )
    report = validate_catalog_artifacts(
        loaded,
        payload_path=args.payload,
        patterns_path=patterns_path,
        templates_path=templates_path,
    )
    _emit_report(
        validation_to_dict(report),
        validation_to_markdown(report),
        args.format,
        args.out,
    )
    if not report.ok:
        return 1
    if args.strict and report.unknown_patterns:
        return 1
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Entrypoint returning 0 on success, 1 on validation failure, or 2 on `ToolError`."""
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        if args.command == "inspect":
            return _run_inspect(args)
        return _run_validate(args)
    except ToolError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
