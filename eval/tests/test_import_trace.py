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

"""Unit tests for bin/import_trace.py and bin/expand_cases.py."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
from typing import Any

import jsonschema
import pytest
import yaml

# Add bin directory to path to import the CLI modules.
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../bin")))
import expand_cases  # noqa: E402
import import_trace  # noqa: E402

SCHEMA = json.loads(
    (Path(__file__).parent.parent / "datasets" / "dataset_schema.json").read_text()
)

GOLDEN_PAYLOAD = (
    "<a2ui-json>"
    + json.dumps([
        {
            "version": "1.0",
            "createSurface": {"surfaceId": "main", "catalogId": "basic"},
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "main",
                "components": [
                    {
                        "id": "root",
                        "component": "Column",
                        "children": ["name", "go"],
                    },
                    {
                        "id": "name",
                        "component": "TextField",
                        "value": {"path": "/form/name"},
                    },
                    {
                        "id": "go",
                        "component": "Button",
                        "action": {"event": {"name": "submit_form"}},
                    },
                ],
            },
        },
    ])
    + "</a2ui-json>"
)

CHAT_TRACE: list[dict[str, Any]] = [
    {"role": "system", "content": "You are a helpful form assistant."},
    {"role": "user", "content": "Look up my profile first."},
    {
        "role": "assistant",
        "content": None,
        "tool_calls": [{
            "id": "call_1",
            "type": "function",
            "function": {"name": "get_profile", "arguments": '{"user": "u1"}'},
        }],
    },
    {"role": "tool", "tool_call_id": "call_1", "content": '{"name": "Ada"}'},
    {"role": "user", "content": "Now build me a form to edit my name."},
    {"role": "assistant", "content": "Here you go: " + GOLDEN_PAYLOAD},
]

ADK_TRACE: dict[str, Any] = {
    "events": [
        {
            "author": "user",
            "content": {"role": "user", "parts": [{"text": "Show my orders."}]},
        },
        {
            "author": "shop_agent",
            "content": {
                "role": "model",
                "parts": [{
                    "functionCall": {
                        "id": "fc_1",
                        "name": "list_orders",
                        "args": {"limit": 5},
                    }
                }],
            },
        },
        {
            "author": "shop_agent",
            "content": {
                "role": "user",
                "parts": [{
                    "functionResponse": {
                        "id": "fc_1",
                        "name": "list_orders",
                        "response": {"orders": ["o1"]},
                    }
                }],
            },
        },
        {
            "author": "user",
            "content": {
                "role": "user",
                "parts": [{"text": "Render them as a list."}],
            },
        },
        {
            "author": "shop_agent",
            "content": {"role": "model", "parts": [{"text": GOLDEN_PAYLOAD}]},
        },
    ]
}


def _write_json(tmp_path: Path, name: str, data: Any) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _import_args(input_path: Path, output: Path, **extra: str) -> list[str]:
    args = [
        "--input",
        str(input_path),
        "--output",
        str(output),
        "--name",
        "case_a",
    ]
    for key, value in extra.items():
        args += [f"--{key.replace('_', '-')}", value]
    return args


# --------------------------------------------------------------------------- #
# import_trace
# --------------------------------------------------------------------------- #


def test_chat_trace_import_builds_schema_valid_entry(tmp_path: Path) -> None:
    trace = _write_json(tmp_path, "trace.json", CHAT_TRACE)
    output = tmp_path / "out.yaml"
    assert import_trace.main(_import_args(trace, output, tags="smoke,real")) == 0

    entries = yaml.safe_load(output.read_text())
    jsonschema.validate(entries, SCHEMA)
    assert len(entries) == 1
    entry = entries[0]
    assert entry["name"] == "case_a"
    assert entry["dataset"] == "out"
    assert entry["system_prompt"] == "You are a helpful form assistant."
    assert entry["tags"] == ["smoke", "real"]
    # The golden assistant answer is cut; the last message is the final user turn.
    assert [m["role"] for m in entry["messages"]] == [
        "user",
        "assistant",
        "tool",
        "user",
    ]
    assert entry["messages"][-1]["content"] == "Now build me a form to edit my name."
    # OpenAI-style tool calls are flattened to the dataset shape.
    assert entry["messages"][1]["tool_calls"] == [{
        "id": "call_1",
        "type": "function",
        "function": "get_profile",
        "arguments": {"user": "u1"},
    }]
    assert entry["assertions"] == {
        "required_components": ["Button", "Column", "TextField"],
        "required_bindings": ["/form/name"],
        "required_actions": ["submit_form"],
    }
    assert entry["target"] == entry["description"]


def test_adk_event_trace_maps_tool_calls_and_responses(tmp_path: Path) -> None:
    trace = _write_json(tmp_path, "events.json", ADK_TRACE)
    output = tmp_path / "out.yaml"
    assert import_trace.main(_import_args(trace, output)) == 0

    entry = yaml.safe_load(output.read_text())[0]
    jsonschema.validate([entry], SCHEMA)
    assert entry["messages"] == [
        {"role": "user", "content": "Show my orders."},
        {
            "role": "assistant",
            "tool_calls": [{
                "id": "fc_1",
                "type": "function",
                "function": "list_orders",
                "arguments": {"limit": 5},
            }],
        },
        {
            "role": "tool",
            "content": '{"orders": ["o1"]}',
            "tool_call_id": "fc_1",
            "function": "list_orders",
        },
        {"role": "user", "content": "Render them as a list."},
    ]
    assert "system_prompt" not in entry
    assert entry["assertions"]["required_components"] == [
        "Button",
        "Column",
        "TextField",
    ]


def test_adk_event_trace_preserves_string_function_response(
    tmp_path: Path,
) -> None:
    trace_with_str = json.loads(json.dumps(ADK_TRACE))
    trace_with_str["events"][2]["content"]["parts"][0]["functionResponse"][
        "response"
    ] = '{"orders": ["o1"]}'
    trace = _write_json(tmp_path, "events_str.json", trace_with_str)
    output = tmp_path / "out.yaml"
    assert import_trace.main(_import_args(trace, output)) == 0
    entry = yaml.safe_load(output.read_text())[0]
    assert entry["messages"][2]["content"] == '{"orders": ["o1"]}'


def test_sanitize_messages_redacts_secrets_and_pii() -> None:
    messages = [
        {
            "role": "system",
            "content": "Contact ada@example.com or +1 555-123-4567.",
        },
        {
            "role": "assistant",
            "tool_calls": [{
                "id": "c1",
                "function": "fetch",
                "arguments": {
                    "headers": {
                        "Authorization": "Bearer abcDEF123456789.xyz",
                    },
                    "key": "AIzaSyA1234567890abcdefghijklmnopqrstu",
                    "note": "Flight UA100 departs at 08:00 on 2026-10-12.",
                },
            }],
        },
    ]
    redacted = import_trace.sanitize_messages(messages)

    assert redacted[0]["content"] == "Contact [REDACTED_EMAIL] or [REDACTED_PHONE]."
    arguments = redacted[1]["tool_calls"][0]["arguments"]
    assert arguments["headers"]["Authorization"] == "Bearer [REDACTED_TOKEN]"
    assert arguments["key"] == "[REDACTED_API_KEY]"
    assert arguments["note"] == "Flight UA100 departs at 08:00 on 2026-10-12."
    # The input is left untouched.
    assert messages[0]["content"].startswith("Contact ada@example.com")


def test_no_sanitize_keeps_text(tmp_path: Path) -> None:
    trace = [
        {"role": "user", "content": "Mail ada@example.com a form."},
        {"role": "assistant", "content": GOLDEN_PAYLOAD},
    ]
    path = _write_json(tmp_path, "trace.json", trace)
    output = tmp_path / "out.yaml"
    assert import_trace.main(_import_args(path, output) + ["--no-sanitize"]) == 0
    entry = yaml.safe_load(output.read_text())[0]
    assert entry["messages"][0]["content"] == "Mail ada@example.com a form."


def test_eval_log_import(tmp_path: Path) -> None:
    try:
        from inspect_ai.log import (
            EvalConfig,
            EvalDataset,
            EvalLog,
            EvalSample,
            EvalSpec,
            write_eval_log,
        )
        from inspect_ai.model import (
            ChatMessageAssistant,
            ChatMessageSystem,
            ChatMessageTool,
            ChatMessageUser,
        )
        from inspect_ai.tool import ToolCall
    except ImportError as error:  # pragma: no cover - depends on inspect_ai version
        pytest.skip(f"inspect_ai log API unavailable: {error}")

    messages = [
        ChatMessageSystem(content="Be brief."),
        ChatMessageUser(content="Fetch it."),
        ChatMessageAssistant(
            content="",
            tool_calls=[ToolCall(id="c1", function="fetch", arguments={"a": 1})],
        ),
        ChatMessageTool(content="ok", tool_call_id="c1", function="fetch"),
        ChatMessageUser(content="Make the UI."),
        ChatMessageAssistant(content=GOLDEN_PAYLOAD),
    ]
    log = EvalLog(
        eval=EvalSpec(
            created=datetime.now(timezone.utc).isoformat(),
            task="a2ui_eval",
            dataset=EvalDataset(),
            model="mockllm/model",
            config=EvalConfig(),
        ),
        samples=[
            EvalSample(id="s0", epoch=1, input="x", target="y", messages=[]),
            EvalSample(id="s1", epoch=1, input="x", target="y", messages=messages),
        ],
    )
    log_path = tmp_path / "run.eval"
    write_eval_log(log, str(log_path))

    output = tmp_path / "out.yaml"
    assert import_trace.main(_import_args(log_path, output, sample_id="s1")) == 0
    entry = yaml.safe_load(output.read_text())[0]
    jsonschema.validate([entry], SCHEMA)
    assert entry["system_prompt"] == "Be brief."
    assert [m["role"] for m in entry["messages"]] == [
        "user",
        "assistant",
        "tool",
        "user",
    ]
    assert entry["messages"][1]["tool_calls"][0]["function"] == "fetch"
    assert entry["messages"][2]["tool_call_id"] == "c1"
    assert entry["assertions"]["required_bindings"] == ["/form/name"]


def test_append_same_name_requires_force(tmp_path: Path, capsys: Any) -> None:
    trace = _write_json(tmp_path, "trace.json", CHAT_TRACE)
    output = tmp_path / "out.yaml"
    assert import_trace.main(_import_args(trace, output)) == 0
    assert import_trace.main(_import_args(trace, output)) == 1
    assert "pass --force" in capsys.readouterr().err
    assert len(yaml.safe_load(output.read_text())) == 1

    assert import_trace.main(_import_args(trace, output) + ["--force"]) == 0
    assert len(yaml.safe_load(output.read_text())) == 1


def test_import_dry_run_writes_nothing(tmp_path: Path, capsys: Any) -> None:
    trace = _write_json(tmp_path, "trace.json", CHAT_TRACE)
    output = tmp_path / "out.yaml"
    assert import_trace.main(_import_args(trace, output) + ["--dry-run"]) == 0
    assert not output.exists()
    printed = yaml.safe_load(capsys.readouterr().out)
    jsonschema.validate(printed, SCHEMA)
    assert printed[0]["name"] == "case_a"


def test_import_refuses_unencrypted_repo_location(tmp_path: Path) -> None:
    trace = _write_json(tmp_path, "trace.json", CHAT_TRACE)
    output = import_trace.EVAL_ROOT / "examples" / "should_not_exist.yaml"
    assert import_trace.main(_import_args(trace, output)) == 1
    assert not output.exists()


def test_import_without_golden_payload_has_no_assertions(
    tmp_path: Path,
) -> None:
    trace = [{"role": "user", "content": "Build a form."}]
    path = _write_json(tmp_path, "trace.json", trace)
    output = tmp_path / "out.yaml"
    assert import_trace.main(_import_args(path, output)) == 0
    entry = yaml.safe_load(output.read_text())[0]
    assert "assertions" not in entry
    assert entry["messages"] == [{"role": "user", "content": "Build a form."}]


def test_derive_assertions_extracts_nested_data_model_paths() -> None:
    payload = [
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": "basic",
                "dataModel": {"user": {"email": "ada@example.com"}},
            },
        },
        {
            "version": "1.0",
            "updateDataModel": {
                "surfaceId": "main",
                "path": "/",
                "value": {"form": {"name": "Ada"}},
            },
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "main",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": {"path": "/user/email"},
                }],
            },
        },
    ]
    assertions = import_trace.derive_assertions(payload)
    assert assertions == {
        "required_components": ["Text"],
        "required_bindings": [
            "/",
            "/form",
            "/form/name",
            "/user",
            "/user/email",
        ],
    }


# --------------------------------------------------------------------------- #
# expand_cases
# --------------------------------------------------------------------------- #

BASE_SAMPLES: list[dict[str, Any]] = [
    {
        "name": "form",
        "dataset": "core_v1_0",
        "description": "A form.",
        "catalog": "specification/{version}/catalogs/basic/catalog.json",
        "messages": [{"role": "user", "content": "Build a form."}],
        "tags": ["smoke"],
        "assertions": {"required_components": ["TextField", "Button"]},
    },
    {
        "name": "plain",
        "dataset": "core_v1_0",
        "description": "No assertions.",
        "catalog": "specification/{version}/catalogs/basic/catalog.json",
        "promptText": "Say hello.",
    },
]


def _write_dataset(tmp_path: Path, name: str = "core_v1_0.yaml") -> Path:
    path = tmp_path / name
    path.write_text(yaml.safe_dump(BASE_SAMPLES, sort_keys=False), encoding="utf-8")
    return path


def test_expand_cases_produces_all_mutations(tmp_path: Path) -> None:
    source = _write_dataset(tmp_path)
    output = tmp_path / "expanded_v1_0.yaml"
    args = [
        "--input",
        str(source),
        "--output",
        str(output),
        "--mutations",
        "multi_catalog,pruned,stateful_update",
    ]
    assert expand_cases.main(args) == 0

    entries = yaml.safe_load(output.read_text())
    jsonschema.validate(entries, SCHEMA)
    by_name = {entry["name"]: entry for entry in entries}
    # `pruned` is skipped for the sample without required_components.
    assert sorted(by_name) == [
        "form__multi_catalog",
        "form__pruned",
        "form__stateful_update",
        "plain__multi_catalog",
        "plain__stateful_update",
    ]

    multi = by_name["form__multi_catalog"]
    assert "catalog" not in multi
    assert multi["catalogs"] == [
        {"path": "specification/{version}/catalogs/basic/catalog.json"},
        {"path": "catalogs/mcp/v1/catalog.json"},
    ]
    assert multi["tags"] == ["smoke", "multi_catalog"]
    assert multi["assertions"]["catalog_ids"] == [
        "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    ]
    assert multi["assertions"]["required_components"] == ["TextField", "Button"]
    # A sample without assertions gains none.
    assert "assertions" not in by_name["plain__multi_catalog"]

    pruned = by_name["form__pruned"]
    assert pruned["catalogs"][0]["allowed_components"] == [
        "Button",
        "Card",
        "Column",
        "Row",
        "Text",
        "TextField",
    ]
    assert pruned["tags"] == ["smoke", "pruned"]

    stateful = by_name["form__stateful_update"]
    assert stateful["tags"] == ["smoke", "stateful"]
    assert stateful["allowed_messages"] == ["updateComponents", "updateDataModel"]
    assert stateful["messages"][-1]["content"] == expand_cases.FOLLOW_UP_PROMPT
    assert stateful["messages"][0]["content"] == "Build a form."
    create, update = stateful["initial_state"]
    assert create["version"] == "1.0"
    assert create["createSurface"]["surfaceId"] == "main"
    assert create["createSurface"]["catalogId"].endswith(
        "v1_0/catalogs/basic/catalog.json"
    )
    components = update["updateComponents"]["components"]
    assert [c["component"] for c in components] == ["Column", "Text"]
    # promptText is migrated into messages before appending the follow-up.
    plain_stateful = by_name["plain__stateful_update"]
    assert "promptText" not in plain_stateful
    assert [m["content"] for m in plain_stateful["messages"]] == [
        "Say hello.",
        expand_cases.FOLLOW_UP_PROMPT,
    ]


def test_expand_cases_uses_v0_9_catalogs_for_v0_9_1_inputs(
    tmp_path: Path,
) -> None:
    source = _write_dataset(tmp_path, "core_v0_9_1.yaml")
    output = tmp_path / "expanded.yaml"
    args = [
        "--input",
        str(source),
        "--output",
        str(output),
        "--mutations",
        "multi_catalog,stateful_update",
        "--names",
        "form",
    ]
    assert expand_cases.main(args) == 0
    entries = yaml.safe_load(output.read_text())
    assert [e["name"] for e in entries] == [
        "form__multi_catalog",
        "form__stateful_update",
    ]
    assert entries[0]["catalogs"][1]["path"] == expand_cases.MCP_CATALOG_V0_9
    assert entries[1]["initial_state"][0]["version"] == "v0.9.1"


def test_expand_cases_dry_run_writes_nothing(tmp_path: Path, capsys: Any) -> None:
    source = _write_dataset(tmp_path)
    output = tmp_path / "expanded.yaml"
    args = [
        "--input",
        str(source),
        "--output",
        str(output),
        "--mutations",
        "pruned",
    ]
    assert expand_cases.main(args + ["--dry-run"]) == 0
    assert not output.exists()
    printed = yaml.safe_load(capsys.readouterr().out)
    jsonschema.validate(printed, SCHEMA)
    assert [e["name"] for e in printed] == ["form__pruned"]


def test_expand_cases_rejects_unknown_mutation(tmp_path: Path, capsys: Any) -> None:
    source = _write_dataset(tmp_path)
    args = ["--input", str(source), "--output", str(tmp_path / "x.yaml")]
    assert expand_cases.main(args + ["--mutations", "bogus"]) == 1
    assert "Unknown mutation" in capsys.readouterr().err


@pytest.mark.parametrize(
    "module, error",
    [
        (import_trace, import_trace.TraceImportError),
        (expand_cases, expand_cases.ExpandError),
    ],
)
def test_check_output_location_requires_yaml_under_datasets(
    module: Any, error: type[Exception], tmp_path: Path
) -> None:
    """In-repository outputs must be files that transcrypt encrypts."""
    module.check_output_location(module.DATASETS_DIR / "cases.yaml")
    module.check_output_location(tmp_path / "cases.yml")
    for rejected in (
        module.DATASETS_DIR / "cases.yml",
        module.REPO_ROOT / "eval" / "cases.yaml",
    ):
        with pytest.raises(error, match=r"must be \.yaml files"):
            module.check_output_location(rejected)
