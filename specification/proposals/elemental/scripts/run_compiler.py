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


"""Command-line tool to compile A2UI Elemental markup into standard A2UI v1.0 JSON.

Loads an A2UI Elemental file (HTML5-like markup, optionally wrapped in the
`<a2ui>` sentinel and a markdown code fence, i.e. the exact shape a model emits),
parses and compiles it against the specified catalog schema, and prints the
pretty-printed standard A2UI JSON message on stdout.
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
import json
from a2ui.core.catalog import Catalog
from a2ui.inference_formats.experimental.elemental.parser import ElementalParser


def _force_surface_id(envelope: dict, surface_id: str) -> None:
    """Overrides the surfaceId on whichever surface operation the envelope carries."""
    for op_key in (
        "createSurface",
        "updateComponents",
        "updateDataModel",
        "deleteSurface",
    ):
        op = envelope.get(op_key)
        if isinstance(op, dict):
            op["surfaceId"] = surface_id


def compile_elemental_file(
    elemental_path: str, catalog_path: str, surface_id=None
) -> dict:
    """Compiles an A2UI Elemental markup file into standard JSON.

    Args:
        elemental_path: Path to the A2UI Elemental markup file.
        catalog_path: Path to the catalog JSON schema.
        surface_id: Optional surface identifier. When provided it overrides the
          `id` encoded in the `<body>` element; when omitted, the `<body>` id is
          used (falling back to "main" if absent).

    Returns:
        The compiled A2UI v1.0 JSON envelope.

    Raises:
        FileNotFoundError: If the Elemental or catalog file does not exist.
        ValueError: If no A2UI payload could be compiled from the input.
    """
    if not os.path.exists(elemental_path):
        raise FileNotFoundError(f"Elemental file not found: {elemental_path}")
    if not os.path.exists(catalog_path):
        raise FileNotFoundError(f"Catalog schema not found: {catalog_path}")

    with open(elemental_path, "r", encoding="utf-8") as f:
        elemental_text = f.read()

    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog_dict = json.load(f)
    catalog = Catalog.from_json(catalog_dict, spec_version="1.0")

    # The parser locates UI blocks by the <a2ui> sentinel. If the input is a
    # bare <body> block (no sentinel), wrap it so it can still be compiled.
    if "<a2ui>" not in elemental_text:
        elemental_text = f"<a2ui>\n{elemental_text}\n</a2ui>"

    parser = ElementalParser(catalog, surface_id or "main")
    parts = parser.parse_response(elemental_text)

    envelopes = []
    for part in parts:
        if getattr(part, "a2ui_json", None):
            envelopes.extend(part.a2ui_json)

    if not envelopes:
        raise ValueError(
            "No A2UI payload was produced. Ensure the input is valid A2UI"
            " Elemental markup wrapped in <a2ui> ... </a2ui>."
        )

    # An explicit --surface-id overrides the id encoded in the <body> element.
    if surface_id is not None:
        for envelope in envelopes:
            _force_surface_id(envelope, surface_id)

    return envelopes[0] if len(envelopes) == 1 else envelopes


def main():
    """CLI entrypoint for the compiler."""
    parser = argparse.ArgumentParser(
        description="Compile A2UI Elemental markup into standard A2UI v1.0 wire JSON."
    )
    parser.add_argument(
        "elemental_file", help="Path to the A2UI Elemental markup file to compile."
    )
    parser.add_argument(
        "--surface-id",
        default=None,
        help=(
            "Override the surface id. If omitted, the id is taken from the <body>"
            " element (or 'main' when absent)."
        ),
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
        compiled = compile_elemental_file(
            args.elemental_file, args.catalog, args.surface_id
        )
        print(json.dumps(compiled, indent=2))
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
