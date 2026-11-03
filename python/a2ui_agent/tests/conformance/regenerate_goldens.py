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

"""Regenerates or checks the builder and macro conformance goldens, refusing to write an invalid one.

Run from the repository root::

    uv run --project python/a2ui_agent \\
        python3 python/a2ui_agent/tests/conformance/regenerate_goldens.py [--check]

The validation gate is the point of this script. Regenerating from implementation
output and then asserting against the result makes a golden agree with whatever
the implementation does, bugs included; that is how the ``functionCall`` and
``DynamicChildList`` wire bugs reached review. Gating on the A2UI validator means
a golden can only be recorded if it is something a client could actually render.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Callable, Sequence

if __package__ in (None, ""):
    sys.path.insert(
        0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    )
    from tests.conformance import builder_suite, macro_suite
else:
    from . import builder_suite, macro_suite


def _process_suite(
    suite_label: str,
    cases: Sequence[Any],
    run_fn: Callable[[Any], Any],
    validate_fn: Callable[[Any, Any], None],
    *,
    check_only: bool,
    failures: list[str],
    mismatched: list[str],
    written: list[str],
    unchanged: list[str],
) -> None:
    for case in cases:
        if not getattr(case, "golden", None):
            continue
        label = f"{suite_label}/{case.id}"
        payload = run_fn(case)

        try:
            validate_fn(payload, case)
        except Exception as exc:  # noqa: BLE001 - reported, not handled
            failures.append(f"{label}: {str(exc).splitlines()[0]}")
            continue

        serialized = json.dumps(payload, indent=2) + "\n"
        try:
            with open(case.golden_path, "r", encoding="utf-8") as f:
                if json.load(f) == payload:
                    unchanged.append(label)
                    continue
        except (FileNotFoundError, json.JSONDecodeError):
            pass

        if check_only:
            mismatched.append(label)
            continue

        os.makedirs(os.path.dirname(case.golden_path), exist_ok=True)
        with open(case.golden_path, "w", encoding="utf-8") as f:
            f.write(serialized)
        written.append(label)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Regenerate or check A2UI builder and macro conformance golden files."
        )
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help=(
            "Verify that generated outputs match golden files on disk without writing."
        ),
    )
    args = parser.parse_args(argv)

    failures: list[str] = []
    mismatched: list[str] = []
    written: list[str] = []
    unchanged: list[str] = []

    _process_suite(
        "builder",
        builder_suite.load_cases(),
        builder_suite.run_case,
        builder_suite.validate_payload,
        check_only=args.check,
        failures=failures,
        mismatched=mismatched,
        written=written,
        unchanged=unchanged,
    )
    _process_suite(
        "macros",
        [c for c in macro_suite.load_cases() if c.golden is not None],
        macro_suite.run_case,
        macro_suite.validate_payload,
        check_only=args.check,
        failures=failures,
        mismatched=mismatched,
        written=written,
        unchanged=unchanged,
    )

    for case_id in unchanged:
        print(f"unchanged  {case_id}")
    for case_id in written:
        print(f"written    {case_id}")
    for case_id in mismatched:
        print(f"MISMATCH   {case_id}")
    for failure in failures:
        print(f"INVALID    {failure}")

    if failures:
        print(f"\n{len(failures)} case(s) produced invalid payloads.")
        return 1
    if mismatched:
        print(f"\n{len(mismatched)} case(s) differed from their golden files on disk.")
        return 1
    if args.check:
        print(f"\nAll {len(unchanged)} golden files are up to date and valid.")
    else:
        print(f"\n{len(written)} written, {len(unchanged)} unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
