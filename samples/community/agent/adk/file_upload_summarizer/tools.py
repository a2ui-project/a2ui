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

import asyncio
import base64
import logging
import os
import traceback
import httpx
from google.adk.tools import ToolContext
from google.genai import Client
from google.genai import types as genai_types

import uuid

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "http://localhost:10008"
STATE_KEY_BASE_URL = "base_url"


async def fetch_and_process(file_info, http_client, base_url):
    if not isinstance(file_info, dict):
        return None
    file_id = file_info.get("fileId", "")
    file_name = file_info.get("fileName", "document")
    mime_type = file_info.get("mimeType", "text/plain")

    drive_id = file_id
    if file_id.startswith("mockdrive://"):
        drive_id = file_id.split("mockdrive://", 1)[1]

    url = f"{base_url}/api/mock-drive/v3/files/{drive_id}?alt=media"
    response = await http_client.get(url, follow_redirects=True)
    response.raise_for_status()
    file_bytes = response.content

    logger.info(
        f"Successfully downloaded {len(file_bytes)} bytes out of band for {drive_id}"
    )

    content_parts = [f"\n\n--- Document: {file_name} ---"]
    if mime_type.startswith("text/") or mime_type in [
        "application/json",
        "application/javascript",
        "application/xml",
    ]:
        try:
            text_content = file_bytes.decode("utf-8", errors="replace")
            content_parts.append(f"Content:\n{text_content}")
        except Exception:
            content_parts.append(
                genai_types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
            )
    else:
        content_parts.append(
            genai_types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
        )
    return file_name, content_parts


async def show_file_uploader_tool(tool_context: ToolContext, multiple: bool = False):
    """Displays the A2UI FileUpload demonstration surface with uploader and button.

    Args:
        multiple: Set to True if the user asks to upload multiple files, False for a single file.
    """
    surface_id = f"file_upload_surface_{uuid.uuid4().hex[:8]}"
    messages = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": surface_id,
                "catalogId": (
                    "https://a2ui.org/samples/community/agent/adk/file_upload_summarizer/catalogs/0.9/file_upload_catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": surface_id,
                "components": [
                    {
                        "id": "root",
                        "component": "Column",
                        "children": [
                            "doc_uploader",
                            "summarize_btn",
                        ],
                    },
                    {
                        "id": "doc_uploader",
                        "component": "FileUpload",
                        "label": "Upload a document to Mock Drive for summarization",
                        "accept": ".txt,.md,.pdf,.csv,.json",
                        "maxSize": 10485760,
                        "multiple": multiple,
                    },
                    {
                        "id": "summarize_btn",
                        "component": "Button",
                        "child": "summarize_btn_txt",
                        "checks": [{
                            "condition": {
                                "call": "required",
                                "args": {"value": {"path": "/uploaded_files"}},
                                "returnType": "boolean",
                            },
                            "message": "Please wait for the file upload to complete",
                        }],
                        "action": {
                            "event": {
                                "name": "summarize_file",
                                "context": {"files": {"path": "/uploaded_files"}},
                            }
                        },
                    },
                    {
                        "id": "summarize_btn_txt",
                        "component": "Text",
                        "text": "Summarize Uploaded Document",
                    },
                ],
            },
        },
    ]
    tool_context.actions.skip_summarization = True
    return {"validated_a2ui_json": messages}


async def update_upload_context_tool(
    tool_context: ToolContext,
    files: list[dict],
    surface_id: str,
):
    """Updates the data model with the uploaded file pointers context.
    IMPORTANT: After calling this tool, you MUST STOP and wait for the user. Do NOT call summarize_file_tool.
    """
    messages = [{
        "version": "v0.9",
        "updateDataModel": {
            "surfaceId": surface_id,
            "path": "/uploaded_files",
            "value": files,
        },
    }]
    tool_context.actions.skip_summarization = True
    return {
        "validated_a2ui_json": messages,
        "instruction_to_model": (
            "SUCCESS. The data model is updated. You MUST STOP NOW. Do NOT proactively"
            " call summarize_file_tool. Wait for the user to click the summarize"
            " button."
        ),
    }


async def summarize_file_tool(
    tool_context: ToolContext,
    files: list[dict],
):
    """Resolves abstract file pointers out-of-band and summarizes the collection of documents using Gemini 3.1 Flash Lite.

    Args:
        files: A list of dictionaries, each containing 'fileId', 'fileName', and 'mimeType' of an uploaded file.
    """
    logger.info(f"Out-of-band resolution triggered for {len(files)} files")

    try:
        if not isinstance(files, list):
            return {
                "summary_title": "Invalid Input",
                "summary_text": "Expected a list of files.",
                "status": "error",
            }

        base_url = tool_context.session.state.get(STATE_KEY_BASE_URL, DEFAULT_BASE_URL)

        contents = []
        file_names = []

        async with httpx.AsyncClient() as http_client:
            tasks = [fetch_and_process(f, http_client, base_url) for f in files]
            results = await asyncio.gather(*tasks)
            for res in results:
                if res:
                    file_name, content_parts = res
                    file_names.append(file_name)
                    contents.extend(content_parts)

        lite_llm_model = os.getenv(
            "LITELLM_MODEL", "gemini/gemini-3.1-flash-lite-preview"
        )
        gemini_model = (
            lite_llm_model[len("gemini/") :]
            if lite_llm_model.startswith("gemini/")
            else lite_llm_model
        )

        client = Client()

        if len(files) == 1:
            prompt = (
                f"You are analyzing an uploaded document titled '{file_names[0]}'."
                " Provide a concise executive summary followed by 3 clear key"
                " takeaways formatted in Markdown."
            )
        else:
            prompt = (
                f"You are analyzing a collection of {len(files)} uploaded documents:"
                f" {', '.join(file_names)}. Provide a concise executive summary of the"
                " entire collection followed by clear key takeaways formatted in"
                " Markdown."
            )

        final_contents = [prompt] + contents

        llm_response = client.models.generate_content(
            model=gemini_model,
            contents=final_contents,
        )
        summary_text = (
            llm_response.text.strip()
            if llm_response.text
            else "Summary generation completed."
        )

        title_suffix = (
            file_names[0] if len(file_names) == 1 else f"{len(file_names)} Documents"
        )
        return {
            "summary_title": f"Summary: {title_suffix}",
            "summary_text": summary_text,
            "status": "success",
        }
    except Exception as e:
        logger.error(f"Error summarizing files: {e}\n{traceback.format_exc()}")
        return {
            "summary_title": "Resolution Error",
            "summary_text": (
                f"Could not resolve file pointers or generate summary: {str(e)}"
            ),
            "status": "error",
        }
