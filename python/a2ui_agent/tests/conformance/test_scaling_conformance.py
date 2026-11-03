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

"""Runs the agent timing suites, `agent/*/scaling.yaml`.

Their cases time an operation instead of checking what it returns (see
`conformance/agent/direct_json/scaling.yaml`), so they are marked
`performance` and run only under `uv run pytest -m performance`.
`test_scaling_cases_have_handlers` runs with the other tests and checks that
every case is one this harness can run.

The operations map to the parser API as follows:

1. `parse_chunk` opens a `ResponseStream` on a new parser and state, feeds it
   the response `<a2ui-json>`, payload, `</a2ui-json>` in chunks of
   `chunk_size` characters, and closes it.
2. `compile` parses the payload whole with `parse_response(payload,
   wrapped=False)`, which compiles it and checks it against a new state, as
   the timing cases describe compiling.
"""

from __future__ import annotations

from collections.abc import Callable
import json
from typing import Any

import pytest

from a2ui.core import A2uiValidationError
from a2ui.inference_format import InferenceFormat
from a2ui.utils import RendererState

from .conformance_helpers import load_conformance_yaml
from .test_conformance import _catalogs_for, _format_for

_SUITES = ("agent/direct_json/scaling.yaml", "agent/express/scaling.yaml")
_CASES = [
    pytest.param(case, id=case["name"])
    for suite in _SUITES
    for case in load_conformance_yaml(suite)
]


def _format(case: dict[str, Any]) -> InferenceFormat:
    """Builds the format a case names, before any timing starts."""
    args = case["args"]
    return _format_for(
        args["format"],
        _catalogs_for(args),
        progressive_keys=args.get("progressive_keys"),
    )


def _updated_before_created(payload: str) -> list[dict[str, Any]]:
    """The `createSurface` messages for surfaces a payload updates first.

    A case may add components to a surface "an earlier response created", so
    the state each run streams into holds those surfaces. They are created on
    the first catalog.
    """
    try:
        messages = json.loads(payload)
    except ValueError:
        return []
    created: set[str] = set()
    creates: list[dict[str, Any]] = []
    for message in messages if isinstance(messages, list) else [messages]:
        if not isinstance(message, dict):
            continue
        for key, body in message.items():
            if not isinstance(body, dict) or "surfaceId" not in body:
                continue
            surface_id = body["surfaceId"]
            if key == "createSurface":
                created.add(surface_id)
            elif surface_id not in created:
                created.add(surface_id)
                creates.append({
                    "version": message.get("version"),
                    "createSurface": {"surfaceId": surface_id},
                })
    return creates


def _call(
    inference_format: InferenceFormat,
    operation: str,
    payload: str,
    chunk_size: int | None,
) -> Callable[[], object]:
    """Returns the timed call for one operation on a payload."""
    catalogs = inference_format.create_parser().catalogs
    if operation == "compile":
        return lambda: inference_format.create_parser().parse_response(
            payload, wrapped=False
        )
    if operation != "parse_chunk":
        raise ValueError(f"Unknown operation {operation!r}")
    assert chunk_size is not None
    response = f"<a2ui-json>{payload}</a2ui-json>"
    chunks = [response[i : i + chunk_size] for i in range(0, len(response), chunk_size)]
    creates = _updated_before_created(payload)
    for create in creates:
        create["createSurface"]["catalogId"] = catalogs[0].catalog_id

    def run() -> None:
        state = RendererState(catalogs)
        state.apply(creates)
        stream = inference_format.create_parser().open_stream(state=state)
        for chunk in chunks[:-1]:
            stream.feed(chunk)
        try:
            stream.feed(chunks[-1])
            stream.close()
        except A2uiValidationError:
            # A surface an earlier response created holds components the
            # state never saw, so the tree check that closes the block
            # rejects it. Everything before it was streamed and timed.
            if not creates:
                raise

    return run


def _prepare(case: dict[str, Any]) -> Callable[[str], Callable[[], object]]:
    inference_format = _format(case)
    return lambda payload: _call(
        inference_format, case["operation"], payload, case.get("chunk_size")
    )


def test_scaling_cases_have_handlers() -> None:
    """Every timing case is one `test_scaling_conformance` can run."""
    assert _CASES, "No timing cases found under conformance/agent."
    for param in _CASES:
        case = param.values[0]
        assert case["action"] in ("measure_growth", "measure_overhead"), case["name"]
        operations = [case["operation"], case.get("baseline", "compile")]
        assert set(operations) <= {"parse_chunk", "compile"}, case["name"]
        _prepare(case)


@pytest.mark.performance
@pytest.mark.parametrize("case", _CASES)
def test_scaling_conformance(case: dict[str, Any], timing: Any) -> None:
    if case["action"] == "measure_growth":
        timing.measure_growth(case, _prepare(case))
        return
    inference_format = _format(case)
    payload = timing.write_payload(case, case["size"])
    chunk_size = case.get("chunk_size")
    timing.expect_time_ratio(
        _call(inference_format, case["operation"], payload, chunk_size),
        _call(inference_format, case["baseline"], payload, chunk_size),
        case["max_ratio"],
        what=f"{case['operation']} against {case['baseline']}",
    )
