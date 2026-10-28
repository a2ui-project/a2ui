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

"""Reading a streamed A2UI Express response chunk by chunk."""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping, Set
import dataclasses
import re
from typing import Any, TYPE_CHECKING

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import A2uiError, A2uiParseError
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import CatalogSchemaHelper, to_message_models
from a2ui.parser import (
    A2uiCompilationError,
    A2uiCompilationParseError,
    A2uiCompilationValidationError,
    A2uiPart,
    ResponsePart,
    ResponseStream,
    TextPart,
)
from a2ui.utils import RendererState

from .compiler import ExpressCompiler, ExpressScopeSession
from .errors import ExpressParseError, ExpressValidationError

if TYPE_CHECKING:
    from .parser import ExpressParser

DEFAULT_EXPRESS_PROGRESSIVE_KEYS: frozenset[str] = frozenset({"text"})

OPEN_TAG = A2UI_INFERENCE_OPEN_TAG
CLOSE_TAG = A2UI_INFERENCE_CLOSE_TAG
OPEN_TAG_RE = re.compile(r"<a2ui(?:\s[^>]*)?>", re.IGNORECASE)
CLOSE_TAG_RE = re.compile(r"</a2ui\s*>", re.IGNORECASE)
OPEN_TAG_START_RE = re.compile(r"<a2ui\s[^>]*$", re.IGNORECASE)
_CLOSE_TAG_START_RE = re.compile(r"</a2ui\s*$", re.IGNORECASE)
_LEADING_FENCE_RE = re.compile(r"^\s*(?:```[a-zA-Z0-9_-]*[ \t]*\r?\n|`+\s*)")
_TRAILING_FENCE_RE = re.compile(r"(?:\r?\n?[ \t]*```[a-zA-Z0-9_-]*|`+)\s*$")
_IDENT_RE = re.compile(r"[a-zA-Z_][a-zA-Z0-9_]*")
_DATA_ASSIGN_RE = re.compile(r"^\s*\$[a-zA-Z0-9_/]*\s*=(?!=)")


def possible_open_tag_start(text: str) -> int:
    """Returns where a tail of `text` could start `<a2ui>`, else its length."""
    idx = text.find("<")
    while idx >= 0:
        if _is_tag_prefix(text, idx, OPEN_TAG) or OPEN_TAG_START_RE.match(text, idx):
            return idx
        idx = text.find("<", idx + 1)
    return len(text)


def _is_tag_prefix(text: str, idx: int, tag: str) -> bool:
    return len(text) - idx < len(tag) and tag.startswith(text[idx:].lower())


def scan_express_block(content: str) -> tuple[int | None, int]:
    """Finds `</a2ui>` outside string literals, or holds a partial close-tag tail."""
    i = 0
    n = len(content)
    while i < n:
        next_i = _skip_block_literal_or_comment(content, i, n)
        if next_i > i:
            i = next_i
            continue
        if content[i] == "<":
            hit = _check_close_tag_at(content, i)
            if hit is not None:
                return hit
        i += 1
    return None, n


def _skip_block_literal_or_comment(content: str, i: int, n: int) -> int:
    if content[i] == '"':
        return _skip_string_literal(content, i, n)
    if content.startswith("/*", i):
        end_comment = content.find("*/", i + 2)
        return n if end_comment < 0 else end_comment + 2
    if content.startswith(("#", "//", "--"), i):
        newline = content.find("\n", i)
        end = n if newline < 0 else newline
        close = CLOSE_TAG_RE.search(content, i, end)
        return close.start() if close else end
    return i


def _check_close_tag_at(content: str, i: int) -> tuple[int | None, int] | None:
    if CLOSE_TAG_RE.match(content, i) is not None:
        return i, i
    if _is_tag_prefix(content, i, CLOSE_TAG) or _CLOSE_TAG_START_RE.match(content, i):
        return None, i
    return None


def _skip_string_literal(content: str, start: int, n: int) -> int:
    quote = content[start]
    triple = content.startswith(quote * 3, start)
    delim = quote * 3 if triple else quote
    i = start + len(delim)
    while i < n:
        if content[i] == "\\":
            i += 2
            continue
        if content.startswith(delim, i):
            return i + len(delim)
        i += 1
    return n


