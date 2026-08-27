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

"""A2UI Code Generator CLI."""

import argparse
import sys
from pathlib import Path
from typing import Sequence

from a2ui.codegen.analyzer import CatalogAnalyzer
from a2ui.codegen.emitter.python import PythonEmitter


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="a2ui-codegen",
        description="Generates typesafe A2UI component libraries from catalog schemas.",
    )
    parser.add_argument(
        "--catalog",
        required=True,
        help="Path to the catalog JSON Schema file.",
    )
    parser.add_argument(
        "--lang",
        default="python",
        choices=["python"],
        help="Target language for code generation (default: python).",
    )
    parser.add_argument(
        "--out",
        required=True,
        help="Output directory where generated files will be written.",
    )
    parser.add_argument(
        "--base-import",
        default="a2ui.inference_formats.experimental.macros.builder.base",
        help="Base module from which ComponentBuilderNode, DataBinding, etc. are imported.",
    )
    parser.add_argument(
        "--spec-version",
        default="v0.9.1",
        help="A2UI protocol specification version (default: v0.9.1).",
    )
    return parser


def main(args: Sequence[str] | None = None) -> int:
    parser = build_parser()
    parsed = parser.parse_args(args)

    catalog_path = Path(parsed.catalog)
    if not catalog_path.exists():
        print(f"Error: Catalog file not found: {catalog_path}", file=sys.stderr)
        return 1

    try:
        catalog = CatalogAnalyzer.from_file(
            catalog_path, spec_version=parsed.spec_version
        )
    except Exception as e:
        print(f"Error analyzing catalog schema: {e}", file=sys.stderr)
        return 1

    out_dir = Path(parsed.out)
    if parsed.lang == "python":
        emitter = PythonEmitter(catalog, base_import=parsed.base_import)
        written = emitter.emit(out_dir)
        print(f"Successfully generated {len(written)} files into {out_dir}:")
        for f in written:
            print(f"  - {f.name}")
    else:
        print(f"Unsupported language: {parsed.lang}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
