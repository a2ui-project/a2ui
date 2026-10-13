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

"""A `FileResolver` that produces `google.genai.types.Part` objects.

Example:

  ```python
  from a2ui.adk import GenAIFileResolver

  resolver = GenAIFileResolver(allowed_mime_types=["application/pdf", "image/*"])

  @resolver.as_tool_decorator(arg_name="files", inject_name="genai_parts")
  async def summarize(files: list[dict], genai_parts: list | None = None):
      ...
  ```
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from google.genai import types as genai_types

from a2ui.extensions.file_resolve import FileResolver, ResolvedFileConverter


def _genai_part_from_bytes(raw_bytes: bytes, mime_type: str) -> genai_types.Part:
    """Converts resolved file bytes and their verified MIME type into a GenAI Part."""
    return genai_types.Part.from_bytes(data=raw_bytes, mime_type=mime_type)


class GenAIFileResolver(FileResolver):
    """Resolves A2UI file pointers into ready-to-use GenAI Parts."""

    async def to_genai_part(
        self, file_info: dict[str, Any], session: Any | None = None
    ) -> genai_types.Part:
        """Resolves a pointer and constructs a ready-to-use GenAI Part."""
        raw_bytes, verified_mime = await self.resolve_bytes(file_info, session)
        return _genai_part_from_bytes(raw_bytes, verified_mime)

    async def resolve_all_to_genai_parts(
        self, files: Sequence[dict[str, Any]], session: Any | None = None
    ) -> list[genai_types.Part]:
        """Concurrently resolves a list of file attachments into GenAI Parts."""
        return await self.resolve_all(files, session, _genai_part_from_bytes)

    def as_tool_decorator(
        self,
        arg_name: str = "files",
        inject_name: str = "genai_parts",
        on_error: Callable[[Exception], Any] | None = None,
        preprocess: (
            Callable[[dict[str, Any], tuple[Any, ...], dict[str, Any]], None] | None
        ) = None,
        convert: ResolvedFileConverter | None = _genai_part_from_bytes,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Creates a tool decorator that resolves file pointers into GenAI Parts.

        Same as `FileResolver.as_tool_decorator`, but injects GenAI Parts into
        `genai_parts` by default.
        """
        return super().as_tool_decorator(
            arg_name=arg_name,
            inject_name=inject_name,
            on_error=on_error,
            preprocess=preprocess,
            convert=convert,
        )
