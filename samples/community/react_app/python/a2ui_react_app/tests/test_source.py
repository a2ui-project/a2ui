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

"""Tests of the source facts and the checks built on them."""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel
import pytest

from a2ui.core import AgentFunction
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats import to_message_dicts, to_message_models
from a2ui.inference_formats.express import ExpressCompiler
from a2ui_react_app import (
    REACT_APP_CATALOG_ID,
    ReactAppTransformer,
    ReactAppValidationError,
    check_react_app,
    react_app_prompt,
    react_app_source_facts,
)

_HEADER = 'import { useEffect, useState } from "react";\n'


class _TravelArgs(BaseModel):
    stops: list[str]


def _source(body: str, imports: str = "useData, callFunction, Button") -> str:
    return (
        _HEADER
        + f'import {{ {imports} }} from "a2ui";\n'
        + "export default function App() {\n"
        + body
        + "\n  return null;\n}\n"
    )


def _app(source: str, **props: Any) -> dict[str, Any]:
    return {"id": "app", "component": "ReactApp", "source": source, **props}


def _codes(component: dict[str, Any], **kwargs: Any) -> list[tuple[str, str]]:
    return [(d.code, d.property_name) for d in check_react_app(component, **kwargs)]


def _turn(*components: dict[str, Any]) -> list[AgentToRendererMessage]:
    return to_message_models([
        {"version": "1.0", "createSurface": {"surfaceId": "s"}},
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [
                    {"catalogId": REACT_APP_CATALOG_ID, **c} for c in components
                ],
            },
        },
    ])


def test_facts_read_literal_paths_names_and_imports() -> None:
    facts = react_app_source_facts(
        _source(
            "  const [rate, setRate] = useData<number>('/loan/rate', 5);\n"
            "  const [years] = useData(`/loan/years`, 30);\n"
            "  setData('/loan/saved', true);\n"
            "  callFunction('formatCurrency', {value: rate});\n"
            '  useFunction("estimateTravelTime", {stops: []});\n'
            "  dispatchAction('book', {});\n"
            "  setRate(rate + 1);",
            imports="useData, setData, callFunction, useFunction, dispatchAction",
        )
        + 'import { querySales } from "a2ui:bindings";\n'
    )

    assert facts.read_paths == {"/loan/rate", "/loan/years"}
    assert facts.written_paths == {"/loan/saved", "/loan/rate"}
    assert facts.functions == {"formatCurrency", "estimateTravelTime"}
    assert facts.bound_functions == {"querySales"}
    assert facts.actions == {"book"}
    assert not (facts.dynamic_paths or facts.dynamic_functions or facts.dynamic_actions)
    assert facts.a2ui_imports == {
        "useData",
        "setData",
        "callFunction",
        "useFunction",
        "dispatchAction",
    }


def test_facts_flag_computed_paths_and_names() -> None:
    facts = react_app_source_facts(
        _source(
            "  const [x] = useData(`/items/${id}`, 0);\n"
            "  callFunction(name, {});\n"
            "  dispatchAction('go' + suffix, {});"
        )
    )

    assert facts.dynamic_paths and facts.dynamic_functions and facts.dynamic_actions
    assert facts.paths == set() and facts.functions == set()


def test_facts_ignore_comments() -> None:
    facts = react_app_source_facts(
        _source(
            "  // fetch('https://example.com'); useData('/hidden', 0);\n"
            "  /* callFunction('nope', {}) */"
        )
    )

    assert facts.forbidden_apis == ()
    assert facts.paths == set() and facts.functions == set()


def test_facts_find_namespace_binding_members() -> None:
    facts = react_app_source_facts(
        _source("  $b.querySales({});") + 'import * as $b from "a2ui:bindings";\n'
    )

    assert facts.bound_functions == {"querySales"}


