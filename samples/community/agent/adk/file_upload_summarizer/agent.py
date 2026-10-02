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
import re
from collections.abc import Mapping, Sequence
from typing import Any, ClassVar
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2ui.a2a import get_a2ui_agent_extension
from a2ui.core import CatalogApi
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.schema import CatalogConfig, VERSION_0_9
from a2ui.utils import resolve_catalogs
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


def _renderer_capabilities(
    version: str,
    client_ui_capabilities: Mapping[str, Any] | None,
    catalog_ids: Sequence[str],
) -> dict[str, Any] | None:
    """Returns the client's capabilities keyed by protocol version.

    Clients may send the bare capabilities entry, and may leave out
    `supportedCatalogIds`, which then names every catalog of the agent.
    Capabilities that are already keyed by protocol version are only read
    under the negotiated version's key.

    Args:
        version: The negotiated A2UI protocol version.
        client_ui_capabilities: The capabilities that the client sent.
        catalog_ids: The ids of the agent's catalogs.

    Returns:
        The capabilities for `a2ui.utils.resolve_catalogs`, or `None` if the
        client sent none for the negotiated version.
    """
    if not client_ui_capabilities:
        return None
    key = f"v{version}"
    raw: Any = client_ui_capabilities
    if any(_is_version_key(k) for k in client_ui_capabilities):
        raw = client_ui_capabilities.get(key)
        if raw is None:
            return None
        if not isinstance(raw, Mapping):
            # Left for `resolve_catalogs` to reject with a validation error.
            return {key: raw}
    entry = dict(raw)
    if "supportedCatalogIds" not in entry and "supported_catalog_ids" not in entry:
        entry["supportedCatalogIds"] = list(catalog_ids)
    return {key: entry}


def _is_version_key(key: Any) -> bool:
    """Whether a capabilities key names a protocol version, such as `v0.9`."""
    return (
        isinstance(key, str)
        and key.startswith("v")
        and bool(re.fullmatch(r"\d+(\.\d+)*", key[1:]))
    )


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

        self._text_runner: Runner | None = self._build_runner(self._build_llm_agent())

        self._accepts_inline_catalogs = True
        self._catalog_configs: dict[str, list[CatalogConfig]] = {}
        self._inference_formats: dict[str, DirectJsonFormat] = {}
        self._ui_runners: dict[str, Runner] = {}

        inference_format = self._build_inference_format(VERSION_0_9)
        self._inference_formats[VERSION_0_9] = inference_format
        agent = self._build_llm_agent(inference_format)
        self._ui_runners[VERSION_0_9] = self._build_runner(agent)

        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    def get_runner(self, version: str | None) -> Runner:
        if version is None:
            return self._text_runner
        return self._ui_runners[version]

    def get_inference_format(self, version: str | None) -> DirectJsonFormat | None:
        if version is None:
            return None
        return self._inference_formats[version]

    def resolve_catalogs(
        self, version: str, client_ui_capabilities: Mapping[str, Any] | None
    ) -> list[CatalogApi]:
        """Returns the catalogs active for the client's capabilities.

        Args:
            version: The negotiated A2UI protocol version.
            client_ui_capabilities: The capabilities that the client sent.

        Returns:
            The active catalogs, the client's preferred one first.
        """
        return resolve_catalogs(
            self._catalog_configs[version],
            _renderer_capabilities(
                version,
                client_ui_capabilities,
                [c.catalog_id for c in self._inference_formats[version].catalogs],
            ),
            accepts_inline_catalogs=self._accepts_inline_catalogs,
        )

    def _build_inference_format(self, version: str) -> DirectJsonFormat:
        config = CatalogConfig.from_path(
            name="file_upload_catalog",
            catalog_path=f"catalogs/{version}/file_upload_catalog.json",
        )
        catalog = config.to_catalog(protocol_version=version)
        # Build the catalog once with the version fixed, so that per-request
        # resolution reuses it as it is.
        self._catalog_configs[version] = [
            CatalogConfig.from_catalog(config.name, catalog)
        ]
        return DirectJsonFormat([catalog])

    def _build_agent_card(self) -> AgentCard:
        extensions = []
        if self._inference_formats:
            for version, fmt in self._inference_formats.items():
                ext = get_a2ui_agent_extension(
                    version,
                    self._accepts_inline_catalogs,
                    [c.catalog_id for c in fmt.catalogs],
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
        self, inference_format: DirectJsonFormat | None = None
    ) -> LlmAgent:
        instruction = (
            "\n\n".join([
                ROLE_DESCRIPTION,
                WORKFLOW_DESCRIPTION,
                f"## UI Description:\n{UI_DESCRIPTION}",
                inference_format.prompt_generator.generate(),
            ])
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
