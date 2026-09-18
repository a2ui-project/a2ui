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

"""Main entry point for the A2UI Headless Developer CLI."""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from .catalog import describe_catalog, diff_catalogs
from .check import check_payload
from .render import render_command


def build_parser() -> argparse.ArgumentParser:
    """Constructs the top-level argument parser for the A2UI CLI."""
    parser = argparse.ArgumentParser(
        prog="a2ui",
        description=(
            "A2UI Developer Toolchain CLI: validate, inspect, diff catalogs, and render"
            " payloads."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # 1. `a2ui check <payload.json>`
    check_parser = subparsers.add_parser(
        "check",
        help=(
            "Validate an A2UI payload against schema, target profile, and did-you-mean"
            " suggestions."
        ),
    )
    check_parser.add_argument(
        "payload",
        help="Path to A2UI payload JSON file (or '-' for stdin)",
    )
    check_parser.add_argument(
        "--target",
        dest="target",
        default=None,
        help=(
            "Host target profile name (e.g. 'gemini-enterprise') or path to profile"
            " YAML"
        ),
    )
    check_parser.add_argument(
        "--catalog",
        dest="catalog",
        default=None,
        help="Override catalog identifier (defaults to target catalog or 'basic')",
    )
    check_parser.add_argument(
        "--json",
        dest="as_json",
        action="store_true",
        help="Output structured JSON results",
    )

    # 2. `a2ui catalog [describe|diff]`
    catalog_parser = subparsers.add_parser(
        "catalog",
        help="Introspect and compare component catalogs.",
    )
    cat_subparsers = catalog_parser.add_subparsers(
        dest="catalog_subcommand", help="Catalog operation"
    )

    # `a2ui catalog describe <catalog_id>`
    desc_parser = cat_subparsers.add_parser(
        "describe",
        help=(
            "Describe a catalog inventory, property types, required flags, and"
            " reference topology."
        ),
    )
    desc_parser.add_argument(
        "catalog_id",
        help=(
            "Catalog identifier ('basic', 'gemini_enterprise_composite', file path, or"
            " URL)"
        ),
    )
    desc_parser.add_argument(
        "--json",
        dest="as_json",
        action="store_true",
        help="Output structured JSON results",
    )

    # `a2ui catalog diff <left> <right>`
    diff_parser = cat_subparsers.add_parser(
        "diff",
        help="Compare two catalogs and report added, removed, and extended components.",
    )
    diff_parser.add_argument(
        "left",
        help="Left / baseline catalog identifier",
    )
    diff_parser.add_argument(
        "right",
        help="Right / target catalog identifier",
    )
    diff_parser.add_argument(
        "--json",
        dest="as_json",
        action="store_true",
        help="Output structured JSON results",
    )

    # 3. `a2ui render <payload.json> --png <out.png>`
    render_parser = subparsers.add_parser(
        "render",
        help="Render an A2UI payload to a PNG image using headless Playwright engine.",
    )
    render_parser.add_argument(
        "payload",
        help="Path to A2UI payload JSON file",
    )
    render_parser.add_argument(
        "--png",
        dest="png_out",
        required=True,
        help="Path to output PNG image file",
    )
    render_parser.add_argument(
        "--width",
        dest="width",
        type=int,
        default=800,
        help="Render viewport width (default: 800)",
    )
    render_parser.add_argument(
        "--height",
        dest="height",
        type=int,
        default=600,
        help="Render viewport height (default: 600)",
    )
    render_parser.add_argument(
        "--catalog",
        dest="catalog",
        default=None,
        help="Catalog identifier to use for rendering",
    )

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    """CLI main execution dispatcher."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        return 1

    if args.command == "check":
        return check_payload(
            payload_path=args.payload,
            target=args.target,
            catalog_override=args.catalog,
            as_json=args.as_json,
        )

    if args.command == "catalog":
        if not getattr(args, "catalog_subcommand", None):
            parser.print_help()
            return 1

        if args.catalog_subcommand == "describe":
            return describe_catalog(
                catalog_id=args.catalog_id,
                as_json=args.as_json,
            )

        if args.catalog_subcommand == "diff":
            return diff_catalogs(
                left=args.left,
                right=args.right,
                as_json=args.as_json,
            )

    if args.command == "render":
        return render_command(
            payload_path=args.payload,
            png_out=args.png_out,
            width=args.width,
            height=args.height,
            catalog_id=args.catalog,
        )

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
