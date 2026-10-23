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
import json
import re

from a2ui.core import A2uiCatalogError
from a2ui.core import A2uiError
from a2ui.core import A2uiParseError
from a2ui.core import CatalogApi
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import AgentToRendererMessage
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats._shared import check_catalogs
from a2ui.inference_formats._shared import to_message_dicts
from a2ui.inference_formats._shared import to_message_models
from a2ui.parser import A2uiPart
from a2ui.parser import Parser
from a2ui.parser import RawA2uiPart
from a2ui.parser import RawResponsePart
from a2ui.parser import ResponsePart
from a2ui.parser import TextPart
from a2ui.utils import validate_payload

from .decompiler import DirectJsonDecompiler
from .json_reader import read_json
from .json_reader import read_partial_message_items

_OPEN_TAG = "<a2ui-json>"
_CLOSE_TAG = "</a2ui-json>"
_OPEN_TAG_RE = re.compile(r"<a2ui-json(?:\s[^>]*)?>", re.IGNORECASE)
_CLOSE_TAG_RE = re.compile(r"</a2ui-json\s*>", re.IGNORECASE)
_OPEN_TAG_START_RE = re.compile(r"^<a2ui-json\s[^>]*$", re.IGNORECASE)
_CLOSE_TAG_START_RE = re.compile(r"^</a2ui-json\s*$", re.IGNORECASE)
_LEADING_FENCE_RE = re.compile(r"^```[a-zA-Z0-9_-]*\s*", re.IGNORECASE)
_TRAILING_FENCE_RE = re.compile(r"\s*```[a-zA-Z0-9_-]*$", re.IGNORECASE)
_OPEN_FENCE_RE = re.compile(r"^[ \t]*```[a-zA-Z0-9_-]*[ \t]*\r?\n?", re.MULTILINE)
_CLOSING_FENCE_END_RE = re.compile(r"\r?\n?[ \t]*```[ \t]*\r?\n?$")
_JSON_START_RE = re.compile(
    r'^[ \t]*(?:\[\s*(?:\{|\]|$)|\{\s*(?:"|\}|$))', re.MULTILINE
)
_STREAM_TRAILING_FENCE_RE = re.compile(r"\s*`{1,3}[a-zA-Z0-9_-]*\s*$")
# Envelope keys of the messages that create a surface.
_CREATE_KEYS = ("createSurface", "beginRendering")


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

        # Streaming state
        self._wrapped: bool | None = None
        self._in_block = False
        self._held = ""
        self._block = ""
        self._run_started = False
        self._held_space = ""
        self._held_backticks = ""
        self._strip_close_backticks = False
        self._emitted_json: list[str] = []

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
                pieces.append(f"{_OPEN_TAG}\n{inner.a2ui_raw}\n{_CLOSE_TAG}")
        return "\n".join(pieces)

    def unwrap(self, content: str) -> list[RawResponsePart]:
        parts: list[RawResponsePart] = []
        i = 0
        n = len(content)
        recovered_unmatched = False
        while i < n:
            open_match = _OPEN_TAG_RE.search(content, i)
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
            self._add_text(parts, text_before)
            close_start, _ = self._scan_block(content, open_match.end())
            if close_start is None:
                parts.append(
                    RawResponsePart(
                        part=RawA2uiPart(
                            a2ui_raw=self._clean_raw(content[open_match.end() :])
                        ),
                        is_final=False,
                    )
                )
                return parts
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
            close_match = _CLOSE_TAG_RE.match(content, close_start)
            assert close_match is not None
            i = close_match.end()
            if i < n and content[i] == "`":
                i += len(content[i:]) - len(content[i:].lstrip("`"))
        self._add_text(parts, content[i:])
        return parts

    def compile(self, format_content: str) -> list[AgentToRendererMessage]:
        cleaned = self._clean_raw(format_content)
        if not cleaned:
            raise A2uiParseError("The direct JSON block is empty.")
        try:
            decoded = read_json(cleaned)
        except ValueError as e:
            raise A2uiParseError(f"The direct JSON block is not JSON: {e}") from e
        if not self._catalogs:
            raise A2uiCatalogError("Compiling direct JSON needs at least one catalog.")
        payload = decoded if isinstance(decoded, list) else [decoded]
        validate_payload(self._catalogs, payload)
        return to_message_models(payload)

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        return self._decompiler.decompile(a2ui_payload)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Encloses decompiled JSON blocks in sentinel tags."""
        return self._decompiler.wrap_decompiled_blocks(blocks)

    def parse_chunk(self, chunk: str, wrapped: bool = True) -> list[ResponsePart]:
        if self._wrapped is None:
            self._wrapped = wrapped
            self._in_block = not wrapped
        elif self._wrapped != wrapped:
            raise ValueError(
                "A response is either wrapped or not; the first chunk said"
                f" {self._wrapped}"
            )

        parts: list[ResponsePart] = []
        if not wrapped:
            self._block += chunk
            self._emit_ready(parts, self._block)
            return parts

        input_str = self._held + chunk
        self._held = ""
        if self._strip_close_backticks:
            if input_str.startswith("`"):
                input_str = input_str.lstrip("`")
            if input_str:
                self._strip_close_backticks = False

        if not self._in_block and self._held_backticks:
            if input_str:
                is_open_tag = bool(
                    _OPEN_TAG_RE.match(input_str)
                    or _OPEN_TAG_START_RE.match(input_str)
                    or (
                        input_str.startswith("<")
                        and "<a2ui-json".startswith(input_str.lower())
                    )
                )
                if is_open_tag:
                    self._held_backticks = ""
                else:
                    input_str = self._held_backticks + input_str
                    self._held_backticks = ""

        while input_str:
            if self._in_block:
                self._block += input_str
                input_str = ""
                close_start, readable_end = self._scan_block(self._block, 0)
                if close_start is None:
                    self._emit_ready(parts, self._block[:readable_end])
                    break
                close_match = _CLOSE_TAG_RE.match(self._block, close_start)
                assert close_match is not None
                block_content = self._block[:close_start]
                input_str = self._block[close_match.end() :]
                if input_str.startswith("`"):
                    input_str = input_str.lstrip("`")
                elif not input_str:
                    self._strip_close_backticks = True
                self._in_block = False
                self._block = ""
                try:
                    self._emit_changed(parts, self.compile(block_content))
                finally:
                    self._emitted_json.clear()
                continue

            open_match = _OPEN_TAG_RE.search(input_str)
            if open_match:
                text_before = input_str[: open_match.start()]
                if text_before.endswith("`"):
                    text_before = text_before.rstrip("`")
                self._emit_text(parts, text_before)
                self._run_started = False
                self._held_space = ""
                self._held_backticks = ""
                self._in_block = True
                input_str = input_str[open_match.end() :]
                continue

            hold = self._possible_tag_start(input_str)
            if hold < len(input_str):
                while hold > 0 and input_str[hold - 1] == "`":
                    hold -= 1
            text_to_emit = input_str[:hold]
            self._held = input_str[hold:]
            input_str = ""
            if not self._held:
                m = re.search(r"`+\Z", text_to_emit)
                if m:
                    self._held_backticks = m.group(0)
                    text_to_emit = text_to_emit[: m.start()]
            self._emit_text(parts, text_to_emit)

        return parts

    def flush(self) -> list[ResponsePart]:
        """Flushes buffered text or backticks when the stream ends."""
        parts: list[ResponsePart] = []
        if self._held_backticks:
            self._emit_text(parts, self._held_backticks)
            self._held_backticks = ""
        elif self._held:
            self._emit_text(parts, self._held)
            self._held = ""
        return parts

    def _emit_text(self, parts: list[ResponsePart], text: str) -> None:
        body = (text if self._run_started else text.lstrip()).rstrip()
        if not body:
            if self._run_started and not body:
                self._held_space += text
            return
        start = 0 if self._run_started else text.find(body)
        parts.append(TextPart(text=f"{self._held_space}{body}"))
        self._held_space = text[start + len(body) :]
        self._run_started = True

    def _emit_ready(self, parts: list[ResponsePart], block: str) -> None:
        content = self._clean_start(block)
        v09_or_later = is_at_least_version(
            self._catalogs[0].protocol_version, ProtocolVersion.V0_9
        )
        v10 = is_at_least_version(
            self._catalogs[0].protocol_version, ProtocolVersion.V1_0
        )
        candidates = read_partial_message_items(
            content,
            self._progressive_keys,
            whole_item_keys={"components"} if v10 else frozenset(),
        )
        ready: list[AgentToRendererMessage] = []
        surfaces: dict[str, str] = {}
        deleted_surfaces: set[str] = set()
        for envelope, closed in candidates:
            try:
                if not isinstance(envelope, dict):
                    break
                # A renderer accepts a surface's create message only once, so
                # it is held until its object closes rather than re-emitted as
                # it grows. The messages after it wait with it.
                if not closed and any(key in envelope for key in _CREATE_KEYS):
                    break
                if v09_or_later:
                    update_target = envelope.get("updateComponents") or envelope.get(
                        "updateDataModel"
                    )
                    if (
                        isinstance(update_target, dict)
                        and update_target.get("surfaceId") in deleted_surfaces
                    ):
                        break
                trial_surfaces = dict(surfaces)
                validate_payload(
                    self._catalogs,
                    [envelope],
                    surface_catalog_ids=trial_surfaces,
                )
                create_body = envelope.get("createSurface") or envelope.get(
                    "beginRendering"
                )
                if isinstance(create_body, dict):
                    sid = create_body.get("surfaceId")
                    cid = create_body.get("catalogId")
                    if isinstance(sid, str):
                        deleted_surfaces.discard(sid)
                        if isinstance(cid, str):
                            trial_surfaces[sid] = cid
                delete_body = envelope.get("deleteSurface")
                if isinstance(delete_body, dict):
                    sid = delete_body.get("surfaceId")
                    if isinstance(sid, str):
                        trial_surfaces.pop(sid, None)
                        deleted_surfaces.add(sid)
                elif isinstance(delete_body, str):
                    trial_surfaces.pop(delete_body, None)
                    deleted_surfaces.add(delete_body)
                models = to_message_models([envelope])
                surfaces = trial_surfaces
                ready.extend(models)
            except A2uiError:
                update_body = envelope.get("updateComponents")
                if (
                    v10
                    and isinstance(envelope.get("version"), str)
                    and isinstance(update_body, dict)
                    and isinstance(update_body.get("surfaceId"), str)
                    and bool(update_body.get("components"))
                ):
                    raise
                break
            except Exception:
                break
        self._emit_changed(parts, ready)

    def _emit_changed(
        self,
        parts: list[ResponsePart],
        messages: list[AgentToRendererMessage],
    ) -> None:
        changed: list[AgentToRendererMessage] = []
        for i, msg in enumerate(messages):
            encoded = json.dumps(to_message_dicts([msg])[0], sort_keys=True)
            if i < len(self._emitted_json):
                if self._emitted_json[i] == encoded:
                    continue
                self._emitted_json[i] = encoded
            else:
                self._emitted_json.append(encoded)
            changed.append(msg)
        if changed:
            parts.append(A2uiPart(a2ui=changed))

    @staticmethod
    def _possible_tag_start(text: str) -> int:
        idx = text.find("<")
        while idx >= 0:
            rest = text[idx:]
            if "<a2ui-json".startswith(rest.lower()) or _OPEN_TAG_START_RE.match(rest):
                return idx
            idx = text.find("<", idx + 1)
        return len(text)

    @staticmethod
    def _scan_block(content: str, start: int) -> tuple[int | None, int]:
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
                if _CLOSE_TAG_RE.match(content, i) is not None:
                    return i, i - start
                rest = content[i:].lower()
                if _CLOSE_TAG.startswith(rest) or _CLOSE_TAG_START_RE.match(rest):
                    return None, i - start
            i += 1
        return None, n - start

    def _add_text(self, parts: list[RawResponsePart], text: str) -> None:
        cleaned = self._clean(text)
        if cleaned:
            parts.append(RawResponsePart(part=TextPart(text=cleaned), is_final=True))

    def _try_recover_unmatched_close(
        self,
        parts: list[RawResponsePart],
        content: str,
        start: int,
        search_end: int,
    ) -> int | None:
        segment = content[start:search_end]
        if _CLOSE_TAG_RE.search(segment) is None:
            return None

        fences = list(_OPEN_FENCE_RE.finditer(segment))
        for idx in range(0, len(fences), 2):
            fence = fences[idx]
            close_start, _ = self._scan_block(segment, fence.end())
            if close_start is None:
                continue
            close_match = _CLOSE_TAG_RE.match(segment, close_start)
            assert close_match is not None
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
            return start + close_match.end()

        search_from = 0
        pair_idx = 0
        while pair_idx + 1 < len(fences):
            close_start, _ = self._scan_block(segment, fences[pair_idx + 1].end())
            if close_start is None:
                break
            search_from = fences[pair_idx + 1].end()
            pair_idx += 2

        json_match = _JSON_START_RE.search(segment, search_from)
        if json_match is None:
            return None
        close_start, _ = self._scan_block(segment, json_match.start())
        if close_start is None:
            return None
        close_match = _CLOSE_TAG_RE.match(segment, close_start)
        assert close_match is not None
        raw_content = self._clean_raw(segment[json_match.start() : close_start])
        if not raw_content:
            return None
        self._add_text(parts, segment[: json_match.start()])
        parts.append(
            RawResponsePart(part=RawA2uiPart(a2ui_raw=raw_content), is_final=True)
        )
        return start + close_match.end()

    @staticmethod
    def _clean(text: str) -> str:
        cleaned = text.strip()
        cleaned = _LEADING_FENCE_RE.sub("", cleaned, count=1)
        cleaned = _TRAILING_FENCE_RE.sub("", cleaned, count=1)
        cleaned = cleaned.strip()
        return "" if not cleaned.strip("`") else cleaned

    @classmethod
    def _clean_raw(cls, text: str) -> str:
        return cls._clean(text).strip("`").strip()

    @staticmethod
    def _clean_start(block: str) -> str:
        text = block.lstrip()
        if text.startswith("```"):
            newline = text.find("\n")
            if newline < 0:
                return ""
            text = text[newline + 1 :]
        elif text.startswith("`"):
            text = text.lstrip("`").lstrip()
        return _STREAM_TRAILING_FENCE_RE.sub("", text, count=1)
