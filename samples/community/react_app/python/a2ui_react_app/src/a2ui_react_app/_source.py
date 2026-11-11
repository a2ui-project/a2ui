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

"""Static facts about a ReactApp source, read with regular expressions.

The checks, the transformer (which fills in missing allowlists) and the evals
all read sources through `react_app_source_facts`, so they agree on what an
app reads, writes, calls and imports.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
import re

__all__ = [
    "A2UI_MODULE_EXPORTS",
    "PRIMITIVES",
    "ReactAppSourceFacts",
    "react_app_source_facts",
    "strip_comments",
]

PRIMITIVES: tuple[str, ...] = ("Card", "Button", "Text", "Slider", "Stack", "VegaChart")
"""The styled components of the `a2ui` module."""

A2UI_MODULE_EXPORTS: tuple[str, ...] = (
    "useData",
    "getData",
    "setData",
    "subscribe",
    "callFunction",
    "useFunction",
    "dispatchAction",
    "theme",
    "useTheme",
    *PRIMITIVES,
)
"""The values the `a2ui` module exports. None of them is a catalog function."""

# Strings are matched so that comment markers inside them are kept; comments
# are matched so that code inside them is ignored.
_STRING_OR_COMMENT_RE = re.compile(
    r"""("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)"""
    r"""|//[^\n]*|/\*[\s\S]*?\*/"""
)
_STRING_RE = re.compile(
    r"""(")((?:\\.|[^"\\\n])*)"|(')((?:\\.|[^'\\\n])*)'|(`)((?:\\.|[^`\\])*)`"""
)
_TYPE_ARGS = r"(?:<[^()]*?>)?"
_FIRST_ARG = (
    r"\s*"
    + _TYPE_ARGS
    + r"""\s*\(\s*(?:(?P<q>['"`])(?P<text>(?:\\.|(?!(?P=q))[^\\\n])*)(?P=q)\s*[,)])?"""
)
_PATH_CALL_RE = re.compile(
    r"(?<![\w$])(useData|getData|setData|subscribe)" + _FIRST_ARG
)
_FUNCTION_CALL_RE = re.compile(r"(?<![\w$])(callFunction|useFunction)" + _FIRST_ARG)
_ACTION_CALL_RE = re.compile(r"(?<![\w$])(dispatchAction)" + _FIRST_ARG)
_SETTER_RE = re.compile(
    r"""\[\s*[\w$]*\s*,\s*([\w$]+)\s*\]\s*=\s*useData""" + _FIRST_ARG
)
_NAMED_IMPORT_RE = re.compile(
    r"""(?<![\w$.])import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])([^'"\n]+)\2"""
)
_NAMESPACE_IMPORT_RE = re.compile(
    r"""(?<![\w$.])import\s+(?:[\w$]+\s*,\s*)?\*\s*as\s+([\w$]+)\s*from\s*(['"])a2ui:bindings\2"""
)
_HEX_COLOR_RE = re.compile(
    r"""['"`]\s*#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b"""
)
_RGB_COLOR_RE = re.compile(r"""['"`]\s*(?:rgb|rgba|hsl|hsla)\(""")
_HOOK_CALL_RE = re.compile(r"(?<![\w$.])(use[A-Z][\w$]*)\s*" + _TYPE_ARGS + r"\s*\(")
_CALLBACK_HOOK_RE = re.compile(
    r"(?<![\w$.])(useEffect|useLayoutEffect|useInsertionEffect|useMemo|useCallback)\s*"
    + _TYPE_ARGS
    + r"\s*\("
)
_HANDLER_RE = re.compile(r"(?<![\w$.-])(on[A-Z][\w$]*)\s*=\s*\{")
_LOOP_CALLBACK_RE = re.compile(
    r"\.(map|forEach|filter|reduce|some|every|find|flatMap)\s*\("
)
_FORBIDDEN_APIS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("fetch", re.compile(r"(?<![\w$.])fetch\s*\(|\bwindow\s*\.\s*fetch\b")),
    ("XMLHttpRequest", re.compile(r"(?<![\w$])XMLHttpRequest\b")),
    ("WebSocket", re.compile(r"(?<![\w$])WebSocket\b")),
    ("EventSource", re.compile(r"(?<![\w$])EventSource\b")),
    ("navigator.sendBeacon", re.compile(r"\bnavigator\s*\.\s*sendBeacon\b")),
    (
        "location navigation",
        re.compile(
            r"(?<![\w$])location\s*(?:\.\s*href\s*)?=(?!=)"
            r"|(?<![\w$])location\s*\.\s*(?:assign|replace|reload)\s*\("
        ),
    ),
    ("window.open", re.compile(r"\bwindow\s*\.\s*open\s*\(")),
)


