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

import pytest
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

from a2ui_eval.bridges import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    BridgeOptions,
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
    subagent_tool_strategy,
)
from a2ui_eval.strategies.skill_mode import (
    SKILLS_READ_STORE_KEY,
    SKILLS_STORE_KEY,
    build_skills,
    read_a2ui_skill,
    record_skills_read,
    skill_mode_strategy,
    skill_mode_system_prompt,
)
from a2ui_eval.strategies.subagent_tool import (
    SAMPLE_META_STORE_KEY,
    _specialist_system_prompt,
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
    solvers = subagent_tool_strategy(version="0.9.1")
    assert len(solvers) == 5


class _FakeBridge:
    """Fake SDK bridge that records prompt and parse_and_validate calls.

    `fail_first` makes the first `parse_and_validate` call raise, to exercise
    the specialist's validation retry.
    """

    def __init__(self, fail_first: int = 0) -> None:
        self.parse_calls: list[dict[str, Any]] = []
        self.prompt_calls: list[dict[str, Any]] = []
        self.options_seen: list[BridgeOptions | None] = []
        self._failures_left = fail_first

    def generate_prompt(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str = "main",
        *,
        options: BridgeOptions | None = None,
    ) -> str:
        self.prompt_calls.append({
            "format_name": format_name,
            "version": version,
            "options": options,
        })
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
        options: BridgeOptions | None = None,
    ) -> dict[str, Any]:
        self.parse_calls.append({
            "format_name": format_name,
            "timeout_sec": timeout_sec,
            "require_complete_tags": require_complete_tags,
            "validate": validate,
        })
        self.options_seen.append(options)
        if self._failures_left > 0:
            self._failures_left -= 1
            raise ValueError("Unknown component 'Widget'")
        return {"compiled_jsons": [{"version": "v0.9"}], "parts": []}


class _FakeModel:
    """Fake specialist model that answers from a script and records its inputs."""

    def __init__(self, completions: list[str] | None = None) -> None:
        self._completions = list(completions or ["<a2ui-json>[]</a2ui-json>"])
        self.calls: list[list[Any]] = []

    async def generate(self, messages: list[Any]) -> ModelOutput:
        self.calls.append(list(messages))
        completion = self._completions.pop(0) if self._completions else ""
        return ModelOutput.from_content("mock/model", completion)


def _specialist_meta(**extra: Any) -> dict[str, Any]:
    """Shares a fresh sample metadata dict with the specialist tool."""
    meta: dict[str, Any] = {"catalog": str(V091_CATALOG), **extra}
    store().set(SAMPLE_META_STORE_KEY, meta)
    store().set(PAYLOAD_STORE_KEY, None)
    return meta


@pytest.mark.asyncio
@pytest.mark.parametrize("sdk", ["python", "ts", "dart"])
async def test_a2ui_specialist_default_is_direct_json(sdk: str) -> None:
    """By default the specialist writes Direct JSON for 0.9.1 and validates it."""
    bridge = _FakeBridge()
    meta = _specialist_meta()

    with patch(
        "a2ui_eval.strategies.subagent_tool.get_sdk_bridge", return_value=bridge
    ), patch("a2ui_eval.strategies.subagent_tool.get_model", return_value=_FakeModel()):
        result = await a2ui_specialist(sdk=sdk)(input="Build a card")

    assert result.startswith("Success")
    assert store().get(PAYLOAD_STORE_KEY) is not None
    assert bridge.prompt_calls[0]["format_name"] == "direct_json"
    assert bridge.prompt_calls[0]["version"] == "0.9.1"
    assert bridge.parse_calls == [{
        "format_name": "direct_json",
        "timeout_sec": DEFAULT_PARSE_TIMEOUT_SEC,
        "require_complete_tags": True,
        "validate": True,
    }]
    assert meta["compiled_messages"] == [{"version": "v0.9"}]
    assert meta["subagent_pass_at_1"] is True
    assert meta["subagent_validation_retries_used"] == 0


