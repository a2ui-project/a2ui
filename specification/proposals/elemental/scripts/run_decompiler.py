#!/usr/bin/env python3
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


"""Command-line script to decompile A2UI JSON examples into A2UI Elemental markup.

Loads an A2UI JSON example file, merges its surface/component/data-model messages
into a single createSurface envelope, decompiles it against the catalog schema,
and prints the result wrapped in the `<a2ui>` sentinel (the shape a model emits)
on stdout.
"""

import argparse
import json
import os
import sys

sys.path.insert(
    0,
    os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "..",
            "..",
            "agent_sdks",
            "python",
            "a2ui_agent",
            "src",
        )
    ),
)
from a2ui.core.catalog import Catalog
from a2ui.inference_formats.experimental.elemental.parser import ElementalParser


def decompile_example(example_path: str, catalog_path: str) -> str:
    """Decompiles an A2UI JSON example file to A2UI Elemental markup.

    Accepts both the gallery example wrapper (`{name, description, messages: [...]}`)
    and a raw envelope (`{version, createSurface: {...}}`). Gallery messages are
    merged into one surface: components come from `updateComponents` (or an inline
    `createSurface.components`), and the initial data model from `updateDataModel`.

    Args:
        example_path: Path to the A2UI JSON example file.
        catalog_path: Path to the catalog JSON schema.

    Returns:
        The decompiled A2UI Elemental markup, wrapped in the `<a2ui>` sentinel.

    Raises:
        FileNotFoundError: If the example or catalog file does not exist.
        ValueError: If no components can be found in the example.
    """
    if not os.path.exists(example_path):
        raise FileNotFoundError(f"Example file not found: {example_path}")
    if not os.path.exists(catalog_path):
        raise FileNotFoundError(f"Catalog schema not found: {catalog_path}")

    with open(example_path, "r", encoding="utf-8") as f:
        ex_data = json.load(f)

    surface_id = "test_surf"
    catalog_id = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    components_list = None
    data_model = None

    # Collect messages from either the gallery wrapper, a raw single envelope,
    # or a raw list of envelopes.
    if isinstance(ex_data, list):
        messages = ex_data
    else:
        messages = ex_data.get("messages")
        if messages is None:
            messages = [ex_data]

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        create = msg.get("createSurface")
        if isinstance(create, dict):
            surface_id = create.get("surfaceId", surface_id)
            catalog_id = create.get("catalogId", catalog_id)
            if create.get("components"):
                components_list = create["components"]
            if create.get("dataModel"):
                data_model = create["dataModel"]
        update = msg.get("updateComponents")
        if isinstance(update, dict):
            components_list = update.get("components", components_list)
            surface_id = update.get("surfaceId", surface_id)
        update_dm = msg.get("updateDataModel")
        if isinstance(update_dm, dict):
            data_model = update_dm.get("value", update_dm.get("contents", data_model))

    if not components_list:
        raise ValueError(
            "Could not find components (via 'updateComponents' or an inline"
            f" 'createSurface.components') in {example_path}"
        )

    envelope = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": surface_id,
            "catalogId": catalog_id,
            "components": components_list,
        },
    }
    if data_model:
        envelope["createSurface"]["dataModel"] = data_model

    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog_dict = json.load(f)
    catalog = Catalog.from_json(catalog_dict, spec_version="1.0")

    parser = ElementalParser(catalog)
    block = parser.decompile(envelope)
    # Wrap in the <a2ui> sentinel (and markdown fence) — the exact shape a model
    # would emit and that run_compiler.py accepts back.
    return parser.wrap_decompiled_blocks([block])


def main():
    """CLI entrypoint for the decompiler."""
    parser = argparse.ArgumentParser(
        description="Decompile standard A2UI JSON examples into A2UI Elemental markup."
    )
    parser.add_argument(
        "example_file", help="Path to the A2UI JSON example file to decompile."
    )
    parser.add_argument(
        "--catalog",
        default=os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "..",
            "v1_0",
            "catalogs",
            "basic",
            "catalog.json",
        ),
        help="Path to the catalog JSON schema (default: basic catalog).",
    )

    args = parser.parse_args()

    try:
        markup_output = decompile_example(args.example_file, args.catalog)
        print(markup_output)
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
