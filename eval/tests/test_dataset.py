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

"""Unit tests for dataset loading and tool call parsing."""

from pathlib import Path
import pytest
from inspect_ai.model import ChatMessageAssistant, ChatMessageTool, ChatMessageUser
from a2ui_eval.dataset import load_a2ui_dataset
from a2ui_eval.shared.utils import GIT_ROOT


def test_load_a2ui_dataset(tmp_path: Path) -> None:
    d = tmp_path / "sub"
    d.mkdir()
    p = d / "dummy_prompts.yaml"
    p.write_text("""
- name: testPrompt
  description: A test prompt.
  catalog: "specification/{version}/catalogs/basic/catalog.json"
  messages:
    - role: user
      content: "Test input"
""")

    dataset = load_a2ui_dataset(file_path=str(p))

    assert len(dataset) == 1
    assert len(dataset[0].input) == 1
    assert isinstance(dataset[0].input[0], ChatMessageUser)
    assert dataset[0].input[0].content == "Test input"
    assert dataset[0].target == "A test prompt."
    assert dataset[0].metadata is not None
    assert dataset[0].metadata["name"] == "testPrompt"


def test_load_a2ui_dataset_file_not_found() -> None:
    with pytest.raises(FileNotFoundError):
        load_a2ui_dataset(file_path="non_existent_file.yaml")


def test_load_a2ui_dataset_with_version(tmp_path: Path) -> None:
    d = tmp_path / "sub"
    d.mkdir()
    p = d / "dummy_prompts_with_version.yaml"
    p.write_text("""
- name: testPrompt
  description: A test prompt.
  catalog: "path/{version}/catalog.json"
  messages:
    - role: user
      content: "Test input"
""")

    dataset = load_a2ui_dataset(file_path=str(p), version="0.9.1")

    assert len(dataset) == 1
    assert dataset[0].metadata is not None
    assert dataset[0].metadata["catalog"] == "path/v0_9_1/catalog.json"


def test_load_a2ui_dataset_multi_turn(tmp_path: Path) -> None:
    d = tmp_path / "sub"
    d.mkdir()
    p = d / "dummy_multi_turn.yaml"
    p.write_text("""
- name: multiTurnPrompt
  dataset: customer_data
  description: A multi turn prompt with tool calls.
  catalog: "specification/v0_9_1/catalogs/basic/catalog.json"
  system_prompt: "Domain prompt"
  messages:
    - role: user
      content: "Lookup account 123"
    - role: assistant
      content: "Checking account"
      tool_calls:
        - id: call_1
          type: function
          function: lookup
          arguments:
            id: "123"
    - role: tool
      tool_call_id: call_1
      function: lookup
      content: '{"balance": 500}'
    - role: user
      content: "Render my balance card"
""")

    dataset = load_a2ui_dataset(file_path=str(p), dataset="customer_data")
    assert len(dataset) == 1
    assert len(dataset[0].input) == 4
    assert isinstance(dataset[0].input[0], ChatMessageUser)

    assistant = dataset[0].input[1]
    assert isinstance(assistant, ChatMessageAssistant)
    assert assistant.tool_calls is not None
    assert len(assistant.tool_calls) == 1
    assert assistant.tool_calls[0].id == "call_1"
    assert assistant.tool_calls[0].function == "lookup"
    assert assistant.tool_calls[0].arguments == {"id": "123"}

    tool_msg = dataset[0].input[2]
    assert isinstance(tool_msg, ChatMessageTool)
    assert tool_msg.tool_call_id == "call_1"
    assert tool_msg.function == "lookup"

    assert dataset[0].metadata is not None
    assert dataset[0].metadata["system_prompt"] == "Domain prompt"


def test_example_eval_case_schema_conformance() -> None:
    example_path = GIT_ROOT / "eval" / "examples" / "example_eval_case.json"
    dataset = load_a2ui_dataset(file_path=example_path)
    assert len(dataset) == 1
    assert len(dataset[0].input) == 5
    assert dataset[0].metadata is not None
    assert dataset[0].metadata["name"] == "flight_booking_multiturn_selection"
