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

"""Unit tests for dataset loading and tool call parsing."""

import json
from pathlib import Path

import jsonschema
import pytest
from inspect_ai.model import ChatMessageAssistant, ChatMessageTool, ChatMessageUser

from a2ui_eval.dataset import load_a2ui_dataset
from a2ui_eval.runner import (
    CatalogSpec,
    RunnerOptions,
    Stage2Assertions,
    runner_options_from_metadata,
)
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


def test_load_a2ui_dataset_maps_moved_catalog_path(tmp_path: Path) -> None:
    d = tmp_path / "sub"
    d.mkdir()
    p = d / "dummy_prompts_moved_catalog.yaml"
    p.write_text("""
- name: legacyPath
  description: Uses the pre-move v1.0 catalog location.
  catalog: "specification/{version}/catalogs/basic/catalog.json"
  messages:
    - role: user
      content: "Test input"
- name: currentPath
  description: Uses the current v1.0 catalog location.
  catalog: "catalogs/basic/v1/catalog.json"
  messages:
    - role: user
      content: "Test input"
""")

    dataset = load_a2ui_dataset(file_path=str(p), version="1.0")

    assert len(dataset) == 2
    for sample in dataset:
        assert sample.metadata is not None
        assert sample.metadata["catalog"] == "catalogs/basic/v1/catalog.json"


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


def _write_dataset(tmp_path: Path, name: str, text: str) -> Path:
    d = tmp_path / "sub"
    d.mkdir(exist_ok=True)
    p = d / name
    p.write_text(text)
    return p


def test_sample_metadata_records_protocol_version(tmp_path: Path) -> None:
    p = _write_dataset(
        tmp_path,
        "versioned.yaml",
        """
- name: versioned
  description: A test prompt.
  catalog: "catalogs/basic/v1/catalog.json"
  messages:
    - role: user
      content: "Test input"
""",
    )

    versioned = load_a2ui_dataset(file_path=str(p), version="1.0")
    unversioned = load_a2ui_dataset(file_path=str(p))

    assert versioned[0].metadata is not None
    assert versioned[0].metadata["version"] == "1.0"
    assert unversioned[0].metadata is not None
    assert unversioned[0].metadata["version"] is None


def test_single_catalog_sample_populates_catalog_specs(tmp_path: Path) -> None:
    p = _write_dataset(
        tmp_path,
        "single.yaml",
        """
- name: single
  description: Legacy single-catalog sample with examples.
  catalog: "specification/{version}/catalogs/basic/catalog.json"
  examples:
    - "samples/agent/node/restaurant_finder/examples/{version}/single_column_list.json"
  messages:
    - role: user
      content: "Test input"
""",
    )

    dataset = load_a2ui_dataset(file_path=str(p), version="1.0")

    meta = dataset[0].metadata
    assert meta is not None
    assert meta["catalog"] == "catalogs/basic/v1/catalog.json"
    assert meta["catalog_specs"] == [{
        "path": "catalogs/basic/v1/catalog.json",
        "catalog_id": None,
        "allowed_components": None,
        "allowed_functions": None,
        "examples": [
            "samples/agent/node/restaurant_finder/examples/v1_0/single_column_list.json"
        ],
    }]
    assert meta["allowed_messages"] is None
    assert meta["initial_state"] is None
    assert meta["stream_chunk_size"] is None
    assert meta["tags"] == []
    assert meta["assertions"] == {}


def test_multi_catalog_sample_keeps_order_and_pruning(tmp_path: Path) -> None:
    p = _write_dataset(
        tmp_path,
        "multi.yaml",
        """
- name: multi
  description: Two catalogs, the first pruned.
  catalogs:
    - path: "catalogs/basic/v1/catalog.json"
      allowed_components: [Column, Text, Button]
      allowed_functions: [required]
    - path: "catalogs/mcp/v1/catalog.json"
      catalog_id: "https://example.com/mcp"
  allowed_messages: [updateDataModel]
  initial_state:
    - createSurface:
        surfaceId: main
        catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
  stream_chunk_size: 64
  tags: [multi_catalog, pruned]
  assertions:
    required_components: [Button]
    required_bindings: ["/form/name"]
  messages:
    - role: user
      content: "Test input"
""",
    )

    dataset = load_a2ui_dataset(file_path=str(p))

    meta = dataset[0].metadata
    assert meta is not None
    assert meta["catalog"] == "catalogs/basic/v1/catalog.json"
    assert [s["path"] for s in meta["catalog_specs"]] == [
        "catalogs/basic/v1/catalog.json",
        "catalogs/mcp/v1/catalog.json",
    ]
    assert meta["catalog_specs"][0]["allowed_components"] == [
        "Column",
        "Text",
        "Button",
    ]
    assert meta["catalog_specs"][0]["allowed_functions"] == ["required"]
    assert meta["catalog_specs"][1]["catalog_id"] == "https://example.com/mcp"
    assert meta["allowed_messages"] == ["updateDataModel"]
    assert meta["initial_state"][0]["createSurface"]["surfaceId"] == "main"
    assert meta["stream_chunk_size"] == 64
    assert meta["tags"] == ["multi_catalog", "pruned"]
    assert meta["assertions"] == {
        "required_components": ["Button"],
        "required_bindings": ["/form/name"],
    }


