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

"""Tests for the ReactApp prompt fragment."""

from __future__ import annotations

from pathlib import Path
import re

from pydantic import BaseModel
import pytest

from a2ui.core import A2uiCatalogError, AgentFunction, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.express import ExpressCompiler, ExpressParser
from a2ui.parser import A2uiPart
from a2ui_react_app import (
    ReactAppTransformer,
    react_app_catalog,
    react_app_examples,
    react_app_prompt,
)

_TYPINGS = (
    Path(__file__).resolve().parents[3]
    / "typescript"
    / "react_app_runtime"
    / "src"
    / "a2ui.d.ts"
)
_EXPRESS_BLOCK_RE = re.compile(r"<a2ui>\n(.*?)\n</a2ui>", re.DOTALL)
_NO_FUNCTIONS_TEXT = "The catalogs declare no functions that the app can call."


class _TravelArgs(BaseModel):
    stops: list[str]


def _catalogs() -> list[CatalogApi]:
    return ReactAppTransformer().transform_catalogs([BasicCatalog("1.0")])


def _react_app_sources(messages: list[AgentToRendererMessage]) -> list[str]:
    """Returns the ReactApp sources, from `createSurface` or `updateComponents`."""
    return [
        component["source"]
        for message in to_message_dicts(messages)
        for envelope in ("createSurface", "updateComponents")
        for component in message.get(envelope, {}).get("components", [])
        if component["component"] == "ReactApp"
    ]


def _loan_source() -> str:
    for turn in react_app_examples():
        for source in _react_app_sources(turn):
            if "schedule(principal" in source:
                return source
    raise AssertionError("The loan example has no ReactApp source.")


def _example_block(prompt: str) -> str:
    match = _EXPRESS_BLOCK_RE.search(prompt)
    assert match is not None, "The prompt has no Express example."
    return match.group(1)


def test_prompt_contains_the_full_typings_without_the_license_header() -> None:
    prompt = react_app_prompt(_catalogs())
    typings = _TYPINGS.read_text(encoding="utf-8")
    body = typings[typings.index("*/") + 2 :].strip()

    assert body in prompt
    assert "declare module 'a2ui'" in prompt
    assert "Licensed under the Apache License" not in prompt


def test_prompt_states_the_rules() -> None:
    prompt = react_app_prompt(_catalogs())

    for rule in (
        "only for interactive UI that the native components can't express",
        "shared data model paths",
        "default-exports a component named `App`",
        "Import only from `react` and `a2ui`",
        'source=r"""',
        "Never put three double quotes in a row",
        "template literals",
        "var(--a2ui-*)",
        "Never hard-code colors or fonts",
        "Never set `compiled`",
    ):
        assert rule in prompt, rule


def test_prompt_lists_catalog_functions_with_their_args() -> None:
    prompt = react_app_prompt(_catalogs())

    assert (
        "- `formatCurrency(args: { value: number; currency: string; decimals?:"
        " number; grouping?: boolean }): string`"
        in prompt
    )
    assert "  - `currency`: The ISO 4217 currency code" in prompt
    # Validation checks and functions that need a user gesture are left out.
    assert "`email(" not in prompt
    assert "`openUrl(" not in prompt


def test_prompt_lists_agent_functions() -> None:
    estimate = AgentFunction(
        "estimateTravelTime",
        handler=lambda args: 42,
        schema=_TravelArgs,
        return_type="number",
        description="Estimates the total travel time of a trip, in minutes.",
    )
    basic = BasicCatalog("1.0").copy_with(agent_functions=[estimate])

    prompt = react_app_prompt([basic, react_app_catalog()])

    assert "- `estimateTravelTime(args: { stops: string[] }): number`" in prompt
    assert "  Estimates the total travel time of a trip, in minutes." in prompt


def test_prompt_lists_only_the_named_functions() -> None:
    prompt = react_app_prompt(_catalogs(), functions=["formatNumber", "email"])

    assert "`formatNumber(" in prompt
    assert "`email(" in prompt
    assert "`formatCurrency(" not in prompt


def test_prompt_rejects_an_unknown_function() -> None:
    with pytest.raises(A2uiCatalogError, match="estimateTravelTime"):
        react_app_prompt(_catalogs(), functions=["estimateTravelTime"])


def test_prompt_writes_the_example_source_as_a_raw_string() -> None:
    block = _example_block(react_app_prompt(_catalogs()))

    assert re.search(r'^chart = ReactApp\(source=r"""import ', block, re.MULTILINE)
    assert f'r"""{_loan_source()}"""' in block


def test_example_compiles_back_to_the_same_source() -> None:
    catalogs = _catalogs()
    block = _example_block(react_app_prompt(catalogs))

    compiled = ExpressCompiler(catalogs).compile(block)

    assert _react_app_sources(compiled) == [_loan_source()]


def test_example_parses_back_to_the_same_source() -> None:
    catalogs = _catalogs()
    prompt = react_app_prompt(catalogs)
    response = prompt[prompt.index("<a2ui>") :]

    parts = ExpressParser(catalogs).parse_response(response)

    messages = [m for p in parts if isinstance(p, A2uiPart) for m in p.a2ui]
    assert _react_app_sources(messages) == [_loan_source()]


def test_example_is_left_out_without_the_catalogs_it_needs() -> None:
    prompt = react_app_prompt([react_app_catalog()])

    assert "<a2ui>" not in prompt
    assert _NO_FUNCTIONS_TEXT in prompt


def test_prompt_adds_the_react_app_catalog_when_missing() -> None:
    with_catalog = react_app_prompt(_catalogs())
    without_catalog = react_app_prompt([BasicCatalog("1.0")])

    assert with_catalog == without_catalog
