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

"""Reading a streamed Direct JSON response chunk by chunk."""

from __future__ import annotations

import json
from typing import Any
from typing import TYPE_CHECKING

from a2ui.core import A2uiError
from a2ui.core import A2uiParseError
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import AgentToRendererMessage
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats._shared import to_message_dicts
from a2ui.inference_formats._shared import to_message_models
from a2ui.parser import A2uiPart
from a2ui.parser import ResponsePart
from a2ui.parser import ResponseStream
from a2ui.parser import TextPart
from a2ui.utils import RendererState

from .blocks import CLOSE_TAG
from .blocks import CLOSE_TAG_RE
from .blocks import OPEN_TAG
from .blocks import OPEN_TAG_RE
from .blocks import clean_start
from .blocks import possible_tag_start
from .blocks import scan_block
from .json_reader import read_partial_message_items

if TYPE_CHECKING:
    from .parser import DirectJsonParser

# Envelope keys of the messages that a renderer applies only once, so a stream
# holds them until their object closes: creating a surface twice fails, and a
# deleted surface cannot be restored.
_ONCE_KEYS = ("createSurface", "beginRendering", "deleteSurface")


class DirectJsonResponseStream(ResponseStream):
    """Reads one streamed Direct JSON response.

    A message is emitted, and applied to the state, as soon as it reads and
    the state accepts it, and again each time it grows. A message that creates
    or deletes a surface is held until its object closes. When a block closes,
    the messages it holds are applied in full and every surface they touched
    is checked in full.

    The stream ends when `close` returns or when `feed` or `close` raises: the
    response cannot be read further once part of it is rejected.
    """

    def __init__(
        self,
        parser: DirectJsonParser,
        *,
        wrapped: bool,
        state: RendererState,
    ) -> None:
        self._parser = parser
        self._wrapped = wrapped
        self._state = state
        self._v10 = is_at_least_version(
            parser.catalogs[0].protocol_version, ProtocolVersion.V1_0
        )
        self._closed = False
        # Text outside blocks.
        self._held = ""
        self._run_started = False
        self._held_space = ""
        # The open block.
        self._in_block = not wrapped
        self._block = ""
        self._committed = 0
        self._applied_json: list[str] = []
        self._emitted_json: list[str] = []
        self._touched: dict[str, None] = {}

    @property
    def state(self) -> RendererState:
        return self._state

    def feed(self, chunk: str) -> list[ResponsePart]:
        if self._closed:
            raise ValueError("The response stream is closed.")
        try:
            # A chunk may apply messages and then fail, for example in a second
            # block, before its parts are returned. The transaction undoes
            # them, so the state holds only what was emitted.
            with self._state.transaction():
                return self._feed(chunk)
        except BaseException:
            self._closed = True
            raise

    def close(self) -> list[ResponsePart]:
        if self._closed:
            return []
        self._closed = True
        parts: list[ResponsePart] = []
        if not self._wrapped:
            self._finish_block(parts, self._block)
            return parts
        if self._in_block:
            raise A2uiParseError(
                f"The response ended inside an {OPEN_TAG} block, before its"
                f" {CLOSE_TAG} tag."
            )
        if self._held:
            self._emit_text(parts, self._held)
            self._held = ""
        return parts

    def _feed(self, chunk: str) -> list[ResponsePart]:
        parts: list[ResponsePart] = []
        if not self._wrapped:
            self._block += chunk
            self._emit_ready(parts, self._block)
            return parts

        input_str = self._held + chunk
        self._held = ""
        while input_str:
            if self._in_block:
                self._block += input_str
                input_str = ""
                close_start, readable_end = scan_block(self._block, 0)
                if close_start is None:
                    self._emit_ready(parts, self._block[:readable_end])
                    break
                close_match = CLOSE_TAG_RE.match(self._block, close_start)
                assert close_match is not None
                input_str = self._block[close_match.end() :]
                self._finish_block(parts, self._block[:close_start])
                continue

            open_match = OPEN_TAG_RE.search(input_str)
            if open_match:
                self._emit_text(parts, input_str[: open_match.start()])
                self._run_started = False
                self._held_space = ""
                self._in_block = True
                input_str = input_str[open_match.end() :]
                continue

            hold = possible_tag_start(input_str)
            self._emit_text(parts, input_str[:hold])
            self._held = input_str[hold:]
            input_str = ""

        return parts

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

    def _emit_ready(self, parts: list[ResponsePart], block: str) -> None:
        """Emits the messages of the open block that read and are accepted."""
        candidates = read_partial_message_items(
            clean_start(block),
            self._parser.progressive_keys,
            whole_item_keys={"components"} if self._v10 else frozenset(),
        )
        ready: list[AgentToRendererMessage] = []
        for index, (envelope, closed) in enumerate(candidates):
            if index < self._committed:
                continue
            if not isinstance(envelope, dict):
                break
            # A message that creates or deletes a surface is held until its
            # object closes rather than emitted as it grows. The messages after
            # it wait with it.
            if not closed and any(key in envelope for key in _ONCE_KEYS):
                break
            try:
                ready.extend(self._apply(index, envelope))
            except A2uiError:
                update_body = envelope.get("updateComponents")
                if (
                    self._v10
                    and isinstance(envelope.get("version"), str)
                    and isinstance(update_body, dict)
                    and isinstance(update_body.get("surfaceId"), str)
                    and bool(update_body.get("components"))
                ):
                    raise
                break
            except Exception:
                break
            if closed:
                self._committed = index + 1
        if ready:
            parts.append(A2uiPart(a2ui=ready))

    def _finish_block(self, parts: list[ResponsePart], block: str) -> None:
        """Applies the rest of a closed block and checks the surfaces it touched.

        `compile` only reads the block. Each message is checked when the state
        applies it: the messages that closed while the block arrived were
        checked then, and `_apply` checks the rest here. The trees of the
        surfaces the block touched are checked last.

        The messages not emitted yet are emitted only if the checks pass, so
        a failed block leaves the state holding what was emitted.
        """
        messages = self._parser.compile(block)
        ready: list[AgentToRendererMessage] = []
        with self._state.transaction():
            for index, envelope in enumerate(messages):
                if index >= self._committed:
                    ready.extend(self._apply(index, envelope))
            self._state.check_topology(self._touched)
        if ready:
            parts.append(A2uiPart(a2ui=ready))
        self._in_block = False
        self._block = ""
        self._committed = 0
        self._applied_json.clear()
        self._emitted_json.clear()
        self._touched.clear()

    def _apply(self, index: int, envelope: Any) -> list[AgentToRendererMessage]:
        """Applies the message at an index of the block if it changed.

        Returns:
          The message, if the renderer has not received it as it now stands.
        """
        applied = json.dumps(envelope, sort_keys=True)
        if index < len(self._applied_json) and self._applied_json[index] == applied:
            return []
        with self._state.transaction():
            # A newer version of a message holds everything the older one did,
            # since components are replaced by id and a data model path is
            # overwritten, so applying it over the older one is an update.
            touched = self._state.apply([envelope])
            models = to_message_models([envelope])
        self._touched.update(dict.fromkeys(touched))
        encoded = json.dumps(to_message_dicts(models)[0], sort_keys=True)
        if index < len(self._applied_json):
            self._applied_json[index] = applied
            if self._emitted_json[index] == encoded:
                return []
            self._emitted_json[index] = encoded
        else:
            self._applied_json.append(applied)
            self._emitted_json.append(encoded)
        return models
