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

"""A2UI File Resolver with Security Guardrails and GenAI Helpers.

This module provides a unified interface for securely resolving abstract file pointers
(such as inline data URIs, remote HTTP URLs, or custom schemes) into raw bytes.

Security Guardrails:
- Prevents out-of-memory (OOM) vulnerabilities via strict, configurable file size limits (halting streams or decoding early).
- Mitigates MIME-spoofing attacks by inspecting file "magic byte" headers to verify the true content type against the claimed type.
- Enforces strict developer-configured MIME type allowlists.
- Mitigates SSRF risks by enforcing strict developer-configured host allowlists for remote HTTP/HTTPS downloads.

GenAI Helpers:
- Provides utilities (`to_genai_part`, `resolve_all_to_genai_parts`) to directly convert resolved bytes into ready-to-use `google.genai.types.Part` objects.
- Exports a powerful `as_tool_decorator` factory, enabling developers to seamlessly wrap agent tools so that incoming A2UI file pointer dictionaries are automatically downloaded, verified, and injected as GenAI parts, while gracefully handling UI error payloads.
"""

import asyncio
import base64
import fnmatch
import functools
import inspect
import ipaddress
import logging
import socket
from typing import (
    Any,
    Awaitable,
    Callable,
    Coroutine,
    Dict,
    List,
    Optional,
    Union,
)
import urllib.parse
from google.genai import types as genai_types
import httpx

logger = logging.getLogger(__name__)

# "Magic numbers" (magic bytes) are distinct, standardized binary header signatures
# at the beginning of a file used to identify its true MIME type (similar to Unix libmagic).
# We inspect these signatures to prevent MIME-spoofing attacks before passing content to models.
MAGIC_SIGNATURES: dict[bytes, str] = {
    b"%PDF": "application/pdf",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
    b"RIFF": "image/webp",
}

# Standard MIME type aliases to normalize common client variations.
MIME_ALIASES: dict[str, str] = {
    "image/jpg": "image/jpeg",
    "image/pjpeg": "image/jpeg",
    "image/x-png": "image/png",
}


def _normalize_mime(mime: str) -> str:
    cleaned = mime.split(";", 1)[0].strip().lower()
    return MIME_ALIASES.get(cleaned, cleaned)


SchemeHandler = Callable[
    [str, dict[str, Any]],
    bytes | Coroutine[Any, Any, bytes] | Awaitable[bytes],
]


class FileResolverSecurityError(Exception):
    """Raised when a resolved file fails security checks."""

    pass


