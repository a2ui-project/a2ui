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
        open_match = OPEN_TAG_RE.search(content)
        if not open_match:
            return False
        if not complete:
            return True
        close_start, _ = scan_block(content, open_match.end())
        return close_start is not None

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
        while True:
            open_match = OPEN_TAG_RE.search(content, i)
            if not open_match:
                break
            add_text(parts, content[i : open_match.start()])
            close_start, _ = scan_block(content, open_match.end())
            if close_start is None:
                parts.append(
                    RawResponsePart(
                        part=RawA2uiPart(a2ui_raw=clean(content[open_match.end() :])),
                        is_final=False,
                    )
                )
                return parts
            parts.append(
                RawResponsePart(
                    part=RawA2uiPart(
                        a2ui_raw=clean(content[open_match.end() : close_start])
                    ),
                    is_final=True,
                )
            )
            close_match = CLOSE_TAG_RE.match(content, close_start)
            assert close_match is not None
            i = close_match.end()
        add_text(parts, content[i:])
        return parts

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
        cleaned = clean(format_content)
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
