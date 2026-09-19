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

"""Incremental streaming parser for Vertical inference format.

Streams component constructors in an <a2ui> block, emitting an independent Surface
per completed component.
"""

from __future__ import annotations

import re
from typing import Any, List, Optional, Union

from a2ui.core.catalog import Catalog
from a2ui.parser.response_part import ResponsePart
from a2ui.schema.catalog import A2uiCatalog
from .compiler import VerticalCompiler, _is_legacy_version, _split_statements


class VerticalStreamParser:
    """Processes streamed token chunks incrementally, emitting a Surface per component."""

    def __init__(
        self,
        catalog: Union[Catalog[Any, Any], A2uiCatalog],
        surface_id: str = "main",
        version: str = "v1.0",
    ):
        self.catalog = catalog
        self.surface_id = surface_id
        self.version = version
        self.compiler = VerticalCompiler(
            catalog, surface_id=surface_id, version=version
        )
        self._surface_count = 0
        self._in_tag = False
        self._buffer = ""
        self._tag_buffer = ""
        self._text_buffer = ""

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Processes the next token chunk in the stream.

        Args:
            chunk: Streamed chunk string. Passing an empty string flushes the
              remaining buffer.

        Returns:
            List of parsed ResponsePart objects.
        """
        parts: List[ResponsePart] = []

        if not chunk:
            # Flush remaining tag buffer on EOF
            if self._in_tag and self._tag_buffer.strip():
                remaining = self._tag_buffer.strip()
                self._tag_buffer = ""
                stmts = _split_statements(remaining)
                for s in stmts:
                    part = self._compile_statement(s)
                    if part:
                        parts.append(part)
            elif not self._in_tag and self._text_buffer:
                parts.append(ResponsePart(text=self._text_buffer))
                self._text_buffer = ""
            return parts

        self._buffer += chunk

        while self._buffer:
            if not self._in_tag:
                # Search for opening tag <a2ui> or <a2ui-vertical>
                match = re.search(
                    r"<(?:a2ui|a2ui-vertical)\b[^>]*>", self._buffer, re.IGNORECASE
                )
                if match:
                    pre_text = self._buffer[: match.start()]
                    if pre_text:
                        self._text_buffer += pre_text
                        parts.append(ResponsePart(text=self._text_buffer))
                        self._text_buffer = ""
                    self._buffer = self._buffer[match.end() :]
                    self._in_tag = True
                    self._tag_buffer = ""
                else:
                    # Check if buffer ends with partial tag prefix like "<", "<a", "<a2ui"
                    potential_tag = re.search(
                        r"<\/?(?:a2ui|a2ui-vertical)?\b[^>]*$",
                        self._buffer,
                        re.IGNORECASE,
                    )
                    if potential_tag and potential_tag.start() > 0:
                        safe_text = self._buffer[: potential_tag.start()]
                        self._text_buffer += safe_text
                        parts.append(ResponsePart(text=self._text_buffer))
                        self._text_buffer = ""
                        self._buffer = self._buffer[potential_tag.start() :]
                        break
                    elif not potential_tag:
                        self._text_buffer += self._buffer
                        parts.append(ResponsePart(text=self._text_buffer))
                        self._text_buffer = ""
                        self._buffer = ""
                    else:
                        break
            else:
                # We are inside the A2UI tag
                close_match = re.search(
                    r"<\/(?:a2ui|a2ui-vertical)\s*>", self._buffer, re.IGNORECASE
                )
                if close_match:
                    tag_content = self._buffer[: close_match.start()]
                    self._tag_buffer += tag_content
                    self._buffer = self._buffer[close_match.end() :]
                    self._in_tag = False

                    # Parse and compile all statements in tag_buffer
                    stmts = _split_statements(self._tag_buffer.strip())
                    for s in stmts:
                        part = self._compile_statement(s)
                        if part:
                            parts.append(part)
                    self._tag_buffer = ""
                else:
                    # Look for completed statements inside tag buffer
                    self._tag_buffer += self._buffer
                    self._buffer = ""

                    # Try splitting statements
                    stmts = _split_statements(self._tag_buffer)
                    if len(stmts) > 1:
                        # All but the last statement are guaranteed complete
                        for s in stmts[:-1]:
                            part = self._compile_statement(s)
                            if part:
                                parts.append(part)
                        self._tag_buffer = stmts[-1]
                    break

        return parts

    def _compile_statement(self, stmt: str) -> Optional[ResponsePart]:
        stmt = stmt.strip()
        if not stmt:
            return None
        # Strip markdown fence if present
        stmt = re.sub(r"^\s*```\S*[ \t]*\r?\n?", "", stmt, flags=re.MULTILINE)
        stmt = re.sub(r"^\s*```[ \t]*\r?\n?", "", stmt, flags=re.MULTILINE).strip()
        if not stmt:
            return None

        surf_id = (
            self.surface_id
            if self._surface_count == 0
            else f"{self.surface_id}_{self._surface_count}"
        )
        res = self.compiler._parse_statement_to_component(stmt)
        if not res:
            return None
        comp_name, pos_args, kw_args = res
        comp_dict = self.compiler._resolve_component(comp_name, pos_args, kw_args)
        root_comp = {"id": "root", **comp_dict}

        target_version = self.version
        resolved_catalog_id = (
            getattr(self.catalog, "catalog_id", "")
            or getattr(self.catalog, "id", "")
            or "https://a2ui.org/catalogs/basic.json"
        )

        if _is_legacy_version(target_version):
            messages = [
                {
                    "version": target_version,
                    "createSurface": {
                        "surfaceId": surf_id,
                        "catalogId": resolved_catalog_id,
                    },
                },
                {
                    "version": target_version,
                    "updateComponents": {
                        "surfaceId": surf_id,
                        "components": [root_comp],
                    },
                },
            ]
        else:
            messages = [{
                "version": target_version,
                "createSurface": {
                    "surfaceId": surf_id,
                    "catalogId": resolved_catalog_id,
                    "components": [root_comp],
                },
            }]

        self._surface_count += 1
        return ResponsePart(
            text="",
            a2ui_raw=stmt,
            a2ui_json=messages,
            is_final=True,
        )
