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
    "LexerState",
]


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

    def _clean_markdown(self, text: str) -> str:
        """Cleans Markdown code block wrappers from conversational text or inner raw content."""
        if not text:
            return ""
        text = text.strip()
        text = re.sub(r"^```[a-zA-Z-]*\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```[a-zA-Z-]*$", "", text, flags=re.IGNORECASE)
        return text.strip()

    def tokenize(self, content: str) -> list[RawResponsePart]:
        """Scans response content character-by-character to extract format blocks.

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

        state = LexerState.NORMAL

        current_text: list[str] = []
        current_raw: list[str] = []

        string_delim: str | None = None
        triple_quote = False

        while i < n:
            if state == LexerState.NORMAL:
                match = self.open_tag_pattern.match(content, i)
                if match:
                    i = match.end()
                    state = LexerState.IN_A2UI
                    current_raw = []
                    continue
                current_text.append(content[i])
                i += 1
                continue

            if state == LexerState.IN_A2UI:
                match = self.close_tag_pattern.match(content, i)
                if match:
                    raw_content = self._clean_markdown("".join(current_raw))
                    text_part = self._clean_markdown("".join(current_text))
                    if text_part:
                        parts.append(
                            RawResponsePart(
                                part=TextPart(text=text_part), is_final=True
                            )
                        )
                    parts.append(
                        RawResponsePart(
                            part=RawA2uiPart(a2ui_raw=raw_content), is_final=True
                        )
                    )
                    current_text = []
                    current_raw = []
                    state = LexerState.NORMAL
                    i = match.end()
                    continue

                ch = content[i]

                if ch in self.string_delimiters:
                    if i + 2 < n and content[i : i + 3] == ch * 3:
                        string_delim = ch * 3
                        triple_quote = True
                        current_raw.append(string_delim)
                        i += 3
                    else:
                        string_delim = ch
                        triple_quote = False
                        current_raw.append(ch)
                        i += 1
                    state = LexerState.IN_STRING
                    continue

                comment_start = False
                for cm in self.single_line_comments:
                    if content.startswith(cm, i):
                        current_raw.append(cm)
                        i += len(cm)
                        state = LexerState.IN_COMMENT
                        comment_start = True
                        break
                if comment_start:
                    continue

                current_raw.append(ch)
                i += 1
                continue

            if state == LexerState.IN_STRING:
                assert string_delim is not None
                if content[i] == "\\":
                    current_raw.append(content[i])
                    i += 1
                    if i < n:
                        current_raw.append(content[i])
                        i += 1
                    continue

                if triple_quote:
                    if content.startswith(string_delim, i):
                        current_raw.append(string_delim)
                        i += 3
                        state = LexerState.IN_A2UI
                        continue
                else:
                    if content[i] == string_delim:
                        current_raw.append(string_delim)
                        i += 1
                        state = LexerState.IN_A2UI
                        continue

                current_raw.append(content[i])
                i += 1
                continue

            if state == LexerState.IN_COMMENT:
                ch = content[i]
                current_raw.append(ch)
                i += 1
                if ch in ("\n", "\r"):
                    state = LexerState.IN_A2UI
                continue

        if state in (LexerState.IN_A2UI, LexerState.IN_STRING, LexerState.IN_COMMENT):
            raw_content = self._clean_markdown("".join(current_raw))
            text_part = self._clean_markdown("".join(current_text))
            if text_part:
                parts.append(
                    RawResponsePart(part=TextPart(text=text_part), is_final=True)
                )
            parts.append(
                RawResponsePart(part=RawA2uiPart(a2ui_raw=raw_content), is_final=False)
            )
        else:
            trailing = self._clean_markdown("".join(current_text))
            if trailing:
                parts.append(
                    RawResponsePart(part=TextPart(text=trailing), is_final=True)
                )

        return parts
