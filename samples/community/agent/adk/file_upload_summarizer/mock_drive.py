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

"""
A mock Mock Drive API server implementation.

This module provides simulated Mock Drive v3 endpoints for multipart uploads
and media downloads. It is used by the A2UI file upload demo to demonstrate
out-of-band file resolution (uploading a file and returning a `mockdrive://` URI pointer)
without requiring real Mock Drive credentials or internet access.
"""

import json
import logging
import os
import tempfile
import uuid
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

MOCK_STORAGE_DIR = os.path.join(tempfile.gettempdir(), "mock_drive_storage")
os.makedirs(MOCK_STORAGE_DIR, exist_ok=True)


async def handle_mock_drive_upload(request: Request) -> Response:
    """Handles multipart/form-data file uploads mirroring Mock Drive v3 API."""
    try:
        form = await request.form()
        file_obj = form.get("file")
        if not file_obj:
            return JSONResponse(
                {"error": {"message": "No file field found in form-data"}},
                status_code=400,
            )

        filename = getattr(file_obj, "filename", "uploaded_document")
        mime_type = getattr(file_obj, "content_type", "application/octet-stream")
        content = await file_obj.read()

        file_id = uuid.uuid4().hex
        file_path = os.path.join(MOCK_STORAGE_DIR, file_id)
        meta_path = os.path.join(MOCK_STORAGE_DIR, f"{file_id}.meta.json")

        with open(file_path, "wb") as f:
            f.write(content)

        meta_data = {
            "id": file_id,
            "name": filename,
            "mimeType": mime_type,
            "size": str(len(content)),
        }
        with open(meta_path, "w", encoding="utf-8") as mf:
            json.dump(meta_data, mf)

        logger.info(
            f"Mock Drive upload completed: id={file_id}, name={filename},"
            f" size={len(content)}"
        )
        return JSONResponse(meta_data, status_code=200)
    except Exception as e:
        logger.error(f"Error handling mock drive upload: {e}", exc_info=True)
        return JSONResponse(
            {"error": {"message": str(e)}},
            status_code=500,
        )


async def handle_mock_drive_download(request: Request) -> Response:
    """Handles downloading raw file bytes mirroring Mock Drive v3 alt=media API."""
    try:
        file_id = request.path_params.get("file_id", "")
        if not file_id or not file_id.isalnum():
            return JSONResponse(
                {"error": {"message": "Invalid file ID"}},
                status_code=400,
            )
        file_path = os.path.join(MOCK_STORAGE_DIR, file_id)
        meta_path = os.path.join(MOCK_STORAGE_DIR, f"{file_id}.meta.json")

        if not os.path.exists(file_path):
            return JSONResponse(
                {"error": {"message": f"File {file_id} not found in mock storage"}},
                status_code=404,
            )

        mime_type = "application/octet-stream"
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as mf:
                    meta = json.load(mf)
                    mime_type = meta.get("mimeType", mime_type)
            except Exception:
                pass

        with open(file_path, "rb") as f:
            data = f.read()

        return Response(content=data, media_type=mime_type, status_code=200)
    except Exception as e:
        logger.error(f"Error downloading from mock drive: {e}", exc_info=True)
        return JSONResponse(
            {"error": {"message": str(e)}},
            status_code=500,
        )
