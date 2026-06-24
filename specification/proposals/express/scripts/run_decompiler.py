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


"""Command-line script to decompile A2UI JSON examples into A2UI Express.

Loads an A2UI JSON example file, extracts its component updates, parses them
against the catalog schema, and decompiles them to A2UI Express DSL on stdout.
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
from a2ui.experimental.express.decompiler import ExpressDecompiler


def decompile_example(example_path: str, catalog_path: str) -> str:
    """Decompiles an A2UI JSON example file to A2UI Express DSL.

    Args:
        example_path: Path to the A2UI JSON example file.
        catalog_path: Path to the catalog JSON schema.

    Returns:
        The decompiled A2UI Express DSL string.

    Raises:
        FileNotFoundError: If the example or catalog file does not exist.
        ValueError: If the example JSON does not contain components updates.
    """
    if not os.path.exists(example_path):
        raise FileNotFoundError(f"Example file not found: {example_path}")
    if not os.path.exists(catalog_path):
        raise FileNotFoundError(f"Catalog schema not found: {catalog_path}")

    with open(example_path, "r", encoding="utf-8") as f:
        ex_data = json.load(f)

    messages = ex_data.get("messages", [])
    components_list = None
    surface_id = "test_surf"
    catalog_id = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"

    # Extract components from the updateComponents message
    for msg in messages:
        if "updateComponents" in msg:
            components_list = msg["updateComponents"].get("components", [])
            surface_id = msg["updateComponents"].get("surfaceId", surface_id)
            break

    if not components_list:
        raise ValueError(
            f"Could not find any 'updateComponents' message in {example_path}"
        )

    envelope = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": surface_id,
            "catalogId": catalog_id,
            "components": components_list,
        },
    }

    decompiler = ExpressDecompiler(catalog_path)
    return decompiler.decompile(envelope)


def main():
    """CLI entrypoint for the decompiler."""
    parser = argparse.ArgumentParser(
        description="Decompile standard A2UI JSON examples into A2UI Express DSL."
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
        dsl_output = decompile_example(args.example_file, args.catalog)
        print(dsl_output)
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
