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

"""Tests of `repair_prompt`, `repair_react_app` and `compile_and_repair`."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
import copy
from typing import Any

from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage
from pydantic import TypeAdapter
import pytest

from a2ui_react_app import (
    REACT_APP_CATALOG_ID,
    ReactAppBindings,
    ReactAppCompiler,
    ReactAppTransformer,
    compile_and_repair,
    default_worker_path,
    react_app_bindings,
    react_app_catalog,
    repair_prompt,
    repair_react_app,
    repair_system_instruction,
)
from a2ui_react_app._repair import extract_source

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


def _app_of(messages: list[AgentToRendererMessage]) -> dict[str, Any]:
    for message in messages:
        dumped = message.model_dump(by_alias=True, exclude_none=True)
        for envelope in ("createSurface", "updateComponents"):
            for component in (dumped.get(envelope) or {}).get("components") or []:
                if component.get("component") == "ReactApp":
                    result: dict[str, Any] = component
                    return result
    raise AssertionError("No ReactApp component found")


def test_repair_prompt_and_system_instruction_use_dynamic_fences() -> None:
    source_with_backticks = 'const md = "```tsx\\nhi\\n```";\nexport default App;'
    user_only = repair_prompt(
        source_with_backticks,
        ["1:1 TS2304 Cannot find name 'App'."],
        title="app",
        include_rules=False,
    )
    assert "Problems in `app`:" in user_only
    assert "- 1:1 TS2304 Cannot find name 'App'." in user_only
    assert (
        '````tsx\n1 | const md = "```tsx\\nhi\\n```";\n2 | export default App;\n````'
        in user_only
    )
    assert "Rules:" not in user_only

    bindings = react_app_bindings(_CATALOGS)
    sys_inst = repair_system_instruction(bindings=bindings)
    assert "Rules:" in sys_inst
    assert "The `a2ui:bindings` module:" in sys_inst
    assert "estimateTravelTime" in sys_inst

    # Even if `names` is empty, non-empty declarations are still included.
    raw_bindings = ReactAppBindings(names=(), declarations=bindings.declarations)
    assert "estimateTravelTime" in repair_system_instruction(bindings=raw_bindings)

    assert (
        extract_source("Here:\n````tsx\nconst x = ```a```;\nexport default App;\n````")
        == "const x = ```a```;\nexport default App;\n"
    )


def test_repair_loop_fixes_in_two_attempts_and_passes_system_instruction(
    compiler: ReactAppCompiler,
) -> None:
    replies = iter([
        (
            "Still wrong:\n```tsx\nexport default function App() { return"
            " <p>{missing}</p>; }\n```"
        ),
        f"```tsx\n{_TYPED_APP}```",
    ])
    calls: list[tuple[str, str | None]] = []

    async def generate(prompt: str, system_instruction: str | None = None) -> str:
        calls.append((prompt, system_instruction))
        return next(replies)

    bindings = ReactAppBindings(
        names=(), declarations=react_app_bindings(_CATALOGS).declarations
    )
    result = asyncio.run(
        repair_react_app(
            "export default function App() { return <p>{oops}</p>; }\n",
            ["1:43 TS2304 Cannot find name 'oops'."],
            generate=generate,
            compiler=compiler,
            bindings=bindings,
        )
    )

    assert result.ok and result.compiled
    assert [a.ok for a in result.attempts] == [False, True]
    assert len(calls) == 2
    assert calls[0][1] is not None and "estimateTravelTime" in calls[0][1]
    assert "Rules:" not in calls[0][0]
    assert "missing" in calls[1][0]
    assert result.source == _TYPED_APP


def test_repair_checks_structural_rules_on_candidate(
    compiler: ReactAppCompiler,
) -> None:
    # Attempt 1 compiles cleanly in TS, but lacks a default export and uses a path
    # outside the component's `dataPaths` allowlist. Attempt 2 fixes both.
    good_source = """import { Text, useData } from "a2ui";
