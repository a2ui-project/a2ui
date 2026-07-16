# Copyright 2026 Google LLC
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

import re
from enum import Enum
from typing import List, Optional, Set
from a2ui.parser.response_part import ResponsePart


class LexerState(Enum):
    """States of the BlockLexer scanner."""

    NORMAL = 0  # Outside tag (conversational text)
    IN_A2UI = 1  # Inside tag (scanning code)
    IN_STRING = 2  # Inside string literal
    IN_COMMENT = 3  # Inside single-line comment


class BlockLexer:
    """A generic state-machine-based scanner to extract structured format blocks from text.

    Correctly handles nested string literals and comments to prevent premature tag detection,
    and strips Markdown code block wrapping artifacts.
    """

    def __init__(
        self,
        open_tag: str = "<a2ui>",
        close_tag: str = "</a2ui>",
        string_delimiters: Optional[Set[str]] = None,
        single_line_comments: Optional[Set[str]] = None,
        preserve_enclosing_tags: bool = False,
    ):
        if isinstance(open_tag, str):
            tag_name = open_tag.strip("<>")
            self.open_tag_pattern = re.compile(rf"<{tag_name}\b[^>]*>", re.IGNORECASE)
        else:
            self.open_tag_pattern = open_tag

        if isinstance(close_tag, str):
            tag_name = close_tag.strip("<>/")
            self.close_tag_pattern = re.compile(rf"</{tag_name}>", re.IGNORECASE)
        else:
            self.close_tag_pattern = close_tag

        self.string_delimiters = string_delimiters or {"'", '"'}
        self.single_line_comments = single_line_comments or {"#"}
        self.preserve_enclosing_tags = preserve_enclosing_tags
        self.close_tag_str = close_tag if isinstance(close_tag, str) else "</a2ui>"

    def _clean_markdown(self, text: Optional[str]) -> Optional[str]:
        """Cleans Markdown code block wrapper backticks from conversational text."""
        if not text:
            return None
        # Remove opening backticks followed by language indicator at the end (e.g. ```html)
        text = re.sub(r"```[a-zA-Z-]*\s*$", "", text, flags=re.IGNORECASE)
        # Remove leading closing backticks from the start of subsequent text
        text = re.sub(r"^\s*```", "", text)
        return text.strip() or None

    def tokenize(self, content: str) -> List[ResponsePart]:
        """Scans response content character-by-character to extract format blocks."""
        parts: List[ResponsePart] = []
        n = len(content)
        i = 0

        state = LexerState.NORMAL

        current_text = []
        current_raw = []

        string_delim = None
        triple_quote = False

        while i < n:
            # Check for start tag in NORMAL state
            if state == LexerState.NORMAL:
                match = self.open_tag_pattern.match(content, i)
                if match:
                    start_tag = match.group(0)
                    i = match.end()
                    state = LexerState.IN_A2UI
                    current_raw = [start_tag] if self.preserve_enclosing_tags else []
                    continue
                else:
                    current_text.append(content[i])
                    i += 1
                    continue

            # Check for close tag or literal transitions in IN_A2UI
            if state == LexerState.IN_A2UI:
                match = self.close_tag_pattern.match(content, i)
                if match:
                    if self.preserve_enclosing_tags:
                        current_raw.append(match.group(0))
                    raw_content = "".join(current_raw).strip()
                    text_part = self._clean_markdown("".join(current_text))
                    parts.append(
                        ResponsePart(
                            text=text_part,
                            a2ui_raw=raw_content,
                            is_final=True,
                        )
                    )
                    current_text = []
                    current_raw = []
                    state = LexerState.NORMAL
                    i = match.end()
                    continue

                ch = content[i]

                # Check for string literal start
                if ch in self.string_delimiters:
                    # Check for triple quotes
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

                # Check for single line comments
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

            # Handle string literal scanning (respect escaping)
            if state == LexerState.IN_STRING:
                if content[i] == "\\":
                    if i + 1 < n:
                        current_raw.append(content[i : i + 2])
                        i += 2
                    else:
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

            # Handle single line comment scanning
            if state == LexerState.IN_COMMENT:
                ch = content[i]
                current_raw.append(ch)
                i += 1
                if ch in ("\n", "\r"):
                    state = LexerState.IN_A2UI
                continue

        # Post-loop checks (handle unclosed/truncated tags)
        if state in (LexerState.IN_A2UI, LexerState.IN_STRING, LexerState.IN_COMMENT):
            if self.preserve_enclosing_tags:
                current_raw.append(self.close_tag_str)
            raw_content = "".join(current_raw).strip()
            text_part = self._clean_markdown("".join(current_text))
            parts.append(
                ResponsePart(
                    text=text_part,
                    a2ui_raw=raw_content,
                    is_final=False,
                )
            )
        else:
            trailing = self._clean_markdown("".join(current_text))
            if trailing:
                parts.append(ResponsePart(text=trailing, a2ui_raw=None))

        return parts