def test_sample_without_catalog_or_catalogs_is_rejected(tmp_path: Path) -> None:
    p = _write_dataset(
        tmp_path,
        "bad.yaml",
        """
- name: bad
  description: Names no catalog.
  messages:
    - role: user
      content: "Test input"
""",
    )
    with pytest.raises(jsonschema.ValidationError):
        load_a2ui_dataset(file_path=str(p))


def test_tags_filter_keeps_matching_samples_only(tmp_path: Path) -> None:
    p = _write_dataset(
        tmp_path,
        "tagged.yaml",
        """
- name: smokeOne
  description: Tagged smoke.
  catalog: "catalogs/basic/v1/catalog.json"
  tags: [smoke]
  messages:
    - role: user
      content: "a"
- name: nightlyOnly
  description: Untagged.
  catalog: "catalogs/basic/v1/catalog.json"
  messages:
    - role: user
      content: "b"
- name: smokeTwo
  description: Tagged smoke and stateful.
  catalog: "catalogs/basic/v1/catalog.json"
  tags: [smoke, stateful]
  messages:
    - role: user
      content: "c"
""",
    )

    names = lambda ds: [s.metadata["name"] for s in ds if s.metadata]  # noqa: E731
    assert names(load_a2ui_dataset(file_path=str(p))) == [
        "smokeOne",
        "nightlyOnly",
        "smokeTwo",
    ]
    assert names(load_a2ui_dataset(file_path=str(p), tags="smoke")) == [
        "smokeOne",
        "smokeTwo",
    ]
    assert names(load_a2ui_dataset(file_path=str(p), tags=["stateful"])) == ["smokeTwo"]
    assert names(load_a2ui_dataset(file_path=str(p), tags="smoke,stateful")) == [
        "smokeOne",
        "smokeTwo",
    ]


def test_runner_options_from_metadata_defaults_to_resolved_catalog() -> None:
    options = runner_options_from_metadata({}, "/abs/catalog.json")
    assert options == RunnerOptions(catalogs=(CatalogSpec(path="/abs/catalog.json"),))
    assert options.allowed_messages is None
    assert options.initial_renderer_state is None
    assert options.stream_chunk_size is None


def test_runner_options_from_metadata_resolves_relative_paths(
    tmp_path: Path,
) -> None:
    metadata = {
        "catalog_specs": [
            {
                "path": "catalogs/basic/v1/catalog.json",
                "catalog_id": "basic",
                "allowed_components": ["Text"],
                "allowed_functions": None,
                "examples": ["examples/one.json", "/already/abs.json"],
            },
            {"path": "/abs/other.json"},
        ],
        "allowed_messages": ["updateDataModel"],
        "initial_state": [{"createSurface": {"surfaceId": "main"}}],
        "stream_chunk_size": 32,
    }

    options = runner_options_from_metadata(metadata, "/unused.json", repo_root=tmp_path)

    assert options.catalogs == (
        CatalogSpec(
            path=str(tmp_path / "catalogs/basic/v1/catalog.json"),
            catalog_id="basic",
            allowed_components=("Text",),
            allowed_functions=None,
            examples=(str(tmp_path / "examples/one.json"), "/already/abs.json"),
        ),
        CatalogSpec(path="/abs/other.json"),
    )
    assert options.allowed_messages == ("updateDataModel",)
    assert options.initial_renderer_state == ({"createSurface": {"surfaceId": "main"}},)
    assert options.stream_chunk_size == 32


def test_runner_options_round_trip_through_dict() -> None:
    options = RunnerOptions(
        catalogs=(
            CatalogSpec(path="/a.json", allowed_components=("Text",)),
            CatalogSpec(path="/b.json", catalog_id="b", examples=("/e.json",)),
        ),
        allowed_messages=("createSurface",),
        initial_renderer_state=({"createSurface": {"surfaceId": "main"}},),
        stream_chunk_size=8,
    )

    as_dict = options.to_dict()
    assert json.loads(json.dumps(as_dict)) == json.loads(options.cache_key())
    assert RunnerOptions.from_dict(json.loads(json.dumps(as_dict))) == options
    assert RunnerOptions.from_dict(None) == RunnerOptions()
    assert options.cache_key() != RunnerOptions().cache_key()


def test_stage2_assertions_from_mapping() -> None:
    assert Stage2Assertions.from_mapping(None).is_empty
    assert Stage2Assertions.from_mapping({}).is_empty
    parsed = Stage2Assertions.from_mapping(
        {"required_components": ["Button"], "catalog_ids": ["basic"]}
    )
    assert parsed.required_components == ("Button",)
    assert parsed.catalog_ids == ("basic",)
    assert parsed.required_bindings == ()
    assert not parsed.is_empty
