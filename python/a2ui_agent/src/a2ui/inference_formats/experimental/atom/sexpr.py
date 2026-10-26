# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Typed S-expression reader for the Atom inference format.

The reader keeps the lexical kind of every token, so the compiler can tell
`:id` (a keyword) from `":id"` (a string), `$/a/b` (a path symbol) from
`"$/a/b"` (a string), and `( ... )` from `[ ... ]`.

- Keywords parse to `Keyword`, a `str` that keeps its leading colon.
- Bare words (component names, function names, paths) parse to `Symbol`.
- Quoted strings parse to plain `str`.
- `( ... )` parses to `Form`; `[ ... ]` parses to a plain `list`.
- `true`, `false`, `null` and numbers parse to Python literals.
"""

from __future__ import annotations

import json
import re
from typing import Any


class Keyword(str):
    """A `:name` token. The value keeps the leading colon."""

    @property
    def name(self) -> str:
        """The keyword without its leading colon."""
        return str(self)[1:]


class Symbol(str):
    """A bare token that is not a keyword, string, number, boolean or null."""


class Form(list):
    """A parenthesized expression. Bracketed lists parse to a plain `list`."""


_TOKEN_SPEC = (
    # `;` starts a comment anywhere; `#` only when followed by a space or the
    # end of the line, so symbols may still contain `#`.
    ("COMMENT", r";[^\n]*|#(?=\s|$)[^\n]*"),
    ("LPAREN", r"\("),
    ("LBRACKET", r"\["),
    ("RPAREN", r"\)"),
    ("RBRACKET", r"\]"),
    ("KEYWORD_VAL", r':[\w-]+=[^\s()":\[\],]+'),
    ("KEYWORD", r":[\w-]+:?"),
    ("SYMBOL", r'[^\s()":\[\],]+'),
    ("SKIP", r"[,\s]+"),
)
_TOKEN_RE = re.compile("|".join(f"(?P<{name}>{pat})" for name, pat in _TOKEN_SPEC))
_STRING_RE = re.compile(r'"(?:\\.|[^"\\])*"')
_INT_RE = re.compile(r"-?\d+")
_FLOAT_RE = re.compile(r"-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?")

# Token kinds after tokenizing.
_OPEN = {"LPAREN": "RPAREN", "LBRACKET": "RBRACKET"}
_CLOSE = ("RPAREN", "RBRACKET")


def _tokenize(text: str) -> list[tuple[str, str]]:
    """Splits text into (kind, value) tokens.

    An unterminated string at the end of the input is closed, so that a
    truncated stream still tokenizes.

    Raises:
        SyntaxError: If the text contains a character no token can start with.
    """
    tokens: list[tuple[str, str]] = []
    pos = 0
    while pos < len(text):
        if text[pos] == '"':
            m = _STRING_RE.match(text, pos)
            if m:
                tokens.append(("STRING", m.group()))
                pos = m.end()
                continue
            tokens.append(("STRING", text[pos:] + '"'))
            break
        mo = _TOKEN_RE.match(text, pos)
        if not mo:
            raise SyntaxError(f"Unexpected character in Atom input: {text[pos:]!r}")
        kind = mo.lastgroup or ""
        value = mo.group()
        pos = mo.end()
        if kind in ("SKIP", "COMMENT"):
            continue
        if kind == "KEYWORD_VAL":
            k, v = value.split("=", 1)
            tokens.append(("KEYWORD", k))
            tokens.append(("SYMBOL", v))
        elif kind == "KEYWORD":
            tokens.append(("KEYWORD", value.rstrip(":")))
        else:
            tokens.append((kind, value))
    return tokens


def _atom(kind: str, value: str) -> Any:
    if kind == "STRING":
        try:
            return json.loads(value, strict=False)
        except json.JSONDecodeError:
            return value[1:-1]
    if kind == "KEYWORD":
        return Keyword(value)
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "null":
        return None
    if _INT_RE.fullmatch(value):
        return int(value)
    if _FLOAT_RE.fullmatch(value):
        return float(value)
    return Symbol(value)


def parse_sexpr(text: str) -> list[Any]:
    """Parses Atom text into a list of top-level expressions.

    Missing closing parentheses at the end of the input are added, and stray
    closing parentheses are ignored, so that truncated output still parses.

    Args:
        text: The Atom source text.

    Returns:
        The top-level expressions, in source order.

    Raises:
        SyntaxError: If the text contains a character no token can start with.
    """
    tokens = _tokenize(text)
    pos = 0

    def parse_expr() -> tuple[bool, Any]:
        nonlocal pos
        kind, value = tokens[pos]
        pos += 1
        if kind in _OPEN:
            closing = _OPEN[kind]
            elements: list[Any] = Form() if kind == "LPAREN" else []
            while pos < len(tokens) and tokens[pos][0] != closing:
                ok, sub = parse_expr()
                if ok:
                    elements.append(sub)
            if pos < len(tokens):
                pos += 1
            return True, elements
        if kind in _CLOSE:
            return False, None
        return True, _atom(kind, value)

    expressions: list[Any] = []
    while pos < len(tokens):
        ok, expr = parse_expr()
        if ok:
            expressions.append(expr)
    return expressions


def is_keyword(value: Any) -> bool:
    """Whether a parsed value is a keyword token."""
    return isinstance(value, Keyword)


def is_symbol(value: Any) -> bool:
    """Whether a parsed value is a bare symbol token."""
    return isinstance(value, Symbol)
