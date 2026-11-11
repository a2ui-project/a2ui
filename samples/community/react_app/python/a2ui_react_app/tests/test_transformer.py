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

"""Tests for ReactAppTransformer and check_react_app."""

from __future__ import annotations

import logging
from typing import Any

import pytest

from a2ui.core import A2uiCatalogError, A2uiValidationError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats import to_message_models
from a2ui_react_app import (
    REACT_APP_CATALOG_ID,
    ReactAppDiagnostic,
    ReactAppTransformer,
    ReactAppValidationError,
    check_react_app,
    react_app_catalog,
    react_app_examples,
)

_BASIC_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
_VALID_SOURCE = """import { useState } from 'react';
import { Button, useData } from 'a2ui';

export default function App() {
  const [count, setCount] = useData<number>('/count', 0);
  return <Button onClick={() => setCount(count + 1)}>{count}</Button>;
}
"""


def _app(**props: Any) -> dict[str, Any]:
    component = {
        "id": "app",
        "component": "ReactApp",
        "catalogId": REACT_APP_CATALOG_ID,
        "title": "Counter",
        "source": _VALID_SOURCE,
        "dataPaths": ["/count"],
    }
    component.update(props)
    return {key: value for key, value in component.items() if value is not None}


def _turn(*components: dict[str, Any]) -> list[AgentToRendererMessage]:
    return to_message_models([
        {
            "version": "1.0",
            "createSurface": {"surfaceId": "s", "catalogId": _BASIC_ID},
        },
        {
            "version": "1.0",
            "updateComponents": {"surfaceId": "s", "components": list(components)},
        },
    ])


def _codes(component: dict[str, Any]) -> list[str]:
    return [d.code for d in check_react_app(component)]


def test_rejects_invalid_on_error() -> None:
    with pytest.raises(ValueError, match="on_error"):
        ReactAppTransformer(on_error="ignore")  # type: ignore[arg-type]


def test_transform_catalogs_adds_the_react_app_catalog_once() -> None:
    transformer = ReactAppTransformer()
    basic = BasicCatalog("1.0")

    catalogs = transformer.transform_catalogs([basic])
    again = transformer.transform_catalogs(catalogs)

    assert [c.catalog_id for c in catalogs] == [_BASIC_ID, REACT_APP_CATALOG_ID]
    assert again == catalogs


def test_transform_catalogs_rejects_catalogs_before_v1_0() -> None:
    with pytest.raises(A2uiCatalogError, match="v1.0"):
        ReactAppTransformer().transform_catalogs([BasicCatalog("0.9")])


def test_identity_transforms() -> None:
    transformer = ReactAppTransformer()
    catalog = react_app_catalog()
    turn = _turn(_app())

    assert transformer.transform_to_inference_catalog(catalog) is catalog
    assert transformer.transform_to_inference(turn) == turn


def test_valid_messages_pass_unchanged() -> None:
    transformer = ReactAppTransformer(on_error="raise")
    for turn in [*react_app_examples(), _turn(_app(height=200, dataPaths=["/count"]))]:
        result = transformer.transform_to_transport(turn)

        assert result == turn
        assert all(a is b for a, b in zip(result, turn))
        assert transformer.check(turn) == []


@pytest.mark.parametrize(
    ("props", "code", "prop"),
    [
        ({"source": None}, "missing_source", "source"),
        ({"source": "   \n"}, "missing_source", "source"),
        ({"source": 42}, "missing_source", "source"),
        (
            {"source": "function App() { return null; }"},
            "missing_default_export",
            "source",
        ),
        (
            {"source": "import _ from 'lodash';\n" + _VALID_SOURCE},
            "forbidden_import",
            "source",
        ),
        (
            {"source": _VALID_SOURCE + 'const s = """;\n'},
            "triple_quote",
            "source",
        ),
        ({"dataPaths": "/count"}, "invalid_data_paths", "dataPaths"),
        ({"dataPaths": ["/a~2b"]}, "invalid_data_paths", "dataPaths"),
        ({"dataPaths": "/loan"}, "invalid_data_paths", "dataPaths"),
        ({"dataPaths": [7]}, "invalid_data_paths", "dataPaths"),
        ({"functions": "formatCurrency"}, "invalid_functions", "functions"),
        ({"functions": ["formatCurrency", 3]}, "invalid_functions", "functions"),
        ({"height": 0}, "invalid_height", "height"),
        ({"height": -10}, "invalid_height", "height"),
        ({"height": "tall"}, "invalid_height", "height"),
        ({"height": True}, "invalid_height", "height"),
    ],
)
def test_each_failure_raises(props: dict[str, Any], code: str, prop: str) -> None:
    transformer = ReactAppTransformer(on_error="raise")

    with pytest.raises(ReactAppValidationError) as raised:
        transformer.transform_to_transport(_turn(_app(**props)))

    assert isinstance(raised.value, A2uiValidationError)
    assert [(d.code, d.property_name) for d in raised.value.diagnostics] == [
        (code, prop)
    ]
    assert raised.value.details[0].path == f"components.app.{prop}"
    assert raised.value.details[0].surface_id == "s"


def test_check_react_app_flags_compiled_when_called_directly() -> None:
    assert [(d.code, d.property_name) for d in check_react_app(_app(compiled="x"))] == [
        ("compiled_set", "compiled")
    ]


