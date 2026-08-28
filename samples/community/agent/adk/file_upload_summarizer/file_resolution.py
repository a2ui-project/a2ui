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

"""A2UI File Resolution Configuration for Mock Drive.

This module sets up the FileResolver used by the File Upload Summarizer sample agent.
It configures custom file resolution handlers (e.g., mockdrive://) and security
constraints (allowed MIME types). Finally, it exports a configured `resolve_files`
decorator to automatically download and inject file contents directly into tools.
"""

import logging
import traceback
from typing import Any, Dict
import httpx
from a2ui.extensions.file_resolve import FileResolver, FileResolverSecurityError

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "http://localhost:10008"
STATE_KEY_BASE_URL = "base_url"
MOCK_DRIVE_SCHEME = "mockdrive://"

ALLOWED_MIME_TYPES = [
    "text/*",
    "application/pdf",
    "application/json",
    "application/javascript",
    "application/xml",
    "image/*",
]

_http_client = httpx.AsyncClient()


async def _mock_drive_handler(file_id: str, file_info: Dict[str, Any]) -> bytes:
    drive_id = file_id.removeprefix(MOCK_DRIVE_SCHEME)
    base_url = file_info.get("base_url") or DEFAULT_BASE_URL
    url = f"{base_url}/api/mock-drive/v3/files/{drive_id}?alt=media"
    response = await _http_client.get(url, follow_redirects=True)
    response.raise_for_status()
    return response.content


resolver = FileResolver(
    allowed_mime_types=ALLOWED_MIME_TYPES,
    allowed_hosts=[],
    custom_schemes={MOCK_DRIVE_SCHEME: _mock_drive_handler},
    http_client=_http_client,
)


def _handle_resolution_error(e: Exception) -> dict:
    if isinstance(e, FileResolverSecurityError):
        logger.error(f"FileResolver security error: {e}")
        return {
            "summary_title": "Security Verification Error",
            "summary_text": f"File failed security checks: {str(e)}",
            "status": "error",
        }
    logger.error(f"Error resolving files: {e}\n{traceback.format_exc()}")
    return {
        "summary_title": "Resolution Error",
        "summary_text": f"Could not resolve file pointers: {str(e)}",
        "status": "error",
    }


def _preprocess_mockdrive(file_info: dict, args: tuple, kwargs: dict) -> None:
    tool_context = kwargs.get("tool_context")
    if not tool_context and args and hasattr(args[0], "session"):
        tool_context = args[0]

    base_url = DEFAULT_BASE_URL
    if tool_context and hasattr(tool_context, "session"):
        base_url = tool_context.session.state.get(STATE_KEY_BASE_URL, DEFAULT_BASE_URL)
    file_info.setdefault("base_url", base_url)


resolve_files = resolver.as_tool_decorator(
    arg_name="files",
    inject_name="genai_parts",
    on_error=_handle_resolution_error,
    preprocess=_preprocess_mockdrive,
)
