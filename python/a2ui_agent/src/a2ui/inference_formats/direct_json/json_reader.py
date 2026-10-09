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

"""Reads the JSON a model writes, which is often almost JSON.

Both readers accept what a model commonly gets wrong and a strict decoder
rejects: a trailing comma before `]` or `}`, and a raw line break or tab
inside a string. When the text does not read as it is, they read it again
with curly quotes straightened, so a curly quote inside a string that is
otherwise valid JSON is kept.
"""

from __future__ import annotations

from collections.abc import Collection
import re
from typing import Any, NoReturn, TypeVar

_T = TypeVar("_T")
_NUMBER_RE = re.compile(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$")
# Values that are never healed while they arrive: a cut URL is a different,
# usually broken, address rather than a shorter version of the same text.
_URL_PREFIXES = ("http://", "https://", "data:")


def read_json(text: str) -> Any:
    """Reads the complete JSON document `text`.

    Raises:
      ValueError: If `text` is not a single JSON value.
    """
    try:
        return _Reader(text, None).document()
    except ValueError:
        straight = _straighten_quotes(text)
        if straight == text:
            raise
        return _Reader(straight, None).document()


def read_partial_messages(
    text: str,
    progressive_keys: Collection[str],
    whole_item_keys: Collection[str] = frozenset(),
) -> list[Any]:
    """Reads a partial JSON array or object into a list of candidate envelopes."""
    return [
        message
        for message, _ in read_partial_message_items(
            text, progressive_keys, whole_item_keys
        )
    ]


def read_partial_message_items(
    text: str,
    progressive_keys: Collection[str],
    whole_item_keys: Collection[str] = frozenset(),
) -> list[tuple[Any, bool]]:
    """Reads a partial JSON array or object into candidate envelopes.

    Returns:
      One `(envelope, closed)` pair per message, in order. `closed` is False
      when the message's text was still arriving and the reader healed it.
    """
    prog_set = set(progressive_keys)
    whole_set = set(whole_item_keys)
    try:
        return _Reader(text, prog_set, whole_set).message_items()
    except ValueError:
        straight = _straighten_quotes(text)
        if straight == text:
            return []
        try:
            return _Reader(straight, prog_set, whole_set).message_items()
        except ValueError:
            return []


def _straighten_quotes(text: str) -> str:
    return (
        text.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
    )


class _Unfinished(Exception):
    """Raised where the text ends before a value that cannot be healed."""


class _Reader:
    """Recursive-descent JSON and partial-JSON reader."""

    def __init__(
        self,
        text: str,
        progressive_keys: set[str] | None,
        whole_item_keys: set[str] = frozenset(),  # type: ignore[assignment]
    ):
        self.text = text
        self.progressive_keys = progressive_keys
        self.whole_item_keys = set(whole_item_keys)
        self._i = 0
        self._cut = False

    @property
    def _partial(self) -> bool:
        return self.progressive_keys is not None

    @property
    def _at_end(self) -> bool:
        return self._i >= len(self.text)

    def document(self) -> Any:
        self._skip_space()
        value = self._value(healable=False)
        self._skip_space()
        if not self._at_end:
            self._fail("unexpected text after the JSON value")
        return value

    def message_items(self) -> list[tuple[Any, bool]]:
        self._skip_space()
        if self._at_end:
            return []
        if self.text[self._i] != "[":
            try:
                self._cut = False
                message = self._value(healable=False)
                closed = not self._cut
                self._skip_space()
                if not self._at_end:
                    self._fail("unexpected text after the JSON value")
                return [(message, closed)]
            except _Unfinished:
                return []
        self._i += 1
        messages: list[tuple[Any, bool]] = []
        while True:
            self._skip_space()
            if self._at_end:
                return messages
            if self.text[self._i] == "]":
                self._i += 1
                self._skip_space()
                if not self._at_end:
                    self._fail("unexpected text after the JSON value")
                return messages
            try:
                self._cut = False
                message = self._value(healable=False)
                messages.append((message, not self._cut))
            except _Unfinished:
                return messages
            self._skip_space()
            if self._at_end:
                return messages
            if self.text[self._i] == ",":
                self._i += 1
            elif self.text[self._i] != "]":
                self._fail("expected ',' or ']'")

    def _value(self, *, healable: bool) -> Any:
        if self._at_end:
            self._end()
        c = self.text[self._i]
        if c == "{":
            return self._object()
        if c == "[":
            return self._array()
        if c == '"':
            return self._string(healable=healable)
        if c == "-" or ("0" <= c <= "9"):
            return self._number()
        for word, val in (("true", True), ("false", False), ("null", None)):
            if self.text.startswith(word, self._i):
                self._i += len(word)
                return val
            if self._partial and word.startswith(self.text[self._i :]):
                self._end()
        self._fail(f"unexpected character '{c}'")

    def _object(self) -> dict[str, Any]:
        self._i += 1
        obj: dict[str, Any] = {}
        while True:
            self._skip_space()
            if self._at_end:
                return self._healed(obj)
            if self.text[self._i] == "}":
                self._i += 1
                return obj
            if self.text[self._i] != '"':
                self._fail("expected a key")
            key = self._string(healable=False)
            self._skip_space()
            if self._at_end:
                self._end()
            if self.text[self._i] != ":":
                self._fail(f"expected ':' after key '{key}'")
            self._i += 1
            self._skip_space()
            if (
                not self._at_end
                and self.text[self._i] == "["
                and self._partial
                and key in self.whole_item_keys
            ):
                obj[key] = self._array(whole_items=True)
            else:
                healable_val = (
                    self.progressive_keys is not None and key in self.progressive_keys
                )
                obj[key] = self._value(healable=healable_val)
            self._skip_space()
            if self._at_end:
                return self._healed(obj)
            if self.text[self._i] == ",":
                self._i += 1
            elif self.text[self._i] != "}":
                self._fail("expected ',' or '}'")

    def _array(self, *, whole_items: bool = False) -> list[Any]:
        self._i += 1
        arr: list[Any] = []
        while True:
            self._skip_space()
            if self._at_end:
                return self._healed(arr)
            if self.text[self._i] == "]":
                self._i += 1
                return arr
            if whole_items:
                cut_before = self._cut
                self._cut = False
                try:
                    item = self._value(healable=False)
                except _Unfinished:
                    return self._healed(arr)
                if self._cut:
                    return self._healed(arr)
                self._cut = cut_before
                arr.append(item)
            else:
                arr.append(self._value(healable=False))
            self._skip_space()
            if self._at_end:
                return self._healed(arr)
            if self.text[self._i] == ",":
                self._i += 1
            elif self.text[self._i] != "]":
                self._fail("expected ',' or ']'")

    def _healed(self, value: _T) -> _T:
        if not self._partial:
            self._end()
        self._cut = True
        return value

    def _string(self, *, healable: bool) -> str:
        self._i += 1
        buf: list[str] = []
        n = len(self.text)
        while not self._at_end:
            c = self.text[self._i]
            if c == '"':
                self._i += 1
                return "".join(buf)
            if c != "\\":
                buf.append(c)
                self._i += 1
                continue
            if self._i + 1 >= n:
                self._i = n
                break
            escaped = self.text[self._i + 1]
            if escaped in ('"', "\\", "/"):
                buf.append(escaped)
            elif escaped == "b":
                buf.append("\b")
            elif escaped == "f":
                buf.append("\f")
            elif escaped == "n":
                buf.append("\n")
            elif escaped == "r":
                buf.append("\r")
            elif escaped == "t":
                buf.append("\t")
            elif escaped == "u":
                if self._i + 6 > n:
                    self._i = n
                    continue
                hex_str = self.text[self._i + 2 : self._i + 6]
                try:
                    code = int(hex_str, 16)
                except ValueError:
                    self._fail("invalid unicode escape")
                if 0xD800 <= code <= 0xDBFF:
                    if self._i + 12 > n:
                        if (
                            self._partial
                            and self.text[self._i + 6 : n] == "\\u"[: n - (self._i + 6)]
                            or (
                                self._partial
                                and self._i + 8 <= n
                                and self.text[self._i + 6 : self._i + 8] == "\\u"
                            )
                        ):
                            self._i = n
                            continue
                    if (
                        self._i + 12 <= n
                        and self.text[self._i + 6 : self._i + 8] == "\\u"
                    ):
                        low_hex = self.text[self._i + 8 : self._i + 12]
                        try:
                            low = int(low_hex, 16)
                        except ValueError:
                            self._fail("invalid unicode escape")
                        if 0xDC00 <= low <= 0xDFFF:
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
                            self._i += 6
                buf.append(chr(code))
                self._i += 4
            else:
                self._fail(f"invalid escape '\\{escaped}'")
            self._i += 2
        if healable and self._partial:
            value = "".join(buf)
            # A URL that is still arriving names the wrong resource, so it
            # waits for its closing quote like any value that can't heal.
            if not value.startswith(_URL_PREFIXES):
                self._cut = True
                return value
        self._end()

    def _number(self) -> int | float:
        start = self._i
        if self.text[self._i] == "-":
            self._i += 1
        while not self._at_end and (
            ("0" <= self.text[self._i] <= "9") or self.text[self._i] in "+-.eE"
        ):
            self._i += 1
        if self._at_end and self._partial:
            self._end()
        literal = self.text[start : self._i]
        if not _NUMBER_RE.match(literal):
            self._fail(f"invalid number '{literal}'")
        try:
            if "." in literal or "e" in literal or "E" in literal:
                return float(literal)
            return int(literal)
        except ValueError:
            self._fail(f"invalid number '{literal}'")

    def _skip_space(self) -> None:
        while not self._at_end and self.text[self._i] in " \t\n\r":
            self._i += 1

    def _end(self) -> NoReturn:
        if self._partial:
            raise _Unfinished()
        self._fail("unexpected end of the JSON text")

    def _fail(self, reason: str) -> NoReturn:
        raise ValueError(f"Invalid JSON at {self._i}: {reason}")
