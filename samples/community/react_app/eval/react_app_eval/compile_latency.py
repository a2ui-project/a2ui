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

"""Measures the latency the server compile adds per ReactApp, with a cold and a warm worker.

```bash
uv run python -m react_app_eval.compile_latency
```
"""

from __future__ import annotations

import json
import statistics
import time

from a2ui.core.basic_catalog import BasicCatalog
from a2ui_react_app import (
    ReactAppCompiler,
    react_app_bindings,
    react_app_catalog,
    react_app_examples,
)

from .facts import iter_react_apps

__all__ = ["main"]


def _sources() -> list[str]:
    sources: list[str] = []
    for example in react_app_examples():
        dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in example]
        sources += [str(app["source"]) for app in iter_react_apps(dumped)]
    return sources


def main(rounds: int = 10) -> None:
    sources = _sources()
    bindings = react_app_bindings(
        [BasicCatalog("1.0"), react_app_catalog()]
    ).declarations
    started = time.perf_counter()
    with ReactAppCompiler() as compiler:
        compiler.start()
        first = compiler.compile(sources[0], bindings=bindings)
        cold_total_ms = round((time.perf_counter() - started) * 1000)
        warm: list[int] = []
        typecheck: list[int] = []
        for index in range(rounds):
            # Change the source a little each time, so nothing is cached by text.
            source = sources[index % len(sources)] + f"\n// round {index}\n"
            result = compiler.compile(source, bindings=bindings)
            assert result.ok, result.diagnostics
            warm.append(result.round_trip_ms)
            typecheck.append(result.typecheck_ms)
        report = {
            "worker_start_and_warmup_ms": compiler.startup_ms,
            "first_compile_ms": first.round_trip_ms,
            "cold_total_ms": cold_total_ms,
            "warm_compile_ms_median": statistics.median(warm),
            "warm_compile_ms_p90": sorted(warm)[int(0.9 * (len(warm) - 1))],
            "warm_typecheck_ms_median": statistics.median(typecheck),
            "warm_transpile_ms_median": statistics.median(
                compiler.compile(sources[0]).transpile_ms for _ in range(5)
            ),
            "rounds": rounds,
            "source_chars": [len(s) for s in sources],
        }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
