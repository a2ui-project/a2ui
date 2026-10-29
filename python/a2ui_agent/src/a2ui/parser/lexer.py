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

"""State-machine-based scanner to extract structured format blocks from text."""

from __future__ import annotations

from collections.abc import Iterable
from enum import Enum
import re

from .response_part import RawA2uiPart
from .response_part import RawResponsePart
from .response_part import TextPart

__all__ = [
    "BlockLexer",
    "EXPRESS_PAYLOAD_START_RE",
    "JSON_PAYLOAD_START_RE",
    "LexerState",
]

_LEADING_FENCE_RE = re.compile(r"^```[a-zA-Z0-9_-]*\s*", re.IGNORECASE)
_TRAILING_FENCE_RE = re.compile(r"\s*```[a-zA-Z0-9_-]*$", re.IGNORECASE)
_OPEN_FENCE_RE = re.compile(r"^[ \t]*```[a-zA-Z0-9_-]*[ \t]*\r?\n?", re.MULTILINE)
_CLOSING_FENCE_END_RE = re.compile(r"\r?\n?[ \t]*```[ \t]*\r?\n?$")
EXPRESS_PAYLOAD_START_RE = re.compile(
    r"^[ \t]*(?:surface\s*\(|deleteSurface\s*\(|\$[a-zA-Z0-9_/]*\s*=(?!=)|[a-zA-Z_][a-zA-Z0-9_]*\s*=(?!=))",
    re.MULTILINE,
)
JSON_PAYLOAD_START_RE = re.compile(
    r'^[ \t]*(?:\[\s*(?:\{|\]|$)|\{\s*(?:"|\}|$))',
    re.MULTILINE,
)


class LexerState(Enum):
    """States of the BlockLexer scanner."""

    NORMAL = 0  # Outside tag (conversational text)
    IN_A2UI = 1  # Inside tag (scanning code)
    IN_STRING = 2  # Inside string literal
    IN_COMMENT = 3  # Inside single-line comment