def clean_express_payload(block: str, end: int) -> str | None:
    """Strips leading/trailing markdown fences from `block[:end]`."""
    text = block[:end]
    stripped = text.lstrip()
    if stripped and len(stripped) <= 3 and "```".startswith(stripped):
        return None
    if stripped.startswith("```") and "\n" not in stripped:
        return None
    cleaned = _LEADING_FENCE_RE.sub("", text, count=1)
    cleaned = _TRAILING_FENCE_RE.sub("", cleaned, count=1)
    return cleaned


@dataclasses.dataclass
class _ScanCursor:
    """Tracks lexical state while scanning Express source for statement bounds."""

    depth: int = 0
    has_token: bool = False
    saw_equals: bool = False
    has_rhs: bool = False
    rhs_closed: bool = False
    last_complete: int = 0

    def reset_statement(self, pos: int) -> None:
        self.has_token = False
        self.saw_equals = False
        self.has_rhs = False
        self.rhs_closed = False
        self.last_complete = pos


def split_complete_statements(
    source: str, *, is_final: bool = False
) -> tuple[str, str]:
    """Splits `source` into `(complete_prefix, trailing_fragment)`."""
    if is_final:
        return source, ""
    cur = _ScanCursor()
    i = 0
    n = len(source)
    while i < n:
        next_i, closed_string = _step_string_or_comment(source, i, n)
        if next_i > i:
            if closed_string and cur.depth == 0 and cur.saw_equals:
                cur.has_rhs = True
                cur.rhs_closed = True
                cur.last_complete = next_i
            i = next_i
            continue
        i = _step_code_char(source, i, n, cur)
    return source[: cur.last_complete], source[cur.last_complete :]


def _step_string_or_comment(source: str, i: int, n: int) -> tuple[int, bool]:
    """Advances past a string literal or comment starting at `i`, if any."""
    if source[i] in ("r", "R") and i + 1 < n and source[i + 1] == '"':
        end = _scan_double_quoted(source, i + 1, n, raw=True)
        return (end, True) if end is not None else (n, False)
    if source[i] == '"':
        end = _scan_double_quoted(source, i, n, raw=False)
        return (end, True) if end is not None else (n, False)
    if source.startswith("/*", i):
        close = source.find("*/", i + 2)
        return (close + 2, False) if close >= 0 else (n, False)
    if source[i] == "#" or source.startswith("//", i) or source.startswith("--", i):
        nl = source.find("\n", i)
        return (nl, False) if nl >= 0 else (n, False)
    return i, False


def _scan_double_quoted(
    source: str, quote_start: int, n: int, *, raw: bool
) -> int | None:
    triple = source.startswith('"""', quote_start)
    delim = '"""' if triple else '"'
    i = quote_start + len(delim)
    while i < n:
        if not raw and source[i] == "\\":
            if i + 1 >= n:
                return None
            i += 2
            continue
        if source.startswith(delim, i):
            return i + len(delim)
        i += 1
    return None


def _step_code_char(source: str, i: int, n: int, cur: _ScanCursor) -> int:
    ch = source[i]
    if ch in "([{":
        _on_open_bracket(cur)
    elif ch in ")]}":
        _on_close_bracket(i, cur)
    elif cur.depth == 0 and ch in ("\n", ";"):
        _on_statement_separator(i, cur)
    elif not ch.isspace():
        _on_non_space_char(source, i, n, cur)
    return i + 1


def _on_open_bracket(cur: _ScanCursor) -> None:
    cur.depth += 1
    cur.has_token = True
    if cur.saw_equals:
        cur.has_rhs = True
        cur.rhs_closed = False


def _on_close_bracket(i: int, cur: _ScanCursor) -> None:
    if cur.depth <= 0:
        return
    cur.depth -= 1
    if cur.depth == 0 and (cur.saw_equals or cur.has_token):
        cur.has_rhs = True
        cur.rhs_closed = True
        cur.last_complete = i + 1


def _on_statement_separator(i: int, cur: _ScanCursor) -> None:
    if cur.rhs_closed or (cur.saw_equals and cur.has_rhs):
        cur.reset_statement(i + 1)
    elif not cur.has_token:
        cur.last_complete = i + 1