@pytest.mark.asyncio
async def test_a2ui_specialist_express_uses_version_and_options() -> None:
    """An Express specialist prompts and validates with the sample's options."""
    bridge = _FakeBridge()
    meta = _specialist_meta(
        catalog=str(V1_CATALOG),
        allowed_messages=["updateComponents"],
        allowed_surface_ids=["panel"],
    )
    model = _FakeModel(['<a2ui>root = Text("hi")</a2ui>'])

    with patch(
        "a2ui_eval.strategies.subagent_tool.get_sdk_bridge", return_value=bridge
    ), patch("a2ui_eval.strategies.subagent_tool.get_model", return_value=model):
        result = await a2ui_specialist(subagent_format="express", version="1.0")(
            input="Build a card"
        )

    assert result.startswith("Success")
    assert bridge.prompt_calls == [{
        "format_name": "express",
        "version": "1.0",
        "options": bridge.options_seen[0],
    }]
    options = bridge.options_seen[0]
    assert options is not None
    assert options.catalogs[0].path == str(V1_CATALOG)
    assert options.allowed_messages == ("updateComponents",)
    assert bridge.parse_calls[0]["format_name"] == "express"
    assert bridge.parse_calls[0]["validate"] is True
    assert meta["compiled_messages"] == [{"version": "v0.9"}]
    # The specialist sees the sample's role text, then the bridge prompt.
    assert model.calls[0][0].content.endswith("PROMPT")


@pytest.mark.asyncio
async def test_a2ui_specialist_prefers_sample_version() -> None:
    """Without an explicit version the specialist uses the sample's version."""
    bridge = _FakeBridge()
    _specialist_meta(version="1.0")
    with patch(
        "a2ui_eval.strategies.subagent_tool.get_sdk_bridge", return_value=bridge
    ), patch("a2ui_eval.strategies.subagent_tool.get_model", return_value=_FakeModel()):
        await a2ui_specialist()(input="Build a card")
    assert bridge.prompt_calls[0]["version"] == "1.0"


@pytest.mark.asyncio
async def test_a2ui_specialist_retries_after_validation_error() -> None:
    """A rejected answer goes back to the specialist with the error, once."""
    bridge = _FakeBridge(fail_first=1)
    meta = _specialist_meta()
    model = _FakeModel(["<a2ui-json>bad</a2ui-json>", "<a2ui-json>[]</a2ui-json>"])

    with patch(
        "a2ui_eval.strategies.subagent_tool.get_sdk_bridge", return_value=bridge
    ), patch("a2ui_eval.strategies.subagent_tool.get_model", return_value=model):
        result = await a2ui_specialist(max_validation_retries=1)(input="Build a card")

    assert result.startswith("Success")
    assert len(bridge.parse_calls) == 2
    assert meta["compiled_messages"] == [{"version": "v0.9"}]
    assert meta["subagent_pass_at_1"] is False
    assert meta["subagent_validation_retries_used"] == 1
    # Second attempt: system, user, rejected assistant answer, error feedback.
    second_call = model.calls[1]
    assert [m.role for m in second_call] == ["system", "user", "assistant", "user"]
    assert "Unknown component 'Widget'" in second_call[-1].content


@pytest.mark.asyncio
async def test_a2ui_specialist_gives_up_when_retries_run_out() -> None:
    bridge = _FakeBridge(fail_first=5)
    meta = _specialist_meta()
    with patch(
        "a2ui_eval.strategies.subagent_tool.get_sdk_bridge", return_value=bridge
    ), patch(
        "a2ui_eval.strategies.subagent_tool.get_model",
        return_value=_FakeModel(["x", "y"]),
    ):
        result = await a2ui_specialist(max_validation_retries=1)(input="Build a card")

    assert result.startswith("Error")
    assert "Unknown component 'Widget'" in result
    assert len(bridge.parse_calls) == 2
    assert "compiled_messages" not in meta
    assert meta["subagent_pass_at_1"] is False
    assert meta["subagent_validation_retries_used"] == 1


