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

import base64
from typing import Any

import pytest

from a2ui.adk import GenAIFileResolver
from a2ui.extensions.file_resolve import FileResolverSecurityError

PDF_BYTES = b"%PDF-1.4 Document 1"
PNG_BYTES = b"\x89PNG\r\n\x1a\n Image 2"


def _data_uri(mime: str, data: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode('utf-8')}"


@pytest.mark.asyncio
async def test_to_genai_part_and_resolve_all() -> None:
    resolver = GenAIFileResolver()
    files = [
        {"fileId": _data_uri("application/pdf", PDF_BYTES)},
        {"fileId": _data_uri("image/png", PNG_BYTES)},
    ]

    part = await resolver.to_genai_part(files[0])
    assert part.inline_data is not None
    assert part.inline_data.mime_type == "application/pdf"
    assert part.inline_data.data == PDF_BYTES

    parts = await resolver.resolve_all_to_genai_parts(files)
    assert [(p.inline_data.mime_type, p.inline_data.data) for p in parts] == [  # type: ignore[union-attr]
        ("application/pdf", PDF_BYTES),
        ("image/png", PNG_BYTES),
    ]


@pytest.mark.asyncio
async def test_as_tool_decorator_injects_genai_parts_by_default() -> None:
    resolver = GenAIFileResolver()

    @resolver.as_tool_decorator()
    async def my_tool(files: list[dict[str, Any]], genai_parts: Any = None) -> Any:
        return genai_parts

    parts = await my_tool(files=[{"fileId": _data_uri("application/pdf", PDF_BYTES)}])
    assert len(parts) == 1
    assert parts[0].inline_data.mime_type == "application/pdf"
    assert parts[0].inline_data.data == PDF_BYTES


@pytest.mark.asyncio
async def test_security_checks_still_apply() -> None:
    resolver = GenAIFileResolver(allowed_mime_types=["image/*"])
    with pytest.raises(FileResolverSecurityError, match="not permitted"):
        await resolver.to_genai_part(
            {"fileId": _data_uri("application/pdf", PDF_BYTES)}
        )
