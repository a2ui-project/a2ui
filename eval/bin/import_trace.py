#!/usr/bin/env python3
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

"""Imports a real-world agent trace as an A2UI evaluation dataset entry.

Usage (from the `eval/` directory):

    uv run ./bin/import_trace.py --input <trace> --output datasets/<file>.yaml \\
        --name <case_name> [--dataset <name>] [--catalog <repo-relative path>] \\
        [--description <text>] [--tags smoke,real] [--sample-id <id>] \\
        [--no-sanitize] [--force] [--dry-run]

Three input formats are recognised from the file itself:

* An Inspect AI `.eval` log; one sample is imported (`--sample-id`, default
  the first).
* A JSON array of chat messages in OpenAI/Inspect style (`role`, `content`,
  `tool_calls`, `tool_call_id`), optionally wrapped as `{"messages": [...]}`.
* An ADK/A2A event trace: a JSON array (or `{"events": [...]}`) of events with
  `author`/`role` and `content.parts[]` carrying `text`, `functionCall` or
  `functionResponse` parts.

The system prompt becomes `system_prompt`, the conversation is cut after the
final user turn that precedes the golden assistant A2UI payload (the last
assistant message holding an `<a2ui-json>` or `<a2ui>` block), secrets and
personal data are redacted, and Stage 2 `assertions` are derived from the
golden payload when it is Direct JSON. The entry is checked against
`datasets/dataset_schema.json` and appended to the output YAML.

Output files must live under `eval/datasets/`, whose `.gitattributes` encrypts
every YAML file through transcrypt. The tool refuses to write a YAML file
anywhere else inside the repository.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import re
import sys
from typing import Any

import jsonschema
import yaml

EVAL_ROOT = Path(__file__).resolve().parent.parent
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))
from a2ui_eval.scorers import collect_payload_facts  # noqa: E402

REPO_ROOT = EVAL_ROOT.parent
DATASETS_DIR = EVAL_ROOT / "datasets"
SCHEMA_PATH = DATASETS_DIR / "dataset_schema.json"
DEFAULT_CATALOG = "specification/{version}/catalogs/basic/catalog.json"

_A2UI_BLOCK_RE = re.compile(
    r"<a2ui-json>(?P<json>.*?)</a2ui-json>|<a2ui>(?P<a2ui>.*?)</a2ui>",
    re.DOTALL,
)

# Order matters: the token patterns run before the email pattern so that a key
# embedded in an address-like string is still reported as a key.
_REDACTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"(?i)\bbearer\s+[A-Za-z0-9\-._~+/]{8,}=*"),
        "Bearer [REDACTED_TOKEN]",
    ),
    (re.compile(r"\bAIza[0-9A-Za-z\-_]{20,}"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"), "[REDACTED_API_KEY]"),
    (
        re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
        "[REDACTED_EMAIL]",
    ),
    (
        re.compile(
            r"(?<![\w/])(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w/])"
        ),
        "[REDACTED_PHONE]",
    ),
)


class TraceImportError(Exception):
    """Raised when the trace cannot be turned into a dataset entry."""


# --------------------------------------------------------------------------- #
# Sanitising
# --------------------------------------------------------------------------- #


def sanitize_text(text: str) -> str:
    """Redacts bearer tokens, API keys, emails and phone numbers in one string."""
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def _sanitize_value(value: Any) -> Any:
    """Recursively redacts every string inside nested dicts and lists."""
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _sanitize_value(item) for key, item in value.items()}
    return value


def sanitize_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Returns a redacted copy of chat messages, leaving the originals intact."""
    return [_sanitize_value(copy.deepcopy(message)) for message in messages]


# --------------------------------------------------------------------------- #
# Loading and normalising traces
# --------------------------------------------------------------------------- #


