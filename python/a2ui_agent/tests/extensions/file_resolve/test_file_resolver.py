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

"""Unit tests for A2UI FileResolver and security guardrails under extensions.file_resolve."""

import base64
from typing import Any, AsyncIterator
import pytest
from a2ui.extensions.file_resolve import FileResolver, FileResolverSecurityError
import httpx


@pytest.mark.asyncio
async def test_resolve_data_uri_base64():
    resolver = FileResolver()
    raw_content = b"Hello, A2UI World!"
    b64_content = base64.b64encode(raw_content).decode("utf-8")
    data_uri = f"data:text/plain;base64,{b64_content}"

    file_info = {
        "fileId": data_uri,
        "fileName": "test.txt",
        "mimeType": "text/plain",
    }
    raw_bytes, verified_mime = await resolver.resolve_bytes(file_info)

    assert raw_bytes == raw_content
    assert verified_mime == "text/plain"


@pytest.mark.asyncio
async def test_resolve_data_uri_extracts_header_mime():
    resolver = FileResolver()
    raw_content = b"Some JSON data"
    b64_content = base64.b64encode(raw_content).decode("utf-8")
    data_uri = f"data:application/json;base64,{b64_content}"

    file_info = {
        "fileId": data_uri,
        "fileName": "test.json",
    }
    raw_bytes, verified_mime = await resolver.resolve_bytes(file_info)

    assert raw_bytes == raw_content
    assert verified_mime == "application/json"


@pytest.mark.asyncio
async def test_resolve_custom_scheme_async_and_sync():
    resolver = FileResolver()

    async def gdrive_handler(file_id: str, file_info: dict[str, Any]) -> bytes:
        assert file_id == "gdrive://abc123"
        return b"%PDF-1.4 Mock PDF Content"

    def s3_handler(file_id: str, file_info: dict[str, Any]) -> bytes:
        assert file_id == "s3://bucket/key"
        return b"\x89PNG\r\n\x1a\n Mock PNG Content"

    resolver.register_scheme("gdrive://", gdrive_handler)
    resolver.register_scheme("s3://", s3_handler)

    # Resolve async custom scheme
    bytes_gdrive, mime_gdrive = await resolver.resolve_bytes({
        "fileId": "gdrive://abc123",
        "mimeType": "application/pdf",
    })
    assert bytes_gdrive == b"%PDF-1.4 Mock PDF Content"
    assert mime_gdrive == "application/pdf"

    # Resolve sync custom scheme
    bytes_s3, mime_s3 = await resolver.resolve_bytes({
        "fileId": "s3://bucket/key",
        "mimeType": "image/png",
    })
    assert bytes_s3 == b"\x89PNG\r\n\x1a\n Mock PNG Content"
    assert mime_s3 == "image/png"


@pytest.mark.asyncio
async def test_resolve_custom_scheme_via_init():
    def custom_handler(file_id: str, _file_info: dict[str, Any]) -> bytes:
        return b"%PDF-1.4 Custom Scheme via Init"

    resolver = FileResolver(custom_schemes={"custom://": custom_handler})
    raw_bytes, mime = await resolver.resolve_bytes({
        "fileId": "custom://doc1",
        "mimeType": "application/pdf",
    })
    assert raw_bytes == b"%PDF-1.4 Custom Scheme via Init"
    assert mime == "application/pdf"


