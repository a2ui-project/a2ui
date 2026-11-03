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

"""Expands an A2UI eval dataset with deterministic variants of its samples.

Usage (from the `eval/` directory):

    uv run ./bin/expand_cases.py --input datasets/core_v1_0.yaml \\
        --output datasets/expanded_v1_0.yaml \\
        --mutations multi_catalog,pruned,stateful_update [--names a,b] [--dry-run]

No model is called. For each input sample and each requested mutation a new
entry named `<name>__<mutation>` is produced:

* `multi_catalog`: the sample's catalog becomes the first of two `catalogs`,
  the second being the MCP app catalog for the sample's protocol version. When
  the sample already carries `assertions`, `assertions.catalog_ids` pins the
  primary catalog id.
* `pruned`: the primary catalog is pruned to `assertions.required_components`
  plus the layout set (Column, Row, Card, Text, Button). Samples without
  `required_components` are skipped.
* `stateful_update`: `initial_state` seeds a surface with a heading, a
  follow-up user turn asks for an incremental update, and `allowed_messages`
  limits the answer to `updateComponents`/`updateDataModel`.

Output files must live under `eval/datasets/` (encrypted by transcrypt); the
tool refuses to write a YAML file anywhere else inside the repository.
"""

from __future__ import annotations

import argparse
from collections.abc import Callable
import copy
import json
from pathlib import Path
import sys
from typing import Any

import jsonschema
import yaml

EVAL_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = EVAL_ROOT.parent
DATASETS_DIR = EVAL_ROOT / "datasets"
SCHEMA_PATH = DATASETS_DIR / "dataset_schema.json"

LAYOUT_COMPONENTS = ("Column", "Row", "Card", "Text", "Button")
MCP_CATALOG_V1_0 = "catalogs/mcp/v1/catalog.json"
MCP_CATALOG_V0_9 = (
    "samples/community/agent/adk/mcp_app_proxy/catalogs/0.9/mcp_app_catalog.json"
)
FOLLOW_UP_PROMPT = (
    "Update the surface you already created: change the heading text to "
    "'Updated' and leave everything else unchanged."
)
STATEFUL_UPDATE_TARGET = (
    "An incremental update to the existing surface: only updateComponents or"
    " updateDataModel messages, changing the heading text to 'Updated' and"
    " leaving the rest of the surface unchanged. Recreating the surface is"
    " incorrect."
)
STATEFUL_SURFACE_ID = "main"

# Fallback catalog ids when the catalog file cannot be read from the repo.
_BASIC_CATALOG_IDS = {
    "v0_9_1": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    "v1_0": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
}
_PROTOCOL_VERSIONS = {"v0_9_1": "v0.9.1", "v1_0": "1.0"}
# Catalogs that moved out of `specification/<version>/`; mirrors dataset.py.
_MOVED_CATALOGS = {"specification/v1_0/catalogs/basic/": "catalogs/basic/v1/"}

Mutation = Callable[[dict[str, Any], str], dict[str, Any] | None]


class ExpandError(Exception):
    """Raised when the dataset cannot be expanded."""


# --------------------------------------------------------------------------- #
# Catalog helpers
# --------------------------------------------------------------------------- #


def primary_catalog_path(sample: dict[str, Any]) -> str:
    """Returns the sample's primary catalog path."""
    catalogs = sample.get("catalogs")
    if catalogs:
        return str(catalogs[0]["path"])
    catalog = sample.get("catalog")
    if not catalog:
        raise ExpandError(f"Sample {sample.get('name')!r} names no catalog.")
    return str(catalog)


def detect_version_dir(sample: dict[str, Any], input_path: Path) -> str:
    """Picks `v0_9_1` or `v1_0` from the catalog path, else the input file name."""
    if "v0_9_1" in primary_catalog_path(sample) or "v0_9_1" in input_path.stem:
        return "v0_9_1"
    return "v1_0"


def _resolve_catalog_file(path: str, version_dir: str) -> Path:
    """Maps a dataset catalog path to a file in the repository."""
    concrete = path.replace("{version}", version_dir)
    for old_prefix, new_prefix in _MOVED_CATALOGS.items():
        if concrete.startswith(old_prefix):
            concrete = new_prefix + concrete[len(old_prefix) :]
    return REPO_ROOT / concrete


