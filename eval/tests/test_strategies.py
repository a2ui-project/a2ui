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

"""Unit tests for the evaluation solver strategies."""

from pathlib import Path
from typing import Any
from unittest.mock import patch

from a2ui.processor import CatalogConfig
from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessageAssistant,
    ChatMessageTool,
    ModelName,
    ModelOutput,
)
from inspect_ai.solver import TaskState
from inspect_ai.util import store
import pytest

from a2ui_eval.runner import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    get_python_strategy,
    parse_and_validate_in_process,
)
from a2ui_eval.shared.utils import GIT_ROOT
from a2ui_eval.strategies import (
    PAYLOAD_STORE_KEY,
    STRATEGIES,
    a2ui_specialist,
    compile_format_payload,
    extract_subagent_payload,
    format_system_prompt,
    subagent_tool_solver,
)

V1_CATALOG = GIT_ROOT / "catalogs/basic/v1/catalog.json"
V091_CATALOG = GIT_ROOT / "specification/v0_9_1/catalogs/basic/catalog.json"


async def dummy_generate(state: TaskState, *args: Any, **kwargs: Any) -> TaskState:
    return state


def _state(
    metadata: dict[str, Any],
    completion: str | None = None,
    messages: list[Any] | None = None,
) -> TaskState:
    output = (
        ModelOutput(
            model="mock/model",
            choices=[
                ChatCompletionChoice(message=ChatMessageAssistant(content=completion))
            ],
        )
        if completion is not None
        else None
    )
    return TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=messages or [],
        metadata=metadata,
        output=output,
    )


def _set_completion(state: TaskState, completion: str) -> None:
    state.output = ModelOutput(
        model="mock/model",
        choices=[
            ChatCompletionChoice(message=ChatMessageAssistant(content=completion))
        ],
    )


@pytest.mark.asyncio
async def test_a2ui_system_prompt(tmp_path: Path) -> None:
    catalog_file = tmp_path / "catalog.json"
    catalog_file.write_text(
        '{"catalogId": "https://a2ui.org/test_catalog", "components": {}}'
    )

    solver = format_system_prompt("direct_json", version="0.9.1")
    state = _state({
        "catalog": str(catalog_file),
        "role_description": "mock role",
        "workflow_description": "mock workflow",
    })

    state = await solver(state, dummy_generate)

    assert len(state.messages) == 1
    assert state.messages[0].role == "system"
    assert "https://a2ui.org/test_catalog" in state.messages[0].content


@pytest.mark.asyncio
async def test_extract_subagent_payload() -> None:
    solver = extract_subagent_payload()
    state = _state(
        {},
        completion="old content",
        messages=[
            ChatMessageTool(content='{"test": "payload"}', tool_call_id="call_1")
        ],
    )
    state.store.set(PAYLOAD_STORE_KEY, '{"test": "payload"}')

    state = await solver(state, dummy_generate)
    assert state.output.completion == '<a2ui-json>\n{"test": "payload"}\n</a2ui-json>'


def test_subagent_tool_solver() -> None:
    solvers = subagent_tool_solver(version="0.9.1")
    assert len(solvers) == 5


class _FakeRunner:
    """Fake runner that records parse_and_validate calls."""

    def __init__(self) -> None:
        self.parse_calls: list[dict[str, Any]] = []

    def generate_prompt(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str = "main",
    ) -> str:
        return "PROMPT"

    def parse_and_validate(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str,
        completion: str,
        timeout_sec: float = DEFAULT_PARSE_TIMEOUT_SEC,
        require_complete_tags: bool = False,
        *,
        validate: bool = True,
    ) -> dict[str, Any]:
        self.parse_calls.append({
            "format_name": format_name,
            "timeout_sec": timeout_sec,
            "require_complete_tags": require_complete_tags,
            "validate": validate,
        })
        return {"compiled_jsons": [{"version": "v0.9"}], "parts": []}


class _FakeModel:

    async def generate(self, messages: list[Any]) -> ModelOutput:
        return ModelOutput.from_content("mock/model", "<a2ui-json>[]</a2ui-json>")


@pytest.mark.asyncio
async def test_a2ui_specialist_parses_without_validation() -> None:
    """The subagent tool only parses, so the model gets no validation feedback."""
    runner = _FakeRunner()
    store().set("version", "0.9.1")
    store().set("catalog", str(V091_CATALOG))

    with patch(
        "a2ui_eval.strategies.subagent_tool.generate_prompt",
        side_effect=runner.generate_prompt,
    ), patch(
        "a2ui_eval.strategies.subagent_tool.parse_and_validate",
        side_effect=runner.parse_and_validate,
    ), patch(
        "a2ui_eval.strategies.subagent_tool.get_model", return_value=_FakeModel()
    ):
        result = await a2ui_specialist()(input="Build a card")

    assert result.startswith("Success")
    assert store().get(PAYLOAD_STORE_KEY) is not None
    assert runner.parse_calls == [{
        "format_name": "direct_json",
        "timeout_sec": DEFAULT_PARSE_TIMEOUT_SEC,
        "require_complete_tags": True,
        "validate": False,
    }]


def test_express_solver() -> None:
    solvers = STRATEGIES["express"]("1.0")
    assert len(solvers) == 3