def _on_non_space_char(source: str, i: int, n: int, cur: _ScanCursor) -> None:
    if cur.depth == 0 and source[i] == "=" and (i + 1 >= n or source[i + 1] != "="):
        cur.saw_equals = True
        cur.has_token = True
        return
    cur.has_token = True
    if cur.depth == 0 and cur.saw_equals:
        cur.has_rhs = True


@dataclasses.dataclass
class _OpenCallFrame:
    name: str
    arg_index: int = 0
    kwarg_name: str | None = None
    last_ident: str | None = None


def heal_progressive_fragment(
    fragment: str,
    helpers: Mapping[str, CatalogSchemaHelper],
    progressive_keys: Set[str],
) -> str | None:
    """Heals an unclosed progressive string literal at the tail of `fragment`."""
    if not progressive_keys or not fragment.strip():
        return None
    state = _scan_fragment_for_unclosed_string(fragment)
    if state is None:
        return None
    str_start, delim, is_raw, brackets, calls = state
    content = fragment[str_start:]
    if _is_url_like(content):
        return None
    if not _is_progressive_slot(fragment, calls, helpers, progressive_keys):
        return None
    healed = fragment
    if not is_raw and _has_odd_trailing_backslashes(healed):
        healed = healed[:-1]
    if delim == '"""' and healed.endswith('"'):
        if is_raw:
            return None
        healed = f'{healed[:-1]}\\"'
    closing_brackets = "".join(_closing_delimiter(b) for b in reversed(brackets))
    return f"{healed}{delim}{closing_brackets}"


@dataclasses.dataclass
class _FragmentScanState:
    brackets: list[str] = dataclasses.field(default_factory=list)
    calls: list[_OpenCallFrame] = dataclasses.field(default_factory=list)
    last_ident: str | None = None


def _scan_fragment_for_unclosed_string(
    fragment: str,
) -> tuple[int, str, bool, list[str], list[_OpenCallFrame]] | None:
    """Returns the unclosed string state if `fragment` ends inside a string literal."""
    i = 0
    n = len(fragment)
    st = _FragmentScanState()

    while i < n:
        str_res = _try_scan_fragment_string(fragment, i, n, st)
        if str_res is not None:
            next_i, unclosed = str_res
            if unclosed is not None:
                return unclosed
            i = next_i
            continue
        comment_i = _try_skip_fragment_comment(fragment, i, n)
        if comment_i is not None:
            if comment_i < 0:
                return None
            i = comment_i
            continue
        i = _step_fragment_token(fragment, i, st)
    return None


def _try_scan_fragment_string(
    fragment: str, i: int, n: int, st: _FragmentScanState
) -> tuple[int, tuple[int, str, bool, list[str], list[_OpenCallFrame]] | None] | None:
    is_raw = fragment[i] in ("r", "R") and i + 1 < n and fragment[i + 1] == '"'
    if not is_raw and fragment[i] != '"':
        return None
    quote_pos = i + 1 if is_raw else i
    delim = '"""' if fragment.startswith('"""', quote_pos) else '"'
    end = _scan_double_quoted(fragment, quote_pos, n, raw=is_raw)
    if end is None:
        return n, (quote_pos + len(delim), delim, is_raw, st.brackets, st.calls)
    return end, None


def _try_skip_fragment_comment(fragment: str, i: int, n: int) -> int | None:
    if fragment.startswith("/*", i):
        close = fragment.find("*/", i + 2)
        return -1 if close < 0 else close + 2
    if (
        fragment[i] == "#"
        or fragment.startswith("//", i)
        or fragment.startswith("--", i)
    ):
        nl = fragment.find("\n", i)
        return -1 if nl < 0 else nl + 1
    return None


def _step_fragment_token(fragment: str, i: int, st: _FragmentScanState) -> int:
    m = _IDENT_RE.match(fragment, i)
    if m:
        st.last_ident = m.group(0)
        if st.calls and st.brackets and st.brackets[-1] == "(":
            st.calls[-1].last_ident = st.last_ident
        return m.end()
    _apply_fragment_punct(fragment[i], st)
    return i + 1