@pytest.mark.parametrize(
    ("body", "api"),
    [
        ("  fetch('https://api.example.com/price');", "fetch"),
        ("  const r = new XMLHttpRequest();", "XMLHttpRequest"),
        ("  const ws = new WebSocket('wss://x');", "WebSocket"),
        ("  const es = new EventSource('/s');", "EventSource"),
        ("  navigator.sendBeacon('/b', '');", "navigator.sendBeacon"),
        ("  location.href = 'https://evil.example';", "location navigation"),
        ("  window.location = 'https://evil.example';", "location navigation"),
        ("  location.assign('https://evil.example');", "location navigation"),
        ("  window.open('https://x');", "window.open"),
    ],
)
def test_forbidden_apis_are_reported(body: str, api: str) -> None:
    component = _app(_source(body))

    assert react_app_source_facts(component["source"]).forbidden_apis == (api,)
    diagnostics = check_react_app(component)
    assert [(d.code, d.property_name) for d in diagnostics] == [
        ("forbidden_api", "source")
    ]
    assert "never simulate" in diagnostics[0].message


def test_lookalikes_of_forbidden_apis_pass() -> None:
    body = (
        "  const prefetch = () => 1; prefetch();\n"
        "  const isLocation = location === undefined;\n"
        "  const label = 'fetch(';"
    )

    assert react_app_source_facts(_source(body)).forbidden_apis == ()


@pytest.mark.parametrize(
    ("body", "hook", "where"),
    [
        (
            "  useEffect(() => { useData('/route/m', 1)[1](2); }, []);",
            "useData",
            "a `useEffect` callback",
        ),
        (
            "  const v = useMemo(() => useState(0), []);",
            "useState",
            "a `useMemo` callback",
        ),
        (
            "  const el = <Button onClick={() => { const [a] = useState(0); }} />;",
            "useState",
            "the `onClick` handler",
        ),
        (
            "  const rows = [1, 2].map(i => useData(`/rows/${i}`, 0));",
            "useData",
            "a `.map` callback",
        ),
    ],
)
def test_misplaced_hooks_are_reported(body: str, hook: str, where: str) -> None:
    diagnostics = check_react_app(_app(_source(body)))

    misplaced = [d for d in diagnostics if d.code == "misplaced_hook"]
    assert len(misplaced) == 1
    assert misplaced[0].message.startswith(f"`{hook}` is called inside {where}.")
    assert "#321" in misplaced[0].message


def test_top_level_hooks_and_brackets_in_strings_pass() -> None:
    body = (
        "  const [n, setN] = useData<number>('/n', 0);\n"
        "  const label = 'useEffect(() => { useData(';\n"
        "  useEffect(() => { setN(n + 1); }, [n]);\n"
        "  const el = <Button onClick={() => setN(0)}>Don't</Button>;"
    )

    assert _codes(_app(_source(body), dataPaths=["/n"])) == []


def test_a2ui_module_names_are_not_functions() -> None:
    component = _app(
        _source("  callFunction('setData', {path: '/x', value: 1});"),
        functions=["getData"],
    )

    diagnostics = check_react_app(component)

    assert [(d.code, d.property_name) for d in diagnostics] == [
        ("unknown_function", "source"),
        ("unknown_function", "functions"),
    ]
    assert diagnostics[0].message.startswith(
        "`setData` is a function of the `a2ui` module, not a catalog function:"
        " import it from 'a2ui' and call `setData(...)` directly."
    )


def test_undeclared_functions_are_reported_when_the_catalogs_are_known() -> None:
    component = _app(
        _source("  callFunction('getWeather', {});"), functions=["getWeather"]
    )

    assert _codes(component) == []
    diagnostics = check_react_app(component, functions={"formatCurrency", "now"})
    assert [(d.code, d.property_name) for d in diagnostics] == [
        ("unknown_function", "source"),
        ("unknown_function", "functions"),
    ]
    assert diagnostics[0].message == (
        "`getWeather` isn't a function the catalogs declare. The app can call only"
        " these: `formatCurrency`, `now`."
    )