@dataclass(frozen=True)
class ReactAppSourceFacts:
    """What one ReactApp source reads, writes, calls and uses.

    Comments are ignored. Only string literals count as paths and names; a
    call whose first argument is built at runtime sets the matching
    `dynamic_*` flag instead.

    Attributes:
        read_paths: Paths passed to `useData`, `getData` or `subscribe`.
        written_paths: Paths passed to `setData`, plus `useData` paths whose
            setter the app calls.
        dynamic_paths: Whether a data call takes a path built at runtime.
        functions: Names passed to `callFunction` or `useFunction`.
        bound_functions: Names imported from `a2ui:bindings`, or used on a
            namespace import of it.
        dynamic_functions: Whether a function call takes a computed name.
        actions: Names passed to `dispatchAction`.
        dynamic_actions: Whether `dispatchAction` takes a computed name.
        a2ui_imports: Names imported from `a2ui`.
        forbidden_apis: Browser APIs the frame blocks that the app uses, such
            as `fetch`, in source order.
        misplaced_hooks: `(hook, where)` for each hook called inside an
            effect or memo callback, an event handler or a loop callback.
        uses_css_vars: Whether the source uses `var(--a2ui-*)`.
        uses_theme: Whether the source reads `theme` or calls `useTheme`.
        hard_coded_colors: Number of color literals (hex, rgb(), hsl()).
    """

    read_paths: frozenset[str] = frozenset()
    written_paths: frozenset[str] = frozenset()
    dynamic_paths: bool = False
    functions: frozenset[str] = frozenset()
    bound_functions: frozenset[str] = frozenset()
    dynamic_functions: bool = False
    actions: frozenset[str] = frozenset()
    dynamic_actions: bool = False
    a2ui_imports: frozenset[str] = frozenset()
    forbidden_apis: tuple[str, ...] = ()
    misplaced_hooks: tuple[tuple[str, str], ...] = ()
    uses_css_vars: bool = False
    uses_theme: bool = False
    hard_coded_colors: int = 0

    @property
    def paths(self) -> frozenset[str]:
        """Every path the app reads or writes."""
        return self.read_paths | self.written_paths

    @property
    def called_functions(self) -> frozenset[str]:
        """Every function the app calls, by name or through the bindings."""
        return self.functions | self.bound_functions

    @property
    def primitives(self) -> frozenset[str]:
        """The styled `a2ui` components the app imports."""
        return self.a2ui_imports & frozenset(PRIMITIVES)

    @property
    def themed(self) -> bool:
        """Whether the app takes its look from the theme rather than literals."""
        return bool(self.primitives) or self.uses_css_vars or self.uses_theme


def strip_comments(source: str) -> str:
    """Replaces the comments in TypeScript source with spaces, keeping strings."""
    return _STRING_OR_COMMENT_RE.sub(
        lambda m: m.group(1) if m.group(1) is not None else " ", source
    )


def _mask_strings(code: str) -> str:
    """Blanks the contents of string literals, so brackets inside them don't count."""

    def blank(match: re.Match[str]) -> str:
        quote = next(q for q in match.groups()[::2] if q is not None)
        return quote + " " * (len(match.group(0)) - 2) + quote

    return _STRING_RE.sub(blank, code)


def _literal(match: re.Match[str]) -> str | None:
    """The first argument of a matched call, when it is a plain string literal."""
    quote, text = match.group("q"), match.group("text")
    if quote is None or (quote == "`" and "${" in text):
        return None
    return text


def _literals(pattern: re.Pattern[str], code: str) -> Iterator[tuple[str, str | None]]:
    for match in pattern.finditer(code):
        yield match.group(1), _literal(match)


def _span_end(code: str, open_index: int) -> int:
    """The index just past the bracket that closes the one at `open_index`."""
    pairs = {"(": ")", "{": "}", "[": "]"}
    stack: list[str] = []
    for index in range(open_index, len(code)):
        char = code[index]
        if char in pairs:
            stack.append(pairs[char])
        elif stack and char == stack[-1]:
            stack.pop()
            if not stack:
                return index + 1
    return len(code)


