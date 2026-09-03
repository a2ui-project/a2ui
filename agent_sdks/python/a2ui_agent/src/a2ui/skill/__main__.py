# Copyright 2026 Google LLC
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

"""CLI entry point for python -m a2ui.skill."""

import argparse
import sys
from typing import Optional

from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog
from a2ui.skill.generator import generate_skill


def main(args: Optional[list[str]] = None) -> None:
    """Main CLI parser for A2UI Skill generation."""
    parser = argparse.ArgumentParser(
        description="Generates A2UI SKILL.md packages for managed agent platforms."
    )
    parser.add_argument(
        "paths",
        nargs="+",
        help="One or more paths to catalog JSON files.",
    )
    parser.add_argument(
        "--inference-format",
        "-f",
        default="express",
        choices=["express", "direct_json"],
        help="Target inference format (default: express).",
    )
    parser.add_argument(
        "--name",
        "-n",
        help="Custom skill name override.",
    )
    parser.add_argument(
        "--description",
        "-d",
        help="Custom skill description override.",
    )
    parser.add_argument(
        "--modular",
        "-m",
        action="store_true",
        help="Generate modular skills (split core rules and catalog skills).",
    )
    parser.add_argument(
        "--output-dir",
        "-o",
        default="./skills",
        help="Target directory to write SKILL.md files.",
    )
    parser.add_argument(
        "--no-examples",
        action="store_true",
        help="Exclude few-shot catalog examples.",
    )

    parsed = parser.parse_args(args)

    catalogs = [A2uiCatalog.from_json_file(p) for p in parsed.paths]
    if parsed.inference_format == "direct_json":
        fmt = DirectJsonFormat(supported_catalogs=catalogs)
    else:
        fmt = ExpressFormat(catalog=catalogs[0] if catalogs else None)

    generated = generate_skill(
        catalogs=catalogs,
        inference_format=fmt,
        name=parsed.name,
        description=parsed.description,
        modular=parsed.modular,
        output_dir=parsed.output_dir,
        include_examples=not parsed.no_examples,
    )

    print(
        f"Successfully generated {len(generated)} skill package(s) in"
        f" '{parsed.output_dir}':"
    )
    for file_path in generated.keys():
        print(f"  - {file_path}")


if __name__ == "__main__":
    main()
