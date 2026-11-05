# Copyright 2026 Google LLC
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

"""Parser orchestrating A2UI XML envelope unwrapping, compilation, and streaming."""

from __future__ import annotations

from collections.abc import Sequence
import re
from typing import Literal, TYPE_CHECKING, overload

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser import (
    Parser,
    RawA2uiPart,
    RawResponsePart,
    ResponsePart,
    ResponseStream,
    StreamPart,
    TextPart,
)


from .compiler import A2uiXmlCompiler
from .decompiler import A2uiXmlDecompiler
from .errors import A2uiXmlCompileDiagnostics, A2uiXmlParseError
from .response_stream import A2uiXmlResponseStream
from .scanner import (
    CLOSE_A2UI_RE,
    OPEN_A2UI_RE,
    build_surface_directive_from_a2ui_attrs,
    scan_a2ui_block_end,
)

if TYPE_CHECKING:
    from a2ui.utils import RendererState

_OUTER_FENCE_AROUND_OPEN_RE = re.compile(
    r"(?:\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n[ \t]*|(?:^|(?<=\s))`{1,2})\Z"
)
_OUTER_FENCE_AFTER_CLOSE_RE = re.compile(
    r"^(?:[ \t]*\r?\n?[ \t]*```[a-zA-Z0-9_-]*|`{1,2})"
)


