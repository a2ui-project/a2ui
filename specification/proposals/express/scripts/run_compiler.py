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


"""Command-line tool to compile A2UI Express DSL files into standard A2UI v1.0 JSON.

Loads an A2UI Express DSL file, parses it against the specified catalog schema,
and prints the pretty-printed standard A2UI JSON message on stdout.
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
from a2ui.experimental.express.compiler import ExpressCompiler


def compile_dsl_file(
    dsl_path: str, catalog_path: str, surface_id: str, catalog_id: str
) -> dict:
    """Compiles an A2UI Express DSL file into standard JSON.

    Args:
        dsl_path: Path to the A2UI Express DSL file.
        catalog_path: Path to the catalog JSON schema.
        surface_id: The unique identifier for the compiled surface.
        catalog_id: The optional URI/identifier of the catalog.

    Returns:
        The compiled A2UI v1.0 JSON envelope.

    Raises:
        FileNotFoundError: If the DSL or catalog file does not exist.
    """
    if not os.path.exists(dsl_path):
        raise FileNotFoundError(f"DSL file not found: {dsl_path}")
    if not os.path.exists(catalog_path):
        raise FileNotFoundError(f"Catalog schema not found: {catalog_path}")

    with open(dsl_path, "r", encoding="utf-8") as f:
        dsl_text = f.read()

    compiler = ExpressCompiler(catalog_path)
    return compiler.compile(dsl_text, surface_id=surface_id, catalog_id=catalog_id)


def main():
    """CLI entrypoint for the compiler."""
    parser = argparse.ArgumentParser(
        description="Compile A2UI Express DSL files into standard A2UI v1.0 wire JSON."
    )
    parser.add_argument(
        "dsl_file", help="Path to the A2UI Express DSL file to compile."
    )
    parser.add_argument(
        "--surface-id",
        default="express_surface",
        help="The unique identifier for the compiled surface (default: express_surface).",
    )
    parser.add_argument(
        "--catalog-id",
        default="",
        help="The optional catalog URI to reference in the output.",
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
        compiled_envelope = compile_dsl_file(
            args.dsl_file, args.catalog, args.surface_id, args.catalog_id
        )
        print(json.dumps(compiled_envelope, indent=2))
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
