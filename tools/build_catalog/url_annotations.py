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

"""Checks that catalog properties holding URLs carry `x-a2ui-url-context`.

Renderers check a component property against the URL security policy only
when the catalog marks it with `x-a2ui-url-context` (`media`, `navigation`, or
`iframe`). A property whose name looks like a URL but holds something else is
marked `"none"`. This module finds component properties whose names look like
URLs (`url`, `uri`, `href`, `src`, `*Url`, `*Uri`) and carry no mark.

Run it as a script to check catalog files; it exits with status 1 when any
property is unmarked or a mark has an unknown value:

    python3 tools/build_catalog/url_annotations.py catalogs
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

URL_CONTEXT_KEYWORD = "x-a2ui-url-context"
URL_CONTEXT_VALUES = frozenset({"media", "navigation", "iframe", "none"})

# The published basic catalogs carry no marks. Renderers treat these
# properties as `media` through a built-in list keyed by catalog ID, so they
# count as marked in catalogs with these IDs.
_BASIC_COMPONENT_URL_PROPERTIES = {
    "Image": {"url": "media"},
    "Video": {"url": "media", "posterUrl": "media"},
    "AudioPlayer": {"url": "media"},
}
BUILT_IN_URL_PROPERTIES: dict[str, dict[str, dict[str, str]]] = {
    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json": (
        _BASIC_COMPONENT_URL_PROPERTIES
    ),
    "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json": (
        _BASIC_COMPONENT_URL_PROPERTIES
    ),
}

_URL_LIKE_NAME = re.compile(
    r"^(?:url|uri|href|src)$|(?<=[A-Za-z0-9])(?:Url|URL|Uri|URI)$|_(?:url|uri)$"
)
_NON_STRING_TYPES = frozenset(
    {"object", "array", "number", "integer", "boolean", "null"}
)


def looks_like_url_property(name: str) -> bool:
    """Returns whether a property name looks like it holds a URL.

    Args:
      name: The property name.
    """
    return bool(_URL_LIKE_NAME.search(name))


def _may_hold_string(schema: Any) -> bool:
    """Returns whether a property schema may hold a string.

    A schema that only declares non-string types (`object`, `array`, and so
    on) can't hold a URL. Everything else, including `$ref`s such as
    `DynamicString` and unions, is treated as possibly holding one.
    """
    if not isinstance(schema, dict):
        return True
    declared = schema.get("type")
    if isinstance(declared, str):
        return declared not in _NON_STRING_TYPES
    if isinstance(declared, list) and declared:
        return any(t not in _NON_STRING_TYPES for t in declared)
    return True


def _resolve_local_ref(root: dict[str, Any], ref: str) -> Any:
    """Resolves a `#/...` JSON pointer in the catalog, or returns None."""
    if not ref.startswith("#/"):
        return None
    current: Any = root
    for part in ref[2:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif (
            isinstance(current, list)
            and part.isascii()
            and part.isdigit()
            and int(part) < len(current)
        ):
            current = current[int(part)]
        else:
            return None
    return current


def find_url_annotation_problems(catalog: dict[str, Any]) -> list[str]:
    """Lists the component properties of a catalog with a missing or bad mark.

    Walks every component's properties, following local `$ref`s, `allOf`,
    `anyOf`, `oneOf`, nested object `properties`, and array `items`. A
    property is reported when its name looks like a URL, its schema may hold a
    string, and it has no `x-a2ui-url-context`, unless the built-in list for
    the catalog's ID covers it. A mark with a value other than `media`,
    `navigation`, `iframe`, or `none` is reported wherever it appears.

    Args:
      catalog: The catalog document.

    Returns:
      One message per problem, such as
      `ProductCard.imageUrl: no x-a2ui-url-context`, in document order.
    """
    components = catalog.get("components")
    if not isinstance(components, dict):
        return []
    catalog_id = catalog.get("catalogId") or catalog.get("$id")
    built_in = (
        BUILT_IN_URL_PROPERTIES.get(catalog_id, {})
        if isinstance(catalog_id, str)
        else {}
    )
    problems: list[str] = []

    def walk(schema: Any, component: str, path: str, seen: frozenset[str]) -> None:
        if not isinstance(schema, dict):
            return
        ref = schema.get("$ref")
        if isinstance(ref, str) and ref not in seen:
            walk(_resolve_local_ref(catalog, ref), component, path, seen | {ref})
        for keyword in ("allOf", "anyOf", "oneOf"):
            branches = schema.get(keyword)
            if isinstance(branches, list):
                for branch in branches:
                    walk(branch, component, path, seen)
        properties = schema.get("properties")
        if isinstance(properties, dict):
            for name, prop in properties.items():
                prop_path = f"{path}.{name}" if path else name
                check(prop, component, prop_path, name)
                walk(prop, component, prop_path, seen)
        items = schema.get("items")
        if isinstance(items, dict):
            walk(items, component, f"{path}[]", seen)

    reported: set[str] = set()

    def report(key: str, message: str) -> None:
        if key not in reported:
            reported.add(key)
            problems.append(message)

    def check(prop: Any, component: str, path: str, name: str) -> None:
        label = f"{component}.{path}"
        mark = prop.get(URL_CONTEXT_KEYWORD) if isinstance(prop, dict) else None
        if mark is not None:
            if mark not in URL_CONTEXT_VALUES:
                report(
                    label,
                    f"{label}: unknown {URL_CONTEXT_KEYWORD} value {json.dumps(mark)}",
                )
            return
        if not looks_like_url_property(name) or not _may_hold_string(prop):
            return
        if path in built_in.get(component, {}):
            return
        report(label, f"{label}: no {URL_CONTEXT_KEYWORD}")

    for component, schema in components.items():
        walk(schema, component, "", frozenset())
    return problems


def add_built_in_url_marks(catalog: Any) -> None:
    """Writes the built-in URL marks into a basic catalog document, in place.

    Does nothing for a document whose ID has no built-in list, and keeps any
    mark a property already has.

    Args:
      catalog: The catalog document.
    """
    if not isinstance(catalog, dict):
        return
    catalog_id = catalog.get("catalogId") or catalog.get("$id")
    built_in = (
        BUILT_IN_URL_PROPERTIES.get(catalog_id) if isinstance(catalog_id, str) else None
    )
    components = catalog.get("components")
    if not built_in or not isinstance(components, dict):
        return
    for component, marks in built_in.items():
        schema = components.get(component)
        for branch in [
            schema,
            *(schema.get("allOf", []) if isinstance(schema, dict) else []),
        ]:
            properties = branch.get("properties") if isinstance(branch, dict) else None
            if not isinstance(properties, dict):
                continue
            for name, mark in marks.items():
                prop = properties.get(name)
                if isinstance(prop, dict):
                    prop.setdefault(URL_CONTEXT_KEYWORD, mark)


def _catalog_files(paths: list[Path]) -> list[Path]:
    """Expands directories into the `catalog.json` files under them."""
    files: list[Path] = []
    for path in paths:
        if path.is_dir():
            files.extend(sorted(path.rglob("catalog.json")))
        else:
            files.append(path)
    return files


def main(argv: list[str] | None = None) -> int:
    """Checks catalog files and returns the exit status."""
    parser = argparse.ArgumentParser(
        description=(
            "Fail when a component property whose name looks like a URL has no"
            f" {URL_CONTEXT_KEYWORD} annotation."
        )
    )
    parser.add_argument(
        "paths",
        nargs="+",
        type=Path,
        help="Catalog files, or directories to search for catalog.json files.",
    )
    args = parser.parse_args(argv)

    failed = False
    for file in _catalog_files(args.paths):
        problems = find_url_annotation_problems(
            json.loads(file.read_text(encoding="utf-8"))
        )
        for problem in problems:
            print(f"{file}: {problem}")
        failed = failed or bool(problems)
    if failed:
        print(
            f"\nMark each URL property with {URL_CONTEXT_KEYWORD} (media, navigation,"
            ' or iframe), or with "none" if it does not hold a URL.'
        )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
