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

"""Validates A2UI JSON examples in the documentation against the spec schemas.

The script finds ```json blocks in Markdown and MDX files and checks each one
against the JSON Schemas of the protocol version it shows:

- Blocks inside a version tab (`=== "v1.0"` in MkDocs, `<TabItem label="v1.0">`
  in Astro MDX) use the tab's version. v0.9 and v0.9.1 tabs use the v0.9.1
  schemas. v0.8 tabs are not checked.
- Untabbed blocks use the version named by their `"version"` field. An
  untabbed component (an object with `id` and `component`) has no version
  field and is checked against v1.0, the current version.

Messages, renderer events, and single components are checked. Other JSON (for
example catalog definitions or capabilities) is skipped. To skip a block that
is intentionally partial, put `<!-- example: skip -->` on one of the two lines
above its opening fence.

Usage:
    python docs/scripts/validate_doc_examples.py --paths docs/public docs/site/src/content/docs
"""

from __future__ import annotations

import argparse
import copy
import dataclasses
import json
import pathlib
import re
import sys
from typing import Any, Iterator

import jsonschema
import referencing
import referencing.jsonschema

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

V1_0 = "1.0"
V0_9_1 = "0.9.1"

_SPEC_BASE = "https://a2ui.org/specification"

# Per version: the spec JSON directory, the basic catalog, and the URI the
# message schemas use for `catalog.json` (relative to their own `$id`).
_VERSION_FILES = {
    V1_0: {
        "json_dir": REPO_ROOT / "specification/v1_0/json",
        "catalog": REPO_ROOT / "catalogs/basic/v1/catalog.json",
        "base": f"{_SPEC_BASE}/v1_0",
        "to_renderer": "agent_to_renderer.json",
        "from_renderer": "renderer_to_agent.json",
    },
    # The v0.9.1 schemas keep `v0_9` in their `$id`s, so the v0.9 schemas must
    # never be loaded into the same registry.
    V0_9_1: {
        "json_dir": REPO_ROOT / "specification/v0_9_1/json",
        "catalog": REPO_ROOT / "specification/v0_9_1/catalogs/basic/catalog.json",
        "base": f"{_SPEC_BASE}/v0_9",
        "to_renderer": "server_to_client.json",
        "from_renderer": "client_to_server.json",
    },
}

_TO_RENDERER_KEYS = {
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "callRendererFunction",
    "agentFunctionResponse",
}
_FROM_RENDERER_KEYS = {
    "action",
    "callAgentFunction",
    "rendererFunctionResponse",
    "error",
}

_SKIP_MARKER = "<!-- example: skip -->"
_MKDOCS_TAB = re.compile(r'^(?P<indent>\s*)=== "(?P<label>[^"]*)"')
_ASTRO_TAB_OPEN = re.compile(r'<TabItem\s+label="(?P<label>[^"]*)"')
_ASTRO_TAB_CLOSE = re.compile(r"</TabItem>")
_FENCE_OPEN = re.compile(r"^(?P<indent>\s*)```json\s*$")


@dataclasses.dataclass
class Example:
    """A JSON code block found in a documentation file."""

    path: pathlib.Path
    line: int
    tab_label: str | None
    text: str
    skipped: bool = False

    @property
    def location(self) -> str:
        try:
            rel = self.path.resolve().relative_to(REPO_ROOT)
        except ValueError:
            rel = self.path
        return f"{rel}:{self.line}"


def version_for_label(label: str) -> str | None:
    """Maps a tab label to the protocol version whose schemas apply."""
    if re.search(r"\bv?1\.0\b", label):
        return V1_0
    if re.search(r"\bv?0\.9(\.1)?\b", label):
        return V0_9_1
    return None


def _version_for_field(value: Any) -> str | None:
    if value == "1.0":
        return V1_0
    if value in ("v0.9", "v0.9.1"):
        return V0_9_1
    return None


