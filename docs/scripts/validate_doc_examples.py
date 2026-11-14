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
  field and is checked against both v1.0 and v0.9.1.

Messages, renderer events, and single components are checked. Other JSON (for
example catalog definitions or capabilities) is skipped. To skip a block that
is intentionally partial, put `<!-- example: skip -->` on one of the two lines
above its opening fence.

Usage:
    python docs/scripts/validate_doc_examples.py --paths docs/site/src/content/docs
"""

from __future__ import annotations

import argparse
import copy
import dataclasses
import json
import pathlib
import re
import sys
from typing import Any, Iterator, cast

import jsonschema
import referencing
import referencing.jsonschema

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

V1_0 = "1.0"
V0_9_1 = "0.9.1"

_SPEC_BASE = "https://a2ui.org/specification"


@dataclasses.dataclass(frozen=True)
class _VersionFiles:
    json_dir: pathlib.Path
    catalog: pathlib.Path
    base: str
    to_renderer: str
    from_renderer: str


# Per version: the spec JSON directory, the basic catalog, and the URI the
# message schemas use for `catalog.json` (relative to their own `$id`).
_VERSION_FILES: dict[str, _VersionFiles] = {
    V1_0: _VersionFiles(
        json_dir=REPO_ROOT / "specification/v1_0/json",
        catalog=REPO_ROOT / "catalogs/basic/v1/catalog.json",
        base=f"{_SPEC_BASE}/v1_0",
        to_renderer="agent_to_renderer.json",
        from_renderer="renderer_to_agent.json",
    ),
    # common_types.json keeps v0.9's `$id`, since v0.9.1 publishes it
    # unchanged; the other v0.9.1 schemas declare their own.
    V0_9_1: _VersionFiles(
        json_dir=REPO_ROOT / "specification/v0_9_1/json",
        catalog=REPO_ROOT / "specification/v0_9_1/catalogs/basic/catalog.json",
        base=f"{_SPEC_BASE}/v0_9_1",
        to_renderer="server_to_client.json",
        from_renderer="client_to_server.json",
    ),
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
_FENCE_OPEN = re.compile(r"^(?P<indent>\s*)(?P<fence>`{3,}|~{3,})(?P<info>.*)$")
_JSON_INFO = re.compile(r"^\s*json(?:\s|$)")


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


def _update_tab_state(
    line: str,
    mkdocs_tab: tuple[int, str] | None,
    astro_tab: str | None,
) -> tuple[tuple[int, str] | None, str | None]:
    """Updates the active MkDocs or Astro tab state for a non-fence line."""
    tab_match = _MKDOCS_TAB.match(line)
    if tab_match:
        return (len(tab_match.group("indent")), tab_match.group("label")), astro_tab
    if _ASTRO_TAB_CLOSE.search(line):
        astro_tab = None
    open_match = _ASTRO_TAB_OPEN.search(line)
    if open_match:
        astro_tab = open_match.group("label")
    # A MkDocs tab ends at the first non-blank line indented no deeper
    # than its `===` header.
    if mkdocs_tab and line.strip():
        indent = len(line) - len(line.lstrip())
        if indent <= mkdocs_tab[0]:
            mkdocs_tab = None
    return mkdocs_tab, astro_tab


def _is_closing_fence(line: str, fence_marker: str) -> bool:
    """Returns True when `line` closes `fence_marker`."""
    stripped = line.strip()
    return len(stripped) >= len(fence_marker) and stripped == fence_marker[0] * len(
        stripped
    )


def _consume_fenced_block(
    lines: list[str], start: int, fence_indent: str, fence_marker: str
) -> tuple[str, int]:
    """Reads lines inside a fenced code block and returns `(body, next_index)`."""
    body: list[str] = []
    j = start + 1
    while j < len(lines) and not _is_closing_fence(lines[j], fence_marker):
        raw = lines[j]
        body.append(raw[len(fence_indent) :] if raw.startswith(fence_indent) else raw)
        j += 1
    return "\n".join(body), j + 1


def extract_examples_from_text(path: pathlib.Path, text: str) -> list[Example]:
    """Finds ```json blocks and the version tab (if any) that contains each."""
    lines = text.splitlines()
    examples: list[Example] = []
    mkdocs_tab: tuple[int, str] | None = None  # (indent, label)
    astro_tab: str | None = None
    i = 0
    while i < len(lines):
        line = lines[i]
        mkdocs_tab, astro_tab = _update_tab_state(line, mkdocs_tab, astro_tab)
        fence = _FENCE_OPEN.match(line)
        if not fence:
            i += 1
            continue
        body_text, next_i = _consume_fenced_block(
            lines, i, fence.group("indent"), fence.group("fence")
        )
        if _JSON_INFO.match(fence.group("info")):
            preceding = lines[max(0, i - 2) : i]
            examples.append(
                Example(
                    path=path,
                    line=i + 1,
                    tab_label=mkdocs_tab[1] if mkdocs_tab else astro_tab,
                    text=body_text,
                    skipped=any(_SKIP_MARKER in p for p in preceding),
                )
            )
        i = next_i
    return examples


def extract_examples(path: pathlib.Path) -> list[Example]:
    """Reads a Markdown or MDX file and returns its JSON examples."""
    return extract_examples_from_text(path, path.read_text(encoding="utf-8"))


def _load(path: pathlib.Path) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


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
    known_functions = (
        [*function_names, "@index"] if call_key == "@call" else function_names
    )
    fallback_function: dict[str, Any] = {
        "type": "object",
        "required": [call_key],
        "properties": {
            call_key: {"not": {"enum": known_functions}},
            "args": {"type": "object"},
        },
    }
    if call_key == "call":
        fallback_function["properties"]["returnType"] = {
            "$ref": "common_types.json#/$defs/FunctionCall/properties/returnType"
        }
        fallback_function["additionalProperties"] = False
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
    defs["anyFunction"] = {"anyOf": [defs["anyFunction"], fallback_function]}


class SchemaSet:
    """Validators for one protocol version, sharing one `$ref` registry."""

    def __init__(self, version: str) -> None:
        files = _VERSION_FILES[version]
        base = files.base
        resources: list[tuple[str, referencing.Resource[Any]]] = []
        for schema_path in sorted(files.json_dir.glob("*.json")):
            schema = _load(schema_path)
            uri = schema.get("$id") or f"{base}/{schema_path.name}"
            resources.append(
                (uri, referencing.jsonschema.DRAFT202012.create_resource(schema))
            )
        # The schemas reference the catalog as "catalog.json" relative to their
        # own `$id`, which differs from the catalog's `$id`. Register the
        # catalog under each URI that resolves to, without its `$id`, so its
        # own relative references (such as "common_types.json") resolve
        # against it. In v0.9.1, common_types.json keeps v0.9's `$id`, so it
        # reaches the catalog under v0.9 while the message schemas reach it
        # under v0.9.1.
        catalog = copy.deepcopy(_load(files.catalog))
        catalog.pop("$id", None)
        _allow_other_catalogs(catalog, call_key="@call" if version == V1_0 else "call")
        catalog_uri = f"{base}/catalog.json"
        catalog_uris = {uri.rsplit("/", 1)[0] + "/catalog.json" for uri, _ in resources}
        for uri in sorted(catalog_uris | {catalog_uri}):
            resources.append(
                (uri, referencing.jsonschema.DRAFT202012.create_resource(catalog))
            )
        self.registry: referencing.Registry[Any] = (
            referencing.Registry().with_resources(resources)
        )
        self.version = version
        self._to_renderer = self._validator({"$ref": f"{base}/{files.to_renderer}"})
        self._from_renderer = self._validator({"$ref": f"{base}/{files.from_renderer}"})
        if version == V1_0:
            component_ref = f"{base}/{files.to_renderer}#/$defs/Component"
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
        if "id" in keys and "component" in keys:
            return self._component
        if keys & _FROM_RENDERER_KEYS:
            return self._from_renderer
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
    errors = sorted(
        validator.iter_errors(payload),
        key=lambda e: tuple(str(x) for x in e.absolute_path),
    )
    return [
        f"v{version}: {'/'.join(map(str, e.absolute_path)) or '<root>'}:"
        f" {e.message[:200]}"
        for e in errors
    ]


_UNTABBED_MESSAGE_KEYS = _TO_RENDERER_KEYS | {
    "callAgentFunction",
    "rendererFunctionResponse",
}


def _is_untabbed_message(payload: dict[str, Any]) -> bool:
    """Returns True when an untabbed object without `version` is a message."""
    keys = set(payload)
    return bool(keys & _UNTABBED_MESSAGE_KEYS) or (
        bool(keys) and keys <= {"action", "error"}
    )


def _versions_for_payload(payload: Any, tab_version: str | None) -> list[str]:
    """Determines which protocol versions apply to a parsed JSON payload."""
    if tab_version:
        return [tab_version]
    if not isinstance(payload, dict):
        return []
    if "version" in payload:
        if payload["version"] == "v0.8":
            return []
        return [_version_for_field(payload["version"]) or V1_0]
    if _is_untabbed_message(payload):
        return [V1_0]
    if "id" in payload and "component" in payload:
        return [V1_0, V0_9_1]
    return []


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
        looks_like_message = any(
            f'"{k}"' in example.text for k in (*_TO_RENDERER_KEYS, "version")
        )
        if tab_version is None and not looks_like_message:
            return []  # Untabbed non-JSON snippets are not protocol examples.
        return [f"invalid JSON: {e}"]
    errors: list[str] = []
    for payload in _payloads(data):
        for version in _versions_for_payload(payload, tab_version):
            errors.extend(_errors_for(payload, version) or [])
    return errors


def iter_doc_files(paths: list[pathlib.Path]) -> Iterator[pathlib.Path]:
    for path in paths:
        if path.is_dir():
            for suffix in ("*.md", "*.mdx"):
                yield from sorted(path.rglob(suffix))
        elif not path.exists():
            raise SystemExit(f"error: --paths entry not found: {path}")
        elif path.suffix in (".md", ".mdx"):
            yield path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--paths",
        nargs="+",
        type=pathlib.Path,
        default=[REPO_ROOT / "docs/site/src/content/docs"],
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
