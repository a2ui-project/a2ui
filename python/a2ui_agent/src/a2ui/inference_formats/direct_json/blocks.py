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

"""Finding and cleaning `<a2ui-json>` blocks in model output."""

from __future__ import annotations

import re

from a2ui.parser import RawResponsePart
from a2ui.parser import TextPart

OPEN_TAG = "<a2ui-json>"
CLOSE_TAG = "</a2ui-json>"
OPEN_TAG_RE = re.compile(r"<a2ui-json(?:\s[^>]*)?>", re.IGNORECASE)
CLOSE_TAG_RE = re.compile(r"</a2ui-json\s*>", re.IGNORECASE)
# The start of a tag that runs to the end of the text, matched at a position.
OPEN_TAG_START_RE = re.compile(r"<a2ui-json\s[^>]*$", re.IGNORECASE)
_CLOSE_TAG_START_RE = re.compile(r"</a2ui-json\s*$", re.IGNORECASE)
_LEADING_FENCE_RE = re.compile(r"^```[a-zA-Z-]*\s*")
_TRAILING_FENCE_RE = re.compile(r"\s*```[a-zA-Z-]*$")


def possible_tag_start(text: str) -> int:
    """Returns where a tail of `text` could start an open tag, else its length."""
    idx = text.find("<")
    while idx >= 0:
        if _is_tag_prefix(text, idx, OPEN_TAG) or OPEN_TAG_START_RE.match(text, idx):
            return idx
        idx = text.find("<", idx + 1)
    return len(text)


def _is_tag_prefix(text: str, idx: int, tag: str) -> bool:
    """Whether the rest of `text` from `idx` is a proper prefix of `tag`."""
    return len(text) - idx < len(tag) and tag.startswith(text[idx:].lower())


def scan_block(content: str, start: int) -> tuple[int | None, int]:
    """Finds the close tag of a block whose body starts at `start`.

    A tag written inside a JSON string does not count.

    Returns:
      The close tag's offset, or None if the block is still open, and the
      length of the body that can be read: up to the close tag, or up to a
      tail that could start one.
    """
    return BlockScanner(start).scan(content)


class BlockScanner:
    """Finds the close tag of a block as its text arrives.

    Each scan goes on from where the last one stopped, so across the scans of
    a longer and longer text each character is read once. A tag written
    inside a JSON string does not count.
    """

    def __init__(self, start: int) -> None:
        """Creates a scanner of the block whose body starts at `start`."""
        self._start = start
        # Where the next scan starts. Past the end of the text when the text
        # ends in an escape whose second character has not arrived.
        self._i = start
        self._in_string = False

    def scan(self, content: str) -> tuple[int | None, int]:
        """Scans `content`, the text the last scan read and more.

        Returns:
          As `scan_block` does.
        """
        i = self._i
        n = len(content)
        in_string = self._in_string
        try:
            while i < n:
                if in_string:
                    # Jumps to the next quote or escape.
                    quote = content.find('"', i)
                    escape = content.find("\\", i, quote if quote >= 0 else n)
                    if escape >= 0:
                        i = escape + 2
                        continue
                    if quote < 0:
                        i = n
                        break
                    in_string = False
                    i = quote + 1
                    continue
                c = content[i]
                if c == '"':
                    in_string = True
                elif c == "<":
                    if CLOSE_TAG_RE.match(content, i) is not None:
                        return i, i - self._start
                    if _is_tag_prefix(
                        content, i, CLOSE_TAG
                    ) or _CLOSE_TAG_START_RE.match(content, i):
                        # Scanned again from here once more text arrives.
                        return None, i - self._start
                i += 1
            return None, n - self._start
        finally:
            self._i = i
            self._in_string = in_string


def payload_start(block: str, end: int) -> int | None:
    """Where the payload of a block still arriving starts.

    That is after leading whitespace and after the line of a leading Markdown
    fence. None while nothing but the start of a fence has arrived, or while
    the fence's line is not complete.

    Args:
      block: The block text.
      end: Where the part of `block` that can be read ends.
    """
    start = 0
    while start < end and block[start].isspace():
        start += 1
    if end - start <= 3 and "```".startswith(block[start:end]):
        return None
    if block.startswith("```", start):
        newline = block.find("\n", start, end)
        return None if newline < 0 else newline + 1
    if start < end and block[start] == "`":
        while start < end and (block[start] == "`" or block[start].isspace()):
            start += 1
    return start


def trailing_fence_start(block: str, start: int, end: int) -> int:
    """Where a Markdown fence that ends `block[start:end]` begins, else `end`.

    The fence is what `\\s*`{1,3}[a-zA-Z-]*\\s*$` matches: a fence still
    arriving may have fewer than three backticks. It is found by reading back
    from the end, so that a block is not searched from its start on every
    chunk.
    """
    fence = end
    while fence > start and block[fence - 1].isspace():
        fence -= 1
    while fence > start and (
        block[fence - 1] == "-" or ("a" <= block[fence - 1].lower() <= "z")
    ):
        fence -= 1
    ticks = 0
    while ticks < 3 and fence > start and block[fence - 1] == "`":
        fence -= 1
        ticks += 1
    if not ticks:
        return end
    while fence > start and block[fence - 1].isspace():
        fence -= 1
    return fence


def add_text(parts: list[RawResponsePart], text: str) -> None:
    """Appends `text` as a final text part, unless it is empty once cleaned."""
    cleaned = clean(text)
    if cleaned:
        parts.append(RawResponsePart(part=TextPart(text=cleaned), is_final=True))


def clean(text: str) -> str:
    """Strips whitespace and one Markdown code fence around a block body."""
    cleaned = text.strip()
    cleaned = _LEADING_FENCE_RE.sub("", cleaned, count=1)
    cleaned = _TRAILING_FENCE_RE.sub("", cleaned, count=1)
    cleaned = cleaned.strip()
    return "" if not cleaned.strip("`") else cleaned
