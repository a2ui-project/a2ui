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
_OPEN_TAG_START_RE = re.compile(r"<a2ui-json\s[^>]*$", re.IGNORECASE)
_CLOSE_TAG_START_RE = re.compile(r"</a2ui-json\s*$", re.IGNORECASE)
_LEADING_FENCE_RE = re.compile(r"^```[a-zA-Z-]*\s*")
_TRAILING_FENCE_RE = re.compile(r"\s*```[a-zA-Z-]*$")
_STREAM_TRAILING_FENCE_RE = re.compile(r"\s*`{1,3}[a-zA-Z-]*\s*$")


def possible_tag_start(text: str) -> int:
    """Returns where a tail of `text` could start an open tag, else its length."""
    idx = text.find("<")
    while idx >= 0:
        if _is_tag_prefix(text, idx, OPEN_TAG) or _OPEN_TAG_START_RE.match(text, idx):
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
    i = start
    in_string = False
    n = len(content)
    while i < n:
        c = content[i]
        if in_string:
            if c == "\\":
                i += 2
                continue
            if c == '"':
                in_string = False
        elif c == '"':
            in_string = True
        elif c == "<":
            if CLOSE_TAG_RE.match(content, i) is not None:
                return i, i - start
            if _is_tag_prefix(content, i, CLOSE_TAG) or _CLOSE_TAG_START_RE.match(
                content, i
            ):
                return None, i - start
        i += 1
    return None, n - start


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
    return cleaned.strip()


def clean_start(block: str) -> str:
    """Strips the opening fence and a trailing fence from a block still arriving."""
    text = block.lstrip()
    if "```".startswith(text):
        # Nothing has arrived yet but the start of a fence.
        return ""
    if text.startswith("```"):
        newline = text.find("\n")
        if newline < 0:
            return ""
        text = text[newline + 1 :]
    return _STREAM_TRAILING_FENCE_RE.sub("", text, count=1)