class BlockLexer:
    """A generic state-machine-based scanner to extract structured format blocks from text.

    Correctly handles nested string literals and comments to prevent premature tag
    detection, and strips Markdown code block wrapping artifacts.
    """

    def __init__(
        self,
        open_tag: str | re.Pattern[str] = "<a2ui>",
        close_tag: str | re.Pattern[str] | None = None,
        string_delimiters: Iterable[str] | None = None,
        single_line_comments: set[str] | None = None,
        payload_start_pattern: re.Pattern[str] = EXPRESS_PAYLOAD_START_RE,
    ):
        """Initializes the block lexer with tag patterns, string delimiters, and comments.

        Args:
            open_tag: Either the literal open tag string or a pre-compiled regex
              pattern.
            close_tag: Either the literal close tag string or a pre-compiled regex
              pattern. When omitted, defaults to the matching closing tag for
              `open_tag` (or `</a2ui>` if `open_tag` is a regex pattern).
            string_delimiters: Character set representing string bounds.
            single_line_comments: Character set representing single-line comment
              markers.
            payload_start_pattern: Line-anchored pattern matching the start of an
              unfenced payload when recovering from a missing open tag.
        """
        if isinstance(open_tag, str):
            open_tag_name = open_tag.strip("<>")
            self.open_tag_pattern = re.compile(
                rf"<{open_tag_name}(?:\s[^>]*)?>", re.IGNORECASE
            )
            if close_tag is None:
                close_tag = f"</{open_tag_name}>"
        else:
            self.open_tag_pattern = open_tag
            if close_tag is None:
                close_tag = "</a2ui>"

        if isinstance(close_tag, str):
            close_tag_name = close_tag.strip("<>/")
            self.close_tag_pattern = re.compile(
                rf"</{close_tag_name}\s*>", re.IGNORECASE
            )
        else:
            self.close_tag_pattern = close_tag

        self.string_delimiters = (
            set(string_delimiters) if string_delimiters is not None else {"'", '"'}
        )
        self.single_line_comments = (
            single_line_comments if single_line_comments is not None else {"#"}
        )
        self.payload_start_pattern = payload_start_pattern

    def _clean_markdown(self, text: str) -> str:
        """Cleans Markdown code block wrappers from conversational text or inner raw content.

        A run made of nothing but backticks is left over from tags written as
        inline code, so it is dropped.
        """
        if not text:
            return ""
        text = text.strip()
        text = _LEADING_FENCE_RE.sub("", text, count=1)
        text = _TRAILING_FENCE_RE.sub("", text, count=1)
        text = text.strip()
        return "" if not text.strip("`") else text

    def _clean_raw(self, text: str) -> str:
        """Cleans a raw block: Markdown fences, then backticks left at its edges.

        No payload format starts or ends with a backtick, so the ones at the edges
        are left over from tags written as inline code, such as `` `<a2ui>` ``.
        """
        return self._clean_markdown(text).strip("`").strip()

    def _add_text(self, parts: list[RawResponsePart], text: str) -> None:
        cleaned = self._clean_markdown(text)
        if cleaned:
            parts.append(RawResponsePart(part=TextPart(text=cleaned), is_final=True))

    def _scan_block(self, content: str, start: int, end: int) -> tuple[int, int] | None:
        """Scans from `start` up to `end` for the closing tag outside strings."""
        i = start
        state = LexerState.IN_A2UI
        string_delim: str | None = None
        triple_quote = False

        while i < end:
            if state == LexerState.IN_A2UI:
                match = self.close_tag_pattern.match(content, i, end)
                if match:
                    return i, match.end()

                ch = content[i]
                if ch in self.string_delimiters:
                    if i + 2 < end and content[i : i + 3] == ch * 3:
                        string_delim = ch * 3
                        triple_quote = True
                        i += 3
                    else:
                        string_delim = ch
                        triple_quote = False
                        i += 1
                    state = LexerState.IN_STRING
                    continue

                comment_start = False
                for cm in self.single_line_comments:
                    if content.startswith(cm, i):
                        i += len(cm)
                        state = LexerState.IN_COMMENT
                        comment_start = True
                        break
                if comment_start:
                    continue

                i += 1
                continue

            if state == LexerState.IN_STRING:
                assert string_delim is not None
                if content[i] == "\\":
                    i += 2
                    continue
                if triple_quote:
                    if content.startswith(string_delim, i):
                        i += 3
                        state = LexerState.IN_A2UI
                        continue
                else:
                    if content[i] == string_delim:
                        i += 1
                        state = LexerState.IN_A2UI
                        continue
                i += 1
                continue

            if state == LexerState.IN_COMMENT:
                match = self.close_tag_pattern.match(content, i, end)
                if match:
                    return i, match.end()
                if content[i] in ("\n", "\r"):
                    state = LexerState.IN_A2UI
                i += 1
                continue

        return None

    def _try_recover_unmatched_close(
        self,
        parts: list[RawResponsePart],
        content: str,
        start: int,
        search_end: int,
    ) -> int | None:
        """Recovers at most one block closed by a close tag when the open tag was omitted."""
        segment = content[start:search_end]
        if self.close_tag_pattern.search(segment) is None:
            return None

        fences = list(_OPEN_FENCE_RE.finditer(segment))
        for idx in range(0, len(fences), 2):
            fence = fences[idx]
            close_span = self._scan_block(segment, fence.end(), len(segment))
            if close_span is None:
                continue
            close_start, close_end = close_span
            body = segment[fence.end() : close_start]
            body_stripped = _CLOSING_FENCE_END_RE.sub("", body)
            if _OPEN_FENCE_RE.search(body_stripped) is not None:
                continue
            raw_content = self._clean_raw(body_stripped)
            if not raw_content:
                continue
            self._add_text(parts, segment[: fence.start()])
            parts.append(
                RawResponsePart(part=RawA2uiPart(a2ui_raw=raw_content), is_final=True)
            )
            return start + close_end

        search_from = 0
        pair_idx = 0
        while pair_idx + 1 < len(fences):
            if (
                self._scan_block(segment, fences[pair_idx + 1].end(), len(segment))
                is None
            ):
                break
            search_from = fences[pair_idx + 1].end()
            pair_idx += 2

        stmt_match = self.payload_start_pattern.search(segment, search_from)
        if stmt_match is None:
            return None
        close_span = self._scan_block(segment, stmt_match.start(), len(segment))
        if close_span is None:
            return None
        close_start, close_end = close_span
        raw_content = self._clean_raw(segment[stmt_match.start() : close_start])
        if not raw_content:
            return None
        self._add_text(parts, segment[: stmt_match.start()])
        parts.append(
            RawResponsePart(part=RawA2uiPart(a2ui_raw=raw_content), is_final=True)
        )
        return start + close_end

    def tokenize(self, content: str) -> list[RawResponsePart]:
        """Scans response content to extract format blocks.

        Properly respects nested comments, strings, and escaped characters to avoid
        premature close tag detection.

        Args:
            content: The raw text response string to scan.

        Returns:
            A list of tokenized RawResponsePart objects.
        """
        parts: list[RawResponsePart] = []
        n = len(content)
        i = 0
        recovered_unmatched = False

        while i < n:
            open_match = self.open_tag_pattern.search(content, i)
            search_end = open_match.start() if open_match else n
            if not recovered_unmatched and search_end > i:
                next_i = self._try_recover_unmatched_close(
                    parts, content, i, search_end
                )
                if next_i is not None:
                    recovered_unmatched = True
                    i = next_i
                    continue
            if not open_match:
                break
            self._add_text(parts, content[i : open_match.start()])
            close_span = self._scan_block(content, open_match.end(), n)
            if close_span is None:
                parts.append(
                    RawResponsePart(
                        part=RawA2uiPart(
                            a2ui_raw=self._clean_raw(content[open_match.end() :])
                        ),
                        is_final=False,
                    )
                )
                return parts
            close_start, close_end = close_span
            parts.append(
                RawResponsePart(
                    part=RawA2uiPart(
                        a2ui_raw=self._clean_raw(
                            content[open_match.end() : close_start]
                        )
                    ),
                    is_final=True,
                )
            )
            i = close_end

        self._add_text(parts, content[i:])
        return parts
