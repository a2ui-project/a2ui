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

"""Tests for `RunnerOptions` handling in the Python evaluation runner.

These run against the real Python SDK and make no model calls.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import textwrap
from typing import Any

import pytest

from a2ui_eval.runner import (
    CatalogSpec,
    RunnerOptions,
    build_catalogs_and_examples,
    generate_prompt,
    get_python_strategy,
    parse_and_validate,
    parse_and_validate_in_process,
)
from a2ui_eval.shared.utils import GIT_ROOT

V10_CATALOG = str(GIT_ROOT / "catalogs" / "basic" / "v1" / "catalog.json")
V10_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
MCP_CATALOG = str(GIT_ROOT / "catalogs" / "mcp" / "v1" / "catalog.json")
MCP_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json"

EXAMPLE_MARKER = "zebra-example-marker"
EXAMPLE_PAYLOAD: list[dict[str, Any]] = [
    {"createSurface": {"surfaceId": "main", "catalogId": V10_CATALOG_ID}},
    {
        "updateComponents": {
            "surfaceId": "main",
            "components": [{"id": "root", "component": "Text", "text": EXAMPLE_MARKER}],
        }
    },
]

# A complete renderer state: one surface holding a single Text.
INITIAL_STATE: tuple[dict[str, Any], ...] = (
    {
        "version": "v1.0",
        "createSurface": {"surfaceId": "main", "catalogId": V10_CATALOG_ID},
    },
    {
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "main",
            "components": [{"id": "root", "component": "Text", "text": "hi"}],
        },
    },
)


def _update_data_model_completion(surface_id: str = "main") -> str:
    message = {
        "version": "v1.0",
        "updateDataModel": {"surfaceId": surface_id, "path": "/x", "value": 1},
    }
    return f"<a2ui-json>{json.dumps([message])}</a2ui-json>"


@pytest.fixture(name="example_file")
def example_file_fixture(tmp_path: Path) -> str:
    path = tmp_path / "example.json"
    path.write_text(json.dumps(EXAMPLE_PAYLOAD), encoding="utf-8")
    return str(path)


@pytest.mark.parametrize("format_name", ["direct_json", "express"])
def test_pruning_removes_component_from_prompt(format_name: str) -> None:
    full = generate_prompt(format_name, "1.0", V10_CATALOG)
    pruned = generate_prompt(
        format_name,
        "1.0",
        V10_CATALOG,
        options=RunnerOptions(
            catalogs=(
                CatalogSpec(path=V10_CATALOG, allowed_components=("Text", "Column")),
            )
        ),
    )
    assert "Button" in full
    assert "Button" not in pruned
    assert "Text" in pruned


def test_function_pruning_removes_function_from_catalog() -> None:
    catalogs, _ = build_catalogs_and_examples(
        V10_CATALOG,
        "1.0",
        {"catalogs": [{"path": V10_CATALOG, "allowed_functions": ["required"]}]},
    )
    assert len(catalogs) == 1
    function_names = set(catalogs[0].functions)
    assert function_names == {"required"}


@pytest.mark.parametrize("format_name", ["direct_json", "express"])
def test_allowed_messages_changes_prompt(format_name: str) -> None:
    default = generate_prompt(format_name, "1.0", V10_CATALOG)
    restricted = generate_prompt(
        format_name,
        "1.0",
        V10_CATALOG,
        options=RunnerOptions(allowed_messages=("updateDataModel",)),
    )
    assert restricted != default
    if format_name == "direct_json":
        assert "updateDataModel" in restricted


@pytest.mark.parametrize("format_name", ["direct_json", "express"])
def test_example_file_appears_in_prompt(format_name: str, example_file: str) -> None:
    prompt = generate_prompt(
        format_name,
        "1.0",
        V10_CATALOG,
        options=RunnerOptions(
            catalogs=(CatalogSpec(path=V10_CATALOG, examples=(example_file,)),)
        ),
    )
    assert EXAMPLE_MARKER in prompt


def test_example_file_accepts_messages_object(tmp_path: Path) -> None:
    path = tmp_path / "wrapped.json"
    path.write_text(json.dumps({"messages": EXAMPLE_PAYLOAD}), encoding="utf-8")
    _, examples = build_catalogs_and_examples(
        V10_CATALOG,
        "1.0",
        {"catalogs": [{"path": V10_CATALOG, "examples": [str(path)]}]},
    )
    assert examples is not None
    assert len(examples) == 1
    assert len(examples[0]) == len(EXAMPLE_PAYLOAD)


def test_example_file_rejects_other_shapes(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({"not_messages": []}), encoding="utf-8")
    with pytest.raises(ValueError, match="JSON list of A2UI messages"):
        build_catalogs_and_examples(
            V10_CATALOG,
            "1.0",
            {"catalogs": [{"path": V10_CATALOG, "examples": [str(path)]}]},
        )


def test_no_options_gives_single_catalog_and_no_examples() -> None:
    catalogs, examples = build_catalogs_and_examples(V10_CATALOG, "1.0", None)
    assert [c.id for c in catalogs] == [V10_CATALOG_ID]
    assert examples is None


def test_multi_catalog_prompt_names_both_catalogs() -> None:
    prompt = generate_prompt(
        "direct_json",
        "1.0",
        V10_CATALOG,
        options=RunnerOptions(
            catalogs=(CatalogSpec(path=V10_CATALOG), CatalogSpec(path=MCP_CATALOG))
        ),
    )
    assert V10_CATALOG_ID in prompt
    assert MCP_CATALOG_ID in prompt


def test_get_python_strategy_accepts_catalog_list() -> None:
    catalogs, _ = build_catalogs_and_examples(V10_CATALOG, "1.0", None)
    strategy = get_python_strategy(
        "express", "1.0", catalogs, allowed_messages=["updateComponents"]
    )
    assert strategy.catalogs[0].id == V10_CATALOG_ID
    assert strategy.allowed_messages == ["updateComponents"]


def test_initial_renderer_state_lets_bare_update_validate() -> None:
    result = parse_and_validate_in_process(
        "direct_json",
        "1.0",
        V10_CATALOG,
        "main",
        _update_data_model_completion(),
        options={"initial_renderer_state": list(INITIAL_STATE)},
    )
    assert len(result["compiled_jsons"]) == 1
    assert "updateDataModel" in result["compiled_jsons"][0]


def test_bare_update_fails_without_initial_state() -> None:
    with pytest.raises(Exception, match="Surface not found"):
        parse_and_validate_in_process(
            "direct_json",
            "1.0",
            V10_CATALOG,
            "main",
            _update_data_model_completion(),
        )


def test_initial_renderer_state_rejects_unknown_surface() -> None:
    with pytest.raises(Exception, match="Surface not found"):
        parse_and_validate_in_process(
            "direct_json",
            "1.0",
            V10_CATALOG,
            "main",
            _update_data_model_completion(surface_id="nope"),
            options={"initial_renderer_state": list(INITIAL_STATE)},
        )


def test_initial_renderer_state_is_ignored_when_not_validating() -> None:
    result = parse_and_validate_in_process(
        "direct_json",
        "1.0",
        V10_CATALOG,
        "main",
        _update_data_model_completion(surface_id="nope"),
        validate=False,
        options={"initial_renderer_state": list(INITIAL_STATE)},
    )
    assert len(result["compiled_jsons"]) == 1


@pytest.mark.parametrize("chunk_size", [1, 3, 1000])
def test_stream_chunk_size_works_for_direct_json(chunk_size: int) -> None:
    result = parse_and_validate_in_process(
        "direct_json",
        "1.0",
        V10_CATALOG,
        "main",
        _update_data_model_completion(),
        options={
            "initial_renderer_state": list(INITIAL_STATE),
            "stream_chunk_size": chunk_size,
        },
    )
    assert len(result["compiled_jsons"]) == 1


def test_stream_chunk_size_rejects_non_positive() -> None:
    with pytest.raises(ValueError, match="stream_chunk_size"):
        parse_and_validate_in_process(
            "direct_json",
            "1.0",
            V10_CATALOG,
            "main",
            _update_data_model_completion(),
            validate=False,
            options={"stream_chunk_size": 0},
        )


def test_stream_chunk_size_is_skipped_for_non_streaming_format() -> None:
    result = parse_and_validate_in_process(
        "express",
        "1.0",
        V10_CATALOG,
        "main",
        '<a2ui>\nroot = Text("hello")\n</a2ui>',
        options={"stream_chunk_size": 2},
    )
    assert len(result["compiled_jsons"]) > 0


def test_worker_request_carries_options_dict_only_when_given() -> None:
    """The `options` key reaches the worker in `to_dict` form, or not at all."""
    script = textwrap.dedent("""
        import json, sys
        print(json.dumps({"ready": True}), flush=True)
        for line in sys.stdin:
            request = json.loads(line)
            print(json.dumps({"result": {"compiled_jsons": [], "parts": [request]}}), flush=True)
        """)
    worker_cmd = [sys.executable, "-c", script]
    options = RunnerOptions(
        catalogs=(CatalogSpec(path=V10_CATALOG, allowed_components=("Text",)),),
        allowed_messages=("updateDataModel",),
        initial_renderer_state=INITIAL_STATE,
        stream_chunk_size=7,
    )

    def request_for(opts: RunnerOptions | None) -> dict[str, Any]:
        return parse_and_validate(
            "direct_json",
            "1.0",
            V10_CATALOG,
            "main",
            "text",
            options=opts,
            worker_command=worker_cmd,
        )["parts"][0]

    assert "options" not in request_for(None)
    sent = request_for(options)["options"]
    assert sent == json.loads(json.dumps(options.to_dict()))
    assert RunnerOptions.from_dict(sent) == options


def test_worker_round_trip_carries_options() -> None:
    options = RunnerOptions(
        catalogs=(CatalogSpec(path=V10_CATALOG, allowed_components=("Text",)),),
        initial_renderer_state=INITIAL_STATE,
        stream_chunk_size=5,
    )
    result = parse_and_validate(
        "direct_json",
        "1.0",
        V10_CATALOG,
        "main",
        _update_data_model_completion(),
        options=options,
    )
    assert len(result["compiled_jsons"]) == 1

    # Without the seeded state the same turn must fail in the worker too.
    with pytest.raises(ValueError, match="Surface not found"):
        parse_and_validate(
            "direct_json",
            "1.0",
            V10_CATALOG,
            "main",
            _update_data_model_completion(),
        )


def test_worker_round_trip_applies_pruning() -> None:
    button_turn = [
        INITIAL_STATE[0],
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "main",
                "components": [
                    {
                        "id": "root",
                        "component": "Button",
                        "child": "label",
                        "action": {"event": {"name": "tap"}},
                    },
                    {"id": "label", "component": "Text", "text": "Go"},
                ],
            },
        },
    ]
    completion = f"<a2ui-json>{json.dumps(button_turn)}</a2ui-json>"
    assert parse_and_validate("direct_json", "1.0", V10_CATALOG, "main", completion)[
        "compiled_jsons"
    ]
    with pytest.raises(ValueError):
        parse_and_validate(
            "direct_json",
            "1.0",
            V10_CATALOG,
            "main",
            completion,
            options=RunnerOptions(
                catalogs=(CatalogSpec(path=V10_CATALOG, allowed_components=("Text",)),)
            ),
        )