def _text_of(content: Any) -> str:
    """Flattens string, list-of-parts or None content into one string."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "\n".join(parts)
    return str(content)


def _parse_arguments(arguments: Any) -> dict[str, Any]:
    """Returns tool-call arguments as a dict, decoding JSON strings if needed."""
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str) and arguments.strip():
        try:
            decoded = json.loads(arguments)
        except ValueError:
            return {"raw": arguments}
        return decoded if isinstance(decoded, dict) else {"value": decoded}
    return {}


def _normalize_tool_call(call: dict[str, Any], index: int) -> dict[str, Any]:
    """Maps OpenAI and Inspect tool-call shapes to the dataset's shape."""
    function = call.get("function")
    if isinstance(function, dict):
        name = function.get("name", "")
        arguments = function.get("arguments")
    else:
        name = function or call.get("name", "")
        arguments = call.get("arguments")
    return {
        "id": str(call.get("id") or f"call_{index}"),
        "type": "function",
        "function": str(name),
        "arguments": _parse_arguments(arguments),
    }


def _normalize_assistant_message(message: dict[str, Any]) -> dict[str, Any]:
    """Keeps the optional content and tool calls of an assistant message."""
    result: dict[str, Any] = {"role": "assistant"}
    content = _text_of(message.get("content"))
    if content:
        result["content"] = content
    tool_calls = message.get("tool_calls") or []
    if tool_calls:
        result["tool_calls"] = [
            _normalize_tool_call(call, i) for i, call in enumerate(tool_calls)
        ]
    return result


def _normalize_chat_message(message: dict[str, Any], index: int) -> dict[str, Any]:
    """Keeps only the schema fields of one chat message."""
    role = message.get("role")
    if role not in ("system", "user", "assistant", "tool"):
        raise TraceImportError(f"Message {index} has unsupported role {role!r}.")
    if role == "assistant":
        return _normalize_assistant_message(message)
    result: dict[str, Any] = {
        "role": role,
        "content": _text_of(message.get("content")),
    }
    if role == "tool":
        result["tool_call_id"] = str(message.get("tool_call_id") or "")
        function = message.get("function") or message.get("name")
        if function:
            result["function"] = str(function)
    return result


