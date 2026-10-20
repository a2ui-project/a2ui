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

"""Timing support shared by the Python SDK test suites.

The conformance timing cases (`measure_growth` and `measure_overhead`, see
`conformance/README.md`) time an operation instead of checking what it returns.
Tests that run them are marked `performance`. The root `pyproject.toml`
deselects that marker, so `uv run pytest` skips them, and
`uv run pytest -m performance` runs only them.

A test asks for the `timing` fixture to write a case's payload and to compare
the times of two calls.

This is a plain module rather than a conftest so that the test suites of other
packages can load it too: a test directory's `conftest.py` loads it by path and
exposes `timing` (see `conftest.py` in this directory).
"""

from __future__ import annotations

import gc
import statistics
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import pytest


class TimingHarness:
    """Writes the payloads of timing cases and compares how long calls take.

    `conformance/agent/direct_json/scaling.yaml` describes how a harness times a
    case: each call runs once untimed, then the calls run in turn `runs` times
    each and their median times are compared.
    """

    runs = 5

    @staticmethod
    def write_payload(case: Mapping[str, Any], size: int) -> str:
        """Returns the payload of a timing case written at `size`.

        See `PayloadTemplate` in `conformance/conformance_schema.json`.
        """
        parts: list[str] = []
        for segment in case["payload"]:
            if isinstance(segment, str):
                parts.append(segment)
            elif isinstance(segment, Mapping) and isinstance(
                segment.get("repeat"), str
            ):
                text = segment["repeat"]
                separator = segment.get("separator", "")
                parts.append(
                    separator.join(text.replace("{i}", str(i)) for i in range(size))
                )
            else:
                raise ValueError(f"Unknown payload segment: {segment!r}")
        return "".join(parts)

    def expect_time_ratio(
        self,
        measured: Callable[[], object],
        baseline: Callable[[], object],
        max_ratio: float,
        what: str,
    ) -> None:
        """Fails unless `measured` takes at most `max_ratio` times as long as `baseline`.

        `what` names the two calls in the failure message.
        """
        baseline()
        measured()
        baseline_times: list[int] = []
        measured_times: list[int] = []
        for _ in range(self.runs):
            baseline_times.append(_time(baseline))
            measured_times.append(_time(measured))
        measured_median = statistics.median(measured_times)
        baseline_median = statistics.median(baseline_times)
        ratio = measured_median / max(baseline_median, 1)
        assert ratio <= max_ratio, (
            f"Median time of {what}: {measured_median / 1000:.0f} µs against"
            f" {baseline_median / 1000:.0f} µs, a ratio of {ratio:.1f} where at"
            f" most {max_ratio} is allowed."
        )

    def measure_growth(
        self,
        case: Mapping[str, Any],
        prepare: Callable[[str], Callable[[], object]],
    ) -> None:
        """Runs a `measure_growth` case.

        `prepare` receives the payload written at one size and does the work that
        is not timed, such as decoding it. It returns the call to time, which
        builds what the case names (a processor or a parser) and runs the
        operation to the end of the payload.
        """
        sizes: Sequence[int] = case["sizes"]
        smaller, larger = sizes
        self.expect_time_ratio(
            prepare(self.write_payload(case, larger)),
            prepare(self.write_payload(case, smaller)),
            case["max_ratio"],
            what=f"{case['operation']} at {larger} against {smaller}",
        )


def _time(body: Callable[[], object]) -> int:
    """Returns the time `body` takes, in nanoseconds.

    Garbage left by earlier runs is collected first, so that a run is not
    charged for collecting it.
    """
    gc.collect()
    start = time.perf_counter_ns()
    body()
    return time.perf_counter_ns() - start


@pytest.fixture
def timing() -> TimingHarness:
    """The harness that runs the conformance timing cases."""
    return TimingHarness()