class FileResolver:
    """Unified resolver for abstract file pointers and inline data URIs."""

    def __init__(
        self,
        max_file_bytes: int = 25 * 1024 * 1024,  # 25 MB limit
        allowed_mime_types: list[str] | None = None,
        allowed_hosts: list[str] | None = None,
        max_concurrent_downloads: int = 5,
        http_client: httpx.AsyncClient | None = None,
        custom_schemes: dict[str, SchemeHandler] | None = None,
    ):
        self.max_file_bytes = max_file_bytes
        self.allowed_mime_types = allowed_mime_types
        self.allowed_hosts = allowed_hosts if allowed_hosts is not None else []
        self.max_concurrent_downloads = max_concurrent_downloads
        self._owns_http_client = http_client is None
        self._http_client = http_client or httpx.AsyncClient()
        self._custom_schemes: dict[str, SchemeHandler] = (
            dict(custom_schemes) if custom_schemes else {}
        )
        self._semaphore = asyncio.Semaphore(max_concurrent_downloads)

    async def close(self) -> None:
        """Closes the HTTP client if it was created by the resolver."""
        if self._owns_http_client and self._http_client:
            await self._http_client.aclose()

    async def __aenter__(self) -> "FileResolver":
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
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

        if detected_mime and claimed_mime:
            norm_claimed = _normalize_mime(claimed_mime)
            norm_detected = _normalize_mime(detected_mime)

            if norm_claimed not in ("application/octet-stream", "*/*", ""):
                if norm_claimed != norm_detected and not fnmatch.fnmatch(
                    norm_detected, norm_claimed
                ):
                    raise FileResolverSecurityError(
                        f"MIME mismatch: claimed '{claimed_mime}', detected magic"
                        f" signature '{detected_mime}'"
                    )

        final_mime = detected_mime or claimed_mime or "application/octet-stream"

        if self.allowed_mime_types and not any(
            fnmatch.fnmatch(final_mime, t) for t in self.allowed_mime_types
        ):
            raise FileResolverSecurityError(
                f"MIME type '{final_mime}' is not permitted by security policy"
            )

        return final_mime

    def _check_file_size(self, current_size: int) -> None:
        if current_size > self.max_file_bytes:
            raise FileResolverSecurityError(
                f"File exceeded max size of {self.max_file_bytes} bytes"
            )

    async def resolve_bytes(
        self, file_info: dict[str, Any], session: Any | None = None
    ) -> tuple[bytes, str]:
        """Resolves raw bytes and verified MIME type from a file pointer dictionary."""
        async with self._semaphore:
            return await self._resolve_bytes_internal(file_info, session)

    def _resolve_inline(self, file_id: str, session: Any | None) -> tuple[bytes, str]:
        if not session:
            raise ValueError(f"Cannot resolve {file_id}: No session provided.")

        for event in getattr(session, "events", []):
            if (
                hasattr(event, "message")
                and event.message
                and getattr(event.message, "parts", None)
            ):
                for part in event.message.parts:
                    if getattr(part, "inline_data", None):
                        part_meta = getattr(part, "part_metadata", None) or {}
                        part_file_id = (
                            part_meta.get("fileId")
                            if isinstance(part_meta, dict)
                            else getattr(part_meta, "fileId", None)
                        )
                        if part_file_id == file_id:
                            return part.inline_data.data, part.inline_data.mime_type

        raise ValueError(f"Inline data pointer {file_id} not found in session history.")

    async def _resolve_custom(self, file_id: str, file_info: dict[str, Any]) -> bytes:
        prefix = next(p for p in self._custom_schemes if file_id.startswith(p))
        handler_res = self._custom_schemes[prefix](file_id, file_info)
        if inspect.isawaitable(handler_res):
            return await handler_res
        return handler_res

    def _resolve_data_uri(self, file_id: str, claimed_mime: str) -> tuple[bytes, str]:
        try:
            header, encoded = file_id.split(",", 1)
        except ValueError:
            raise ValueError(f"Invalid data URI format: {file_id[:50]}...")

        is_base64 = header.endswith(";base64")
        if is_base64:
            mime_part = header[5:-7].strip()
        else:
            mime_part = header[5:].strip()

        if mime_part and not claimed_mime:
            claimed_mime = mime_part.split(";")[0]
        elif not mime_part and not claimed_mime:
            claimed_mime = "text/plain"

        try:
            if is_base64:
                raw_bytes = base64.b64decode(encoded)
            else:
                raw_bytes = urllib.parse.unquote_to_bytes(encoded)
        except Exception as e:
            raise ValueError(f"Failed to decode data URI: {e}")

        return raw_bytes, claimed_mime

    async def _resolve_http(self, file_id: str) -> bytes:
        buffer = bytearray()
        current_url = file_id
        redirects_followed = 0
        max_redirects = 5

        while redirects_followed <= max_redirects:
            parsed_current = urllib.parse.urlparse(current_url)
            current_hostname = (parsed_current.hostname or "").lower()
            if not current_hostname:
                raise FileResolverSecurityError("URL is missing a valid hostname")

            if not any(
                fnmatch.fnmatch(current_hostname, pattern.lower())
                for pattern in self.allowed_hosts
            ):
                raise FileResolverSecurityError(
                    f"Host '{current_hostname}' is not permitted by security policy"
                )

            resolved_ip = None
            try:
                loop = asyncio.get_running_loop()
                addr_info = await loop.getaddrinfo(current_hostname, None)
                for res in addr_info:
                    ip = res[4][0]
                    try:
                        ip_obj = ipaddress.ip_address(ip)
                        if (
                            ip_obj.is_private
                            or ip_obj.is_loopback
                            or ip_obj.is_link_local
                            or ip_obj.is_multicast
                            or ip_obj.is_unspecified
                        ):
                            raise FileResolverSecurityError(
                                f"Host '{current_hostname}' resolves to a private/local"
                                f" IP '{ip}', which is not permitted."
                            )
                        if not resolved_ip:
                            resolved_ip = ip
                    except ValueError:
                        pass
            except socket.gaierror as e:
                raise FileResolverSecurityError(
                    f"Failed to resolve host '{current_hostname}': {e}"
                )

            if not resolved_ip:
                raise FileResolverSecurityError(
                    f"Could not find a valid public IP for host '{current_hostname}'"
                )

            netloc = f"[{resolved_ip}]" if ":" in resolved_ip else resolved_ip
            if parsed_current.port:
                netloc = f"{netloc}:{parsed_current.port}"
            ip_url = parsed_current._replace(netloc=netloc).geturl()

            host_header = (
                f"{current_hostname}:{parsed_current.port}"
                if parsed_current.port
                else current_hostname
            )
            async with self._http_client.stream(
                "GET",
                ip_url,
                headers={"Host": host_header},
                extensions={"sni_hostname": current_hostname},
                follow_redirects=False,
            ) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    redirect_location = response.headers.get("Location")
                    if not redirect_location:
                        raise FileResolverSecurityError(
                            "Redirect missing Location header"
                        )
                    current_url = urllib.parse.urljoin(current_url, redirect_location)
                    redirect_scheme = urllib.parse.urlparse(current_url).scheme.lower()
                    if redirect_scheme not in ("http", "https"):
                        raise FileResolverSecurityError(
                            f"Unsupported redirect scheme: {redirect_scheme}"
                        )
                    redirects_followed += 1
                    continue

                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    buffer.extend(chunk)
                    self._check_file_size(len(buffer))
            break

        if redirects_followed > max_redirects:
            raise FileResolverSecurityError("Too many redirects")

        return bytes(buffer)

    async def _resolve_bytes_internal(
        self, file_info: dict[str, Any], session: Any | None = None
    ) -> tuple[bytes, str]:
        if not isinstance(file_info, dict):
            raise TypeError("file_info must be a dictionary")

        file_id = file_info["fileId"]
        if not isinstance(file_id, str) or not file_id:
            raise ValueError("Invalid 'fileId' in file_info")

        claimed_mime = file_info.get("mimeType")
        if not isinstance(claimed_mime, str):
            claimed_mime = ""

        if file_id.startswith("inline://"):
            raw_bytes, claimed_mime = self._resolve_inline(file_id, session)
        elif any(file_id.startswith(p) for p in self._custom_schemes):
            raw_bytes = await self._resolve_custom(file_id, file_info)
        elif file_id.startswith("data:"):
            raw_bytes, claimed_mime = self._resolve_data_uri(file_id, claimed_mime)
        elif file_id.startswith("https://") or file_id.startswith("http://"):
            raw_bytes = await self._resolve_http(file_id)
        else:
            raise ValueError(f"Unsupported file pointer scheme: {file_id}")

        self._check_file_size(len(raw_bytes))

        verified_mime = self._verify_magic_bytes(raw_bytes, claimed_mime)
        return raw_bytes, verified_mime

    async def to_genai_part(
        self, file_info: dict[str, Any], session: Any | None = None
    ) -> genai_types.Part:
        """Resolves pointer and constructs a ready-to-use GenAI Part."""
        raw_bytes, verified_mime = await self.resolve_bytes(file_info, session)
        return genai_types.Part.from_bytes(data=raw_bytes, mime_type=verified_mime)

    async def resolve_all_to_genai_parts(
        self, files: list[dict[str, Any]], session: Any | None = None
    ) -> list[genai_types.Part]:
        """Concurrently resolves a list of file attachments with throttling protection."""
        return await asyncio.gather(*(self.to_genai_part(f, session) for f in files))

    def as_tool_decorator(
        self,
        arg_name: str = "files",
        inject_name: str = "genai_parts",
        on_error: Callable[[Exception], Any] | None = None,
        preprocess: (
            Callable[[dict[str, Any], tuple[Any, ...], dict[str, Any]], None] | None
        ) = None,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Creates a tool decorator to automatically resolve file pointers into GenAI parts.

        Args:
            arg_name: The kwarg name containing the list of file pointer dicts.
            inject_name: The kwarg name to inject the resolved GenAI Parts into.
            on_error: Optional callback `(Exception) -> Any` to handle errors (e.g., return a UI payload).
            preprocess: Optional callback `(file_info: dict, args: tuple, kwargs: dict) -> None`
                        to inject contextual data (like `base_url`) into file pointers before resolution.
        """

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            sig = inspect.signature(func)

            @functools.wraps(func)
            async def wrapper(*args: Any, **kwargs: Any) -> Any:
                bound_args = sig.bind(*args, **kwargs)
                bound_args.apply_defaults()
                file_pointers = bound_args.arguments.get(arg_name)

                session = None
                if "tool_context" in bound_args.arguments:
                    session = getattr(
                        bound_args.arguments["tool_context"], "session", None
                    )

                if file_pointers is None or not isinstance(file_pointers, list):
                    return await func(*bound_args.args, **bound_args.kwargs)

                if preprocess:
                    for f in file_pointers:
                        if isinstance(f, dict):
                            preprocess(f, args, kwargs)
                try:
                    bound_args.arguments[inject_name] = (
                        await self.resolve_all_to_genai_parts(file_pointers, session)
                    )
                except Exception as e:
                    if on_error:
                        return on_error(e)
                    raise

                return await func(*bound_args.args, **bound_args.kwargs)

            return wrapper

        return decorator
