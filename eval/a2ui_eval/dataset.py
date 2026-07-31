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

"""Dataset loader for A2UI evaluation."""

import json
from pathlib import Path
from typing import Any

import jsonschema
import yaml
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.model import (
    ChatMessage,
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageTool,
    ChatMessageUser,
)
from inspect_ai.tool import ToolCall

from a2ui_eval.shared.utils import GIT_ROOT
from datasets.defaults import (
    DEFAULT_CATALOG_PATH,
    DEFAULT_ROLE_DESCRIPTION,
    DEFAULT_WORKFLOW_DESCRIPTION,
    FORMAT_AGNOSTIC_ROLE_DESCRIPTION,
    FORMAT_AGNOSTIC_WORKFLOW_DESCRIPTION,
)

SCHEMA_PATH = GIT_ROOT / "eval" / "datasets" / "dataset_schema.json"
DATASETS_DIR = GIT_ROOT / "eval" / "datasets"


def _version_to_dir_name(version: str) -> str:
    """Converts a version string (e.g., '0.9.1') to a directory name (e.g., 'v0_9_1')."""
    return "v" + version.replace(".", "_")


def _parse_tool_calls(
    raw_tool_calls: list[dict[str, Any]] | None,
) -> list[ToolCall] | None:
    """Converts raw tool calls in native Inspect AI format into ToolCall objects."""
    if not raw_tool_calls:
        return None
    parsed = []
    for tc in raw_tool_calls:
        func_name = tc.get("function")
        if isinstance(func_name, dict):
            func_args = func_name.get("arguments", {})
            func_name = str(func_name.get("name", ""))
        else:
            func_name = str(func_name or "")
            func_args = tc.get("arguments", {})

        if isinstance(func_args, str):
            try:
                func_args = json.loads(func_args)
            except (json.JSONDecodeError, TypeError):
                # If it's not a valid JSON string, treat it as a raw string argument.
                pass

        parsed.append(
            ToolCall(
                id=str(tc.get("id", "")),
                function=func_name,
                arguments=func_args,
                type=tc.get("type", "function"),
            )
        )
    return parsed


def _parse_messages(item: dict[str, Any]) -> list[ChatMessage]:
    """Parses a sample's messages list or promptText into Inspect AI ChatMessage objects."""
    messages_raw = item.get("messages")
    if messages_raw:
        parsed: list[ChatMessage] = []
        call_id_to_func: dict[str, str] = {}
        for m in messages_raw:
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "user":
                parsed.append(ChatMessageUser(content=content))
            elif role == "assistant":
                tool_calls = _parse_tool_calls(m.get("tool_calls"))
                if tool_calls:
                    for tc in tool_calls:
                        if tc.id and tc.function:
                            call_id_to_func[tc.id] = tc.function
                parsed.append(
                    ChatMessageAssistant(
                        content=content,
                        tool_calls=tool_calls,
                    )
                )
            elif role == "tool":
                call_id = m.get("tool_call_id", "")
                func_name = (
                    m.get("function")
                    or m.get("name")
                    or call_id_to_func.get(call_id, "tool_response")
                )
                parsed.append(
                    ChatMessageTool(
                        content=content,
                        tool_call_id=call_id,
                        function=func_name,
                    )
                )
            elif role == "system":
                parsed.append(ChatMessageSystem(content=content))
            else:
                parsed.append(ChatMessageUser(content=content))
        return parsed
    elif "promptText" in item:
        return [ChatMessageUser(content=item["promptText"])]
    else:
        raise ValueError(
            f"Sample {item.get('name')} must specify 'messages' or 'promptText'."
        )


def load_a2ui_dataset(
    file_path: str | Path | None = None,
    dataset: str | list[str] | None = None,
    default_catalog_path: str | None = None,
    version: str | None = None,
    format_name: str | None = None,
) -> MemoryDataset:
    """Loads A2UI evaluation samples from YAML dataset files."""
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema = json.load(f)

    filter_names = None
    if dataset:
        if isinstance(dataset, str):
            filter_names = [d.strip() for d in dataset.split(",") if d.strip()]
        else:
            filter_names = list(dataset)

    target_files: list[Path] = []
    if file_path:
        p = Path(file_path)
        if not p.is_absolute():
            p = (DATASETS_DIR / p).resolve() if not p.exists() else p.resolve()
        if not p.exists():
            raise FileNotFoundError(f"Dataset file not found: {p}")
        target_files.append(p)
    else:
        for yaml_file in sorted(DATASETS_DIR.glob("*.yaml")):
            target_files.append(yaml_file)

    is_json = format_name is None or format_name in ("direct_json", "json", "transport")
    samples: list[Sample] = []

    for target_file in target_files:
        with open(target_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or []

        jsonschema.validate(instance=data, schema=schema)
        inferred_dataset = target_file.stem

        for item in data:
            item_dataset = item.get("dataset") or inferred_dataset
            if filter_names and item_dataset not in filter_names:
                continue

            # Skip datasets specifically targeted at another protocol version if version is set
            if version == "0.9.1" and (
                item_dataset.endswith("v1_0") or item_dataset == "core_v1_0"
            ):
                continue
            if version == "1.0" and (
                item_dataset.endswith("v0_9_1") or item_dataset == "core_v0_9_1"
            ):
                continue

            catalog_path = (
                item.get("catalog") or default_catalog_path or DEFAULT_CATALOG_PATH
            )
            if version and catalog_path:
                catalog_path = catalog_path.replace(
                    "{version}", _version_to_dir_name(version)
                )

            default_role = (
                DEFAULT_ROLE_DESCRIPTION
                if is_json
                else FORMAT_AGNOSTIC_ROLE_DESCRIPTION
            )
            default_workflow = (
                DEFAULT_WORKFLOW_DESCRIPTION
                if is_json
                else FORMAT_AGNOSTIC_WORKFLOW_DESCRIPTION
            )

            protocol_role = (
                item.get("protocol_role")
                or item.get("role_description")
                or default_role
            )
            generation_rules = (
                item.get("generation_rules")
                or item.get("workflow_description")
                or default_workflow
            )

            chat_messages = _parse_messages(item)

            sample_id = (
                f"{item_dataset}_{item.get('name')}"
                if item.get("name")
                else str(len(samples))
            )

            samples.append(
                Sample(
                    id=sample_id,
                    input=chat_messages,
                    target=item.get("target") or item["description"],
                    metadata={
                        "name": item.get("name"),
                        "dataset": item_dataset,
                        "description": item["description"],
                        "catalog": catalog_path,
                        "system_prompt": item.get("system_prompt", ""),
                        "protocol_role": protocol_role,
                        "generation_rules": generation_rules,
                        "role_description": protocol_role,
                        "workflow_description": generation_rules,
                        "allowed_surface_ids": (
                            item.get("allowed_surface_ids") or ["main"]
                        ),
                    },
                )
            )

    return MemoryDataset(samples=samples)
