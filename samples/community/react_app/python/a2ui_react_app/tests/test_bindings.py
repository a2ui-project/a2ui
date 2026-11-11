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

"""Tests of the `a2ui:bindings` declarations and their place in the prompt."""

from __future__ import annotations

from typing import Any

import pytest

from a2ui.core import A2uiCatalogError, Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui_react_app import (
    BINDINGS_MODULE,
    ReactAppBindings,
    check_react_app,
    react_app_bindings,
    react_app_catalog,
    react_app_prompt,
)

_AGENT_CATALOG_ID = "https://example.com/agent/v1/catalog.json"


def _function(
    description: str, args: dict[str, Any], return_type: str
) -> dict[str, Any]:
    return {
        "type": "object",
        "description": description,
        "returnType": return_type,
        "properties": {"args": args},
        "required": ["args"],
    }


def _agent_catalog(functions: dict[str, dict[str, Any]]) -> CatalogApi:
    return Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "catalogId": _AGENT_CATALOG_ID,
            "protocolVersion": "1.0",
            "components": {},
            "functions": functions,
            "$defs": {"anyComponent": {"not": {}}},
        },
        protocol_version="1.0",
        catalog_id=_AGENT_CATALOG_ID,
    )


_TRAVEL = _function(
    "Total travel minutes for the stops, in order.",
    {
        "type": "object",
        "properties": {
            "stops": {
                "type": "array",
                "items": {"type": "object"},
                "description": "The stops to visit.",
            }
        },
        "required": ["stops"],
    },
    "number",
)
_NO_ARGS = _function("Now, as an ISO string.", {"type": "object"}, "string")


def _catalogs(**extra: dict[str, Any]) -> list[CatalogApi]:
    agent = _agent_catalog({"estimateTravelTime": _TRAVEL, **extra})
    return [BasicCatalog("1.0"), react_app_catalog(), agent]


def test_bindings_declare_typed_wrappers() -> None:
    bindings = react_app_bindings(_catalogs())

    assert {"estimateTravelTime", "formatCurrency"} <= set(bindings.names)
    assert list(bindings.names) == sorted(bindings.names)
    assert bindings.declarations.startswith(f"declare module '{BINDINGS_MODULE}' {{\n")
    assert (
        "  export function estimateTravelTime(args: { stops: ({ [key: string]:"
        " JsonValue })[] }, options?: CallFunctionOptions): Promise<number>;"
    ) in bindings.declarations
    assert "   * @param args.stops The stops to visit." in bindings.declarations


def test_bindings_make_args_optional_when_nothing_is_required() -> None:
    bindings = react_app_bindings(_catalogs(now=_NO_ARGS), ["now"])

    assert bindings.names == ("now",)
    assert (
        "  export function now(args?: {}, options?: CallFunctionOptions):"
        " Promise<string>;"
    ) in bindings.declarations


def test_bindings_bind_only_the_named_functions() -> None:
    bindings = react_app_bindings(_catalogs(), ["estimateTravelTime"])

    assert bindings.names == ("estimateTravelTime",)
    assert "formatCurrency" not in bindings.declarations


def test_bindings_refuse_unknown_function_names() -> None:
    with pytest.raises(A2uiCatalogError, match=r"\['getWeather'\]"):
        react_app_bindings(_catalogs(), ["getWeather"])


# v1.0 catalogs already refuse names that aren't UAX #31 identifiers, such as
# `a-b` or `$now`; these names pass that check but can't be imported.
@pytest.mark.parametrize(
    "name",
    [
        "delete",
        "default",
        "package",
        "interface",
        "implements",
        "eval",
        "arguments",
        "await",
        "café",
    ],
)
def test_bindings_leave_out_names_an_app_cannot_import(name: str) -> None:
    bindings = react_app_bindings(
        _catalogs(**{name: _NO_ARGS}), [name, "estimateTravelTime"]
    )

    assert bindings.names == ("estimateTravelTime",)
    assert f"function {name}(" not in bindings.declarations


def test_empty_bindings_are_still_bindings() -> None:
    bindings = react_app_bindings(_catalogs(**{"delete": _NO_ARGS}), ["delete"])

    assert isinstance(bindings, ReactAppBindings)
    assert bindings.names == ()
    assert bool(bindings) is True


def test_prompt_includes_the_bindings() -> None:
    catalogs = _catalogs()
    bindings = react_app_bindings(catalogs)

    prompt = react_app_prompt(catalogs, bindings=bindings)

    assert "### Typed functions: `a2ui:bindings`" in prompt
    assert bindings.declarations.rstrip() in prompt
    assert "a2ui:bindings" not in react_app_prompt(catalogs)


def test_prompt_leaves_out_bindings_that_bind_nothing() -> None:
    catalogs = _catalogs(**{"delete": _NO_ARGS})

    prompt = react_app_prompt(
        catalogs, bindings=react_app_bindings(catalogs, ["delete"])
    )

    assert "a2ui:bindings" not in prompt


def test_checks_allow_importing_the_bindings() -> None:
    component = {
        "id": "app",
        "component": "ReactApp",
        "source": (
            'import { estimateTravelTime } from "a2ui:bindings";\n'
            "export default function App() { return null; }\n"
        ),
        "functions": ["estimateTravelTime"],
    }

    assert check_react_app(component) == []
