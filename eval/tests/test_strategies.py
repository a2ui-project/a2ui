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

from pathlib import Path
from typing import Any
import pytest
from a2ui_eval.strategies.format import format_system_prompt
from inspect_ai.solver import TaskState
from inspect_ai.model import ModelName


async def dummy_generate(state: TaskState, *args: Any, **kwargs: Any) -> TaskState:
    return state


@pytest.mark.asyncio
async def test_a2ui_system_prompt(tmp_path: Path) -> None:
    schema_file = tmp_path / "schema.json"
    schema_file.write_text("schema content")
    catalog_file = tmp_path / "catalog.json"
    catalog_file.write_text(
        '{"catalogId": "https://a2ui.org/test_catalog", "components": {}}'
    )

    solver = format_system_prompt("direct_json", version="0.9.1")

    state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        metadata={
            "catalog": str(catalog_file),
            "role_description": "mock role",
            "workflow_description": "mock workflow",
        },
    )

    state = await solver(state, dummy_generate)

    assert len(state.messages) == 1
    assert state.messages[0].role == "system"
    assert "https://a2ui.org/test_catalog" in state.messages[0].content


from a2ui_eval.strategies.subagent_tool import extract_subagent_payload, PAYLOAD_STORE_KEY
from inspect_ai.model import ModelOutput, ChatCompletionChoice, ChatMessageAssistant, ChatMessageTool


@pytest.mark.asyncio
async def test_extract_subagent_payload() -> None:
    solver = extract_subagent_payload()

    state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[
            ChatMessageTool(content='{"test": "payload"}', tool_call_id="call_1")
        ],
        output=ModelOutput(
            model="mock/model",
            choices=[
                ChatCompletionChoice(
                    message=ChatMessageAssistant(content="old content")
                )
            ],
        ),
    )
    state.store.set(PAYLOAD_STORE_KEY, '{"test": "payload"}')

    state = await solver(state, dummy_generate)
    assert state.output.completion == '<a2ui-json>\n{"test": "payload"}\n</a2ui-json>'


from a2ui_eval.strategies.subagent_tool import subagent_tool_solver


def test_subagent_tool_solver(tmp_path: Path) -> None:
    schema_file = tmp_path / "schema.json"
    schema_file.write_text("schema content")
    catalog_file = tmp_path / "catalog.json"
    catalog_file.write_text('{"catalogId": "test", "components": {}}')

    solvers = subagent_tool_solver(version="0.9.1")
    assert len(solvers) == 5


from a2ui_eval.strategies import STRATEGIES


def test_express_solver() -> None:
    solvers = STRATEGIES["express"]("1.0")
    assert len(solvers) == 3


@pytest.mark.asyncio
async def test_a2ui_express_solvers() -> None:
    from a2ui_eval.strategies.format import format_system_prompt, compile_format_payload
    from inspect_ai.model import ModelName, ModelOutput, ChatCompletionChoice, ChatMessageAssistant
    from inspect_ai.solver import TaskState
    from a2ui_eval.shared.utils import GIT_ROOT

    catalog_file = GIT_ROOT / "specification/v1_0/catalogs/basic/catalog.json"

    # 1. Test Prompt Solver
    prompt_solver = format_system_prompt("express", version="1.0")
    state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        metadata={"catalog": str(catalog_file)},
    )

    # Mock GIT_ROOT in the solver module dynamically for testing
    import a2ui_eval.strategies.format as format_module

    original_git_root = getattr(format_module, "GIT_ROOT", None)
    setattr(format_module, "GIT_ROOT", GIT_ROOT)

    try:
        state = await prompt_solver(state, dummy_generate)
        assert len(state.messages) == 1
        assert state.messages[0].role == "system"
        assert "A2UI Express DSL Output Contract" in state.messages[0].content

        # 2. Test Compile Solver with accompanying text and sentinel tags
        compile_solver = compile_format_payload("express", version="1.0")
        state.output = ModelOutput(
            model="mock/model",
            choices=[
                ChatCompletionChoice(
                    message=ChatMessageAssistant(
                        content=(
                            "Here is the domain research synthesis.\n\n"
                            '<a2ui>\nroot = Text("Hello")\n</a2ui>\n\n'
                            "Additional reference notes."
                        )
                    )
                )
            ],
        )
        state = await compile_solver(state, dummy_generate)
        assert "Here is the domain research synthesis." in state.output.completion
        assert "Additional reference notes." in state.output.completion
        assert "<a2ui-json>" in state.output.completion
        assert '"component": "Text"' in state.output.completion
    finally:
        if original_git_root is not None:
            setattr(format_module, "GIT_ROOT", original_git_root)


def test_elemental_solver() -> None:
    solvers = STRATEGIES["elemental"]("1.0")
    assert len(solvers) == 3


