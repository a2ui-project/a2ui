# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import pytest
from a2ui_eval.strategies.direct import a2ui_system_prompt
from inspect_ai.solver import TaskState
from inspect_ai.model import ChatMessage, ChatMessageUser, ModelName


@pytest.mark.asyncio
async def test_a2ui_system_prompt(tmp_path):
  schema_file = tmp_path / "schema.json"
  schema_file.write_text("schema content")
  catalog_file = tmp_path / "catalog.json"
  catalog_file.write_text(
      '{"catalogId": "https://a2ui.org/test_catalog", "components": {}}'
  )

  solver = a2ui_system_prompt()

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

  async def dummy_generate(state, **kwargs):
    return state

  state = await solver(state, dummy_generate)

  assert len(state.messages) == 1
  assert state.messages[0].role == "system"
  assert "https://a2ui.org/test_catalog" in state.messages[0].content


from a2ui_eval.strategies.subagent_tool import extract_subagent_payload, PAYLOAD_STORE_KEY
from inspect_ai.model import ModelOutput, ChatCompletionChoice, ChatMessageAssistant, ChatMessageTool


@pytest.mark.asyncio
async def test_extract_subagent_payload():
  solver = extract_subagent_payload()

  state = TaskState(
      model=ModelName("mock/model"),
      sample_id=1,
      epoch=1,
      input="test",
      messages=[ChatMessageTool(content='{"test": "payload"}', tool_call_id="call_1")],
      output=ModelOutput(
          model="mock/model",
          choices=[
              ChatCompletionChoice(message=ChatMessageAssistant(content="old content"))
          ],
      ),
  )
  state.store.set(PAYLOAD_STORE_KEY, '{"test": "payload"}')

  async def dummy_generate(state, **kwargs):
    return state

  state = await solver(state, dummy_generate)
  assert state.output.completion == '<a2ui-json>\n{"test": "payload"}\n</a2ui-json>'


from a2ui_eval.strategies.subagent_tool import subagent_tool_solver


def test_subagent_tool_solver(tmp_path):
  schema_file = tmp_path / "schema.json"
  schema_file.write_text("schema content")
  catalog_file = tmp_path / "catalog.json"
  catalog_file.write_text('{"catalogId": "test", "components": {}}')

  solvers = subagent_tool_solver()
  assert len(solvers) == 5


from a2ui_eval.strategies.express import express_solver


def test_express_solver():
  solvers = express_solver()
  assert len(solvers) == 3


@pytest.mark.asyncio
async def test_a2ui_express_solvers():
  from a2ui_eval.strategies.express import a2ui_express_prompt, compile_express_dsl
  from inspect_ai.model import ModelName, ModelOutput, ChatCompletionChoice, ChatMessageAssistant
  from inspect_ai.solver import TaskState
  from a2ui_eval.shared.utils import GIT_ROOT

  catalog_file = GIT_ROOT / "specification/v1_0/catalogs/basic/catalog.json"

  # 1. Test Prompt Solver
  prompt_solver = a2ui_express_prompt()
  state = TaskState(
      model=ModelName("mock/model"),
      sample_id=1,
      epoch=1,
      input="test",
      messages=[],
      metadata={"catalog": str(catalog_file)},
  )

  async def dummy_generate(state, **kwargs):
    return state

  # Mock GIT_ROOT in the solver module dynamically for testing
  import a2ui_eval.strategies.express as express_module

  original_git_root = getattr(express_module, "GIT_ROOT", None)
  express_module.GIT_ROOT = GIT_ROOT

  try:
    state = await prompt_solver(state, dummy_generate)
    assert len(state.messages) == 1
    assert state.messages[0].role == "system"
    assert "A2UI Express Output Contract" in state.messages[0].content

    # 2. Test Compile Solver
    compile_solver = compile_express_dsl()
    state.output = ModelOutput(
        model="mock/model",
        choices=[
            ChatCompletionChoice(
                message=ChatMessageAssistant(
                    content='<a2ui>\nroot = Text("Hello")\n</a2ui>'
                )
            )
        ],
    )
    state = await compile_solver(state, dummy_generate)
    assert "<a2ui-json>" in state.output.completion
    assert '"component": "Text"' in state.output.completion
  finally:
    if original_git_root is not None:
      express_module.GIT_ROOT = original_git_root