class A2uiXmlParser(Parser):
    """Parses, compiles, decompiles, and streams A2UI A2UI XML blocks."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        surface_id: str = "main",
        version: str | None = None,
        *,
        strict: bool = False,
        tuned: bool = False,
    ):
        self._catalogs = list(catalogs)
        self.surface_id = surface_id
        self.version = version
        self.strict = strict
        self._tuned = tuned
        self.compiler = A2uiXmlCompiler(self._catalogs, strict=strict, tuned=tuned)
        self.decompiler = A2uiXmlDecompiler(
            self._catalogs, default_surface_id=surface_id
        )

    @property
    def catalogs(self) -> list[CatalogApi]:
        return list(self._catalogs)

    @property
    def tuned(self) -> bool:
        """Whether tuned A2UI XML parsing and healing rules are enabled."""
        return self._tuned

    @property
    def supports_streaming(self) -> bool:
        return True

    @overload
    def open_stream(
        self,
        *,
        wrapped: bool = True,
        state: RendererState | None = None,
        after_rejected_block: Literal["end"] = "end",
    ) -> ResponseStream[ResponsePart]:
        ...

    @overload
    def open_stream(
        self,
        *,
        wrapped: bool = True,
        state: RendererState | None = None,
        after_rejected_block: Literal["end", "continue"],
    ) -> ResponseStream[StreamPart]:
        ...

    def open_stream(
        self,
        *,
        wrapped: bool = True,
        state: RendererState | None = None,
        after_rejected_block: Literal["end", "continue"] = "end",
    ) -> ResponseStream[ResponsePart] | ResponseStream[StreamPart]:
        return A2uiXmlResponseStream(
            self,
            wrapped=wrapped,
            state=state,
            after_rejected_block=after_rejected_block,
        )

    def has_format_content(self, content: str, complete: bool = False) -> bool:
        """Checks whether ``content`` contains an ``<a2ui>`` A2UI XML block."""
        open_match = OPEN_A2UI_RE.search(content)
        if open_match:
            if not complete:
                return True
            close_start, _, _ = scan_a2ui_block_end(content[open_match.end() :])
            return close_start is not None

        # One-shot fallback when opening `<a2ui>` was omitted before `</a2ui>`
        close_match = CLOSE_A2UI_RE.search(content)
        return close_match is not None

    def wrap(self, blocks: Sequence[RawResponsePart]) -> str:
        """Wraps text and raw A2UI XML parts into an ``<a2ui>...</a2ui>`` response."""
        chunks: list[str] = []
        for item in blocks:
            if isinstance(item.part, TextPart):
                if item.part.text:
                    chunks.append(item.part.text)
            elif isinstance(item.part, RawA2uiPart):
                body = item.part.a2ui_raw.strip("\n")
                if item.is_final:
                    chunks.append(
                        f"{A2UI_INFERENCE_OPEN_TAG}\n{body}\n{A2UI_INFERENCE_CLOSE_TAG}"
                    )
                else:
                    chunks.append(f"{A2UI_INFERENCE_OPEN_TAG}\n{body}")
        return "\n\n".join(chunks)

    def unwrap(self, content: str) -> list[RawResponsePart]:
        """Splits a model response into ``TextPart`` prose and ``RawA2uiPart`` blocks.

        Respects Law 6 (Opaque Fences): ``</a2ui>`` inside triple-backtick code
        fences or quoted attributes does not terminate the ``<a2ui>`` block.
        Attributes on ``<a2ui surface="..." update="true">`` are preserved as a
        leading ``<Surface ... />`` directive inside ``a2ui_raw``.
        """
        parts: list[RawResponsePart] = []
        pos = 0
        n = len(content)
        saw_open_tag = False

        while pos < n:
            open_match = OPEN_A2UI_RE.search(content, pos)
            if open_match is None:
                if not saw_open_tag:
                    close_match = CLOSE_A2UI_RE.search(content, pos)
                    if close_match is not None:
                        raw_body = content[pos : close_match.start()].strip()
                        parts.append(
                            RawResponsePart(
                                part=RawA2uiPart(a2ui_raw=raw_body), is_final=True
                            )
                        )
                        after = _OUTER_FENCE_AFTER_CLOSE_RE.sub(
                            "", content[close_match.end() :], count=1
                        ).strip()
                        if after:
                            parts.append(
                                RawResponsePart(
                                    part=TextPart(text=after), is_final=True
                                )
                            )
                        return parts

                tail = content[pos:].strip()
                if tail:
                    parts.append(
                        RawResponsePart(part=TextPart(text=tail), is_final=True)
                    )
                break

            saw_open_tag = True
            before = _OUTER_FENCE_AROUND_OPEN_RE.sub(
                "", content[pos : open_match.start()], count=1
            ).strip()
            if before:
                parts.append(RawResponsePart(part=TextPart(text=before), is_final=True))

            header_dir, attr_violations = build_surface_directive_from_a2ui_attrs(
                open_match.group("attrs") or "", tuned=self._tuned
            )
            if self.strict and attr_violations:
                first = attr_violations[0]
                raise A2uiXmlParseError(f"[{first.law}] {first.message}")

            block_start = open_match.end()
            rel_close_start, rel_close_end, _ = scan_a2ui_block_end(
                content[block_start:]
            )

            if rel_close_start is None:
                raw_inner = content[block_start:].strip("\r\n")
                if header_dir and not raw_inner.lstrip().lower().startswith("<surface"):
                    raw_inner = (
                        f"{header_dir}\n{raw_inner}" if raw_inner else header_dir
                    )
                parts.append(
                    RawResponsePart(
                        part=RawA2uiPart(a2ui_raw=raw_inner), is_final=False
                    )
                )
                break

            assert rel_close_end is not None
            raw_inner = content[block_start : block_start + rel_close_start].strip(
                "\r\n"
            )
            if header_dir and not raw_inner.lstrip().lower().startswith("<surface"):
                raw_inner = f"{header_dir}\n{raw_inner}" if raw_inner else header_dir
            parts.append(
                RawResponsePart(part=RawA2uiPart(a2ui_raw=raw_inner), is_final=True)
            )

            next_pos = block_start + rel_close_end
            fence_after = _OUTER_FENCE_AFTER_CLOSE_RE.match(content, next_pos)
            if fence_after:
                next_pos = fence_after.end()
            pos = next_pos

        return parts

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> list[AgentToRendererMessage]:
        return self.compiler.compile(
            format_content,
            surface_id=self.surface_id,
            version=self.version,
            is_final=is_final,
        )

    def compile_with_diagnostics(
        self,
        format_content: str,
        *,
        is_final: bool = True,
        strict: bool | None = None,
    ) -> A2uiXmlCompileDiagnostics:
        """Compiles a raw A2UI XML block and returns both messages and Six-Laws diagnostics."""
        return self.compiler.compile_with_diagnostics(
            format_content,
            surface_id=self.surface_id,
            version=self.version,
            is_final=is_final,
            strict=strict,
        )

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        return self.decompiler.decompile(a2ui_payload)

    def decompile_blocks(
        self, a2ui_payload: Sequence[AgentToRendererMessage]
    ) -> list[str]:
        return self.decompiler.decompile_blocks(a2ui_payload)

    def wrap_decompiled_blocks(self, blocks: Sequence[str]) -> str:
        return self.decompiler.wrap_decompiled_blocks(blocks)