export default function App() {
  const [rate] = useData<number>("/loan/rate", 5);
  return <Text>{rate}</Text>;
}
"""
    replies = iter([
        (
            '```tsx\nimport { Text, useData } from "a2ui";\n'
            "export function NotDefault() {\n"
            '  const [secret] = useData<number>("/other/secret", 0);\n'
            "  return <Text>{secret}</Text>;\n"
            "}\n```"
        ),
        f"```tsx\n{good_source}```",
    ])
    prompts: list[str] = []

    async def generate(prompt: str) -> str:
        prompts.append(prompt)
        return next(replies)

    component = {
        "id": "app",
        "component": "ReactApp",
        "source": "broken",
        "dataPaths": ["/loan"],
    }
    result = asyncio.run(
        repair_react_app(
            "export default function App() { return <p>{oops}</p>; }\n",
            ["1:43 TS2304 Cannot find name 'oops'."],
            generate=generate,
            compiler=compiler,
            component=component,
            max_attempts=2,
        )
    )

    assert result.ok
    assert [a.ok for a in result.attempts] == [False, True]
    assert "default-export" in prompts[1]
    assert "/other/secret" in prompts[1]
    assert result.source == good_source


def test_repair_keeps_original_source_and_compiled_when_candidate_is_worse(
    compiler: ReactAppCompiler,
) -> None:
    original_source = _TYPED_APP.replace("{ stops: [", "{ stop: [")
    initial = compiler.compile(
        original_source, bindings=react_app_bindings(_CATALOGS).declarations
    )
    assert initial.compiled is not None and len(initial.diagnostics) == 1

    # Reply 1 has no code block; Reply 2 has two type errors (worse than 1).
    replies = iter([
        "I cannot fix this.",
        (
            "```tsx\n"
            "export default function App() {\n"
            "  return <p>{unknownOne} {unknownTwo}</p>;\n"
            "}\n```"
        ),
    ])

    async def generate(prompt: str) -> str:
        return next(replies)

    bindings = react_app_bindings(_CATALOGS)
    transformer = ReactAppTransformer(compiler=compiler, bindings=bindings)
    messages = _app_messages(original_source)

    fixed, repairs = asyncio.run(
        compile_and_repair(messages, transformer=transformer, generate=generate)
    )

    assert len(repairs) == 1
    assert not repairs[0].ok
    assert repairs[0].source == original_source
    assert repairs[0].compiled == initial.compiled
    app = _app_of(fixed)
    assert app["source"] == original_source
    assert app["compiled"] == initial.compiled


def test_compile_and_repair_keys_by_slot_and_runs_in_parallel(
    compiler: ReactAppCompiler,
) -> None:
    bindings = react_app_bindings(_CATALOGS)
    transformer = ReactAppTransformer(compiler=compiler, bindings=bindings)
    bad_first = (
        'import { Text } from "a2ui";\nexport default function App() { return'
        " <Text>{firstMissing}</Text>; }\n"
    )
    bad_second = (
        'import { Text } from "a2ui";\nexport default function App() { return'
        " <Text>{secondMissing}</Text>; }\n"
    )
    good_first = (
        'import { Text } from "a2ui";\nexport default function App() { return'
        " <Text>first</Text>; }\n"
    )
    good_second = (
        'import { Text } from "a2ui";\nexport default function App() { return'
        " <Text>second</Text>; }\n"
    )

    # Same surfaceId ("s") and same component id ("app") in both createSurface and updateComponents!
    messages = _MESSAGES.validate_python([
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "s",
                "components": [{
                    "id": "app",
                    "component": "ReactApp",
                    "catalogId": REACT_APP_CATALOG_ID,
                    "source": bad_first,
                }],
            },
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [{
                    "id": "app",
                    "component": "ReactApp",
                    "catalogId": REACT_APP_CATALOG_ID,
                    "source": bad_second,
                }],
            },
        },
    ])
    original = copy.deepcopy(messages)
    active = 0
    max_active = 0

    async def generate(prompt: str, system_instruction: str | None = None) -> str:
        nonlocal active, max_active
        assert system_instruction is not None
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.05)
        active -= 1
        if "firstMissing" in prompt:
            return f"```tsx\n{good_first}```"
        return f"```tsx\n{good_second}```"

    fixed, repairs = asyncio.run(
        compile_and_repair(messages, transformer=transformer, generate=generate)
    )

    assert len(repairs) == 2 and all(r.ok for r in repairs)
    assert max_active == 2
    first_comp = fixed[0].model_dump(by_alias=True, exclude_none=True)["createSurface"][
        "components"
    ][0]
    second_comp = fixed[1].model_dump(by_alias=True, exclude_none=True)[
        "updateComponents"
    ]["components"][0]
    assert first_comp["source"] == good_first
    assert second_comp["source"] == good_second
    assert "first" in first_comp["compiled"] and "second" not in first_comp["compiled"]
    assert (
        "second" in second_comp["compiled"] and "first" not in second_comp["compiled"]
    )
    assert messages == original