@pytest.mark.asyncio
async def test_a2ui_elemental_solvers() -> None:
    from a2ui_eval.strategies.format import format_system_prompt, compile_format_payload
    from inspect_ai.model import ModelName, ModelOutput, ChatCompletionChoice, ChatMessageAssistant
    from inspect_ai.solver import TaskState
    from a2ui_eval.shared.utils import GIT_ROOT

    catalog_file = GIT_ROOT / "specification/v1_0/catalogs/basic/catalog.json"

    # 1. Test Prompt Solver
    prompt_solver = format_system_prompt("elemental", version="1.0")
    state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        metadata={"catalog": str(catalog_file)},
    )

    import a2ui_eval.strategies.format as format_module

    original_git_root = getattr(format_module, "GIT_ROOT", None)
    setattr(format_module, "GIT_ROOT", GIT_ROOT)

    try:
        state = await prompt_solver(state, dummy_generate)
        assert len(state.messages) == 1
        assert state.messages[0].role == "system"
        assert "A2UI Elemental Output Contract" in state.messages[0].content

        # 2. Test Compile Solver
        compile_solver = compile_format_payload("elemental", version="1.0")
        state.output = ModelOutput(
            model="mock/model",
            choices=[
                ChatCompletionChoice(
                    message=ChatMessageAssistant(
                        content=(
                            '<a2ui><body id="main"><link rel="catalog"'
                            ' href="https://a2ui.org/catalog"><ui-text id="root"'
                            ' text="Hello"></ui-text></body></a2ui>'
                        )
                    )
                )
            ],
        )
        state = await compile_solver(state, dummy_generate)
        assert "<a2ui-json>" in state.output.completion
        assert '"component": "Text"' in state.output.completion
    finally:
        if original_git_root is not None:
            setattr(format_module, "GIT_ROOT", original_git_root)


@pytest.mark.asyncio
async def test_a2ui_atom_solvers() -> None:
    from a2ui_eval.shared.utils import GIT_ROOT

    catalog_file = GIT_ROOT / "specification/v1_0/catalogs/basic/catalog.json"

    from a2ui_eval.strategies.format import (
        format_system_prompt,
        compile_format_payload,
    )

    prompt_solver = format_system_prompt("atom", version="1.0")

    state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        metadata={"catalog": str(catalog_file)},
    )

    import a2ui_eval.strategies.format as format_module

    original_git_root = getattr(format_module, "GIT_ROOT", None)
    setattr(format_module, "GIT_ROOT", GIT_ROOT)

    try:
        state = await prompt_solver(state, dummy_generate)
        assert len(state.messages) == 1
        assert state.messages[0].role == "system"
        assert "A2UI Atom" in state.messages[0].content

        compile_solver = compile_format_payload("atom", version="1.0")
        state.output = ModelOutput(
            model="mock/model",
            choices=[
                ChatCompletionChoice(
                    message=ChatMessageAssistant(
                        content='<a2ui>(Card (Text "Hello"))</a2ui>'
                    )
                )
            ],
        )
        state = await compile_solver(state, dummy_generate)
        assert "<a2ui-json>" in state.output.completion
        assert '"component": "Card"' in state.output.completion
    finally:
        if original_git_root is not None:
            setattr(format_module, "GIT_ROOT", original_git_root)


@pytest.mark.asyncio
async def test_format_system_prompt_with_domain_prompt() -> None:
    from a2ui_eval.shared.utils import GIT_ROOT
    from a2ui_eval.strategies.format import format_system_prompt, _get_strategy, _parse_and_validate_in_process, compile_format_payload
    from a2ui.schema.catalog import CatalogConfig

    catalog_file = GIT_ROOT / "specification/v1_0/catalogs/basic/catalog.json"
    catalog_config = CatalogConfig.from_path("basic_catalog", str(catalog_file))

    # Test unknown format raises ValueError
    with pytest.raises(ValueError, match="Unknown format strategy"):
        _get_strategy("unknown_strategy", "1.0", catalog_config)

    # Test format_system_prompt with domain prompt metadata
    solver = format_system_prompt("direct_json", version="1.0")
    state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        metadata={
            "catalog": str(catalog_file),
            "system_prompt": "You are a research bot.",
            "protocol_role": "Custom UI generator",
            "generation_rules": "Follow catalog strictly",
        },
    )
    state = await solver(state, dummy_generate)
    assert "## Domain Instructions" in state.messages[0].content
    assert "You are a research bot." in state.messages[0].content

    # Test _parse_and_validate_in_process directly
    res = _parse_and_validate_in_process(
        format_name="express",
        version="1.0",
        resolved_catalog_path=str(catalog_file),
        surface_id="main",
        completion='Preamble\n<a2ui>\nroot = Text("Direct test")\n</a2ui>\nPostamble',
    )
    assert len(res["compiled_jsons"]) > 0
    assert len(res["parts"]) == 2

    # Test compile_format_payload with empty output and error recovery
    compile_solver = compile_format_payload("express", version="1.0")
    empty_state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        metadata={"catalog": str(catalog_file)},
        output=None,
    )
    res_empty = await compile_solver(empty_state, dummy_generate)
    assert res_empty.output is None or not res_empty.output.completion

    # Error recovery on invalid syntax
    error_state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        metadata={"catalog": str(catalog_file)},
        output=ModelOutput(
            model="mock/model",
            choices=[
                ChatCompletionChoice(
                    message=ChatMessageAssistant(
                        content="<a2ui>INVALID CODE SYNTAX %%%</a2ui>"
                    )
                )
            ],
        ),
    )
    res_error = await compile_solver(error_state, dummy_generate)
    assert "Compilation/validation failed:" in res_error.output.completion
