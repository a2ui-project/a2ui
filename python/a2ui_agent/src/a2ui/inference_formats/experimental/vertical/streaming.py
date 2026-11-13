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

"""Incremental streaming response reader for the A2UI Vertical inference format.

Streams component constructors inside `<a2ui>` or `<a2ui-vertical>` blocks,
emitting an independent surface per completed component statement while applying
and validating every emitted message against a `RendererState`.
"""

from __future__ import annotations

from collections.abc import Callable
import re
from typing import Generic, Literal, TYPE_CHECKING, TypeVar, cast

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import A2uiError, A2uiParseError
from a2ui.inference_formats._shared import to_message_models
from a2ui.parser import (
    A2uiCompilationError,
    A2uiCompilationParseError,
    A2uiCompilationValidationError,
    A2uiPart,
    ErrorPart,
    ResponseStream,
    StreamPart,
    TextRun,
)
from a2ui.utils import RendererState

from .compiler import (
    VerticalCompiler,
    is_line_comment_start,
    split_complete_statements,
)

if TYPE_CHECKING:
    from .parser import VerticalParser

PartT = TypeVar("PartT", bound=StreamPart, covariant=True)
_CALL_OFFSET_ATTR = "_vertical_call_offset"

_OPEN_TAG_RE = re.compile(r"<(?P<tag>a2ui-vertical|a2ui)(?:\s[^>]*)?>", re.IGNORECASE)
_OPEN_TAG_START_RE = re.compile(r"<(?:a2ui-vertical|a2ui)\s[^>]*$", re.IGNORECASE)
_CLOSE_TAG_RE = re.compile(r"</(?:a2ui-vertical|a2ui)\s*>", re.IGNORECASE)
_CLOSE_TAG_START_RE = re.compile(r"</(?:a2ui-vertical|a2ui)\s*$", re.IGNORECASE)
_LEADING_FENCE_RE = re.compile(r"^\s*(?:```[a-zA-Z0-9_-]*[ \t]*\r?\n|`+\s*)")
_TRAILING_FENCE_RE = re.compile(r"(?:\r?\n?[ \t]*```[a-zA-Z0-9_-]*|`+)\s*$")
_OUTER_TRAILING_FENCE_RE = re.compile(
    r"(?:\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n[ \t]*)?|(?:^|(?<=\s))`{1,2})\Z"
)
_OUTER_TRAILING_FENCE_PREFIX_RE = re.compile(
    r"(?:```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n[ \t]*)?|`+)\Z"
)
_OUTER_INLINE_OPEN_BACKTICK_RE = re.compile(r"(?:^|(?<=\s))`{1,2}\Z")
_OUTER_LEADING_FENCE_RE = re.compile(r"^\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n|\Z)")
_OUTER_LEADING_FENCE_PREFIX_RE = re.compile(
    r"^\s*(?:`{0,2}|```[a-zA-Z0-9_-]*[ \t]*\r?)\Z"
)
_OUTER_LEADING_FENCE_INLINE_RE = re.compile(
    r"^(?:\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n|\Z)|`+)"
)
_OUTER_LEADING_FENCE_INLINE_PREFIX_RE = re.compile(
    r"^(?:`+|\s*`{0,2}|\s*```[a-zA-Z0-9_-]*[ \t]*\r?)\Z"
)


def _is_tag_prefix(text: str, idx: int) -> bool:
    tail = text[idx:].lower()
    for candidate in ("<a2ui>", "<a2ui-vertical>", "</a2ui>", "</a2ui-vertical>"):
        if len(tail) < len(candidate) and candidate.startswith(tail):
            return True
    return False


def _possible_open_tag_start(text: str) -> int:
    idx = text.find("<")
    while idx >= 0:
        if _is_tag_prefix(text, idx) or _OPEN_TAG_START_RE.match(text, idx):
            return idx
        idx = text.find("<", idx + 1)
    return len(text)


def _possible_fence_start(text: str) -> int:
    match = _OUTER_TRAILING_FENCE_PREFIX_RE.search(text)
    return match.start() if match else len(text)


def _scan_vertical_block(content: str, start: int = 0) -> tuple[int | None, int, int]:
    """Scans `content` from `start` for `</a2ui>` or `</a2ui-vertical>` outside quotes/comments.

    Returns `(close_start, readable_end, resume_pos)`.
    """
    i = start
    n = len(content)
    while i < n:
        ch = content[i]
        if (
            ch in ("r", "R")
            and i + 1 < n
            and content[i + 1] in ('"', "'")
            and (i == 0 or not (content[i - 1].isalnum() or content[i - 1] == "_"))
        ):
            end = _skip_quoted(content, i + 1, n, raw=True)
            if end is None:
                return None, n, i
            i = end
            continue
        if ch in ('"', "'"):
            end = _skip_quoted(content, i, n, raw=False)
            if end is None:
                return None, n, i
            i = end
            continue
        if content.startswith("/*", i):
            close_comment = content.find("*/", i + 2)
            if close_comment < 0:
                return None, n, i
            i = close_comment + 2
            continue
        comment_len = is_line_comment_start(content, i)
        if comment_len:
            j = i + comment_len
            while j < n and content[j] not in ("\n", "\r"):
                if content[j] == "<":
                    if _CLOSE_TAG_RE.match(content, j) is not None:
                        return j, j, j
                    if _is_tag_prefix(content, j) or _CLOSE_TAG_START_RE.match(
                        content, j
                    ):
                        return None, j, i
                j += 1
            if j >= n:
                return None, n, i
            i = j + 1
            continue
        if ch == "<":
            if _CLOSE_TAG_RE.match(content, i) is not None:
                return i, i, i
            if _is_tag_prefix(content, i) or _CLOSE_TAG_START_RE.match(content, i):
                return None, i, i
        i += 1
    resume_pos = n - 1 if n > 0 and content[n - 1] in ("r", "R", "/") else n
    return None, n, resume_pos


