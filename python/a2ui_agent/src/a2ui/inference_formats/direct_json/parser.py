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

from __future__ import annotations

from collections.abc import Collection
from collections.abc import Sequence
import re

from a2ui.core import A2uiParseError
from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import check_catalogs
from a2ui.inference_formats._shared import to_message_models
from a2ui.parser import Parser
from a2ui.parser import RawA2uiPart
from a2ui.parser import RawResponsePart
from a2ui.parser import TextPart
from a2ui.utils import RendererState

from .blocks import CLOSE_TAG
from .blocks import CLOSE_TAG_RE
from .blocks import OPEN_TAG
from .blocks import OPEN_TAG_RE
from .blocks import add_text
from .blocks import clean
from .blocks import scan_block
from .decompiler import DirectJsonDecompiler
from .json_reader import read_json
from .response_stream import DirectJsonResponseStream

_OPEN_FENCE_RE = re.compile(r"^[ \t]*```[a-zA-Z0-9_-]*[ \t]*\r?\n?", re.MULTILINE)
_CLOSING_FENCE_END_RE = re.compile(r"\r?\n?[ \t]*```[ \t]*\r?\n?$")
_JSON_START_RE = re.compile(
    r'^[ \t]*(?:\[\s*(?:\{|\]|$)|\{\s*(?:"|\}|$))', re.MULTILINE
)


def _clean_raw(text: str) -> str:
    return clean(text).strip("`").strip()


class DirectJsonParser(Parser):
    """Parser for the Direct JSON format, supporting both complete and streaming responses."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        progressive_keys: Collection[str] = frozenset(),
    ):
        self._catalogs = check_catalogs(catalogs)
        self._progressive_keys = frozenset(progressive_keys)
        self._decompiler = DirectJsonDecompiler()

    @property
    def catalogs(self) -> list[CatalogApi]:
        """The active catalogs in priority order."""
        return list(self._catalogs)

    @property
    def progressive_keys(self) -> frozenset[str]:
        """The progressive string property keys healed while streaming."""
        return self._progressive_keys

    @property
    def supports_streaming(self) -> bool:
        return True

    def has_format_content(self, content: str, complete: bool = False) -> bool:
        parts = self.unwrap(content)
        return any(
            isinstance(p.part, RawA2uiPart) and (not complete or p.is_final)
            for p in parts
        )

    def wrap(self, blocks: Sequence[RawResponsePart]) -> str:
        pieces: list[str] = []
        for block in blocks:
            inner = block.part if isinstance(block, RawResponsePart) else block
            if isinstance(inner, TextPart):
                pieces.append(inner.text)
            elif isinstance(inner, RawA2uiPart):
                pieces.append(f"{OPEN_TAG}\n{inner.a2ui_raw}\n{CLOSE_TAG}")
        return "\n".join(pieces)

    def unwrap(self, content: str) -> list[RawResponsePart]:
        parts: list[RawResponsePart] = []
        i = 0
        n = len(content)
        recovered_unmatched = False
        while i < n:
            open_match = OPEN_TAG_RE.search(content, i)
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
            text_before = content[i : open_match.start()]
            if text_before.endswith("`"):
                text_before = text_before.rstrip("`")
            add_text(parts, text_before)
            close_start, _ = scan_block(content, open_match.end())
            if close_start is None:
                parts.append(
                    RawResponsePart(
                        part=RawA2uiPart(
                            a2ui_raw=_clean_raw(content[open_match.end() :])
                        ),
                        is_final=False,
                    )
                )
                return parts
            parts.append(
                RawResponsePart(
                    part=RawA2uiPart(
                        a2ui_raw=_clean_raw(content[open_match.end() : close_start])
                    ),
                    is_final=True,
                )
            )
            close_match = CLOSE_TAG_RE.match(content, close_start)
            assert close_match is not None
            i = close_match.end()
            if i < n and content[i] == "`":
                i += len(content[i:]) - len(content[i:].lstrip("`"))
        if not recovered_unmatched and i < n:
            next_i = self._try_recover_unmatched_close(parts, content, i, n)
            if next_i is not None:
                i = next_i
        add_text(parts, content[i:])
        return parts

    def _try_recover_unmatched_close(
        self,
        parts: list[RawResponsePart],
        content: str,
        start: int,
        search_end: int,
    ) -> int | None:
        segment = content[start:search_end]
        if CLOSE_TAG_RE.search(segment) is None:
            return None

        fences = list(_OPEN_FENCE_RE.finditer(segment))
        for idx in range(0, len(fences), 2):
            fence = fences[idx]
            close_start, _ = scan_block(segment, fence.end())
            if close_start is None:
                continue
            close_match = CLOSE_TAG_RE.match(segment, close_start)
            assert close_match is not None
            body = segment[fence.end() : close_start]
            body_stripped = _CLOSING_FENCE_END_RE.sub("", body)
            if _OPEN_FENCE_RE.search(body_stripped) is not None:
                continue
            raw_content = _clean_raw(body_stripped)
            if not raw_content:
                continue
            add_text(parts, segment[: fence.start()])
            parts.append(
                RawResponsePart(part=RawA2uiPart(a2ui_raw=raw_content), is_final=True)
            )
            return start + close_match.end()

        search_from = 0
        pair_idx = 0
        while pair_idx + 1 < len(fences):
            close_start, _ = scan_block(segment, fences[pair_idx + 1].end())
            if close_start is None:
                break
            search_from = fences[pair_idx + 1].end()
            pair_idx += 2

        json_match = _JSON_START_RE.search(segment, search_from)
        if json_match is None:
            return None
        close_start, _ = scan_block(segment, json_match.start())
        if close_start is None:
            return None
        close_match = CLOSE_TAG_RE.match(segment, close_start)
        assert close_match is not None
        raw_content = _clean_raw(segment[json_match.start() : close_start])
        if not raw_content:
            return None
        add_text(parts, segment[: json_match.start()])
        parts.append(
            RawResponsePart(part=RawA2uiPart(a2ui_raw=raw_content), is_final=True)
        )
        return start + close_match.end()

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> list[AgentToRendererMessage]:
        """Reads a block as a JSON message or a JSON array of messages.

        Raises:
          A2uiParseError: If the block is cut off, empty or not JSON.
          A2uiValidationError: If a message does not match any protocol
            version's message schema.
        """
        if not is_final:
            raise A2uiParseError(
                f"The response ended inside an unclosed {OPEN_TAG} block."
            )
        cleaned = _clean_raw(format_content)
        if not cleaned:
            raise A2uiParseError("The direct JSON block is empty.")
        try:
            decoded = read_json(cleaned)
        except ValueError as e:
            raise A2uiParseError(f"The direct JSON block is not JSON: {e}") from e
        return to_message_models(decoded if isinstance(decoded, list) else [decoded])

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        return self._decompiler.decompile(a2ui_payload)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Encloses decompiled JSON blocks in sentinel tags."""
        return self._decompiler.wrap_decompiled_blocks(blocks)

    def open_stream(
        self, *, wrapped: bool = True, state: RendererState | None = None
    ) -> DirectJsonResponseStream:
        return DirectJsonResponseStream(
            self,
            wrapped=wrapped,
            state=state if state is not None else self._empty_state(),
        )
