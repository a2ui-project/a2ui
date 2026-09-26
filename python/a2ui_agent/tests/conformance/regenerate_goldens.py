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

"""Regenerates the builder conformance goldens, refusing to write an invalid one.

Run from the repository root::

    uv run --project python/a2ui_agent \\
        python3 python/a2ui_agent/tests/conformance/regenerate_goldens.py

The validation gate is the point of this script. Regenerating from implementation
output and then asserting against the result makes a golden agree with whatever
the implementation does, bugs included; that is how the ``functionCall`` and
``DynamicChildList`` wire bugs reached review. Gating on the A2UI validator means
a golden can only be recorded if it is something a client could actually render.
"""

from __future__ import annotations

import json
import sys

from builder_suite import load_cases, run_case, validate_payload


def main() -> int:
    failures: list[str] = []
    written: list[str] = []
    unchanged: list[str] = []

    for case in load_cases():
        payload = run_case(case)

        try:
            validate_payload(payload, case)
        except Exception as exc:  # noqa: BLE001 - reported, not handled
            failures.append(f"{case.id}: {str(exc).splitlines()[0]}")
            continue

        serialized = json.dumps(payload, indent=2) + "\n"
        try:
            with open(case.golden_path, "r", encoding="utf-8") as f:
                if f.read() == serialized:
                    unchanged.append(case.id)
                    continue
        except FileNotFoundError:
            pass

        with open(case.golden_path, "w", encoding="utf-8") as f:
            f.write(serialized)
        written.append(case.id)

    for case_id in unchanged:
        print(f"unchanged  {case_id}")
    for case_id in written:
        print(f"written    {case_id}")
    for failure in failures:
        print(f"INVALID    {failure}")

    if failures:
        print(
            f"\n{len(failures)} case(s) produced invalid payloads and were not written."
        )
        return 1
    print(f"\n{len(written)} written, {len(unchanged)} unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
