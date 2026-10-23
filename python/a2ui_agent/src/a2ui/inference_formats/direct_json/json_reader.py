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

from collections.abc import Callable, Collection
import re
from typing import Any, NoReturn, TypeVar, cast

_T = TypeVar("_T")
_NUMBER_RE = re.compile(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$")
# Values that are never healed while they arrive: a cut URL is a different,
# usually broken, address rather than a shorter version of the same text.
_URL_PREFIXES = ("http://", "https://", "data:")
# A run of string characters that are neither a quote nor an escape.
_PLAIN_RUN = re.compile(r'[^"\\]+')
_PLAIN_RUN_NO_NEWLINES = re.compile(r'[^"\\\r\n]+')


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


class PartialReadCache:
    """What the reads of a payload as it arrives keep for the next read.

    Each read through a cache then reads only what the earlier ones left
    open: a list or map that closed in an earlier read is taken from the
    cache, as the same object, and a list still open, the list of messages
    included, is read on from its last item that closed.

    Every read through a cache must start at the same offset, and read a text
    that holds the same characters as the earlier ones wherever both reach,
    and that reaches the end of every list or map they read. The Direct JSON
    stream reads a block that only grows, less any Markdown fence at its end.
    """

    def __init__(self) -> None:
        self._plain = _ReadState()
        # The reads of the text with curly quotes straightened, which has the
        # same offsets.
        self._straight = _ReadState()
        self.complete = False
        """Whether the last read reached the end of the payload's JSON value."""


class _ReadState:
    """What the reads of one text keep for the next read.

    An offset is the index of a character in the text, so the offset after a
    closing bracket is the index of the character that follows it.
    """

    def __init__(self) -> None:
        # Each list or map that closed, by the offset of its opening bracket,
        # with the offset after its closing one.
        self.closed: dict[int, tuple[Any, int]] = {}
        # Each list still open, by the offset of its opening bracket, with
        # the items that closed and the offset after the last of them.
        self.open: dict[int, tuple[list[Any], int]] = {}
        # For a payload written as a list of messages, the messages whose
        # JSON value has closed and the offset after the last of them, where
        # the next read goes on.
        self.messages: tuple[list[tuple[Any, bool]], int] | None = None


def read_partial_message_items(
    text: str,
    progressive_keys: Collection[str],
    whole_item_keys: Collection[str] = frozenset(),
    *,
    cache: PartialReadCache | None = None,
    start: int = 0,
    end: int | None = None,
) -> list[tuple[Any, bool]]:
    """Reads a partial JSON array or object into candidate envelopes.

    Args:
      text: The start of a payload: a list of messages, or one message.
      progressive_keys: The keys whose string value is healed while it
        arrives.
      whole_item_keys: The keys whose list value holds only the items that
        have closed.
      cache: What earlier reads of the same payload kept, as
        `PartialReadCache` describes. The caller must not change the lists
        and maps returned.
      start: Where the payload starts in `text`.
      end: Where the part of `text` to read ends. All of it by default.

    Returns:
      One `(envelope, closed)` pair per message, in order. `closed` is False
      when the message's text was still arriving and the reader healed it.
    """
    prog_set = set(progressive_keys)
    whole_set = set(whole_item_keys)
    limit = len(text) if end is None else end

    def read(source: str, state: _ReadState | None) -> list[tuple[Any, bool]]:
        reader = _Reader(source, prog_set, whole_set, state, start, limit)
        items = reader.message_items()
        if cache is not None:
            cache.complete = reader.complete
        return items

    if cache is not None:
        cache.complete = False
    try:
        return read(text, cache._plain if cache is not None else None)
    except ValueError:
        straight = _straighten_quotes(text)
        if straight == text:
            return []
        try:
            return read(straight, cache._straight if cache is not None else None)
        except ValueError:
            return []


def _straighten_quotes(text: str) -> str:
    return (
        text.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
    )


_NEWLINE_STRIPPED_KEYS = frozenset({
    "id",
    "component",
    "child",
    "surfaceId",
    "catalogId",
    "componentId",
})


class _Unfinished(Exception):
    """Raised where the text ends before a value that cannot be healed."""


class _Reader:
    """Recursive-descent JSON and partial-JSON reader."""

    def __init__(
        self,
        text: str,
        progressive_keys: set[str] | None,
        whole_item_keys: set[str] = frozenset(),  # type: ignore[assignment]
        state: _ReadState | None = None,
        start: int = 0,
        end: int | None = None,
    ):
        self.text = text
        self.progressive_keys = progressive_keys
        self.whole_item_keys = set(whole_item_keys)
        self._state = state
        self._i = start
        self._limit = len(text) if end is None else end
        self._cut = False
        # Whether the read reached the end of the payload's JSON value.
        self.complete = False
        self._in_data_model = False

    @property
    def _partial(self) -> bool:
        return self.progressive_keys is not None

    @property
    def _at_end(self) -> bool:
        return self._i >= self._limit

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
                self.complete = closed
                return [(message, closed)]
            except _Unfinished:
                return []
        self._i += 1
        messages: list[tuple[Any, bool]] = []
        # How many of the messages closed, and where the text after the last
        # of them starts, for the next read to go on from.
        closed_count = 0
        resume = self._i
        after_item = False
        state = self._state
        if state is not None and state.messages is not None:
            closed_messages, resume = state.messages
            messages = list(closed_messages)
            closed_count = len(messages)
            self._i = resume
            after_item = bool(messages)

        def so_far() -> list[tuple[Any, bool]]:
            if state is not None:
                state.messages = (
                    (
                        messages
                        if closed_count == len(messages)
                        else messages[:closed_count]
                    ),
                    resume,
                )
            return messages

        while True:
            if after_item:
                self._skip_space()
                if self._at_end:
                    return so_far()
                if self.text[self._i] == ",":
                    self._i += 1
                elif self.text[self._i] != "]":
                    self._fail("expected ',' or ']'")
            after_item = True
            self._skip_space()
            if self._at_end:
                return so_far()
            if self.text[self._i] == "]":
                self._i += 1
                self._skip_space()
                if not self._at_end:
                    self._fail("unexpected text after the JSON value")
                self.complete = True
                return messages
            try:
                self._cut = False
                message = self._value(healable=False)
            except _Unfinished:
                return so_far()
            closed = not self._cut
            messages.append((message, closed))
            if closed:
                closed_count = len(messages)
                resume = self._i

    def _value(self, *, healable: bool, strip_newlines: bool = False) -> Any:
        if self._at_end:
            self._end()
        c = self.text[self._i]
        if c == "{":
            return self._object()
        if c == "[":
            return self._array()
        if c == '"':
            return self._string(healable=healable, strip_newlines=strip_newlines)
        if c == "-" or ("0" <= c <= "9"):
            return self._number()
        for word, val in (("true", True), ("false", False), ("null", None)):
            if self._i + len(word) <= self._limit and self.text.startswith(
                word, self._i
            ):
                self._i += len(word)
                return val
            if self._partial and word.startswith(self.text[self._i : self._limit]):
                self._end()
        self._fail(f"unexpected character '{c}'")

    def _object(self, parent_key: str | None = None) -> dict[str, Any]:
        return self._closed_or(lambda: self._read_object(parent_key=parent_key))

    def _closed_or(self, read: Callable[[], _T]) -> _T:
        """Reads a list or map through `read`, unless an earlier read saw it close.

        A list or map that closes is kept for the reads after this one.
        """
        state = self._state
        if state is None:
            return read()
        start = self._i
        cached = state.closed.get(start)
        if cached is not None:
            self._i = cached[1]
            return cast(_T, cached[0])
        cut_before = self._cut
        self._cut = False
        value = read()
        if not self._cut:
            state.closed[start] = (value, self._i)
        self._cut = cut_before or self._cut
        return value

    def _read_object(self, parent_key: str | None = None) -> dict[str, Any]:
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
            key = self._string(
                healable=False,
                strip_newlines=not self._in_data_model,
            )
            self._skip_space()
            if self._at_end:
                self._end()
            if self.text[self._i] != ":":
                self._fail(f"expected ':' after key '{key}'")
            self._i += 1
            self._skip_space()
            is_data_value = not self._in_data_model and (
                (parent_key == "updateDataModel" and key == "value")
                or (parent_key == "createSurface" and key == "dataModel")
            )
            if is_data_value:
                self._in_data_model = True
            try:
                if not self._at_end and self.text[self._i] == "[":
                    obj[key] = self._array(
                        whole_items=self._partial and key in self.whole_item_keys,
                        strip_item_newlines=(
                            key == "children" and not self._in_data_model
                        ),
                    )
                elif not self._at_end and self.text[self._i] == "{":
                    obj[key] = self._object(parent_key=key)
                else:
                    healable_val = (
                        self.progressive_keys is not None
                        and key in self.progressive_keys
                    )
                    obj[key] = self._value(
                        healable=healable_val,
                        strip_newlines=(
                            key in _NEWLINE_STRIPPED_KEYS and not self._in_data_model
                        ),
                    )
            finally:
                if is_data_value:
                    self._in_data_model = False
            self._skip_space()
            if self._at_end:
                return self._healed(obj)
            if self.text[self._i] == ",":
                self._i += 1
            elif self.text[self._i] != "}":
                self._fail("expected ',' or '}'")

    def _array(
        self, *, whole_items: bool = False, strip_item_newlines: bool = False
    ) -> list[Any]:
        return self._closed_or(
            lambda: self._read_array(
                whole_items=whole_items,
                strip_item_newlines=strip_item_newlines,
            )
        )

    def _read_array(
        self, *, whole_items: bool, strip_item_newlines: bool = False
    ) -> list[Any]:
        start = self._i
        self._i += 1
        arr: list[Any] = []
        # How many of the items closed, and where the text after the last of
        # them starts, for the next read to go on from.
        closed_count = 0
        resume = self._i
        after_item = False
        state = self._state
        if state is not None and start in state.open:
            items, resume = state.open[start]
            arr = list(items)
            closed_count = len(arr)
            self._i = resume
            after_item = bool(arr)

        def healed() -> list[Any]:
            if state is not None:
                state.open[start] = (
                    arr if closed_count == len(arr) else arr[:closed_count],
                    resume,
                )
            return self._healed(arr)

        while True:
            if after_item:
                self._skip_space()
                if self._at_end:
                    return healed()
                if self.text[self._i] == ",":
                    self._i += 1
                elif self.text[self._i] != "]":
                    self._fail("expected ',' or ']'")
            after_item = True
            self._skip_space()
            if self._at_end:
                return healed()
            if self.text[self._i] == "]":
                self._i += 1
                if state is not None:
                    state.open.pop(start, None)
                return arr
            cut_before = self._cut
            self._cut = False
            if whole_items:
                try:
                    item = self._value(
                        healable=False, strip_newlines=strip_item_newlines
                    )
                except _Unfinished:
                    return healed()
                if self._cut:
                    return healed()
            else:
                item = self._value(healable=False, strip_newlines=strip_item_newlines)
            arr.append(item)
            if self._cut:
                # An item closed early ends the text, so the list closes
                # early too.
                continue
            self._cut = cut_before
            closed_count = len(arr)
            resume = self._i

    def _healed(self, value: _T) -> _T:
        if not self._partial:
            self._end()
        self._cut = True
        return value

    def _string(self, *, healable: bool, strip_newlines: bool = False) -> str:
        self._i += 1
        buf: list[str] = []
        n = self._limit
        while not self._at_end:
            c = self.text[self._i]
            if c == '"':
                self._i += 1
                return "".join(buf)
            if c != "\\":
                if strip_newlines:
                    if c in ("\r", "\n"):
                        self._i += 1
                        continue
                    run = _PLAIN_RUN_NO_NEWLINES.match(self.text, self._i, n)
                    assert run is not None
                    buf.append(run.group())
                    self._i = run.end()
                else:
                    # Takes the run of plain characters up to the next quote or
                    # escape at once.
                    run = _PLAIN_RUN.match(self.text, self._i, n)
                    assert run is not None
                    buf.append(run.group())
                    self._i = run.end()
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