def test_allowlists_must_cover_what_the_source_uses() -> None:
    source = _source(
        "  const [rate] = useData('/loan/rate', 5);\n"
        "  const [x] = useData('/other/x', 5);\n"
        "  callFunction('formatCurrency', {});"
    )

    assert _codes(_app(source, dataPaths=["/loan"], functions=["formatCurrency"])) == [
        ("unlisted_use", "dataPaths")
    ]
    assert _codes(_app(source, dataPaths=["/loan", "/other/x"])) == [
        ("missing_allowlist", "functions")
    ]


def test_relative_data_paths_are_valid() -> None:
    source = _source("  const [name] = useData('name', '');")

    assert _codes(_app(source, dataPaths=["name", "/a~0b"])) == []


def test_transformer_fills_missing_allowlists_from_literals() -> None:
    transformer = ReactAppTransformer(on_error="raise")
    source = _source(
        "  const [rate, setRate] = useData('/loan/rate', 5);\n"
        "  callFunction('formatCurrency', {value: rate});\n"
        "  dispatchAction('done', {});"
    )
    turn = _turn(_app(source))

    out = transformer.transform_to_transport(turn)

    app = to_message_dicts(out)[1]["updateComponents"]["components"][0]
    assert app["dataPaths"] == ["/loan/rate"]
    assert app["functions"] == ["formatCurrency"]
    assert app["actions"] == ["done"]
    assert out[0] is turn[0]
    assert (
        "dataPaths"
        not in to_message_dicts(turn)[1]["updateComponents"]["components"][0]
    )


def test_transformer_raises_when_an_allowlist_cannot_be_derived() -> None:
    transformer = ReactAppTransformer(on_error="raise")
    source = _source("  const [x] = useData(`/items/${id}`, 0);")

    with pytest.raises(ReactAppValidationError, match="`dataPaths` is missing"):
        transformer.transform_to_transport(_turn(_app(source)))


def test_transformer_raises_on_module_names_and_undeclared_functions() -> None:
    transformer = ReactAppTransformer(on_error="raise")
    agent = BasicCatalog("1.0").copy_with(
        agent_functions=[
            AgentFunction(
                "estimateTravelTime",
                handler=lambda args: 42,
                schema=_TravelArgs,
                return_type="number",
                description="Travel minutes.",
            )
        ]
    )
    transformer.transform_catalogs([agent])
    good = _source("  callFunction('estimateTravelTime', {stops: []});")
    module_name = _source("  callFunction('setData', {});")
    undeclared = _source("  callFunction('getWeather', {});")

    assert transformer.check(_turn(_app(good))) == []
    with pytest.raises(ReactAppValidationError, match="is a function of the `a2ui`"):
        transformer.transform_to_transport(_turn(_app(module_name)))
    with pytest.raises(ReactAppValidationError, match="`getWeather` isn't a function"):
        transformer.transform_to_transport(_turn(_app(undeclared)))


def test_prompt_teaches_updating_a_surface_and_its_example_compiles() -> None:
    catalogs = ReactAppTransformer().transform_catalogs([BasicCatalog("1.0")])
    prompt = react_app_prompt(catalogs)
    section = prompt[prompt.index("### Changing a surface in a later turn") :]
    example = re.search(r"```\n(surface\(.*?)```", section, re.DOTALL)
    assert example is not None
    block = example.group(1).replace(
        "...the whole new source...", "export default function App() { return null; }"
    )

    messages = to_message_dicts(ExpressCompiler(catalogs).compile(block))

    assert [next(k for k in m if k != "version") for m in messages] == [
        "updateComponents",
        "updateDataModel",
    ]
    assert messages[0]["updateComponents"]["components"][0]["id"] == "chart"


def test_prompt_forbids_network_calls_and_simulated_data() -> None:
    prompt = react_app_prompt(
        ReactAppTransformer().transform_catalogs([BasicCatalog("1.0")])
    )

    assert "Never call `fetch`" in prompt
    assert "never simulate it" in prompt
    assert "64 KB" in prompt
    assert "only at the top level of a component" in prompt
