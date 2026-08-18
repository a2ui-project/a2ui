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

import logging
import os
import traceback
from typing import Any
import uuid
from google.adk.tools import ToolContext
from google.genai import Client
from file_resolution import resolve_files

logger = logging.getLogger(__name__)


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


@resolve_files
async def summarize_file_tool(
    tool_context: ToolContext,
    files: list[dict],
    genai_parts: list[Any] = None,
):
    """Summarizes the collection of documents using Gemini.

    Args:
        files: A list of dictionaries representing uploaded files. Each dictionary
               should contain a 'fileId' and a 'metadata' object with 'fileName' and 'mimeType'.
    """
    logger.info(f"Summarization triggered for {len(files)} files")

    tool_context.actions.skip_summarization = False

    try:
        if not isinstance(files, list):
            return {
                "summary_title": "Invalid Input",
                "summary_text": "Expected a list of files.",
                "status": "error",
            }

        if not files:
            return {
                "summary_title": "Invalid Input",
                "summary_text": "No files provided for summarization.",
                "status": "error",
            }

        file_names = []
        for f in files:
            if isinstance(f, dict):
                metadata = f.get("metadata") or {}
                name = metadata.get("fileName") or f.get("fileName") or "document"
                file_names.append(name)

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

        final_contents = [prompt, *(genai_parts or [])]

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
            "instruction_to_model": (
                "You MUST generate a Markdown text response to the user containing the"
                " summary right now. Do not skip this step."
            ),
        }
    except Exception as e:
        logger.error(f"Error summarizing files: {e}\n{traceback.format_exc()}")
        return {
            "summary_title": "Summarization Error",
            "summary_text": f"Could not generate summary: {str(e)}",
            "status": "error",
        }