def _apply_fragment_punct(ch: str, st: _FragmentScanState) -> None:
    in_call_parens = bool(st.calls and st.brackets and st.brackets[-1] == "(")
    if ch == "(":
        st.brackets.append("(")
        st.calls.append(_OpenCallFrame(name=st.last_ident or ""))
        st.last_ident = None
    elif ch in "[{":
        st.brackets.append(ch)
        st.last_ident = None
    elif ch in ")]}":
        if st.brackets and st.brackets.pop() == "(" and st.calls:
            st.calls.pop()
        st.last_ident = None
    elif ch == "," and in_call_parens:
        st.calls[-1].arg_index += 1
        st.calls[-1].kwarg_name = None
        st.calls[-1].last_ident = None
    elif ch == "=" and in_call_parens and st.calls[-1].last_ident:
        st.calls[-1].kwarg_name = st.calls[-1].last_ident
    elif not ch.isspace():
        st.last_ident = None


def _is_progressive_slot(
    fragment: str,
    calls: list[_OpenCallFrame],
    helpers: Mapping[str, CatalogSchemaHelper],
    progressive_keys: Set[str],
) -> bool:
    if not calls:
        return bool(_DATA_ASSIGN_RE.match(fragment))
    frame = calls[-1]
    if not frame.name:
        return False
    for helper in helpers.values():
        if frame.name in helper.components:
            if frame.kwarg_name is not None:
                return frame.kwarg_name in progressive_keys
            props = [
                p for p in helper.get_component_properties(frame.name) if p != "checks"
            ]
            if frame.arg_index < len(props):
                return props[frame.arg_index] in progressive_keys
    return False


def _is_url_like(content: str) -> bool:
    lower = content.lstrip().lower()
    return lower.startswith(("http://", "https://", "data:"))


def _has_odd_trailing_backslashes(text: str) -> bool:
    count = 0
    idx = len(text) - 1
    while idx >= 0 and text[idx] == "\\":
        count += 1
        idx -= 1
    return count % 2 == 1


def _closing_delimiter(open_ch: str) -> str:
    return {
        "(": ")",
        "[": "]",
        "{": "}",
    }.get(open_ch, ")")


def _wrap_compilation_error(
    error: BaseException, raw_content: str
) -> A2uiCompilationError:
    if isinstance(error, A2uiCompilationError):
        return error
    orig_err = error
    if isinstance(error, ValueError) and isinstance(error.__cause__, SyntaxError):
        orig_err = error.__cause__
    line = getattr(orig_err, "lineno", None)
    column = getattr(orig_err, "offset", None)
    help_msg = (
        getattr(error, "help_message", None)
        or "Please correct the syntax error in your Express DSL."
    )
    details = getattr(error, "details", None)
    cls: type[A2uiCompilationError] = A2uiCompilationError
    if isinstance(error, ExpressValidationError):
        cls = A2uiCompilationValidationError
    elif isinstance(error, (SyntaxError, ExpressParseError)) or isinstance(
        error.__cause__, SyntaxError
    ):
        cls = A2uiCompilationParseError
    return cls(
        message=str(error),
        raw_content=raw_content,
        line=line,
        column=column,
        help_message=help_msg,
        details=details,
    )