@pytest.mark.asyncio
async def test_a2ui_specialist_non_validation_error_records_zero_retries() -> None:
    bridge = _FakeBridge()
    meta = _specialist_meta()

    class _TimeoutBridge(_FakeBridge):

        def parse_and_validate(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
            raise TimeoutError("Bridge timed out")

    with patch(
        "a2ui_eval.strategies.subagent_tool.get_sdk_bridge",
        return_value=_TimeoutBridge(),
    ), patch(
        "a2ui_eval.strategies.subagent_tool.get_model",
        return_value=_FakeModel(["<a2ui-json>[]</a2ui-json>"]),
    ):
        result = await a2ui_specialist(max_validation_retries=2)(input="Build a card")

    assert result.startswith("Error")
    assert "Bridge timed out" in result
    assert meta["subagent_pass_at_1"] is False
    assert meta["subagent_validation_retries_used"] == 0
    assert len(bridge.parse_calls) == 0


def test_specialist_system_prompt_supports_v2_and_legacy_keys() -> None:
    v2_prompt = _specialist_system_prompt(
        {
            "protocol_role": "V2 protocol role.",
            "generation_rules": "V2 generation rules.",
            "system_prompt": "V2 domain prompt.",
        },
        "SCHEMA_PROMPT",
    )
    assert "V2 protocol role." in v2_prompt
    assert "V2 generation rules." in v2_prompt
    assert "## Domain Instructions\nV2 domain prompt." in v2_prompt
    assert v2_prompt.endswith("SCHEMA_PROMPT")

    legacy_prompt = _specialist_system_prompt(
        {
            "role_description": "Legacy role.",
            "workflow_description": "Legacy workflow.",
        },
        "SCHEMA_PROMPT",
    )
    assert "Legacy role." in legacy_prompt
    assert "Legacy workflow." in legacy_prompt
    assert "## Domain Instructions" not in legacy_prompt


@pytest.mark.asyncio
async def test_extract_subagent_payload_copies_specialist_results() -> None:
    state = _state({}, completion="old content")
    state.store.set(
        SAMPLE_META_STORE_KEY,
        {"compiled_messages": [{"a": 1}], "subagent_pass_at_1": True},
    )
    state.store.set(PAYLOAD_STORE_KEY, "[]")
    state = await extract_subagent_payload()(state, dummy_generate)
    assert state.metadata["compiled_messages"] == [{"a": 1}]
    assert state.metadata["subagent_pass_at_1"] is True
    assert state.output.completion == "<a2ui-json>\n[]\n</a2ui-json>"


def test_subagent_tool_strategy_signature() -> None:
    solvers = subagent_tool_strategy(
        version="1.0", subagent_format="express", max_validation_retries=2
    )
    assert len(solvers) == 5
    with pytest.raises(ValueError):
        subagent_tool_strategy(sdk="python", subagent_format="not_a_format")


SKILL_META = {
    "catalog": str(V1_CATALOG),
    "system_prompt": "You are a research bot.",
    "protocol_role": "Custom UI generator",
}


@pytest.mark.asyncio
async def test_skill_mode_system_prompt_lists_skills_without_catalog() -> None:
    state = _state(dict(SKILL_META))
    state = await skill_mode_system_prompt("express", "1.0")(state, dummy_generate)

    assert len(state.messages) == 1
    prompt = state.messages[0].content
    skills = state.store.get(SKILLS_STORE_KEY)
    assert list(skills) == ["a2ui-core", "a2ui-basic"]
    assert "`a2ui-core`" in prompt
    assert "`a2ui-basic`" in prompt
    assert "read_a2ui_skill" in prompt
    assert "## Domain Instructions" in prompt
    assert "You are a research bot." in prompt
    assert "Custom UI generator" in prompt
    # The catalog signatures live in the skill, not in the system prompt.
    assert "Button(" in skills["a2ui-basic"]
    assert "Button(" not in prompt
    assert "A2UI Express DSL Output Contract" in skills["a2ui-core"]
    assert "A2UI Express DSL Output Contract" not in prompt
    assert state.store.get(SKILLS_READ_STORE_KEY) == []


@pytest.mark.asyncio
async def test_read_a2ui_skill_returns_text_or_error() -> None:
    state = _state(dict(SKILL_META))
    state = await skill_mode_system_prompt("express", "1.0")(state, dummy_generate)
    # Outside an eval run the sample store and the tool store are separate.
    store().set(SKILLS_STORE_KEY, state.store.get(SKILLS_STORE_KEY))
    store().set(SKILLS_READ_STORE_KEY, [])
    skill_tool = read_a2ui_skill()

    core = await skill_tool(skill_name="a2ui-core")
    assert "A2UI Express DSL Output Contract" in core
    basic = await skill_tool(skill_name="a2ui-basic")
    assert "Button(" in basic
    again = await skill_tool(skill_name="a2ui-core")
    assert again == core

    error = await skill_tool(skill_name="a2ui-nope")
    assert error.startswith("Error: unknown skill 'a2ui-nope'")
    assert "`a2ui-core`" in error and "`a2ui-basic`" in error
    assert store().get(SKILLS_READ_STORE_KEY) == ["a2ui-core", "a2ui-basic"]


@pytest.mark.asyncio
async def test_record_skills_read() -> None:
    state = _state({})
    state.store.set(SKILLS_READ_STORE_KEY, ["a2ui-core"])
    state = await record_skills_read()(state, dummy_generate)
    assert state.metadata["skills_read"] == ["a2ui-core"]


def test_build_skills_uses_catalog_specs() -> None:
    skills = build_skills(
        "direct_json",
        "1.0",
        {
            "catalog_specs": [
                {"path": str(V1_CATALOG)},
                {"path": "catalogs/mcp/v1/catalog.json"},
            ]
        },
        str(V1_CATALOG),
    )
    names = list(skills)
    assert names[0] == "a2ui-core"
    assert len(names) == 3
    assert all(name.startswith("a2ui-") for name in names)


def test_skill_mode_strategy_chain_ends_with_compile() -> None:
    solvers = skill_mode_strategy()
    assert len(solvers) == 5
    assert solvers[-1].__qualname__.startswith("compile_format_payload.")
    with pytest.raises(ValueError):
        skill_mode_strategy(format_name="not_a_format")


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
    bridge = _FakeBridge()
    compile_solver = compile_format_payload("express", version="1.0", sdk="ts")
    state = _state(
        {"catalog": str(V1_CATALOG)}, completion='<a2ui>root = Text("x")</a2ui>'
    )
    with patch("a2ui_eval.strategies.format.get_sdk_bridge", return_value=bridge):
        await compile_solver(state, dummy_generate)
    assert len(bridge.parse_calls) == 1
    assert bridge.parse_calls[0]["timeout_sec"] == DEFAULT_PARSE_TIMEOUT_SEC
    assert bridge.parse_calls[0]["validate"] is True


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


@pytest.mark.asyncio
@pytest.mark.sdk_toolchain
@pytest.mark.parametrize("sdk", ["ts", "dart"])
async def test_format_solvers_multi_sdk(sdk: str) -> None:
    prompt_solver = format_system_prompt("express", version="0.9.1", sdk=sdk)
    state = await prompt_solver(_state({"catalog": str(V091_CATALOG)}), dummy_generate)
    assert len(state.messages) == 1
    assert "<a2ui>" in state.messages[0].content

    compile_solver = compile_format_payload("express", version="0.9.1", sdk=sdk)
    _set_completion(state, 'Intro\n<a2ui>\nroot = Text("Multi SDK")\n</a2ui>\nOutro')
    state = await compile_solver(state, dummy_generate)
    assert "<a2ui-json>" in state.output.completion
    assert '"component": "Text"' in state.output.completion
