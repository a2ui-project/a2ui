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

"""Parser utilities to extract and compile A2UI Vertical syntax from LLM responses."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextvars import ContextVar
import re
from typing import Any, Literal, overload

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import A2uiError, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import check_mixed_catalogs, to_message_models
from a2ui.parser import (
    A2uiCompilationError,
    BlockLexer,
    Parser,
    RawA2uiPart,
    RawResponsePart,
    ResponsePart,
    StreamPart,
    TextPart,
)
from a2ui.utils import RendererState
from a2ui.utils._experimental import experimental

from .compiler import (
    VerticalCompiler,
    get_state_call_offset,
    normalize_wire_version,
    set_state_call_offset,
)
from .decompiler import VerticalDecompiler
from .streaming import VerticalResponseStream

_OPEN_SENTINEL_RE = re.compile(r"<(?:a2ui-vertical|a2ui)(?:\s[^>]*)?>", re.IGNORECASE)
_CLOSE_SENTINEL_RE = re.compile(r"</(?:a2ui-vertical|a2ui)\s*>", re.IGNORECASE)
VERTICAL_PAYLOAD_START_RE = re.compile(r"^[ \t]*[A-Z][\w]*\s*\(", re.MULTILINE)

_IN_FLIGHT_CALL_OFFSET: ContextVar[int | None] = ContextVar(
    "_IN_FLIGHT_CALL_OFFSET", default=None
)


@experimental
class VerticalParser(Parser):
    """Stateless parser, compiler, decompiler, and stream factory for A2UI Vertical."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        surface_id: str = "main",
        version: str | None = None,
    ):
        self._catalogs = check_mixed_catalogs(catalogs)
        self.surface_id = surface_id
        self.version = normalize_wire_version(version) if version is not None else None
        self._compiler = VerticalCompiler(
            self._catalogs, surface_id=self.surface_id, version=self.version
        )
        self._decompiler = VerticalDecompiler(self._catalogs, version=self.version)

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs in priority order."""
        return list(self._catalogs)

    @property
    def supports_streaming(self) -> bool:
        """Whether this parser supports incremental streaming via `open_stream`."""
        return True

    @overload
    def open_stream(
        self,
        *,
        wrapped: bool = True,
        state: RendererState | None = None,
        after_rejected_block: Literal["end"] = "end",
    ) -> VerticalResponseStream[ResponsePart]:
        ...

    @overload
    def open_stream(
        self,
        *,
        wrapped: bool = True,
        state: RendererState | None = None,
        after_rejected_block: Literal["end", "continue"],
    ) -> VerticalResponseStream[StreamPart]:
        ...

    def open_stream(
        self,
        *,
        wrapped: bool = True,
        state: RendererState | None = None,
        after_rejected_block: Literal["end", "continue"] = "end",
    ) -> VerticalResponseStream[StreamPart]:
        """Opens a stream that incrementally compiles Vertical statements as chunks arrive."""
        return VerticalResponseStream(
            self,
            wrapped=wrapped,
            state=state,
            after_rejected_block=after_rejected_block,
        )

    def has_format_content(self, content: str, complete: bool = False) -> bool:
        """Checks whether `content` contains Vertical sentinel blocks."""
        for part in self.unwrap(content):
            if isinstance(part.part, RawA2uiPart):
                if not complete or part.is_final:
                    return True
        return False

    def wrap(self, blocks: Sequence[RawResponsePart]) -> str:
        """Wraps text and raw Vertical blocks into a single LLM-formatted string."""
        parts: list[str] = []
        for block in blocks:
            inner = block.part if isinstance(block, RawResponsePart) else block
            if isinstance(inner, TextPart):
                parts.append(inner.text)
            elif isinstance(inner, RawA2uiPart):
                parts.append(
                    f"{A2UI_INFERENCE_OPEN_TAG}\n{inner.a2ui_raw}\n{A2UI_INFERENCE_CLOSE_TAG}"
                )
        return "\n".join(parts)

    def unwrap(self, content: str) -> list[RawResponsePart]:
        """Unwraps and tokenizes response content into text and raw Vertical blocks."""
        lexer = BlockLexer(
            open_tag=_OPEN_SENTINEL_RE,
            close_tag=_CLOSE_SENTINEL_RE,
            string_delimiters={"'", '"'},
            single_line_comments={"#", "//"},
            payload_start_pattern=VERTICAL_PAYLOAD_START_RE,
            block_comments=[("/*", "*/")],
        )
        return lexer.tokenize(content)

    def parse_response(
        self,
        content: str,
        wrapped: bool = True,
        *,
        state: RendererState | None = None,
    ) -> list[ResponsePart]:
        """Parses a complete LLM response, allocating unique surface and call IDs across blocks and turns."""
        target = state if state is not None else self._empty_state()
        token = _IN_FLIGHT_CALL_OFFSET.set(get_state_call_offset(target))
        try:
            parts = super().parse_response(content, wrapped=wrapped, state=target)
            final_offset = _IN_FLIGHT_CALL_OFFSET.get()
            if state is not None and final_offset is not None:
                set_state_call_offset(state, final_offset)
            return parts
        finally:
            _IN_FLIGHT_CALL_OFFSET.reset(token)

    def _apply_block(
        self, format_content: str, is_final: bool, state: RendererState
    ) -> tuple[list[AgentToRendererMessage], list[str]]:
        active_call_offset = _IN_FLIGHT_CALL_OFFSET.get()
        if active_call_offset is None:
            active_call_offset = get_state_call_offset(state)
        try:
            raw_msgs, _, next_call_offset = self._compiler.compile_dicts(
                format_content,
                surface_id=self.surface_id,
                is_final=is_final,
                version=self.version,
                existing_surface_ids=set(state.surface_ids),
                call_offset=active_call_offset,
            )
        except A2uiError:
            raise
        except Exception as e:
            raise A2uiCompilationError(
                f"Failed to compile A2UI Vertical block: {e}", format_content
            ) from e
        touched = state.apply(raw_msgs)
        _IN_FLIGHT_CALL_OFFSET.set(next_call_offset)
        return to_message_models(raw_msgs), touched

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> Sequence[AgentToRendererMessage | Mapping[str, Any]]:
        """Compiles a single raw Vertical block into A2UI messages."""
        try:
            return self._compiler.compile(
                format_content,
                surface_id=self.surface_id,
                is_final=is_final,
                version=self.version,
            )
        except A2uiError:
            raise
        except Exception as e:
            raise A2uiCompilationError(
                message=str(e),
                raw_content=format_content,
                help_message=(
                    "Please correct the error in your Vertical UI component expression."
                ),
            ) from e

    def decompile(
        self,
        a2ui_payload: (
            Sequence[AgentToRendererMessage | Mapping[str, Any]]
            | AgentToRendererMessage
            | Mapping[str, Any]
        ),
    ) -> str:
        """Decompiles structured A2UI payload messages into Vertical notation."""
        return self._decompiler.decompile(a2ui_payload)

    def wrap_decompiled_blocks(self, blocks: Sequence[str]) -> str:
        """Wraps multiple decompiled blocks with sentinel tags."""
        return self._decompiler.wrap_decompiled_blocks(blocks)
