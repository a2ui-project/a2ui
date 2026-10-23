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

"""Dataset loader for A2UI evaluation."""

from collections.abc import Sequence
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


# Catalogs that moved from `specification/<version>/catalogs/` to the top-level
# `catalogs/` directory. Dataset entries (including the encrypted ones) may still
# use the old location, so both spellings resolve to the same file.
_MOVED_CATALOG_PREFIXES = {
    "specification/v1_0/catalogs/basic/": "catalogs/basic/v1/",
}


def _resolve_catalog_path(catalog_path: str) -> str:
    """Maps legacy catalog locations to their current repository path."""
    for old_prefix, new_prefix in _MOVED_CATALOG_PREFIXES.items():
        if catalog_path.startswith(old_prefix):
            return new_prefix + catalog_path[len(old_prefix) :]
    return catalog_path


def _interpolate_version(path: str, version: str | None) -> str:
    """Fills the '{version}' placeholder and maps moved catalog locations."""
    if version:
        path = path.replace("{version}", _version_to_dir_name(version))
    return _resolve_catalog_path(path)


def _normalize_catalog_specs(
    item: dict[str, Any],
    version: str | None,
    default_catalog_path: str | None,
) -> list[dict[str, Any]]:
    """Returns the sample's catalogs as a uniform list of catalog spec dicts.

    A sample names its catalogs either with the legacy single `catalog` path
    (plus an optional top-level `examples` list) or with a `catalogs` array of
    objects. Both forms yield dicts with the keys `path`, `catalog_id`,
    `allowed_components`, `allowed_functions` and `examples`, with paths
    version-interpolated and relative to the repository root.
    """
    raw_specs = item.get("catalogs")
    if not raw_specs:
        raw_specs = [{
            "path": item.get("catalog") or default_catalog_path or DEFAULT_CATALOG_PATH,
            "examples": item.get("examples") or [],
        }]
    specs: list[dict[str, Any]] = []
    for raw in raw_specs:
        specs.append({
            "path": _interpolate_version(raw["path"], version),
            "catalog_id": raw.get("catalog_id"),
            "allowed_components": raw.get("allowed_components"),
            "allowed_functions": raw.get("allowed_functions"),
            "examples": [
                _interpolate_version(e, version) for e in raw.get("examples") or []
            ],
        })
    return specs


def _matches_tags(item: dict[str, Any], tags: list[str] | None) -> bool:
    """True when no tag filter is set or the item carries one of the tags."""
    if not tags:
        return True
    return bool(set(item.get("tags") or ()) & set(tags))


def _split_names(value: str | Sequence[str] | None) -> list[str] | None:
    """Splits a comma-separated string, or copies a sequence, into a name list."""
    if not value:
        return None
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return list(value)


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
    dataset: str | Sequence[str] | None = None,
    default_catalog_path: str | None = None,
    version: str | None = None,
    format_name: str | None = None,
    tags: str | Sequence[str] | None = None,
) -> MemoryDataset:
    """Loads A2UI evaluation samples from YAML dataset files.

    Args:
        file_path: One dataset file to load; defaults to every YAML file in
            `eval/datasets/`.
        dataset: Dataset name(s) to keep, as a list or comma-separated string.
        default_catalog_path: Catalog used by samples that name none.
        version: Protocol version that fills the '{version}' placeholder and
            drops the datasets targeted at another version.
        format_name: Inference format, which selects the default role and
            workflow descriptions.
        tags: Tag(s) a sample must carry to be kept, as a list or
            comma-separated string. None keeps every sample.
    """
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema = json.load(f)

    filter_names = _split_names(dataset)
    filter_tags = _split_names(tags)

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

    is_json = format_name is None or format_name == "direct_json"
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
            if not _matches_tags(item, filter_tags):
                continue

            catalog_specs = _normalize_catalog_specs(
                item, version, default_catalog_path
            )
            catalog_path = catalog_specs[0]["path"]

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
                        "version": version,
                        "catalog_specs": catalog_specs,
                        "allowed_messages": item.get("allowed_messages"),
                        "initial_state": item.get("initial_state"),
                        "stream_chunk_size": item.get("stream_chunk_size"),
                        "tags": list(item.get("tags") or []),
                        "assertions": item.get("assertions") or {},
                    },
                )
            )

    return MemoryDataset(samples=samples)
