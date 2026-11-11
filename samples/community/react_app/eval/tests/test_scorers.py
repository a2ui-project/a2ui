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

"""Tests of the facts, compiler use, dataset loader and scorers, without a model."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from inspect_ai.model import ChatMessageAssistant, ChatMessageUser, ModelName
from inspect_ai.scorer import Target
from inspect_ai.solver import TaskState
import pytest

from a2ui_react_app import ReactAppCompiler
from react_app_eval.dataset import load_dataset
from react_app_eval.facts import iter_react_apps, source_facts
from react_app_eval.scorers import (
    express_multiline_scorer,
    path_covered,
    react_app_scorer,
)

_LABS = Path(__file__).resolve().parents[2]
_LOAN = json.loads((_LABS / "catalog/v1/examples/loan_explorer.json").read_text())
_CATALOGS = [
    {"path": "catalogs/basic/v1/catalog.json"},
    {"path": "samples/community/react_app/catalog/v1/catalog.json"},
]


def _loan_source() -> str:
    return str(next(iter_react_apps(_LOAN["messages"]))["source"])


def _score_react_app(state: TaskState) -> Any:
    """Runs the ReactApp scorer with its own compile worker."""

    with ReactAppCompiler() as compiler:
        return asyncio.run(react_app_scorer(lambda: compiler)(state, Target("")))


def _state(metadata: dict[str, Any], raw: str = "") -> TaskState:
    state = TaskState(
        model=ModelName("google/test"),
        sample_id="s",
        epoch=1,
        input=[ChatMessageUser(content="hi")],
        messages=[ChatMessageUser(content="hi"), ChatMessageAssistant(content=raw)],
        metadata=metadata,
    )
    return state


def test_source_facts_of_the_loan_example() -> None:
    facts = source_facts(_loan_source())

    assert facts.read_paths == {
        "/loan/principal",
        "/loan/rate",
        "/loan/annualPayment",
        "/loan/selectedYear",
    }
    assert facts.written_paths == {"/loan/selectedYearSummary", "/loan/selectedYear"}
    assert facts.functions == {"formatCurrency"}
    assert {"Card", "Stack", "Text", "VegaChart"} <= facts.primitives
    assert facts.uses_theme and facts.themed
    assert facts.hard_coded_colors == 0


def test_source_facts_count_bindings_calls() -> None:
    facts = source_facts(
        'import { estimateTravelTime as eta, querySales } from "a2ui:bindings";\n'
        "eta({ stops });\n"
    )

    assert facts.functions == {"estimateTravelTime"}


def test_source_facts_count_color_literals_and_function_hooks() -> None:
    facts = source_facts(
        'import { useFunction } from "a2ui";\n'
        'const s = { color: "#ff0000", background: "rgb(1, 2, 3)" };\n'
        'const { data } = useFunction<number>("estimateTravelTime", { stops });\n'
    )

    assert facts.hard_coded_colors == 2
    assert facts.functions == {"estimateTravelTime"}
    assert not facts.themed


def test_path_covered_accepts_parents() -> None:
    assert path_covered("/loan/rate", {"/loan"})
    assert path_covered("/loan/rate", {"/loan/rate"})
    assert not path_covered("/loan/rate", {"/loans"})


def test_compiler_transpiles_and_type_checks() -> None:
    with ReactAppCompiler() as compiler:
        good = compiler.compile(_loan_source())
        wrong_type = compiler.compile(
            'import { useData } from "a2ui";\n'
            "export default function App() {\n"
            '  const [n] = useData<number>("/n", "zero");\n'
            "  return <p>{n}</p>;\n"
            "}\n"
        )
        broken = compiler.compile("export default function App() { return <div>; }")

    assert good.ok
    assert wrong_type.compiled is not None and not wrong_type.ok
    assert wrong_type.diagnostics[0].line == 3
    assert (
        broken.compiled is None and "Unexpected token" in broken.diagnostics[0].message
    )


@pytest.mark.parametrize("name", ["react_app_v1_0", "express_multiline_v1_0"])
def test_datasets_load_with_expectations(name: str) -> None:
    dataset = load_dataset(name)

    assert len(dataset) >= 8
    for sample in dataset:
        assert sample.metadata is not None
        assert isinstance(sample.metadata["expect"], dict)
        assert sample.metadata["tags"]


def test_react_app_scorer_passes_the_loan_example() -> None:
    state = _state({
        "compiled_messages": _LOAN["messages"],
        "expect": {
            "paths": ["/loan/rate", "/loan/selectedYear"],
            "functions": ["formatCurrency"],
        },
    })

    score = _score_react_app(state)

    assert score is not None and isinstance(score.value, dict)
    assert score.value["all"] == 1.0, score.explanation
    assert score.value["typechecks"] == 1.0


def test_react_app_scorer_reports_each_failure() -> None:
    messages = json.loads(json.dumps(_LOAN["messages"]))
    for component in messages[2]["updateComponents"]["components"]:
        if component["component"] == "ReactApp":
            component["source"] = (
                'import _ from "lodash";\n'
                "export default function App() {\n"
                '  return <div style={{ color: "#123456" }}>hi</div>;\n'
                "}\n"
            )
    state = _state({
        "compiled_messages": messages,
        "expect": {"paths": ["/loan/rate"], "functions": ["formatCurrency"]},
    })

    score = _score_react_app(state)

    assert score is not None and isinstance(score.value, dict)
    assert score.value["compiles"] == 1.0
    assert score.value["paths"] == 0.0
    assert score.value["functions"] == 0.0
    assert score.value["imports"] == 0.0
    assert score.value["styling"] == 0.0
    assert score.value["all"] == 0.0
    assert "lodash" in (score.explanation or "")


def test_react_app_scorer_without_payload() -> None:
    score = _score_react_app(_state({}))

    assert score is not None and isinstance(score.value, dict)
    assert set(score.value.values()) == {0.0}


def test_express_scorer_checks_raw_strings_literals_and_round_trip() -> None:
    code = 'const s = `a ${b}`;\nconsole.log("x\\n");\nexport {s};'
    compiled = [{
        "version": "1.0",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": (
                "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
            ),
            "components": [{"id": "root", "component": "Text", "text": code}],
        },
    }]
    metadata = {
        "compiled_messages": compiled,
        "catalog": "catalogs/basic/v1/catalog.json",
        "catalog_specs": [{"path": "catalogs/basic/v1/catalog.json"}],
        "expect": {"multiline": True, "literals": ['console.log("x\\n");']},
    }
    raw_ok = f'<a2ui>\nroot = Text(r"""{code}""")\n</a2ui>'
    raw_escaped = (
        '<a2ui>\nroot = Text("""const s = `a'
        ' ${b}`;\\nconsole.log(\\"x\\\\n\\");""")\n</a2ui>'
    )

    good = asyncio.run(express_multiline_scorer()(_state(metadata, raw_ok), Target("")))
    escaped = asyncio.run(
        express_multiline_scorer()(_state(metadata, raw_escaped), Target(""))
    )

    assert good is not None and isinstance(good.value, dict)
    assert good.value == {
        "parses": 1.0,
        "raw_strings": 1.0,
        "literals": 1.0,
        "roundtrip": 1.0,
        "all": 1.0,
    }, good.explanation
    assert escaped is not None and isinstance(escaped.value, dict)
    assert escaped.value["raw_strings"] == 0.0
    assert escaped.value["all"] == 0.0
