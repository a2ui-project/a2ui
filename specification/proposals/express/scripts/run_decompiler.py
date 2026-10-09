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


"""Command-line script to decompile A2UI JSON examples into A2UI Express.

Loads an A2UI JSON example file and decompiles its whole message sequence
(surface creation, incremental updates, deletes and renderer function calls)
against the catalog schema, printing the A2UI Express DSL on stdout.
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
            "python",
            "a2ui_agent",
            "src",
        )
    ),
)
from a2ui.core import Catalog
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.experimental.express import ExpressDecompiler


def decompile_example(example_path: str, catalog_path: str) -> str:
    """Decompiles an A2UI JSON example file to A2UI Express DSL.

    The example is either an object with a `messages` list, a bare list of
    messages, or a single message.

    Args:
        example_path: Path to the A2UI JSON example file.
        catalog_path: Path to the catalog JSON schema.

    Returns:
        The decompiled A2UI Express DSL string.

    Raises:
        FileNotFoundError: If the example or catalog file does not exist.
        ValueError: If the example JSON contains no messages.
    """
    if not os.path.exists(example_path):
        raise FileNotFoundError(f"Example file not found: {example_path}")
    if not os.path.exists(catalog_path):
        raise FileNotFoundError(f"Catalog schema not found: {catalog_path}")

    with open(example_path, "r", encoding="utf-8") as f:
        ex_data = json.load(f)

    if isinstance(ex_data, list):
        messages = ex_data
    elif isinstance(ex_data, dict) and "messages" in ex_data:
        messages = ex_data["messages"]
    else:
        messages = [ex_data]
    if not messages:
        raise ValueError(f"Could not find any A2UI messages in {example_path}")

    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog_dict = json.load(f)
    catalog = Catalog.from_json(catalog_dict)
    decompiler = ExpressDecompiler([catalog])
    return decompiler.decompile(to_message_models(messages))


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
            "..",
            "catalogs",
            "basic",
            "v1",
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
