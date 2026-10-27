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

"""Shared loaders, sample payload parsers, and report formatters for catalog pattern tooling.

These scripts are standalone developer tooling and import public SDK facades only.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Literal, TextIO

from a2ui.core import A2uiError, Catalog, CatalogApi
from a2ui.inference_formats.decision import (
    ArchetypeGrammar,
    CatalogDecisionGraph,
    PatternError,
    PatternLibrary,
    TemplateRegistry,
)


class ToolError(Exception):
    """User-facing CLI failure; printed to stderr with exit code 2."""


@dataclass(frozen=True)
class LoadedCatalog:
    """Loaded A2UI catalog paired with its decision graph, grammar, and target directory."""

    path: Path
    target_dir: Path
    catalog: CatalogApi
    graph: CatalogDecisionGraph
    grammar: ArchetypeGrammar


def _read_json_object(path: Path, label: str) -> dict[str, Any]:
    """Reads and validates that `path` contains a JSON object."""
    try:
        raw_text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ToolError(f"Failed to read {label} at {path}: {exc}") from exc
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ToolError(f"Malformed JSON in {label} at {path}: {exc}") from exc
    if not isinstance(parsed, Mapping):
        raise ToolError(f"Expected a JSON object in {label} at {path}.")
    return dict(parsed)


def load_catalog(
    path: str | Path, *, out_dir: str | Path | None = None
) -> LoadedCatalog:
    """Loads a `catalog.json` file and constructs its `CatalogDecisionGraph`."""
    resolved = Path(path).resolve()
    target_dir = Path(out_dir).resolve() if out_dir is not None else resolved.parent
    doc = _read_json_object(resolved, "catalog")
    try:
        catalog = Catalog.from_json(doc)
        graph = CatalogDecisionGraph([catalog])
        grammar = ArchetypeGrammar.default()
    except (A2uiError, ValueError, TypeError, KeyError) as exc:
        raise ToolError(f"Invalid catalog at {resolved}: {exc}") from exc
    return LoadedCatalog(
        path=resolved,
        target_dir=target_dir,
        catalog=catalog,
        graph=graph,
        grammar=grammar,
    )


def load_pattern_library(path: str | Path) -> PatternLibrary:
    """Loads and validates a `patterns.json` file or directory."""
    resolved = Path(path).resolve()
    try:
        return PatternLibrary.from_file(resolved)
    except (
        PatternError,
        A2uiError,
        OSError,
        json.JSONDecodeError,
        ValueError,
    ) as exc:
        raise ToolError(f"Invalid patterns file at {resolved}: {exc}") from exc


def load_template_registry(path: str | Path) -> TemplateRegistry:
    """Loads and validates a `templates.json` file or directory."""
    resolved = Path(path).resolve()
    try:
        return TemplateRegistry.from_file(resolved)
    except (
        A2uiError,
        OSError,
        json.JSONDecodeError,
        ValueError,
        KeyError,
    ) as exc:
        raise ToolError(f"Invalid templates file at {resolved}: {exc}") from exc


def _parse_samples_map(path: Path, raw_samples: Any) -> dict[str, dict[str, Any]]:
    """Validates a `{"samples": {...}}` map of named payload dicts."""
    if not isinstance(raw_samples, Mapping) or not raw_samples:
        raise ToolError(
            f"Sample payloads 'samples' at {path} must be a non-empty object."
        )
    samples: dict[str, dict[str, Any]] = {}
    for name, payload in raw_samples.items():
        if not isinstance(name, str) or not name.strip():
            raise ToolError(
                f"Sample payload name in {path} must be a non-empty string."
            )
        if not isinstance(payload, Mapping) or not payload:
            raise ToolError(
                f"Sample payload '{name}' in {path} must be a non-empty object."
            )
        samples[name] = dict(payload)
    return samples


def load_sample_payloads(path: str | Path) -> dict[str, dict[str, Any]]:
    """Loads sample payloads from `path`.

    Accepts either:
    - `{"samples": {"<sample_name>": {<payload_dict>}, ...}}` for multiple named samples, or
    - `{<payload_dict>}` for a single payload (returned under the key `"default"`).
    """
    resolved = Path(path).resolve()
    doc = _read_json_object(resolved, "sample payloads")
    if not doc:
        raise ToolError(f"Sample payloads file at {resolved} must not be empty.")
    if "samples" in doc and isinstance(doc["samples"], Mapping):
        return _parse_samples_map(resolved, doc["samples"])
    return {"default": doc}


def render_markdown_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    """Renders a GitHub-flavored Markdown pipe table."""
    header_line = "| " + " | ".join(headers) + " |"
    sep_line = "| " + " | ".join("---" for _ in headers) + " |"
    body_lines = ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return "\n".join([header_line, sep_line, *body_lines])


def write_report(
    report: Mapping[str, Any],
    *,
    fmt: Literal["json", "markdown"],
    out: TextIO,
    markdown: str | None = None,
) -> None:
    """Writes `report` as formatted JSON or Markdown to `out`."""
    if fmt == "markdown" and markdown is not None:
        text = markdown if markdown.endswith("\n") else f"{markdown}\n"
        out.write(text)
        return
    out.write(json.dumps(report, indent=2) + "\n")