def extract_examples_from_text(path: pathlib.Path, text: str) -> list[Example]:
    """Finds ```json blocks and the version tab (if any) that contains each."""
    lines = text.splitlines()
    examples: list[Example] = []
    mkdocs_tab: tuple[int, str] | None = None  # (indent, label)
    astro_tab: str | None = None
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        tab_match = _MKDOCS_TAB.match(line)
        if tab_match:
            mkdocs_tab = (len(tab_match.group("indent")), tab_match.group("label"))
            i += 1
            continue
        open_match = _ASTRO_TAB_OPEN.search(line)
        if open_match:
            astro_tab = open_match.group("label")
        if _ASTRO_TAB_CLOSE.search(line):
            astro_tab = None
        # A MkDocs tab ends at the first non-blank line indented no deeper
        # than its `===` header.
        if mkdocs_tab and stripped:
            indent = len(line) - len(line.lstrip())
            if indent <= mkdocs_tab[0]:
                mkdocs_tab = None
        fence = _FENCE_OPEN.match(line)
        if not fence:
            i += 1
            continue
        fence_indent = fence.group("indent")
        body: list[str] = []
        j = i + 1
        while j < len(lines) and lines[j].strip() != "```":
            body.append(
                lines[j][len(fence_indent) :]
                if lines[j].startswith(fence_indent)
                else lines[j]
            )
            j += 1
        preceding = lines[max(0, i - 2) : i]
        label = mkdocs_tab[1] if mkdocs_tab else astro_tab
        examples.append(
            Example(
                path=path,
                line=i + 1,
                tab_label=label,
                text="\n".join(body),
                skipped=any(_SKIP_MARKER in p for p in preceding),
            )
        )
        i = j + 1
    return examples


def extract_examples(path: pathlib.Path) -> list[Example]:
    """Reads a Markdown or MDX file and returns its JSON examples."""
    return extract_examples_from_text(path, path.read_text(encoding="utf-8"))


