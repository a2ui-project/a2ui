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

from __future__ import annotations

import argparse
import difflib
import json
from pathlib import Path
import sys
from typing import Any

import yaml

try:
    from conformance.scripts.e2e_outcome import outcome_of
except ImportError:
    try:
        from scripts.e2e_outcome import outcome_of  # type: ignore[import-not-found,no-redef]
    except ImportError:
        from e2e_outcome import outcome_of  # type: ignore[import-not-found,no-redef]


def _is_match_any(value: Any) -> bool:
    return isinstance(value, dict) and len(value) == 1 and value.get("$match") == "any"


def _dicts_match(golden_dict: dict[str, Any], recorded_dict: dict[str, Any]) -> bool:
    return golden_dict.keys() == recorded_dict.keys() and all(
        _outcomes_match(golden_dict[key], recorded_dict[key]) for key in golden_dict
    )


def _lists_match(golden_list: list[Any], recorded_list: list[Any]) -> bool:
    return len(golden_list) == len(recorded_list) and all(
        _outcomes_match(g_item, r_item)
        for g_item, r_item in zip(golden_list, recorded_list)
    )


def _outcomes_match(golden_val: Any, recorded_val: Any) -> bool:
    if _is_match_any(golden_val) or _is_match_any(recorded_val):
        return golden_val is not None and recorded_val is not None
    if isinstance(golden_val, dict) and isinstance(recorded_val, dict):
        return _dicts_match(golden_val, recorded_val)
    if isinstance(golden_val, list) and isinstance(recorded_val, list):
        return _lists_match(golden_list=golden_val, recorded_list=recorded_val)
    return bool(golden_val == recorded_val)


def _load_scenario_file(path_str: str) -> list[dict[str, Any]]:
    path = Path(path_str)
    if not path.is_file():
        raise FileNotFoundError(f"Scenario file not found: {path_str}")

    content = path.read_text(encoding="utf-8")
    try:
        data = yaml.safe_load(content)
    except Exception as exc:
        raise ValueError(f"Failed to parse scenario file {path_str}: {exc}") from exc

    if isinstance(data, dict):
        return [data]
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    raise ValueError(f"Invalid root type in {path_str}: expected dict or list")


def _format_scenario_diff(
    name: str,
    golden_outcome: list[dict[str, Any]],
    recorded_outcome: list[dict[str, Any]],
) -> list[str]:
    lines = [f"## Scenario `{name}`: Outcome Mismatch\n"]
    max_turns = max(len(golden_outcome), len(recorded_outcome))
    for turn_idx in range(max_turns):
        g_turn = golden_outcome[turn_idx] if turn_idx < len(golden_outcome) else None
        r_turn = (
            recorded_outcome[turn_idx] if turn_idx < len(recorded_outcome) else None
        )
        if _outcomes_match(g_turn, r_turn):
            continue
        lines.append(f"### Turn {turn_idx} Diff\n")
        g_str = json.dumps(g_turn, indent=2, sort_keys=True).splitlines()
        r_str = json.dumps(r_turn, indent=2, sort_keys=True).splitlines()
        diff = difflib.unified_diff(
            g_str,
            r_str,
            fromfile=f"golden_turn_{turn_idx}",
            tofile=f"recorded_turn_{turn_idx}",
            lineterm="",
        )
        lines.append("```diff")
        lines.extend(diff)
        lines.append("```\n")
    return lines


def _compare_scenarios(
    golden_scenarios: list[dict[str, Any]],
    recorded_scenarios: list[dict[str, Any]],
    *,
    structural: bool = False,
) -> tuple[bool, list[str]]:
    golden_by_name = {s["name"]: s for s in golden_scenarios if "name" in s}
    recorded_by_name = {s["name"]: s for s in recorded_scenarios if "name" in s}

    diff_lines: list[str] = []
    all_matched = True

    for name, golden_s in golden_by_name.items():
        if name not in recorded_by_name:
            all_matched = False
            diff_lines.append(f"## Scenario `{name}`: Missing in recorded file\n")
            continue

        recorded_s = recorded_by_name[name]
        golden_outcome = outcome_of(golden_s, structural=structural)
        recorded_outcome = outcome_of(recorded_s, structural=structural)

        if _outcomes_match(golden_outcome, recorded_outcome):
            continue

        all_matched = False
        diff_lines.extend(_format_scenario_diff(name, golden_outcome, recorded_outcome))

    return all_matched, diff_lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Compare renderer-visible outcomes between golden and recorded e2e"
            " transcripts."
        )
    )
    parser.add_argument(
        "--golden", required=True, help="Path to golden scenario YAML/JSON"
    )
    parser.add_argument(
        "--recorded", required=True, help="Path to recorded scenario YAML/JSON"
    )
    parser.add_argument(
        "--report",
        required=False,
        default=None,
        help="Optional output report path (.md)",
    )
    parser.add_argument(
        "--structural",
        action="store_true",
        help=(
            "Compare component tree structure, enabled states, and outbound"
            " kinds while tolerating live model prose and action names."
        ),
    )

    try:
        args = parser.parse_args(argv)
    except SystemExit:
        return 2

    try:
        golden_scenarios = _load_scenario_file(args.golden)
        recorded_scenarios = _load_scenario_file(args.recorded)
    except Exception as exc:
        print(f"Input error: {exc}", file=sys.stderr)
        return 2

    matches, diff_report = _compare_scenarios(
        golden_scenarios,
        recorded_scenarios,
        structural=args.structural,
    )

    if args.report is not None:
        report_path = Path(args.report)
        report_content = "# End-to-End Outcome Comparison Report\n\n"
        if matches:
            report_content += "All scenario outcomes match.\n"
        else:
            report_content += "\n".join(diff_report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report_content, encoding="utf-8")

    return 0 if matches else 1


if __name__ == "__main__":
    sys.exit(main())