def _skip_quoted(content: str, quote_start: int, n: int, *, raw: bool) -> int | None:
    q = content[quote_start]
    triple = content.startswith(q * 3, quote_start)
    delim = q * 3 if triple else q
    i = quote_start + len(delim)
    while i < n:
        if not raw and content[i] == "\\":
            if i + 1 >= n:
                return None
            i += 2
            continue
        if content.startswith(delim, i):
            end = i + len(delim)
            if not triple and end == n and end - quote_start == 2:
                return None
            return end
        i += 1
    return None


def _wrap_stream_error(error: Exception, raw_content: str) -> A2uiError:
    if isinstance(error, A2uiError):
        return error
    if isinstance(error, ValueError):
        return A2uiCompilationValidationError(
            message=str(error),
            raw_content=raw_content,
            help_message=(
                "Please correct the validation error in your Vertical expression."
            ),
        )
    if isinstance(error, SyntaxError):
        return A2uiCompilationParseError(
            message=str(error),
            raw_content=raw_content,
            help_message="Please correct the syntax error in your Vertical expression.",
        )
    return A2uiCompilationError(
        message=f"Failed to compile Vertical block: {error}",
        raw_content=raw_content,
    )


class VerticalResponseStream(ResponseStream[PartT], Generic[PartT]):
    """Reads a streamed A2UI Vertical response chunk by chunk."""

    def __init__(
        self,
        parser: VerticalParser,
        *,
        wrapped: bool = True,
        state: RendererState | None = None,
        after_rejected_block: Literal["end", "continue"] = "end",
    ) -> None:
        self._parser = parser
        self._compiler: VerticalCompiler = parser._compiler
        self._wrapped = wrapped
        self._state = state if state is not None else RendererState(parser.catalogs)
        self._continues = after_rejected_block == "continue"
        self._closed = False
        self._held = ""
        self._text = TextRun()
        self._in_block = not wrapped
        self._after_block = False
        self._wrapped_in_inline_backticks = False
        self._rejected = False
        self._block = ""
        self._scan_pos = 0
        self._consumed_len = 0
        self._surface_offset = 0
        self._call_offset = int(getattr(self._state, _CALL_OFFSET_ATTR, 0))
        self._touched: dict[str, None] = {}

    def _reset_block(self) -> None:
        self._block = ""
        self._scan_pos = 0
        self._consumed_len = 0
        self._rejected = False
        self._touched = {}

    @property
    def state(self) -> RendererState:
        return self._state

    @property
    def is_in_block(self) -> bool:
        return not self._closed and self._in_block

    def feed(self, chunk: str) -> list[PartT]:
        if self._closed:
            raise ValueError("The response stream is closed.")
        parts: list[StreamPart] = []
        try:
            self._feed(chunk, parts)
        except BaseException as e:
            self._fail(e, parts)
            raise
        return cast("list[PartT]", parts)

    def close(self) -> list[PartT]:
        if self._closed:
            return []
        self._closed = True
        parts: list[StreamPart] = []
        try:
            if not self._wrapped:
                if not self._rejected:
                    self._read_block(
                        parts, lambda: self._finish_block(parts, len(self._block))
                    )
                return cast("list[PartT]", parts)
            if self._in_block:
                if not self._rejected:
                    self._read_block(parts, self._raise_unclosed)
                self._state.mark_checked(self._touched)
                return cast("list[PartT]", parts)
        except BaseException as e:
            self._fail(e, parts)
            raise
        if self._held:
            rest = self._held
            self._held = ""
            if self._after_block:
                leading_re = (
                    _OUTER_LEADING_FENCE_INLINE_RE
                    if self._wrapped_in_inline_backticks
                    else _OUTER_LEADING_FENCE_RE
                )
                rest = leading_re.sub("", rest, count=1)
                self._after_block = False
                self._wrapped_in_inline_backticks = False
            if rest:
                self._text.emit(parts, rest)
        return cast("list[PartT]", parts)

    @staticmethod
    def _raise_unclosed() -> None:
        raise A2uiParseError(
            f"The response ended inside an {A2UI_INFERENCE_OPEN_TAG} block,"
            f" before its {A2UI_INFERENCE_CLOSE_TAG} tag."
        )

    def _fail(self, error: BaseException, parts: list[StreamPart]) -> None:
        self._closed = True
        self._state.mark_checked(self._touched)
        if isinstance(error, A2uiError):
            setattr(
                error,
                "partial_results",
                [p for p in parts if not isinstance(p, ErrorPart)],
            )

    def _read_block(self, parts: list[StreamPart], step: Callable[[], None]) -> None:
        try:
            step()
        except A2uiError as e:
            if not self._continues:
                raise
            parts.append(ErrorPart(error=e))
            self._state.mark_checked(self._touched)
            self._rejected = True

    def _feed(self, chunk: str, parts: list[StreamPart]) -> None:
        if not self._wrapped:
            self._block += chunk
            if not self._rejected:
                self._read_block(
                    parts,
                    lambda: self._emit_ready(parts, len(self._block), is_final=False),
                )
            return

        input_str = self._held + chunk
        self._held = ""
        while input_str:
            if self._in_block:
                input_str = self._consume_block_text(parts, input_str)
                continue
            if self._after_block:
                prefix_re = (
                    _OUTER_LEADING_FENCE_INLINE_PREFIX_RE
                    if self._wrapped_in_inline_backticks
                    else _OUTER_LEADING_FENCE_PREFIX_RE
                )
                if prefix_re.match(input_str):
                    self._held = input_str
                    return
                self._after_block = False
                leading_re = (
                    _OUTER_LEADING_FENCE_INLINE_RE
                    if self._wrapped_in_inline_backticks
                    else _OUTER_LEADING_FENCE_RE
                )
                self._wrapped_in_inline_backticks = False
                input_str = leading_re.sub("", input_str, count=1)
                continue
            input_str = self._consume_outside_text(parts, input_str)

    def _consume_outside_text(self, parts: list[StreamPart], input_str: str) -> str:
        open_match = _OPEN_TAG_RE.search(input_str)
        if open_match:
            before_open = input_str[: open_match.start()]
            self._wrapped_in_inline_backticks = bool(
                _OUTER_INLINE_OPEN_BACKTICK_RE.search(before_open)
            )
            text_before = _OUTER_TRAILING_FENCE_RE.sub("", before_open, count=1)
            self._text.emit(parts, text_before)
            self._text.reset()
            self._in_block = True
            self._reset_block()
            return input_str[open_match.end() :]

        tag_start = _possible_open_tag_start(input_str)
        hold = _possible_fence_start(input_str[:tag_start])
        self._text.emit(parts, input_str[:hold])
        self._held = input_str[hold:]
        return ""

    def _consume_block_text(self, parts: list[StreamPart], input_str: str) -> str:
        self._block += input_str
        close_start, readable_end, self._scan_pos = _scan_vertical_block(
            self._block, self._scan_pos
        )
        if close_start is None:
            if not self._rejected:
                self._read_block(
                    parts, lambda: self._emit_ready(parts, readable_end, is_final=False)
                )
            return ""

        close_match = _CLOSE_TAG_RE.match(self._block, close_start)
        assert close_match is not None
        remaining = self._block[close_match.end() :]
        if not self._rejected:
            self._read_block(parts, lambda: self._finish_block(parts, close_start))
        self._in_block = False
        self._after_block = True
        self._reset_block()
        return remaining

    def _emit_ready(self, parts: list[StreamPart], end: int, *, is_final: bool) -> None:
        window = self._block[self._consumed_len : end]
        if not window.strip():
            return
        stripped_lead = window.lstrip()
        if (
            not is_final
            and stripped_lead.startswith("```")
            and "\n" not in stripped_lead
        ):
            return

        statements, trailing = split_complete_statements(window, is_final=is_final)
        if not statements:
            return

        consumed_chars = len(window) - len(trailing)
        self._consumed_len += consumed_chars

        for stmt in statements:
            cleaned = _LEADING_FENCE_RE.sub("", stmt, count=1)
            cleaned = _TRAILING_FENCE_RE.sub("", cleaned, count=1).strip()
            if not cleaned or cleaned == "```":
                continue
            try:
                raw_msgs, self._surface_offset, next_call_offset = (
                    self._compiler.compile_dicts(
                        cleaned,
                        surface_id=self._parser.surface_id,
                        is_final=True,
                        version=self._compiler.version,
                        surface_offset=self._surface_offset,
                        call_offset=self._call_offset,
                        existing_surface_ids=set(self._state.surface_ids),
                    )
                )
            except Exception as err:
                raise _wrap_stream_error(err, cleaned) from err

            if not raw_msgs:
                continue

            with self._state.transaction():
                block_touched = self._state.apply(raw_msgs)
                if block_touched:
                    self._state.check_topology(block_touched)
            self._call_offset = next_call_offset
            setattr(self._state, _CALL_OFFSET_ATTR, self._call_offset)
            self._touched.update(dict.fromkeys(block_touched))
            models = to_message_models(raw_msgs)
            parts.append(A2uiPart(a2ui=models))

    def _finish_block(self, parts: list[StreamPart], close_start: int) -> None:
        self._emit_ready(parts, close_start, is_final=True)
        if self._touched:
            self._state.check_topology(list(self._touched))