def _merge_same_surface_updates(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Coalesces consecutive component updates for the same surface."""
    merged: list[dict[str, Any]] = []
    for msg in messages:
        if not merged or not _try_merge_component_update(merged[-1], msg):
            merged.append(msg)
    return merged


def _try_merge_component_update(prev: dict[str, Any], msg: dict[str, Any]) -> bool:
    if "updateComponents" not in msg:
        return False
    next_update = msg["updateComponents"]
    target_id = next_update["surfaceId"]
    if (
        "updateComponents" in prev
        and prev["updateComponents"]["surfaceId"] == target_id
    ):
        target_list = prev["updateComponents"]
    elif (
        "createSurface" in prev
        and "components" in prev["createSurface"]
        and prev["createSurface"]["surfaceId"] == target_id
    ):
        target_list = prev["createSurface"]
    else:
        return False
    by_id = {
        c["id"]: c for c in (*target_list["components"], *next_update["components"])
    }
    target_list["components"] = list(by_id.values())
    return True


class ExpressResponseStream(ResponseStream):
    """Reads a streamed A2UI Express response chunk by chunk."""

    def __init__(
        self,
        parser: ExpressParser,
        *,
        wrapped: bool = True,
        state: RendererState | None = None,
        progressive_keys: Collection[str] | None = None,
    ) -> None:
        self._parser = parser
        self._compiler = ExpressCompiler(parser.catalogs, version=parser.version)
        self._wrapped = wrapped
        self._state = state if state is not None else RendererState(parser.catalogs)
        self._progressive_keys = (
            frozenset(progressive_keys)
            if progressive_keys is not None
            else parser.progressive_keys
        )
        self._closed = False
        self._held = ""
        self._held_backticks = ""
        self._strip_close_backticks = False
        self._run_started = False
        self._held_space = ""
        self._in_block = not wrapped
        self._block = ""
        self._last_compiled_prefix = ""
        self._touched: dict[str, None] = {}
        self._initial_surfaces: frozenset[str] = frozenset(self._state.surface_ids)
        self._session = self._new_session()

    def _new_session(self) -> ExpressScopeSession:
        return ExpressScopeSession(
            self._compiler,
            surface_id=self._parser.surface_id,
            version=self._parser.version,
        )

    def _reset_block(self) -> None:
        self._block = ""
        self._last_compiled_prefix = ""
        self._touched = {}
        self._initial_surfaces = frozenset(self._state.surface_ids)
        self._session = self._new_session()

    @property
    def state(self) -> RendererState:
        return self._state

    def feed(self, chunk: str) -> list[ResponsePart]:
        if self._closed:
            raise ValueError("The response stream is closed.")
        emitted = list(self._touched)
        try:
            with self._state.transaction():
                return self._feed(chunk)
        except BaseException:
            self._fail(emitted)
            raise

    def close(self) -> list[ResponsePart]:
        if self._closed:
            return []
        self._closed = True
        parts: list[ResponsePart] = []
        try:
            if not self._wrapped:
                self._finish_block(parts, len(self._block))
                return parts
            if self._in_block:
                raise A2uiParseError(
                    f"The response ended inside an {OPEN_TAG} block, before its"
                    f" {CLOSE_TAG} tag."
                )
        except BaseException:
            self._fail(self._touched)
            raise
        if self._held_backticks:
            self._emit_text(parts, self._held_backticks)
            self._held_backticks = ""
        if self._held:
            self._emit_text(parts, self._held)
            self._held = ""
        return parts

    def _fail(self, surface_ids: Iterable[str]) -> None:
        self._closed = True
        self._state.mark_checked(surface_ids)

    def _feed(self, chunk: str) -> list[ResponsePart]:
        parts: list[ResponsePart] = []
        if not self._wrapped:
            self._block += chunk
            self._emit_ready(parts, len(self._block))
            return parts

        input_str = self._prepare_chunk(chunk)
        while input_str:
            if self._in_block:
                input_str = self._consume_block_text(parts, input_str)
            else:
                input_str = self._consume_outside_text(parts, input_str)
        return parts

    def _prepare_chunk(self, chunk: str) -> str:
        input_str = self._held + chunk
        self._held = ""
        if self._strip_close_backticks:
            if input_str.startswith("`"):
                input_str = input_str.lstrip("`")
            if input_str:
                self._strip_close_backticks = False
        if not self._in_block and self._held_backticks and input_str:
            is_open = bool(
                OPEN_TAG_RE.match(input_str)
                or OPEN_TAG_START_RE.match(input_str)
                or (
                    input_str.startswith("<")
                    and len(input_str) <= len(OPEN_TAG)
                    and OPEN_TAG.startswith(input_str.lower())
                )
            )
            if not is_open:
                input_str = self._held_backticks + input_str
            self._held_backticks = ""
        return input_str

    def _consume_block_text(self, parts: list[ResponsePart], input_str: str) -> str:
        self._block += input_str
        close_start, readable_end = scan_express_block(self._block)
        if close_start is None:
            self._emit_ready(parts, readable_end)
            return ""
        close_match = CLOSE_TAG_RE.match(self._block, close_start)
        assert close_match is not None
        remaining = self._block[close_match.end() :]
        if remaining.startswith("`"):
            remaining = remaining.lstrip("`")
        elif not remaining:
            self._strip_close_backticks = True
        self._finish_block(parts, close_start)
        return remaining

    def _consume_outside_text(self, parts: list[ResponsePart], input_str: str) -> str:
        open_match = OPEN_TAG_RE.search(input_str)
        if open_match:
            text_before = input_str[: open_match.start()]
            if text_before.endswith("`"):
                text_before = text_before.rstrip("`")
            self._emit_text(parts, text_before)
            self._run_started = False
            self._held_space = ""
            self._held_backticks = ""
            self._in_block = True
            self._reset_block()
            return input_str[open_match.end() :]

        hold = possible_open_tag_start(input_str)
        if hold < len(input_str):
            while hold > 0 and input_str[hold - 1] == "`":
                hold -= 1
        text_to_emit = input_str[:hold]
        self._held = input_str[hold:]
        if not self._held:
            m = re.search(r"`+\Z", text_to_emit)
            if m:
                self._held_backticks = m.group(0)
                text_to_emit = text_to_emit[: m.start()]
        self._emit_text(parts, text_to_emit)
        return ""

    def _emit_text(self, parts: list[ResponsePart], text: str) -> None:
        body = (text if self._run_started else text.lstrip()).rstrip()
        if not body:
            if self._run_started:
                self._held_space += text
            return
        start = 0 if self._run_started else text.find(body)
        parts.append(TextPart(text=f"{self._held_space}{body}"))
        self._held_space = text[start + len(body) :]
        self._run_started = True

    def _emit_ready(self, parts: list[ResponsePart], end: int) -> None:
        payload = clean_express_payload(self._block, end)
        if not payload or not payload.strip():
            return
        complete_prefix, trailing_fragment = split_complete_statements(
            payload, is_final=False
        )
        prefix_messages: list[dict[str, Any]] = []
        if complete_prefix.strip() and complete_prefix != self._last_compiled_prefix:
            prefix_messages = self._compile_step(
                complete_prefix, is_final=False, cache_prefix=True
            )
            self._last_compiled_prefix = complete_prefix
            if prefix_messages:
                self._apply(prefix_messages)

        healed_messages = self._try_compile_and_apply_healed(
            complete_prefix, trailing_fragment
        )
        ready_messages = _merge_same_surface_updates(
            [*prefix_messages, *healed_messages]
        )
        if ready_messages:
            parts.append(A2uiPart(a2ui=to_message_models(ready_messages)))

    def _try_compile_and_apply_healed(
        self, complete_prefix: str, trailing_fragment: str
    ) -> list[dict[str, Any]]:
        healed = heal_progressive_fragment(
            trailing_fragment,
            self._compiler.helpers,
            self._progressive_keys,
        )
        if healed is None:
            return []
        combined = f"{complete_prefix}\n{healed}" if complete_prefix.strip() else healed
        snap = self._session.snapshot()
        saved_touched = dict(self._touched)
        try:
            with self._state.transaction():
                msgs = self._compile_step(combined, is_final=False, cache_prefix=False)
                if msgs:
                    self._apply(msgs)
                return msgs
        except A2uiError:
            self._session.restore(snap)
            self._touched = saved_touched
            return []

    def _finish_block(self, parts: list[ResponsePart], end: int) -> None:
        payload = clean_express_payload(self._block, end) or ""
        with self._state.transaction():
            if not self._session.has_emitted:
                models = self._parser.compile(payload, is_final=True)
                self._apply(models)
            else:
                messages = self._compile_step(payload, is_final=True, cache_prefix=True)
                if messages:
                    self._apply(messages)
                models = to_message_models(messages)
            self._state.check_topology(self._touched)
        if models:
            parts.append(A2uiPart(a2ui=models))
        self._in_block = not self._wrapped
        self._reset_block()

    def _compile_step(
        self, source: str, *, is_final: bool, cache_prefix: bool = True
    ) -> list[dict[str, Any]]:
        try:
            return self._session.compile_step(
                source,
                is_final=is_final,
                existing_surfaces=self._initial_surfaces,
                cache_prefix=cache_prefix,
            )
        except (SyntaxError, ValueError) as e:
            raise _wrap_compilation_error(e, source) from e

    def _apply(
        self, messages: Iterable[AgentToRendererMessage | Mapping[str, Any]]
    ) -> None:
        touched = self._state.apply(messages)
        self._touched.update(dict.fromkeys(touched))
