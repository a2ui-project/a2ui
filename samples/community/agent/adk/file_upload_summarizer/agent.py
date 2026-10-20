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

from collections.abc import Mapping
import logging
from typing import Any, ClassVar

from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from google.adk.agents.llm_agent import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.planners.built_in_planner import BuiltInPlanner
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from a2ui.a2a import get_a2ui_agent_extension
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.utils import to_version_number
from agent_executor import get_a2ui_enabled, get_a2ui_rules
from tools import (
    show_file_uploader_tool,
    summarize_file_tool,
    update_upload_context_tool,
)

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

TEXT_DESCRIPTION = """
You are an expert Document Summarization Agent. This client can't display the file upload interface, so your final output MUST be a text response.
Do NOT call `show_file_uploader_tool`. If the user wants to upload documents, tell them that it needs a client that renders the A2UI file upload interface.
"""


def get_ui_prompt(base_rules: str) -> str:
    """Constructs the instruction for one UI request.

    Args:
        base_rules: The format rules of the request's processor, from
            `processor.format.prompt_generator.generate_base_rules()`.
    """
    return "\n\n".join([
        ROLE_DESCRIPTION,
        base_rules,
        WORKFLOW_DESCRIPTION,
        f"## UI Description:\n{UI_DESCRIPTION}",
    ])


class FileUploadSummarizerAgent:
    """An agent that demonstrates A2UI file upload pointer resolution and summarization.

    The agent holds one generator for each protocol version it speaks. The
    executor negotiates a processor for each request from the client's
    capabilities, and writes what the request needs into the session state:
    whether it uses A2UI, the format rules and the catalog that A2UI in the
    response is converted with. The instruction reads them from there, so one
    runner serves every request.
    """

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

        self._generators: dict[ProtocolVersion, A2uiGenerator] = {
            version: self._build_generator(version)
            for version in [ProtocolVersion.V0_9, ProtocolVersion.V1_0]
        }
        self._runner = self._build_runner()
        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    @property
    def runner(self) -> Runner:
        """The runner of every request, with or without A2UI."""
        return self._runner

    def create_processor(
        self, version: ProtocolVersion, client_ui_capabilities: Mapping[str, Any] | None
    ) -> A2uiRequestProcessor:
        """Negotiates the processor of one request from the client's capabilities.

        Args:
            version: The negotiated A2UI protocol version.
            client_ui_capabilities: The capabilities that the client sent,
                keyed by protocol version (`a2uiClientCapabilities` up to v0.9,
                `a2uiRendererCapabilities` from v1.0), or None if it sent none.

        Raises:
            A2uiError: If the client sent no capabilities, or they are
                malformed or name no catalog that the agent can use.
        """
        return self._generators[version].create_processor(client_ui_capabilities)

    def surface_catalog_ids(self, version: ProtocolVersion) -> set[str]:
        """Returns the ids of every catalog that the uploader surface uses.

        A v0.9 surface uses the file upload catalog alone. A v1.0 surface
        defaults to the basic catalog, and its FileUpload component names the
        file upload catalog.
        """
        return {
            c.transformed_catalog.catalog_id for c in self._generators[version].catalogs
        }

    def _build_generator(self, version: ProtocolVersion) -> A2uiGenerator:
        config = CatalogConfig.from_path(
            catalog_path=(
                f"catalogs/{to_version_number(version)}/file_upload_catalog.json"
            ),
            protocol_version=version,
        )
        if version == ProtocolVersion.V0_9:
            # A v0.9 surface uses one catalog, which holds the layout
            # components next to FileUpload.
            return A2uiGenerator([config], accepts_inline_catalogs=True)
        # A v1.0 surface mixes catalogs: the basic catalog is its default, and
        # the FileUpload component names the file upload catalog.
        return A2uiGenerator(
            [CatalogConfig(BasicCatalog(version)), config],
            accepts_inline_catalogs=True,
        )

    def _build_agent_card(self) -> AgentCard:
        extensions = [
            get_a2ui_agent_extension(
                version,
                generator.accepts_inline_catalogs,
                [c.transformed_catalog.catalog_id for c in generator.catalogs],
            )
            for version, generator in self._generators.items()
        ]

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

    def _instruction(self, ctx: ReadonlyContext) -> str:
        """Returns the instruction of the current request.

        The executor records in the session state whether the request uses
        A2UI and the format rules of the request's processor.
        """
        if not get_a2ui_enabled(ctx):
            return TEXT_DESCRIPTION
        return get_ui_prompt(get_a2ui_rules(ctx))

    def _build_runner(self) -> Runner:
        """Builds the runner, whose instruction follows each request."""
        agent = LlmAgent(
            model=self._model,
            name=self._agent_name,
            description="An agent that provides zero-context-bloat file summarization.",
            instruction=self._instruction,
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
        return Runner(
            app_name=self._agent_name,
            agent=agent,
            artifact_service=self._artifact_service,
            session_service=self._session_service,
            memory_service=self._memory_service,
        )
