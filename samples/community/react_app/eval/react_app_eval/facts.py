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

"""Static facts about ReactApp sources and compiled A2UI messages, for the scorers."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
import re
from typing import Any

from a2ui_react_app import REACT_APP_CATALOG_ID

__all__ = [
    "PRIMITIVES",
    "SourceFacts",
    "iter_react_apps",
    "iter_strings",
    "source_facts",
]

PRIMITIVES = ("Card", "Button", "Text", "Slider", "Stack", "VegaChart")
"""The styled components of the `a2ui` module."""

_PATH_CALL_RE = re.compile(
    r"""\b(useData|getData|setData|subscribe)\s*(?:<[^()]*?>)?\s*\(\s*(['"`])([^'"`$]*)\2"""
)
_FUNCTION_CALL_RE = re.compile(
    r"""\b(callFunction|useFunction)\s*(?:<[^()]*?>)?\s*\(\s*(['"`])([^'"`$]*)\2"""
)
_ACTION_RE = re.compile(r"""\bdispatchAction\s*\(\s*(['"`])([^'"`$]*)\1""")
_A2UI_IMPORT_RE = re.compile(
    r"""import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]a2ui['"]""", re.MULTILINE
)
_HEX_COLOR_RE = re.compile(
    r"""['"`]\s*#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b"""
)
_RGB_COLOR_RE = re.compile(r"""['"`]\s*(?:rgb|rgba|hsl|hsla)\(""")


@dataclass
class SourceFacts:
    """What one ReactApp source reads, writes, calls and uses.

    Attributes:
        read_paths: Literal paths passed to `useData`, `getData` or `subscribe`.
        written_paths: Literal paths passed to `setData`, plus `useData` paths
            whose setter the app uses.
        functions: Literal names passed to `callFunction` or `useFunction`.
        actions: Literal names passed to `dispatchAction`.
        a2ui_imports: Names imported from `a2ui`.
        uses_css_vars: Whether the source uses `var(--a2ui-*)`.
        uses_theme: Whether the source reads `theme` or `useTheme`.
        hard_coded_colors: Number of color literals (hex, rgb(), hsl()).
    """

    read_paths: set[str] = field(default_factory=set)
    written_paths: set[str] = field(default_factory=set)
    functions: set[str] = field(default_factory=set)
    actions: set[str] = field(default_factory=set)
    a2ui_imports: set[str] = field(default_factory=set)
    uses_css_vars: bool = False
    uses_theme: bool = False
    hard_coded_colors: int = 0

    @property
    def paths(self) -> set[str]:
        """Every path the app reads or writes."""
        return self.read_paths | self.written_paths

    @property
    def primitives(self) -> set[str]:
        """The styled `a2ui` components the app imports."""
        return self.a2ui_imports & set(PRIMITIVES)

    @property
    def themed(self) -> bool:
        """Whether the app takes its look from the theme rather than literals."""
        return bool(self.primitives) or self.uses_css_vars or self.uses_theme


def source_facts(source: str) -> SourceFacts:
    """Extracts the `SourceFacts` of one ReactApp source with regular expressions."""
    facts = SourceFacts()
    for match in _PATH_CALL_RE.finditer(source):
        kind, path = match.group(1), match.group(3)
        if kind == "setData":
            facts.written_paths.add(path)
        else:
            facts.read_paths.add(path)
    # `const [x, setX] = useData("/p", ...)` followed by a call of `setX(...)`.
    for match in re.finditer(
        r"""\[\s*\w*\s*,\s*(\w+)\s*\]\s*=\s*useData\s*(?:<[^()]*?>)?\s*\(\s*(['"`])([^'"`$]*)\2""",
        source,
    ):
        setter, path = match.group(1), match.group(3)
        if re.search(rf"""\b{re.escape(setter)}\s*\(""", source[match.end() :]):
            facts.written_paths.add(path)
    facts.functions = {m.group(3) for m in _FUNCTION_CALL_RE.finditer(source)}
    facts.actions = {m.group(2) for m in _ACTION_RE.finditer(source)}
    for match in _A2UI_IMPORT_RE.finditer(source):
        for name in match.group(1).split(","):
            name = name.strip().split(" as ")[0].strip()
            if name.startswith("type "):
                name = name[5:].strip()
            if name:
                facts.a2ui_imports.add(name)
    facts.uses_css_vars = "var(--a2ui-" in source
    facts.uses_theme = bool(re.search(r"\b(theme\.|useTheme\s*\()", source))
    facts.hard_coded_colors = len(_HEX_COLOR_RE.findall(source)) + len(
        _RGB_COLOR_RE.findall(source)
    )
    return facts


def _components_of(message: Mapping[str, Any]) -> Iterator[Mapping[str, Any]]:
    for key in ("createSurface", "updateComponents"):
        body = message.get(key)
        if isinstance(body, Mapping):
            for component in body.get("components") or []:
                if isinstance(component, Mapping):
                    yield component


def iter_react_apps(
    messages: Iterable[Mapping[str, Any]],
) -> Iterator[Mapping[str, Any]]:
    """Yields every `ReactApp` component of compiled messages.

    A component counts when it names the ReactApp catalog, or names no catalog
    (single-catalog payloads stamp none).
    """
    for message in messages:
        if not isinstance(message, Mapping):
            continue
        for component in _components_of(message):
            catalog_id = component.get("catalogId")
            if component.get("component") == "ReactApp" and catalog_id in (
                None,
                REACT_APP_CATALOG_ID,
            ):
                yield component


def iter_strings(value: Any) -> Iterator[str]:
    """Yields every string leaf of a JSON value, keys excluded."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for child in value.values():
            yield from iter_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_strings(child)