def normalize_chat_messages(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Normalises a list of OpenAI/Inspect style chat messages."""
    return [_normalize_chat_message(m, i) for i, m in enumerate(messages)]


def _event_role(event: dict[str, Any]) -> str:
    """Infers the chat role of an ADK/A2A event."""
    author = str(event.get("author") or event.get("role") or "")
    content = event.get("content")
    if isinstance(content, dict) and content.get("role"):
        author = str(content["role"])
    if author.lower() in ("user", "human"):
        return "user"
    if author.lower() == "system":
        return "system"
    return "assistant"


def _event_parts(event: dict[str, Any]) -> list[dict[str, Any]]:
    """Returns the parts of an ADK/A2A event, whichever key holds them."""
    content = event.get("content")
    if isinstance(content, dict):
        parts = content.get("parts")
    else:
        parts = event.get("parts")
    return [part for part in parts or [] if isinstance(part, dict)]


def _convert_event(event: dict[str, Any], index: int) -> list[dict[str, Any]]:
    """Converts one ADK/A2A event into zero or more chat messages."""
    role = _event_role(event)
    texts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    tool_messages: list[dict[str, Any]] = []
    for part_index, part in enumerate(_event_parts(event)):
        call = part.get("functionCall")
        response = part.get("functionResponse")
        if isinstance(part.get("text"), str):
            texts.append(part["text"])
        elif isinstance(call, dict):
            call_id = str(call.get("id") or f"call_{index}_{part_index}")
            tool_calls.append({
                "id": call_id,
                "type": "function",
                "function": str(call.get("name", "")),
                "arguments": _parse_arguments(call.get("args")),
            })
        elif isinstance(response, dict):
            raw_resp = response.get("response")
            tool_messages.append({
                "role": "tool",
                "content": (
                    raw_resp
                    if isinstance(raw_resp, str)
                    else json.dumps(raw_resp, sort_keys=True)
                ),
                "tool_call_id": str(response.get("id") or ""),
                "function": str(response.get("name", "")),
            })
    return _assemble_event_messages(role, texts, tool_calls) + tool_messages


def _assemble_event_messages(
    role: str, texts: list[str], tool_calls: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Builds the text/tool-call message of an event, if it has one."""
    content = "\n".join(texts)
    if role != "assistant":
        return [{"role": role, "content": content}] if content else []
    message: dict[str, Any] = {"role": "assistant"}
    if content:
        message["content"] = content
    if tool_calls:
        message["tool_calls"] = tool_calls
    return [message] if len(message) > 1 else []


def _link_orphan_tool_responses(messages: list[dict[str, Any]]) -> None:
    """Fills missing `tool_call_id`s from the most recent call with that name."""
    pending: dict[str, list[str]] = {}
    for message in messages:
        if message["role"] == "assistant":
            for call in message.get("tool_calls", []):
                pending.setdefault(call["function"], []).append(call["id"])
        elif message["role"] == "tool" and not message.get("tool_call_id"):
            ids = pending.get(message.get("function", ""), [])
            message["tool_call_id"] = ids.pop(0) if ids else "call_unknown"


def convert_adk_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Maps ADK/A2A events to chat messages with tool calls and tool results."""
    messages: list[dict[str, Any]] = []
    for index, event in enumerate(events):
        messages.extend(_convert_event(event, index))
    _link_orphan_tool_responses(messages)
    return messages


def _looks_like_event(item: Any) -> bool:
    """True when a JSON object has the ADK/A2A event shape."""
    if not isinstance(item, dict):
        return False
    content = item.get("content")
    has_parts = isinstance(content, dict) and "parts" in content
    return "author" in item or has_parts or "parts" in item


def load_json_trace(path: Path) -> list[dict[str, Any]]:
    """Loads a chat-message array or an ADK/A2A event trace from JSON."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        if isinstance(data.get("events"), list):
            return convert_adk_events(data["events"])
        if isinstance(data.get("messages"), list):
            return normalize_chat_messages(data["messages"])
        raise TraceImportError(f"{path}: expected a JSON array or 'messages'/'events'.")
    if not isinstance(data, list) or not data:
        raise TraceImportError(f"{path}: expected a non-empty JSON array.")
    if any(_looks_like_event(item) for item in data):
        return convert_adk_events(data)
    return normalize_chat_messages(data)


def _inspect_message_to_dict(message: Any) -> dict[str, Any]:
    """Turns an Inspect AI ChatMessage into the plain dict shape."""
    result: dict[str, Any] = {"role": message.role, "content": message.text}
    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls:
        result["tool_calls"] = [
            {"id": call.id, "function": call.function, "arguments": call.arguments}
            for call in tool_calls
        ]
    if message.role == "tool":
        result["tool_call_id"] = getattr(message, "tool_call_id", None)
        result["function"] = getattr(message, "function", None)
    return result


def load_eval_log_trace(path: Path, sample_id: str | None) -> list[dict[str, Any]]:
    """Loads one sample's conversation from an Inspect AI `.eval` log."""
    from inspect_ai.log import read_eval_log

    log = read_eval_log(str(path))
    samples = log.samples or []
    if not samples:
        raise TraceImportError(f"{path}: the log holds no samples.")
    if sample_id is None:
        sample = samples[0]
    else:
        matches = [s for s in samples if str(s.id) == sample_id]
        if not matches:
            raise TraceImportError(f"{path}: no sample with id {sample_id!r}.")
        sample = matches[0]
    messages = [_inspect_message_to_dict(m) for m in sample.messages]
    return normalize_chat_messages(messages)


def load_trace(path: Path, sample_id: str | None = None) -> list[dict[str, Any]]:
    """Loads a trace in any supported format, detected from the file."""
    if path.suffix == ".eval":
        return load_eval_log_trace(path, sample_id)
    return load_json_trace(path)


# --------------------------------------------------------------------------- #
# Golden payload and assertions
# --------------------------------------------------------------------------- #


def extract_a2ui_block(text: str) -> str | None:
    """Returns the body of the last `<a2ui-json>`/`<a2ui>` block in `text`."""
    matches = list(_A2UI_BLOCK_RE.finditer(text))
    if not matches:
        return None
    last = matches[-1]
    body = last.group("json") if last.group("json") is not None else last.group("a2ui")
    return body.strip()


def find_golden_index(messages: list[dict[str, Any]]) -> int | None:
    """Index of the last assistant message that carries an A2UI payload."""
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if message["role"] != "assistant":
            continue
        if extract_a2ui_block(message.get("content") or "") is not None:
            return index
    return None


def parse_payload(block: str) -> list[dict[str, Any]] | None:
    """Parses a Direct JSON payload (object, array or JSON lines)."""
    try:
        data = json.loads(block)
    except ValueError:
        data = _parse_json_lines(block)
    if isinstance(data, dict):
        return [data]
    if isinstance(data, list) and all(isinstance(item, dict) for item in data):
        return data
    return None


def _parse_json_lines(block: str) -> list[dict[str, Any]] | None:
    """Parses newline-delimited JSON objects, or returns None."""
    items: list[dict[str, Any]] = []
    for line in block.splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except ValueError:
            return None
        if not isinstance(item, dict):
            return None
        items.append(item)
    return items or None


def derive_assertions(payload: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Builds Stage 2 assertions from a golden Direct JSON payload."""
    facts = collect_payload_facts(payload)
    assertions: dict[str, list[str]] = {}
    if facts.component_types:
        assertions["required_components"] = sorted(facts.component_types)
    if facts.bound_paths:
        assertions["required_bindings"] = sorted(facts.bound_paths)
    if facts.action_names:
        assertions["required_actions"] = sorted(facts.action_names)
    return assertions


# --------------------------------------------------------------------------- #
# Building the entry
# --------------------------------------------------------------------------- #


def split_system_prompt(
    messages: list[dict[str, Any]],
) -> tuple[str | None, list[dict[str, Any]]]:
    """Pulls system messages out of the conversation into one prompt string."""
    system_parts = [m["content"] for m in messages if m["role"] == "system"]
    remaining = [m for m in messages if m["role"] != "system"]
    system_prompt = "\n\n".join(part for part in system_parts if part) or None
    return system_prompt, remaining


def cut_at_final_user_turn(
    messages: list[dict[str, Any]], golden_index: int | None
) -> list[dict[str, Any]]:
    """Keeps the messages up to and including the last user turn.

    When a golden payload was found, the last user turn before it is used so
    that the golden answer itself never leaks into the prompt.
    """
    limit = golden_index if golden_index is not None else len(messages)
    for index in range(limit - 1, -1, -1):
        if messages[index]["role"] == "user":
            return messages[: index + 1]
    raise TraceImportError("The trace holds no user turn to evaluate.")


def build_entry(
    messages: list[dict[str, Any]],
    *,
    name: str,
    dataset: str,
    catalog: str,
    description: str | None,
    tags: list[str],
    sanitize: bool = True,
) -> dict[str, Any]:
    """Turns a normalised conversation into a schema-shaped dataset entry."""
    system_prompt, conversation = split_system_prompt(messages)
    golden_index = find_golden_index(conversation)
    kept = cut_at_final_user_turn(conversation, golden_index)
    if sanitize:
        kept = sanitize_messages(kept)
        system_prompt = sanitize_text(system_prompt) if system_prompt else None
    final_user = kept[-1]["content"]
    description = description or f"Imported trace: {final_user[:120]}"
    entry: dict[str, Any] = {
        "name": name,
        "dataset": dataset,
        "description": description,
        "catalog": catalog,
    }
    if system_prompt:
        entry["system_prompt"] = system_prompt
    entry["messages"] = kept
    entry["target"] = description
    if tags:
        entry["tags"] = tags
    assertions = _golden_assertions(conversation, golden_index)
    if assertions:
        entry["assertions"] = assertions
    return entry


def _golden_assertions(
    conversation: list[dict[str, Any]], golden_index: int | None
) -> dict[str, list[str]]:
    """Derives assertions from the golden message, or returns an empty dict."""
    if golden_index is None:
        return {}
    block = extract_a2ui_block(conversation[golden_index].get("content") or "")
    payload = parse_payload(block) if block else None
    return derive_assertions(payload) if payload else {}


def load_schema() -> dict[str, Any]:
    """Loads the dataset JSON schema."""
    schema: dict[str, Any] = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return schema


def validate_entries(entries: list[dict[str, Any]]) -> None:
    """Raises TraceImportError when the entries do not satisfy the dataset schema."""
    try:
        jsonschema.validate(entries, load_schema())
    except jsonschema.ValidationError as error:
        raise TraceImportError(
            f"Entry does not match dataset_schema.json: {error.message}"
        )


# --------------------------------------------------------------------------- #
# Writing YAML
# --------------------------------------------------------------------------- #


def check_output_location(output: Path) -> None:
    """Refuses dataset outputs in the repository that transcrypt won't encrypt.

    Only `eval/datasets/*.yaml` is encrypted by transcrypt (see
    `eval/datasets/.gitattributes`). A dataset written anywhere else in the
    repository, or with another extension such as `.yml`, would be committed
    in clear text.
    """
    resolved = output.resolve()
    inside_repo = REPO_ROOT.resolve() in resolved.parents
    inside_datasets = DATASETS_DIR.resolve() in resolved.parents
    if inside_repo and (not inside_datasets or resolved.suffix != ".yaml"):
        raise TraceImportError(
            f"Refusing to write {output}: dataset files inside the repository "
            f"must be .yaml files under {DATASETS_DIR} so transcrypt encrypts them."
        )


def dump_yaml(entries: list[dict[str, Any]]) -> str:
    """Serialises entries in the style of the existing dataset files."""
    return yaml.safe_dump(
        entries,
        sort_keys=False,
        allow_unicode=True,
        width=100,
        default_flow_style=False,
    )


def load_existing_entries(output: Path) -> list[dict[str, Any]]:
    """Reads the entries already in the output file, if any."""
    if not output.exists():
        return []
    data = yaml.safe_load(output.read_text(encoding="utf-8")) or []
    if not isinstance(data, list):
        raise TraceImportError(f"{output} does not hold a YAML list of entries.")
    return data


def append_entry(output: Path, entry: dict[str, Any], *, force: bool = False) -> None:
    """Appends (or with `force`, replaces) the entry in the output YAML file."""
    check_output_location(output)
    entries = load_existing_entries(output)
    existing = [
        i for i, item in enumerate(entries) if item.get("name") == entry["name"]
    ]
    if existing and not force:
        raise TraceImportError(
            f"{output} already has an entry named {entry['name']!r}; "
            "pass --force to replace it."
        )
    if existing:
        entries[existing[0]] = entry
    else:
        entries.append(entry)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(dump_yaml(entries), encoding="utf-8")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def parse_tags(value: str | None) -> list[str]:
    """Splits a comma-separated tag list, dropping blanks."""
    if not value:
        return []
    return [tag.strip() for tag in value.split(",") if tag.strip()]


def build_parser() -> argparse.ArgumentParser:
    """Defines the command line interface."""
    parser = argparse.ArgumentParser(
        description="Import an agent trace as an A2UI eval dataset entry."
    )
    parser.add_argument("--input", required=True, type=Path, help="Trace file.")
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="Dataset YAML to append to, e.g. datasets/real_world_v1_0.yaml.",
    )
    parser.add_argument("--name", required=True, help="Unique sample name.")
    parser.add_argument(
        "--dataset", help="Dataset name (default: the output file's stem)."
    )
    parser.add_argument(
        "--catalog",
        default=DEFAULT_CATALOG,
        help=f"Repo-relative catalog path (default: {DEFAULT_CATALOG}).",
    )
    parser.add_argument(
        "--description",
        help="What the sample tests; also used as the judge target.",
    )
    parser.add_argument("--tags", help="Comma-separated tags, e.g. smoke,real.")
    parser.add_argument(
        "--sample-id", help="Sample id to import from an Inspect AI .eval log."
    )
    parser.add_argument(
        "--no-sanitize", action="store_true", help="Skip secret/PII redaction."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an entry with the same name.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the entry instead of writing.",
    )
    return parser


def run(args: argparse.Namespace) -> int:
    """Executes the import and returns the process exit code."""
    messages = load_trace(args.input, args.sample_id)
    entry = build_entry(
        messages,
        name=args.name,
        dataset=args.dataset or args.output.stem,
        catalog=args.catalog,
        description=args.description,
        tags=parse_tags(args.tags),
        sanitize=not args.no_sanitize,
    )
    validate_entries([entry])
    if args.dry_run:
        sys.stdout.write(dump_yaml([entry]))
        return 0
    append_entry(args.output, entry, force=args.force)
    print(f"Appended {entry['name']!r} to {args.output}")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Parses the command line and runs the import."""
    args = build_parser().parse_args(argv)
    try:
        return run(args)
    except TraceImportError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
