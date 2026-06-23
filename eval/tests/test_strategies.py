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
    catalog_file.write_text('{"catalogId": "https://a2ui.org/test_catalog", "components": {}}')

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
            "workflow_description": "mock workflow"
        }
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
        messages=[
            ChatMessageTool(content='{"test": "payload"}', tool_call_id="call_1")
        ],
        output=ModelOutput(
            model="mock/model", 
            choices=[ChatCompletionChoice(message=ChatMessageAssistant(content="old content"))]
        )
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