def _load(path: pathlib.Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _allow_other_catalogs(catalog: dict[str, Any], call_key: str) -> None:
    """Lets components and functions from other catalogs pass the catalog check.

    Docs examples often use custom catalogs (charts, MCP apps, app-specific
    components and functions) whose schemas the validator does not have. A
    component or function call whose name is not in the basic catalog is
    accepted as is; envelope fields, data bindings, and basic catalog entries
    are still checked.
    """
    defs = catalog["$defs"]
    component_names = sorted(catalog.get("components", {}))
    function_names = sorted(catalog.get("functions", {}))
    defs["anyComponent"] = {
        "anyOf": [
            defs["anyComponent"],
            {
                "type": "object",
                "required": ["component"],
                "properties": {"component": {"not": {"enum": component_names}}},
                "additionalProperties": True,
            },
        ]
    }
    defs["anyFunction"] = {
        "anyOf": [
            defs["anyFunction"],
            {
                "type": "object",
                "required": [call_key],
                "properties": {call_key: {"not": {"enum": function_names}}},
                "additionalProperties": True,
            },
        ]
    }


class SchemaSet:
    """Validators for one protocol version, sharing one `$ref` registry."""

    def __init__(self, version: str) -> None:
        files = _VERSION_FILES[version]
        base = files["base"]
        resources: list[tuple[str, referencing.Resource]] = []
        for schema_path in sorted(files["json_dir"].glob("*.json")):
            schema = _load(schema_path)
            uri = schema.get("$id") or f"{base}/{schema_path.name}"
            resources.append(
                (uri, referencing.jsonschema.DRAFT202012.create_resource(schema))
            )
        # The message schemas reference the catalog as "catalog.json" relative
        # to their own `$id`, which differs from the catalog's `$id`. Register
        # the catalog under the referenced URI, without its `$id`, so its own
        # relative references (such as "common_types.json") resolve against it.
        catalog = copy.deepcopy(_load(files["catalog"]))
        catalog.pop("$id", None)
        _allow_other_catalogs(catalog, call_key="@call" if version == V1_0 else "call")
        catalog_uri = f"{base}/catalog.json"
        resources.append(
            (catalog_uri, referencing.jsonschema.DRAFT202012.create_resource(catalog))
        )
        self.registry = referencing.Registry().with_resources(resources)
        self.version = version
        self._to_renderer = self._validator({"$ref": f"{base}/{files['to_renderer']}"})
        self._from_renderer = self._validator(
            {"$ref": f"{base}/{files['from_renderer']}"}
        )
        if version == V1_0:
            component_ref = f"{base}/{files['to_renderer']}#/$defs/Component"
        else:
            component_ref = f"{catalog_uri}#/$defs/anyComponent"
        self._component = self._validator({"$ref": component_ref})

    def _validator(self, schema: dict[str, Any]) -> jsonschema.Draft202012Validator:
        return jsonschema.Draft202012Validator(schema, registry=self.registry)

    def validator_for(self, payload: Any) -> jsonschema.Draft202012Validator | None:
        """Picks the schema that matches the payload's shape, if any."""
        if not isinstance(payload, dict):
            return None
        keys = set(payload)
        if keys & _TO_RENDERER_KEYS:
            return self._to_renderer
        if "version" in keys and keys & _FROM_RENDERER_KEYS:
            return self._from_renderer
        if "id" in keys and "component" in keys:
            return self._component
        return None


_SCHEMA_SETS: dict[str, SchemaSet] = {}


def schema_set(version: str) -> SchemaSet:
    if version not in _SCHEMA_SETS:
        _SCHEMA_SETS[version] = SchemaSet(version)
    return _SCHEMA_SETS[version]


def _payloads(data: Any) -> Iterator[Any]:
    if isinstance(data, list):
        yield from data
    else:
        yield data


def _errors_for(payload: Any, version: str) -> list[str] | None:
    """Returns schema errors, or None when the payload's shape is not checked."""
    validator = schema_set(version).validator_for(payload)
    if validator is None:
        return None
    errors = sorted(validator.iter_errors(payload), key=lambda e: list(e.absolute_path))
    return [
        f"v{version}: {'/'.join(map(str, e.absolute_path)) or '<root>'}:"
        f" {e.message[:200]}"
        for e in errors
    ]


def validate(example: Example) -> list[str]:
    """Validates one example and returns error strings (empty when valid)."""
    if example.skipped:
        return []
    tab_version = version_for_label(example.tab_label) if example.tab_label else None
    if example.tab_label and tab_version is None:
        return []  # A tab for another version (v0.8) or a non-version tab.
    try:
        data = json.loads(example.text)
    except json.JSONDecodeError as e:
        if tab_version is None:
            return []  # Untabbed non-JSON snippets are not protocol examples.
        return [f"invalid JSON: {e}"]
    errors: list[str] = []
    for payload in _payloads(data):
        if tab_version:
            versions = [tab_version]
        elif isinstance(payload, dict) and "version" in payload:
            field_version = _version_for_field(payload["version"])
            versions = [field_version] if field_version else []
        elif isinstance(payload, dict) and "id" in payload and "component" in payload:
            versions = [V1_0]
        else:
            versions = []
        for version in versions:
            errors.extend(_errors_for(payload, version) or [])
    return errors


def iter_doc_files(paths: list[pathlib.Path]) -> Iterator[pathlib.Path]:
    for path in paths:
        if path.is_dir():
            for suffix in ("*.md", "*.mdx"):
                yield from sorted(path.rglob(suffix))
        elif path.suffix in (".md", ".mdx"):
            yield path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--paths",
        nargs="+",
        type=pathlib.Path,
        default=[REPO_ROOT / "docs/public", REPO_ROOT / "docs/site/src/content/docs"],
        help="Markdown/MDX files or directories to check.",
    )
    args = parser.parse_args(argv)
    failures = 0
    checked = 0
    for path in iter_doc_files(args.paths):
        for example in extract_examples(path):
            errors = validate(example)
            checked += 1
            if errors:
                failures += 1
                print(f"{example.location} [{example.tab_label or 'untabbed'}]")
                for error in errors:
                    print(f"    {error}")
    print(f"Checked {checked} JSON blocks; {failures} with errors.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
