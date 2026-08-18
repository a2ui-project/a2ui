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
from typing import Any, ClassVar, Optional, Dict
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2ui.a2a.extension import get_a2ui_agent_extension
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.schema.catalog import CatalogConfig
from a2ui.schema.constants import VERSION_0_9
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.planners.built_in_planner import BuiltInPlanner
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from tools import show_file_uploader_tool, summarize_file_tool, update_upload_context_tool

logger = logging.getLogger(__name__)

ROLE_DESCRIPTION = """
You are an expert A2UI Document Summarization Agent. Your primary function is to display a file upload interface and to summarize uploaded documents.

When the user greets you or asks for the file uploader, you MUST call the `show_file_uploader_tool` tool. Set the `multiple` argument to `True` if the user implies uploading multiple files, otherwise set it to `False`.

IMPORTANT: Do NOT attempt to construct the A2UI JSON manually. The tools handle it automatically.

When you receive an `"upload_complete"` action event, extract the `files` array from the event payload and pass it directly as `files` to the `update_upload_context_tool`. You MUST pass the objects exactly as they appear in the event payload, do NOT strip any properties. Do NOT proactively call `summarize_file_tool` after this step; you must wait for the user to explicitly trigger the summarize action.

When you receive a `"summarize_file"` action event OR when the user explicitly asks to summarize the uploaded files, call `summarize_file_tool` with the `files` array. Do NOT call `summarize_file_tool` automatically just because uploaded file context is present in the prompt; wait for an explicit user command or action event.

CRITICAL: Once `summarize_file_tool` completes and returns its JSON result containing `summary_title` and `summary_text`, you MUST generate a subsequent Markdown text response to display the summary to the user. Do NOT stop execution after the tool call; you must explicitly output text summarizing the result.
"""

WORKFLOW_DESCRIPTION = """
1. **Analyze Request**: 
   - If user asks to show the file uploader: Call `show_file_uploader_tool`.
   - If you receive an `"upload_complete"` action event (handshake after file upload): Extract the `files` array and the `surfaceId` from the event payload and pass them to `update_upload_context_tool`. IMPORTANT: Do NOT call `summarize_file_tool` automatically here.
   - If you receive a `"summarize_file"` action event OR the user explicitly asks to summarize the uploaded files: Call `summarize_file_tool` with the `files` array. After the `summarize_file_tool` returns, you MUST generate a final Markdown text response using the returned `summary_title` and `summary_text` to show the user. Never return only the tool call response.
"""

UI_DESCRIPTION = """
Use standard A2UI components (FileUpload, Column, Button, Card, Text) to render the demonstration interface.
"""


class FileUploadSummarizerAgent:
    """An agent that demonstrates A2UI file upload pointer resolution and summarization."""

    SUPPORTED_CONTENT_TYPES: ClassVar[list[str]] = ["text", "text/plain"]

    def __init__(
        self,
        base_url: str,
        model: Any,
    ):
        self.base_url = base_url
        self._model = model

        self._agent_name = "file_upload_summarizer_agent"
        self._user_id = "remote_user"

        self._session_service = InMemorySessionService()
        self._memory_service = InMemoryMemoryService()
        self._artifact_service = InMemoryArtifactService()

        self._text_runner: Optional[Runner] = self._build_runner(
            self._build_llm_agent()
        )

        self._inference_formats: Dict[str, DirectJsonFormat] = {}
        self._ui_runners: Dict[str, Runner] = {}

        inference_format = self._build_inference_format(VERSION_0_9)
        self._inference_formats[VERSION_0_9] = inference_format
        agent = self._build_llm_agent(inference_format)
        self._ui_runners[VERSION_0_9] = self._build_runner(agent)

        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    def get_runner(self, version: Optional[str]) -> Runner:
        if version is None:
            return self._text_runner
        return self._ui_runners[version]

    def get_inference_format(
        self, version: Optional[str]
    ) -> Optional[DirectJsonFormat]:
        if version is None:
            return None
        return self._inference_formats[version]

    def _build_inference_format(self, version: str) -> DirectJsonFormat:
        return DirectJsonFormat(
            version=version,
            catalogs=[
                CatalogConfig.from_path(
                    name="file_upload_catalog",
                    catalog_path=f"catalogs/{version}/file_upload_catalog.json",
                ),
            ],
            accepts_inline_catalogs=True,
        )

    def _build_agent_card(self) -> AgentCard:
        extensions = []
        if self._inference_formats:
            for version, sm in self._inference_formats.items():
                ext = get_a2ui_agent_extension(
                    version,
                    sm.accepts_inline_catalogs,
                    sm.supported_catalog_ids,
                )
                extensions.append(ext)

        capabilities = AgentCapabilities(
            streaming=True,
            extensions=extensions,
        )

        return AgentCard(
            name="FileUpload Summarizer Agent",
            description="Demonstrates file upload and document summarization.",
            url=self.base_url,
            iconUrl="A2UI_light.svg",
            version="1.0.0",
            default_input_modes=FileUploadSummarizerAgent.SUPPORTED_CONTENT_TYPES,
            default_output_modes=FileUploadSummarizerAgent.SUPPORTED_CONTENT_TYPES,
            capabilities=capabilities,
            skills=[
                AgentSkill(
                    id="show_uploader",
                    name="Show File Uploader",
                    description="Displays the document upload and summarization UI.",
                    tags=["fileupload", "upload", "summarize", "demo", "tool"],
                    examples=[
                        "show file uploader",
                        "upload document",
                        "summarize file",
                    ],
                ),
                AgentSkill(
                    id="resolve_file_pointer",
                    name="Resolve File Pointer",
                    description=(
                        "Resolves abstract pointer URIs out-of-band via"
                        f" {self.base_url}/api/mock-drive/v3/files/{{id}}?alt=media"
                    ),
                    tags=["fileupload", "resolve", "pointer", "ioc"],
                    examples=["mockdrive://file-id"],
                ),
            ],
        )

    def _build_runner(self, agent: LlmAgent) -> Runner:
        return Runner(
            app_name=self._agent_name,
            agent=agent,
            artifact_service=self._artifact_service,
            session_service=self._session_service,
            memory_service=self._memory_service,
        )

    def _build_llm_agent(
        self, inference_format: Optional[DirectJsonFormat] = None
    ) -> LlmAgent:
        instruction = (
            inference_format.generate_system_prompt(
                role_description=ROLE_DESCRIPTION,
                workflow_description=WORKFLOW_DESCRIPTION,
                ui_description=UI_DESCRIPTION,
                include_schema=False,
                include_examples=False,
                validate_examples=False,
            )
            if inference_format
            else ""
        )

        return LlmAgent(
            model=self._model,
            name=self._agent_name,
            description="An agent that provides zero-context-bloat file summarization.",
            instruction=instruction,
            tools=[
                show_file_uploader_tool,
                summarize_file_tool,
                update_upload_context_tool,
            ],
            planner=BuiltInPlanner(
                thinking_config=types.ThinkingConfig(
                    include_thoughts=True,
                )
            ),
            disallow_transfer_to_peers=True,
        )