@pytest.mark.asyncio
async def test_resolve_http_streaming():
    test_bytes = b"%PDF-1.7 Document content downloaded via HTTP stream"

    class MockStreamContext:

        def __init__(self, chunks: list[bytes]):
            self._chunks = chunks
            self.status_code = 200
            self.headers = {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        def raise_for_status(self):
            pass

        async def aiter_bytes(self) -> AsyncIterator[bytes]:
            for chunk in self._chunks:
                yield chunk

    class MockHttpClient:

        def stream(self, method: str, url: str, **kwargs):
            assert method == "GET"
            assert "test.pdf" in url
            assert kwargs.get("headers", {}).get("Host") == "example.com"
            return MockStreamContext([test_bytes[:10], test_bytes[10:]])

    resolver = FileResolver(allowed_hosts=["*"], http_client=MockHttpClient())  # type: ignore[arg-type]
    raw_bytes, mime = await resolver.resolve_bytes({
        "fileId": "https://example.com/test.pdf",
        "mimeType": "application/pdf",
    })
    assert raw_bytes == test_bytes
    assert mime == "application/pdf"


@pytest.mark.asyncio
async def test_magic_byte_signatures():
    resolver = FileResolver()

    signatures = [
        (b"%PDF-1.5 Some PDF", "application/pdf"),
        (b"\x89PNG\r\n\x1a\n Some PNG", "image/png"),
        (b"\xff\xd8\xff Some JPEG", "image/jpeg"),
        (b"GIF87a Some GIF87", "image/gif"),
        (b"GIF89a Some GIF89", "image/gif"),
        (b"RIFF Some WebP", "image/webp"),
    ]

    for raw_data, expected_mime in signatures:
        b64 = base64.b64encode(raw_data).decode("utf-8")
        raw_bytes, detected_mime = await resolver.resolve_bytes({
            "fileId": f"data:application/octet-stream;base64,{b64}",
        })
        assert raw_bytes == raw_data
        assert detected_mime == expected_mime


@pytest.mark.asyncio
async def test_security_mime_mismatch_detected():
    resolver = FileResolver()
    # Claim image/png but content starts with %PDF magic header
    fake_png_pdf = b"%PDF-1.4 disguised as image"
    b64 = base64.b64encode(fake_png_pdf).decode("utf-8")

    with pytest.raises(FileResolverSecurityError) as exc_info:
        await resolver.resolve_bytes({
            "fileId": f"data:image/png;base64,{b64}",
            "mimeType": "image/png",
        })

    assert "MIME mismatch" in str(exc_info.value)
    assert "claimed 'image/png'" in str(exc_info.value)
    assert "detected magic signature 'application/pdf'" in str(exc_info.value)


@pytest.mark.asyncio
async def test_security_mime_mismatch_cross_subtype():
    resolver = FileResolver()

    # Claim application/json but content is application/pdf (both start with 'application/')
    pdf_bytes = b"%PDF-1.4 document"
    b64_pdf = base64.b64encode(pdf_bytes).decode("utf-8")
    with pytest.raises(FileResolverSecurityError) as exc_info:
        await resolver.resolve_bytes({
            "fileId": f"data:application/json;base64,{b64_pdf}",
            "mimeType": "application/json",
        })
    assert "MIME mismatch" in str(exc_info.value)
    assert "claimed 'application/json'" in str(exc_info.value)
    assert "detected magic signature 'application/pdf'" in str(exc_info.value)

    # Claim image/jpeg but content is image/png (both start with 'image/')
    png_bytes = b"\x89PNG\r\n\x1a\n image"
    b64_png = base64.b64encode(png_bytes).decode("utf-8")
    with pytest.raises(FileResolverSecurityError) as exc_info:
        await resolver.resolve_bytes({
            "fileId": f"data:image/jpeg;base64,{b64_png}",
            "mimeType": "image/jpeg",
        })
    assert "MIME mismatch" in str(exc_info.value)
    assert "claimed 'image/jpeg'" in str(exc_info.value)
    assert "detected magic signature 'image/png'" in str(exc_info.value)


@pytest.mark.asyncio
async def test_security_mime_aliases_and_wildcards():
    resolver = FileResolver()

    # Claim image/jpg (alias for image/jpeg)
    jpeg_bytes = b"\xff\xd8\xff JPEG content"
    b64_jpeg = base64.b64encode(jpeg_bytes).decode("utf-8")
    _, mime_jpeg = await resolver.resolve_bytes({
        "fileId": f"data:image/jpg;base64,{b64_jpeg}",
        "mimeType": "image/jpg",
    })
    assert mime_jpeg == "image/jpeg"

    # Claim image/* wildcard for PNG
    png_bytes = b"\x89PNG\r\n\x1a\n PNG content"
    b64_png = base64.b64encode(png_bytes).decode("utf-8")
    _, mime_png = await resolver.resolve_bytes({
        "fileId": f"data:image/*;base64,{b64_png}",
        "mimeType": "image/*",
    })
    assert mime_png == "image/png"


@pytest.mark.asyncio
async def test_security_allowed_mime_types_policy():
    resolver = FileResolver(allowed_mime_types=["application/pdf", "image/*"])

    # Disallowed MIME (e.g. video/mp4)
    video_bytes = b"MP4 video content"
    b64_video = base64.b64encode(video_bytes).decode("utf-8")
    with pytest.raises(FileResolverSecurityError) as exc_info:
        await resolver.resolve_bytes({
            "fileId": f"data:video/mp4;base64,{b64_video}",
            "mimeType": "video/mp4",
        })
    assert "MIME type 'video/mp4' is not permitted" in str(exc_info.value)

    # Allowed MIME (e.g. image/png via wildcard image/*)
    png_bytes = b"\x89PNG\r\n\x1a\n Allowed image"
    b64_png = base64.b64encode(png_bytes).decode("utf-8")
    raw_bytes, mime = await resolver.resolve_bytes({
        "fileId": f"data:image/png;base64,{b64_png}",
        "mimeType": "image/png",
    })
    assert mime == "image/png"


@pytest.mark.asyncio
async def test_security_max_file_size_data_uri():
    resolver = FileResolver(max_file_bytes=10)
    large_bytes = b"0123456789 exceeding limit"
    b64 = base64.b64encode(large_bytes).decode("utf-8")

    with pytest.raises(FileResolverSecurityError) as exc_info:
        await resolver.resolve_bytes({
            "fileId": f"data:text/plain;base64,{b64}",
            "mimeType": "text/plain",
        })
    assert "File exceeded max size of 10 bytes" in str(exc_info.value)


@pytest.mark.asyncio
async def test_security_max_file_size_custom_scheme():
    resolver = FileResolver(
        max_file_bytes=10,
        custom_schemes={"custom://": lambda _id, _info: b"0123456789 too large"},
    )
    with pytest.raises(FileResolverSecurityError) as exc_info:
        await resolver.resolve_bytes({
            "fileId": "custom://doc",
            "mimeType": "text/plain",
        })
    assert "File exceeded max size of 10 bytes" in str(exc_info.value)


@pytest.mark.asyncio
async def test_security_max_file_size_http_streaming():
    class MockStreamContext:

        def __init__(self):
            self.status_code = 200
            self.headers = {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        def raise_for_status(self):
            pass

        async def aiter_bytes(self) -> AsyncIterator[bytes]:
            yield b"123456"
            yield b"789012"  # exceeds 10 bytes

    class MockHttpClient:

        def stream(self, method: str, url: str, **kwargs):
            return MockStreamContext()

    resolver = FileResolver(
        allowed_hosts=["*"], max_file_bytes=10, http_client=MockHttpClient()  # type: ignore[arg-type]
    )

    with pytest.raises(FileResolverSecurityError) as exc_info:
        await resolver.resolve_bytes({
            "fileId": "https://example.com/large.bin",
            "mimeType": "text/plain",
        })
    assert "File exceeded max size of 10 bytes" in str(exc_info.value)


@pytest.mark.asyncio
async def test_security_allowed_hosts_policy():
    pdf_bytes = b"%PDF-1.4 Allowed Host Content"

    class MockStreamContext:

        def __init__(self):
            self.status_code = 200
            self.headers = {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        def raise_for_status(self):
            pass

        async def aiter_bytes(self) -> AsyncIterator[bytes]:
            yield pdf_bytes

    class MockHttpClient:

        def stream(self, method: str, url: str, **kwargs):
            return MockStreamContext()

    resolver = FileResolver(
        allowed_hosts=["example.com", "*.trusted.org"],
        http_client=MockHttpClient(),  # type: ignore[arg-type]
    )

    # 1. Allowed exact host
    bytes_res, mime_res = await resolver.resolve_bytes({
        "fileId": "https://example.com/doc.pdf",
        "mimeType": "application/pdf",
    })
    assert bytes_res == pdf_bytes
    assert mime_res == "application/pdf"

    # 2. Allowed wildcard subdomain host
    bytes_sub, mime_sub = await resolver.resolve_bytes({
        "fileId": "https://api.trusted.org/doc.pdf",
        "mimeType": "application/pdf",
    })
    assert bytes_sub == pdf_bytes
    assert mime_sub == "application/pdf"

    # 3. Disallowed external host
    with pytest.raises(FileResolverSecurityError) as exc_info:
        await resolver.resolve_bytes({
            "fileId": "https://malicious.org/doc.pdf",
            "mimeType": "application/pdf",
        })
    assert "Host 'malicious.org' is not permitted" in str(exc_info.value)

    # 4. Disallowed link-local / metadata IP (SSRF protection)
    with pytest.raises(FileResolverSecurityError) as exc_info:
        await resolver.resolve_bytes({
            "fileId": "http://169.254.169.254/latest/meta-data",
            "mimeType": "text/plain",
        })
    assert "169.254.169.254" in str(exc_info.value)


@pytest.mark.asyncio
async def test_security_allowed_hosts_redirect_blocked():
    class MockRedirectResponse:

        def __init__(self, is_redirect):
            if is_redirect:
                self.status_code = 302
                self.headers = {"Location": "https://evil-redirect.com/secret.pdf"}
            else:
                self.status_code = 200
                self.headers = {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        def raise_for_status(self):
            pass

        async def aiter_bytes(self) -> AsyncIterator[bytes]:
            yield b"%PDF-1.4 secret"

    class MockHttpClient:

        def stream(self, method: str, url: str, **kwargs):
            host_header = kwargs.get("headers", {}).get("Host", "")
            if host_header == "trusted.org" and "redirect-me" in url:
                return MockRedirectResponse(is_redirect=True)
            return MockRedirectResponse(is_redirect=False)

    resolver = FileResolver(
        allowed_hosts=["trusted.org"],
        http_client=MockHttpClient(),  # type: ignore[arg-type]
    )

    with pytest.raises(FileResolverSecurityError) as exc_info:
        await resolver.resolve_bytes({
            "fileId": "https://trusted.org/redirect-me",
            "mimeType": "application/pdf",
        })
    assert "evil-redirect.com" in str(exc_info.value)


@pytest.mark.asyncio
async def test_invalid_file_id_and_unsupported_scheme():
    resolver = FileResolver()

    with pytest.raises(KeyError, match="fileId"):
        await resolver.resolve_bytes({"mimeType": "text/plain"})

    with pytest.raises(ValueError, match="Unsupported file pointer scheme"):
        await resolver.resolve_bytes({"fileId": "ftp://files.example.com/doc.pdf"})


@pytest.mark.asyncio
async def test_to_genai_part_and_resolve_all():
    resolver = FileResolver()

    file1_bytes = b"%PDF-1.4 Document 1"
    file2_bytes = b"\x89PNG\r\n\x1a\n Image 2"

    b64_1 = base64.b64encode(file1_bytes).decode("utf-8")
    b64_2 = base64.b64encode(file2_bytes).decode("utf-8")

    files = [
        {"fileId": f"data:application/pdf;base64,{b64_1}"},
        {"fileId": f"data:image/png;base64,{b64_2}"},
    ]

    # Single to_genai_part
    part1 = await resolver.to_genai_part(files[0])
    assert part1.inline_data.mime_type == "application/pdf"
    assert part1.inline_data.data == file1_bytes

    # Batch resolve_all_to_genai_parts
    parts = await resolver.resolve_all_to_genai_parts(files)
    assert len(parts) == 2
    assert parts[0].inline_data.mime_type == "application/pdf"
    assert parts[0].inline_data.data == file1_bytes
    assert parts[1].inline_data.mime_type == "image/png"
    assert parts[1].inline_data.data == file2_bytes


@pytest.mark.asyncio
async def test_file_resolver_lifecycle():
    client = httpx.AsyncClient()
    resolver = FileResolver(http_client=client)
    assert not resolver._owns_http_client

    # Should not close external client
    await resolver.close()
    assert not client.is_closed

    # Should close internal client
    internal_resolver = FileResolver()
    assert internal_resolver._owns_http_client
    await internal_resolver.close()
    assert internal_resolver._http_client.is_closed

    # Should close via context manager
    async with FileResolver() as ctx_resolver:
        assert not ctx_resolver._http_client.is_closed
    assert ctx_resolver._http_client.is_closed


@pytest.mark.asyncio
async def test_as_tool_decorator():
    resolver = FileResolver()

    file1_bytes = b"%PDF-1.4 Doc 1"
    b64_1 = base64.b64encode(file1_bytes).decode("utf-8")

    def on_error(e: Exception):
        return {"error": str(e)}

    def preprocess(file_info: dict, args: tuple, kwargs: dict):
        file_info["preprocessed"] = True

    resolve_files = resolver.as_tool_decorator(
        arg_name="my_files",
        inject_name="my_parts",
        on_error=on_error,
        preprocess=preprocess,
    )

    @resolve_files
    async def my_tool(my_files: list[dict], my_parts: list[Any] = None):
        return my_files, my_parts

    # Test successful resolution
    files = [{"fileId": f"data:application/pdf;base64,{b64_1}"}]
    out_files, out_parts = await my_tool(my_files=files)

    assert out_files[0].get("preprocessed") is True
    assert len(out_parts) == 1
    assert out_parts[0].inline_data.mime_type == "application/pdf"
    assert out_parts[0].inline_data.data == file1_bytes

    # Test error handling
    invalid_files = [{"fileId": f"data:application/pdf;base64,!!!invalid!!!"}]
    res = await my_tool(my_files=invalid_files)
    assert "error" in res


@pytest.mark.asyncio
async def test_http_host_header_with_port():
    pdf_bytes = b"%PDF-1.4"

    class MockStreamContext:

        def __init__(self):
            self.status_code = 200
            self.headers = {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        def raise_for_status(self):
            pass

        async def aiter_bytes(self) -> AsyncIterator[bytes]:
            yield pdf_bytes

    class MockHttpClient:

        def __init__(self):
            self.host_header_received = None

        def stream(self, method: str, url: str, **kwargs):
            self.host_header_received = kwargs.get("headers", {}).get("Host")
            return MockStreamContext()

    mock_client = MockHttpClient()
    resolver = FileResolver(
        allowed_hosts=["example.com"],
        http_client=mock_client,  # type: ignore[arg-type]
    )

    await resolver.resolve_bytes({
        "fileId": "https://example.com:8443/doc.pdf",
        "mimeType": "application/pdf",
    })

    assert mock_client.host_header_received == "example.com:8443"