def catalog_id_for(path: str, version_dir: str) -> str:
    """Reads the catalog's `catalogId` (or `$id`), else the basic catalog id."""
    file = _resolve_catalog_file(path, version_dir)
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _BASIC_CATALOG_IDS[version_dir]
    catalog_id = None
    if isinstance(data, dict):
        catalog_id = data.get("catalogId") or data.get("$id")
    return str(catalog_id) if catalog_id else _BASIC_CATALOG_IDS[version_dir]


def _primary_catalog_spec(sample: dict[str, Any]) -> dict[str, Any]:
    """Returns the primary catalog as a `catalogs` list item, keeping examples."""
    catalogs = sample.get("catalogs")
    if catalogs:
        return copy.deepcopy(catalogs[0])
    spec: dict[str, Any] = {"path": primary_catalog_path(sample)}
    if sample.get("examples"):
        spec["examples"] = list(sample["examples"])
    return spec


def _with_catalogs(sample: dict[str, Any], specs: list[dict[str, Any]]) -> None:
    """Replaces the sample's catalog fields with a `catalogs` list, in place."""
    sample.pop("catalog", None)
    sample.pop("examples", None)
    sample["catalogs"] = specs


# --------------------------------------------------------------------------- #
# Mutations
# --------------------------------------------------------------------------- #


def _derive(sample: dict[str, Any], mutation: str, tag: str) -> dict[str, Any]:
    """Copies a sample under its mutated name with the mutation tag added."""
    derived = copy.deepcopy(sample)
    derived["name"] = f"{sample['name']}__{mutation}"
    tags = list(derived.get("tags") or [])
    if tag not in tags:
        tags.append(tag)
    derived["tags"] = tags
    return derived


def mutate_multi_catalog(
    sample: dict[str, Any], version_dir: str
) -> dict[str, Any] | None:
    """Adds the MCP app catalog next to the sample's own catalog."""
    derived = _derive(sample, "multi_catalog", "multi_catalog")
    primary = _primary_catalog_spec(sample)
    mcp = MCP_CATALOG_V0_9 if version_dir == "v0_9_1" else MCP_CATALOG_V1_0
    _with_catalogs(derived, [primary, {"path": mcp}])
    if "assertions" in sample:
        derived["assertions"] = dict(sample["assertions"] or {})
        derived["assertions"]["catalog_ids"] = [
            catalog_id_for(primary["path"], version_dir)
        ]
    return derived


def mutate_pruned(sample: dict[str, Any], version_dir: str) -> dict[str, Any] | None:
    """Prunes the primary catalog to the required and layout components."""
    del version_dir
    required = (sample.get("assertions") or {}).get("required_components") or []
    if not required:
        return None
    derived = _derive(sample, "pruned", "pruned")
    primary = _primary_catalog_spec(sample)
    primary["allowed_components"] = sorted(set(required) | set(LAYOUT_COMPONENTS))
    _with_catalogs(derived, [primary])
    return derived


def build_initial_state(version: str, catalog_id: str) -> list[dict[str, Any]]:
    """Builds the seed surface: a root Column holding one Text heading."""
    return [
        {
            "version": version,
            "createSurface": {
                "surfaceId": STATEFUL_SURFACE_ID,
                "catalogId": catalog_id,
            },
        },
        {
            "version": version,
            "updateComponents": {
                "surfaceId": STATEFUL_SURFACE_ID,
                "components": [
                    {
                        "id": "root",
                        "component": "Column",
                        "children": ["heading"],
                    },
                    {"id": "heading", "component": "Text", "text": "Welcome"},
                ],
            },
        },
    ]


def mutate_stateful_update(
    sample: dict[str, Any], version_dir: str
) -> dict[str, Any] | None:
    """Seeds a surface and asks the model to update it incrementally."""
    derived = _derive(sample, "stateful_update", "stateful")
    catalog_id = catalog_id_for(primary_catalog_path(sample), version_dir)
    derived["initial_state"] = build_initial_state(
        _PROTOCOL_VERSIONS[version_dir], catalog_id
    )
    messages = list(derived.get("messages") or [])
    if not messages and "promptText" in derived:
        messages = [{"role": "user", "content": derived.pop("promptText")}]
    messages.append({"role": "user", "content": FOLLOW_UP_PROMPT})
    derived["messages"] = messages
    derived["allowed_messages"] = ["updateComponents", "updateDataModel"]
    # The rubric and assertions of the first turn do not describe the delta.
    derived["target"] = STATEFUL_UPDATE_TARGET
    derived["assertions"] = {"message_types": ["updateComponents", "updateDataModel"]}
    return derived