def _misplaced_hooks(masked: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    scopes: list[tuple[int, int, str]] = []
    for match in _CALLBACK_HOOK_RE.finditer(masked):
        scopes.append((
            match.end(),
            _span_end(masked, match.end() - 1),
            f"a `{match.group(1)}` callback",
        ))
    for match in _HANDLER_RE.finditer(masked):
        scopes.append((
            match.end(),
            _span_end(masked, match.end() - 1),
            f"the `{match.group(1)}` handler",
        ))
    for match in _LOOP_CALLBACK_RE.finditer(masked):
        scopes.append((
            match.end(),
            _span_end(masked, match.end() - 1),
            f"a `.{match.group(1)}` callback",
        ))
    seen: set[tuple[str, str]] = set()
    for start, end, where in scopes:
        for hook in _HOOK_CALL_RE.finditer(masked, start, end):
            item = (hook.group(1), where)
            if item not in seen:
                seen.add(item)
                found.append(item)
    return found


def react_app_source_facts(source: str) -> ReactAppSourceFacts:
    """Reads the `ReactAppSourceFacts` of one ReactApp source.

    Args:
        source: The app's TSX source.

    Returns:
        The facts. A source that isn't a string gives empty facts.
    """
    if not isinstance(source, str):
        return ReactAppSourceFacts()
    code = strip_comments(source)
    read: set[str] = set()
    written: set[str] = set()
    dynamic_paths = False
    for kind, path in _literals(_PATH_CALL_RE, code):
        if path is None:
            dynamic_paths = True
        elif kind == "setData":
            written.add(path)
        else:
            read.add(path)
    # `const [x, setX] = useData("/p", ...)` followed by a call of `setX(...)`.
    for match in _SETTER_RE.finditer(code):
        path = _literal(match)
        setter = match.group(1)
        if path is not None and re.search(
            rf"(?<![\w$]){re.escape(setter)}\s*\(", code[match.end() :]
        ):
            written.add(path)
    functions = [name for _, name in _literals(_FUNCTION_CALL_RE, code)]
    actions = [name for _, name in _literals(_ACTION_CALL_RE, code)]
    a2ui_imports: set[str] = set()
    bound: set[str] = set()
    called_bound: set[str] = set()
    for match in _NAMED_IMPORT_RE.finditer(code):
        module = match.group(3)
        if module not in ("a2ui", "a2ui:bindings"):
            continue
        for part in match.group(1).split(","):
            raw = re.sub(r"^type\s+", "", part.strip())
            imported, _, alias = raw.partition(" as ")
            name = imported.strip()
            local = (alias or imported).strip()
            if not name:
                continue
            if module == "a2ui":
                a2ui_imports.add(name)
            else:
                bound.add(name)
                if re.search(
                    rf"(?<![\w$]){re.escape(local)}\s*\(", code[match.end() :]
                ):
                    called_bound.add(name)
    for match in _NAMESPACE_IMPORT_RE.finditer(code):
        member = re.compile(
            rf"(?<![\w$.]){re.escape(match.group(1))}\s*\??\.\s*([\w$]+)"
        )
        for member_match in member.finditer(code):
            bound.add(member_match.group(1))
            called_bound.add(member_match.group(1))
    masked = _mask_strings(code)
    return ReactAppSourceFacts(
        read_paths=frozenset(read),
        written_paths=frozenset(written),
        dynamic_paths=dynamic_paths,
        functions=frozenset(n for n in functions if n is not None)
        | frozenset(called_bound),
        bound_functions=frozenset(bound),
        dynamic_functions=None in functions,
        actions=frozenset(n for n in actions if n is not None),
        dynamic_actions=None in actions,
        a2ui_imports=frozenset(a2ui_imports),
        forbidden_apis=tuple(
            name for name, pattern in _FORBIDDEN_APIS if pattern.search(masked)
        ),
        misplaced_hooks=tuple(_misplaced_hooks(masked)),
        uses_css_vars="var(--a2ui-" in code,
        uses_theme=bool(re.search(r"(?<![\w$])(theme\s*\.|useTheme\s*\()", code)),
        hard_coded_colors=len(_HEX_COLOR_RE.findall(code))
        + len(_RGB_COLOR_RE.findall(code)),
    )