def test_error_message_lists_every_problem() -> None:
    transformer = ReactAppTransformer(on_error="raise")
    turn = _turn(
        _app(source="import x from './x';", functions="bad"),
        _app(id="other", height=-1),
    )

    with pytest.raises(ReactAppValidationError) as raised:
        transformer.transform_to_transport(turn)

    message = str(raised.value)
    assert message.startswith("The ReactApp check found 4 problems:")
    assert "ReactApp 'app' on surface 's', `source`: The app must default-export" in (
        message
    )
    assert "imports `./x`" in message
    assert "ReactApp 'app' on surface 's', `functions`:" in message
    assert "ReactApp 'other' on surface 's', `height`:" in message


def test_passthrough_logs_and_keeps_the_message(
    caplog: pytest.LogCaptureFixture,
) -> None:
    transformer = ReactAppTransformer()
    turn = _turn(_app(height=0))

    with caplog.at_level(logging.WARNING):
        result = transformer.transform_to_transport(turn)

    assert result == turn
    assert "`height`" in caplog.text
    assert [d.code for d in transformer.check(turn)] == ["invalid_height"]


def test_check_returns_structured_diagnostics() -> None:
    diagnostics = ReactAppTransformer().check(_turn(_app(height=0)))

    assert diagnostics == [
        ReactAppDiagnostic(
            code="invalid_height",
            message="`height` must be a positive number of CSS pixels, not 0.",
            property_name="height",
            component_id="app",
            surface_id="s",
        )
    ]


@pytest.mark.parametrize(
    "source",
    [
        "import React, { useState } from 'react';\nexport default function App() {}",
        'import {\n  useEffect,\n  useState,\n} from "react";\nexport default App;',
        "import * as R from 'react';\nexport default () => null;",
        "import type { JsonValue } from 'a2ui';\nexport default () => null;",
        "import { jsx } from 'react/jsx-runtime';\nexport default () => null;",
        "import { createRoot } from 'react-dom/client';\nexport default () => null;",
        "// import _ from 'lodash';\nexport default () => null;",
        "/* import _ from 'lodash'; */\nexport default () => null;",
        "const s = 'import _ from \"lodash\"';\nexport default () => null;",
        "const url = 'https://example.com';\nexport default () => null;",
        "function App() {}\nexport { App as default };",
    ],
)
def test_allowed_sources(source: str) -> None:
    assert _codes(_app(source=source)) == []


@pytest.mark.parametrize(
    "source",
    [
        "import 'lodash';\nexport default () => null;",
        "import d3 from 'd3';\nexport default () => null;",
        "import { a } from './a';\nexport default () => null;",
        "export { a } from 'lodash';\nexport default () => null;",
        "const m = await import('lodash');\nexport default () => null;",
        "const m = await import(name);\nexport default () => null;",
        "const m = require('lodash');\nexport default () => null;",
    ],
)
def test_forbidden_imports(source: str) -> None:
    assert _codes(_app(source=source)) == ["forbidden_import"]


def test_a_forbidden_module_is_reported_once() -> None:
    source = "import a from 'x';\nimport { b } from 'x';\nexport default () => null;"

    assert _codes(_app(source=source)) == ["forbidden_import"]


def test_data_paths_accept_escaped_pointers_but_not_the_root() -> None:
    assert _codes(_app(dataPaths=["/count", "/a~0b/c~1d", "/items/0"])) == []
    # The root pointer would allow every path; omitting dataPaths says that.
    assert _codes(_app(dataPaths=[""])) == ["invalid_data_paths"]


def test_skips_components_of_other_catalogs() -> None:
    transformer = ReactAppTransformer(on_error="raise")
    other = _app(catalogId="https://example.com/catalog.json", height=0)
    unannotated = _app(catalogId=None, height=0)

    assert transformer.check(_turn(other)) == []
    # The surface's default catalog is the basic catalog, which owns it.
    assert transformer.check(_turn(unannotated)) == []


def test_checks_unannotated_components_on_react_app_surfaces() -> None:
    transformer = ReactAppTransformer()
    turn = to_message_models([
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [_app(catalogId=None, height=0)],
            },
        },
    ])

    # An unknown surface is checked.
    assert len(transformer.check(turn)) == 1
    assert (
        len(transformer.check(turn, surface_catalogs={"s": REACT_APP_CATALOG_ID})) == 1
    )
    assert transformer.check(turn, surface_catalogs={"s": _BASIC_ID}) == []


def test_remembers_surfaces_until_they_are_deleted() -> None:
    transformer = ReactAppTransformer()
    transformer.check(_turn())
    update = to_message_models([
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [_app(catalogId=None, height=0)],
            },
        },
    ])

    assert transformer.check(update) == []

    transformer.check(
        to_message_models([{"version": "1.0", "deleteSurface": {"surfaceId": "s"}}])
    )

    assert len(transformer.check(update)) == 1


def test_surface_catalogs_leave_the_instance_state_alone() -> None:
    transformer = ReactAppTransformer()
    transformer.check(_turn(), surface_catalogs={})
    update = to_message_models([
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [_app(catalogId=None, height=0)],
            },
        },
    ])

    assert len(transformer.check(update)) == 1


def test_checks_components_in_create_surface() -> None:
    turn = to_message_models([
        {
            "version": "1.0",
            "createSurface": {"surfaceId": "s", "components": [_app(height=0)]},
        },
    ])

    assert [d.code for d in ReactAppTransformer().check(turn)] == ["invalid_height"]