MUTATIONS: dict[str, Mutation] = {
    "multi_catalog": mutate_multi_catalog,
    "pruned": mutate_pruned,
    "stateful_update": mutate_stateful_update,
}


# --------------------------------------------------------------------------- #
# Expansion
# --------------------------------------------------------------------------- #


def expand_samples(
    samples: list[dict[str, Any]],
    mutations: list[str],
    input_path: Path,
    names: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Applies each mutation to each (selected) sample, in a stable order."""
    unknown = [m for m in mutations if m not in MUTATIONS]
    if unknown:
        raise ExpandError(
            f"Unknown mutation(s): {', '.join(unknown)}. "
            f"Choose from {', '.join(MUTATIONS)}."
        )
    selected = [s for s in samples if names is None or s.get("name") in names]
    expanded: list[dict[str, Any]] = []
    for sample in selected:
        version_dir = detect_version_dir(sample, input_path)
        for mutation in mutations:
            derived = MUTATIONS[mutation](sample, version_dir)
            if derived is not None:
                expanded.append(derived)
    return expanded


def load_samples(path: Path) -> list[dict[str, Any]]:
    """Loads a dataset YAML/JSON file as a list of samples."""
    text = path.read_text(encoding="utf-8")
    data = json.loads(text) if path.suffix == ".json" else yaml.safe_load(text)
    if not isinstance(data, list):
        raise ExpandError(f"{path} does not hold a list of samples.")
    return data


def validate_entries(entries: list[dict[str, Any]]) -> None:
    """Raises ExpandError when the entries do not satisfy the dataset schema."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    try:
        jsonschema.validate(entries, schema)
    except jsonschema.ValidationError as error:
        raise ExpandError(f"Expanded entries fail dataset_schema.json: {error.message}")


def check_output_location(output: Path) -> None:
    """Refuses dataset outputs in the repository that transcrypt won't encrypt.

    Only `eval/datasets/*.yaml` is encrypted by transcrypt, so an output inside
    the repository must be a `.yaml` file under `eval/datasets/`.
    """
    resolved = output.resolve()
    inside_repo = REPO_ROOT.resolve() in resolved.parents
    inside_datasets = DATASETS_DIR.resolve() in resolved.parents
    if inside_repo and (not inside_datasets or resolved.suffix != ".yaml"):
        raise ExpandError(
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


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def build_parser() -> argparse.ArgumentParser:
    """Defines the command line interface."""
    parser = argparse.ArgumentParser(
        description="Expand an A2UI eval dataset with deterministic variants."
    )
    parser.add_argument("--input", required=True, type=Path, help="Source dataset.")
    parser.add_argument(
        "--output", required=True, type=Path, help="Dataset YAML to write."
    )
    parser.add_argument(
        "--mutations",
        required=True,
        help=f"Comma-separated subset of: {', '.join(MUTATIONS)}.",
    )
    parser.add_argument("--names", help="Comma-separated sample names to expand.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the YAML instead of writing.",
    )
    return parser


def run(args: argparse.Namespace) -> int:
    """Executes the expansion and returns the process exit code."""
    samples = load_samples(args.input)
    names = _split_csv(args.names) or None
    expanded = expand_samples(samples, _split_csv(args.mutations), args.input, names)
    if not expanded:
        raise ExpandError("No samples were expanded.")
    validate_entries(expanded)
    if args.dry_run:
        sys.stdout.write(dump_yaml(expanded))
        return 0
    check_output_location(args.output)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(dump_yaml(expanded), encoding="utf-8")
    print(f"Wrote {len(expanded)} entries to {args.output}")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Parses the command line and runs the expansion."""
    args = build_parser().parse_args(argv)
    try:
        return run(args)
    except ExpandError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
