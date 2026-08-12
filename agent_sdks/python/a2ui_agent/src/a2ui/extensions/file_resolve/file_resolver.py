# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""A2UI File Resolver with Security Guardrails and GenAI Helpers.

This module provides a unified interface for securely resolving abstract file pointers
(such as inline data URIs, remote HTTP URLs, or custom schemes) into raw bytes.

Security Guardrails:
- Prevents out-of-memory (OOM) vulnerabilities via strict, configurable file size limits (halting streams or decoding early).
- Mitigates MIME-spoofing attacks by inspecting file "magic byte" headers to verify the true content type against the claimed type.
- Enforces strict developer-configured MIME type allowlists.

GenAI Helpers:
- Provides utilities (`to_genai_part`, `resolve_all_to_genai_parts`) to directly convert resolved bytes into ready-to-use `google.genai.types.Part` objects.
- Exports a powerful `as_tool_decorator` factory, enabling developers to seamlessly wrap agent tools so that incoming A2UI file pointer dictionaries are automatically downloaded, verified, and injected as GenAI parts, while gracefully handling UI error payloads.
"""

import asyncio
import base64
import functools
import inspect
import logging
from typing import Any, Awaitable, Callable, Coroutine, Dict, List, Optional, Union
from google.genai import types as genai_types
import httpx

logger = logging.getLogger(__name__)

# "Magic numbers" (magic bytes) are distinct, standardized binary header signatures
# at the beginning of a file used to identify its true MIME type (similar to Unix libmagic).
# We inspect these signatures to prevent MIME-spoofing attacks before passing content to models.
MAGIC_SIGNATURES: Dict[bytes, str] = {
    b"%PDF": "application/pdf",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
    b"RIFF": "image/webp",
}

SchemeHandler = Callable[
    [str, Dict[str, Any]],
    Union[bytes, Coroutine[Any, Any, bytes], Awaitable[bytes]],
]


class FileResolverSecurityError(Exception):
    """Raised when a resolved file fails security checks."""

    pass


class FileResolver:
    """Unified resolver for abstract file pointers and inline data URIs."""

    def __init__(
        self,
        max_file_bytes: int = 25 * 1024 * 1024,  # 25 MB limit
        allowed_mime_types: Optional[List[str]] = None,
        max_concurrent_downloads: int = 5,
        http_client: Optional[httpx.AsyncClient] = None,
        custom_schemes: Optional[Dict[str, SchemeHandler]] = None,
    ):
        self.max_file_bytes = max_file_bytes
        self.allowed_mime_types = allowed_mime_types
        self.max_concurrent_downloads = max_concurrent_downloads
        self._owns_http_client = http_client is None
        self._http_client = http_client or httpx.AsyncClient()
        self._custom_schemes: Dict[str, SchemeHandler] = (
            dict(custom_schemes) if custom_schemes else {}
        )
        self._semaphore = asyncio.Semaphore(max_concurrent_downloads)

    async def close(self) -> None:
        """Closes the HTTP client if it was created by the resolver."""
        if self._owns_http_client and self._http_client:
            await self._http_client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    def register_scheme(self, prefix: str, handler: SchemeHandler) -> None:
        """Register a custom storage scheme (e.g., 'gdrive://', 's3://', 'mockdrive://')."""
        self._custom_schemes[prefix] = handler

    def _verify_magic_bytes(self, raw_bytes: bytes, claimed_mime: str) -> str:
        detected_mime = None
        for header, mime in MAGIC_SIGNATURES.items():
            if raw_bytes.startswith(header):
                detected_mime = mime
                break

        if (
            detected_mime
            and claimed_mime
            and claimed_mime != "application/octet-stream"
            and not claimed_mime.startswith(detected_mime.split("/")[0])
        ):
            raise FileResolverSecurityError(
                f"MIME mismatch: claimed '{claimed_mime}', detected magic"
                f" signature '{detected_mime}'"
            )

        final_mime = detected_mime or claimed_mime or "application/octet-stream"

        if self.allowed_mime_types and not any(
            final_mime.startswith(t.rstrip("*")) for t in self.allowed_mime_types
        ):
            raise FileResolverSecurityError(
                f"MIME type '{final_mime}' is not permitted by security policy"
            )

        return final_mime

    async def resolve_bytes(self, file_info: Dict[str, Any]) -> tuple[bytes, str]:
        """Resolves raw bytes and verified MIME type from a file pointer dictionary."""
        async with self._semaphore:
            return await self._resolve_bytes_internal(file_info)

    async def _resolve_bytes_internal(self, file_info: Dict[str, Any]) -> tuple[bytes, str]:
        file_id: str = file_info.get("fileId", "")
        claimed_mime: str = file_info.get("mimeType", "")
        if not file_id:
            raise ValueError("Missing 'fileId' in file_info")

        raw_bytes: bytes

        # 1. Inline Data URI
        if file_id.startswith("data:"):
            header, base64_data = file_id.split(",", 1)
            if not claimed_mime and ";" in header:
                header_mime = header[5:].split(";", 1)[0]
                if header_mime:
                    claimed_mime = header_mime
            
            estimated_size = (len(base64_data) * 3) // 4
            if estimated_size > self.max_file_bytes:
                raise FileResolverSecurityError(
                    f"File exceeded max size of {self.max_file_bytes} bytes"
                )
            raw_bytes = base64.b64decode(base64_data)

        # 2. Registered Scheme Handler
        elif any(file_id.startswith(p) for p in self._custom_schemes):
            prefix = next(p for p in self._custom_schemes if file_id.startswith(p))
            handler_res = self._custom_schemes[prefix](file_id, file_info)
            if inspect.isawaitable(handler_res):
                raw_bytes = await handler_res
            else:
                raw_bytes = handler_res

        # 3. HTTPS Ephemeral Download URL
        elif file_id.startswith("https://") or file_id.startswith("http://"):
            buffer = bytearray()
            async with self._http_client.stream(
                "GET", file_id, follow_redirects=True
            ) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    buffer.extend(chunk)
                    if len(buffer) > self.max_file_bytes:
                        raise FileResolverSecurityError(
                            f"File exceeded max size of {self.max_file_bytes} bytes"
                        )
            raw_bytes = bytes(buffer)
        else:
            raise ValueError(f"Unsupported file pointer scheme: {file_id}")

        if len(raw_bytes) > self.max_file_bytes:
            raise FileResolverSecurityError(
                f"File exceeded max size of {self.max_file_bytes} bytes"
            )

        verified_mime = self._verify_magic_bytes(raw_bytes, claimed_mime)
        return raw_bytes, verified_mime

    async def to_genai_part(self, file_info: Dict[str, Any]) -> genai_types.Part:
        """Resolves pointer and constructs a ready-to-use GenAI Part."""
        raw_bytes, verified_mime = await self.resolve_bytes(file_info)
        return genai_types.Part.from_bytes(data=raw_bytes, mime_type=verified_mime)

    async def resolve_all_to_genai_parts(
        self, files: List[Dict[str, Any]]
    ) -> List[genai_types.Part]:
        """Concurrently resolves a list of file attachments with throttling protection."""
        return await asyncio.gather(*(self.to_genai_part(f) for f in files))

    def as_tool_decorator(
        self,
        arg_name: str = "files",
        inject_name: str = "genai_parts",
        on_error: Optional[Callable[[Exception], Any]] = None,
        preprocess: Optional[Callable[[Dict[str, Any], tuple, dict], None]] = None,
    ):
        """Creates a tool decorator to automatically resolve file pointers into GenAI parts.
        
        Args:
            arg_name: The kwarg name containing the list of file pointer dicts.
            inject_name: The kwarg name to inject the resolved GenAI Parts into.
            on_error: Optional callback `(Exception) -> Any` to handle errors (e.g., return a UI payload).
            preprocess: Optional callback `(file_info: dict, args: tuple, kwargs: dict) -> None` 
                        to inject contextual data (like `base_url`) into file pointers before resolution.
        """
        def decorator(func):
            @functools.wraps(func)
            async def wrapper(*args, **kwargs):
                file_pointers = kwargs.get(arg_name)
                
                if file_pointers is not None and isinstance(file_pointers, list):
                    if preprocess:
                        for f in file_pointers:
                            if isinstance(f, dict):
                                preprocess(f, args, kwargs)
                    try:
                        kwargs[inject_name] = await self.resolve_all_to_genai_parts(file_pointers)
                    except Exception as e:
                        if on_error:
                            return on_error(e)
                        raise
                return await func(*args, **kwargs)
            return wrapper
        return decorator
