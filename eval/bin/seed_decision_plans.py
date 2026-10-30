#!/usr/bin/env python3
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Seeds decision plan cases from recorded Inspect AI evaluation logs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

from a2ui_eval.shared.utils import GIT_ROOT
import yaml

BIN_DIR = Path(__file__).parent.resolve()
if str(BIN_DIR) not in sys.path:
    sys.path.insert(0, str(BIN_DIR))

from report_evals import load_log_data

DECISION_PLANS_DIR = (GIT_ROOT / "eval" / "datasets" / "decision_plans").resolve()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed unverified decision plan cases from evaluation logs.",
    )
    parser.add_argument(
        "logs",
        nargs="+",
        help="Paths to .eval log files or directories containing them.",
    )
    parser.add_argument(
        "--out",
        type=str,
        default=str(DECISION_PLANS_DIR / "seeded.yaml"),
        help="Output YAML file path (must reside under eval/datasets/decision_plans/).",
    )
    return parser.parse_args(argv)


def _validate_out_path(out_path: Path) -> Path:
    resolved = out_path.resolve()
    try:
        resolved.relative_to(DECISION_PLANS_DIR)
    except ValueError as exc:
        raise ValueError(
            f"Output file must be inside {DECISION_PLANS_DIR}, got {resolved}"
        ) from exc
    return resolved


def seed_cases_from_logs(
    log_paths: list[str | Path],
    out_file: str | Path,
) -> int:
    """Reads eval logs and seeds decision plan cases into out_file."""
    out_path = _validate_out_path(Path(out_file))

    existing_cases: list[dict[str, Any]] = []
    existing_names: set[str] = set()

    if out_path.is_file():
        with open(out_path, "r", encoding="utf-8") as f:
            existing_cases = yaml.safe_load(f) or []
            for item in existing_cases:
                if isinstance(item, dict) and "name" in item:
                    existing_names.add(str(item["name"]))

    new_cases: list[dict[str, Any]] = []

    for log_path_str in log_paths:
        log_path = Path(log_path_str)
        files_to_process = (
            list(log_path.glob("**/*.eval")) if log_path.is_dir() else [log_path]
        )

        for f in files_to_process:
            if not f.is_file():
                continue
            try:
                log_data = load_log_data(str(f))
            except Exception as exc:  # pylint: disable=broad-exception-caught
                sys.stderr.write(f"Warning: could not load {f}: {exc}\n")
                continue

            samples = log_data.get("samples") or []
            for sample in samples:
                meta = sample.get("metadata") or {}
                raw_block = meta.get("decision_block")
                if not raw_block:
                    continue

                if isinstance(raw_block, str):
                    try:
                        block_data = json.loads(raw_block)
                    except json.JSONDecodeError:
                        continue
                elif isinstance(raw_block, dict):
                    block_data = raw_block
                else:
                    continue

                if not isinstance(block_data, dict):
                    continue

                sample_id = str(sample.get("id") or sample.get("name") or "sample")
                arch = meta.get("decision_archetype")
                if not arch or arch == "unknown":
                    continue
                case_name = f"{sample_id}_{arch}"
                if case_name in existing_names:
                    continue

                intent = block_data.get("intent") or sample.get("input") or ""
                payload = block_data.get("payload") or {}
                mutable_paths = block_data.get("mutable_paths") or []
                decision_blocks = meta.get("decision_blocks") or []
                if isinstance(decision_blocks, str):
                    decision_blocks = [
                        b.strip() for b in decision_blocks.split(",") if b.strip()
                    ]

                family = (
                    meta.get("decision_family")
                    or meta.get("decision_stage")
                    or "monitor"
                )
                if family == "archetype":
                    family = "monitor"

                case_stub: dict[str, Any] = {
                    "name": case_name,
                    "intent": intent,
                    "payload": payload,
                    "expected": {
                        "family": family,
                        "archetypes": [arch] if arch != "unknown" else [],
                        "blocks": {
                            "required": decision_blocks,
                        },
                        "action_gate": "pass",
                    },
                    "tags": ["seeded"],
                    "verified": False,
                    "source": {
                        "log_path": str(f),
                        "sample_id": sample_id,
                    },
                }
                if mutable_paths:
                    case_stub["mutable_paths"] = mutable_paths

                existing_names.add(case_name)
                new_cases.append(case_stub)

    if not new_cases and not existing_cases:
        return 0

    all_cases = existing_cases + new_cases
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(all_cases, f, sort_keys=False)

    return len(new_cases)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        added = seed_cases_from_logs(args.logs, args.out)
        print(f"Seeded {added} new case(s) into {args.out}")
        return 0
    except Exception as exc:
        sys.stderr.write(f"Error: {exc}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
