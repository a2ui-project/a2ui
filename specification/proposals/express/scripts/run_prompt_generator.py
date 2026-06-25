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


"""Command-line tool to generate prompt contracts for A2UI Express.

Crawls the specified catalog JSON schema and outputs a formatted model system prompt
containing complete instructions and positional signatures on stdout.
"""

import argparse
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
from a2ui.experimental.express.prompt_generator import ExpressPromptGenerator


def generate_prompt_text(catalog_path: str) -> str:
    """Generates the A2UI Express system prompt contract.

    Args:
        catalog_path: Path to the catalog JSON schema.

    Returns:
        The compiled system prompt text block.

    Raises:
        FileNotFoundError: If the catalog schema file does not exist.
    """
    if not os.path.exists(catalog_path):
        raise FileNotFoundError(f"Catalog schema not found: {catalog_path}")

    generator = ExpressPromptGenerator(catalog_path)
    return generator.generate_prompt()


def main():
    """CLI entrypoint for the prompt generator."""
    parser = argparse.ArgumentParser(
        description="Generate model system prompts for A2UI Express from a catalog schema."
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
        prompt_content = generate_prompt_text(args.catalog)
        print(prompt_content)
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