def test_elemental_solver() -> None:
    solvers = STRATEGIES["elemental"]("1.0")
    assert len(solvers) == 3


@pytest.mark.asyncio
async def test_a2ui_express_solvers() -> None:
    prompt_solver = format_system_prompt("express", version="1.0")
    state = await prompt_solver(_state({"catalog": str(V1_CATALOG)}), dummy_generate)
    assert len(state.messages) == 1
    assert state.messages[0].role == "system"
    assert "A2UI Express DSL Output Contract" in state.messages[0].content

    # The compile solver keeps the text around the sentinel tags.
    compile_solver = compile_format_payload("express", version="1.0")
    _set_completion(
        state,
        "Here is the domain research synthesis.\n\n"
        '<a2ui>\nroot = Text("Hello")\n</a2ui>\n\n'
        "Additional reference notes.",
    )
    state = await compile_solver(state, dummy_generate)
    assert "Here is the domain research synthesis." in state.output.completion
    assert "Additional reference notes." in state.output.completion
    assert "<a2ui-json>" in state.output.completion
    assert '"component": "Text"' in state.output.completion


@pytest.mark.asyncio
async def test_a2ui_elemental_solvers() -> None:
    prompt_solver = format_system_prompt("elemental", version="1.0")
    state = await prompt_solver(_state({"catalog": str(V1_CATALOG)}), dummy_generate)
    assert len(state.messages) == 1
    assert state.messages[0].role == "system"
    assert "A2UI Elemental Output Contract" in state.messages[0].content

    compile_solver = compile_format_payload("elemental", version="1.0")
    _set_completion(
        state,
        '<a2ui><body id="main"><link rel="catalog"'
        ' href="https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"><ui-text'
        ' id="root" text="Hello"></ui-text></body></a2ui>',
    )
    state = await compile_solver(state, dummy_generate)
    assert "<a2ui-json>" in state.output.completion
    assert '"component": "Text"' in state.output.completion


@pytest.mark.asyncio
async def test_a2ui_atom_solvers() -> None:
    prompt_solver = format_system_prompt("atom", version="1.0")
    state = await prompt_solver(_state({"catalog": str(V1_CATALOG)}), dummy_generate)
    assert len(state.messages) == 1
    assert state.messages[0].role == "system"
    assert "A2UI Atom" in state.messages[0].content

    compile_solver = compile_format_payload("atom", version="1.0")
    _set_completion(state, '<a2ui>(Card (Text "Hello"))</a2ui>')
    state = await compile_solver(state, dummy_generate)
    assert "<a2ui-json>" in state.output.completion
    assert '"component": "Card"' in state.output.completion


@pytest.mark.asyncio
async def test_compile_format_payload_uses_default_timeout() -> None:
    runner = _FakeRunner()
    compile_solver = compile_format_payload("express", version="1.0")
    state = _state(
        {"catalog": str(V1_CATALOG)}, completion='<a2ui>root = Text("x")</a2ui>'
    )
    with patch(
        "a2ui_eval.strategies.format.parse_and_validate",
        side_effect=runner.parse_and_validate,
    ):
        await compile_solver(state, dummy_generate)
    assert len(runner.parse_calls) == 1
    assert runner.parse_calls[0]["timeout_sec"] == DEFAULT_PARSE_TIMEOUT_SEC
    assert runner.parse_calls[0]["validate"] is True


def test_get_python_strategy_rejects_unknown_format() -> None:
    catalog_config = CatalogConfig.from_path(str(V1_CATALOG))
    with pytest.raises(ValueError, match="Unknown format strategy"):
        get_python_strategy("unknown_strategy", "1.0", catalog_config)


def test_parse_and_validate_in_process_keeps_text_parts() -> None:
    res = parse_and_validate_in_process(
        format_name="express",
        version="1.0",
        resolved_catalog_path=str(V1_CATALOG),
        surface_id="main",
        completion='Preamble\n<a2ui>\nroot = Text("Direct test")\n</a2ui>\nPostamble',
    )
    assert len(res["compiled_jsons"]) > 0
    assert len(res["parts"]) == 3


@pytest.mark.asyncio
async def test_format_system_prompt_with_domain_prompt() -> None:
    solver = format_system_prompt("direct_json", version="1.0")
    state = _state({
        "catalog": str(V1_CATALOG),
        "system_prompt": "You are a research bot.",
        "protocol_role": "Custom UI generator",
        "generation_rules": "Follow catalog strictly",
    })
    state = await solver(state, dummy_generate)
    assert "## Domain Instructions" in state.messages[0].content
    assert "You are a research bot." in state.messages[0].content


@pytest.mark.asyncio
async def test_compile_format_payload_empty_output_and_error_recovery() -> None:
    compile_solver = compile_format_payload("express", version="1.0")

    empty_state = _state({"catalog": str(V1_CATALOG)})
    res_empty = await compile_solver(empty_state, dummy_generate)
    assert res_empty.output is None or not res_empty.output.completion

    error_state = _state(
        {"catalog": str(V1_CATALOG)},
        completion="<a2ui>INVALID CODE SYNTAX %%%</a2ui>",
    )
    res_error = await compile_solver(error_state, dummy_generate)
    assert "Compilation/validation failed:" in res_error.output.completion
