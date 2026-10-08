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

import json

from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessage,
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageUser,
    ModelOutput,
    get_model,
)
from inspect_ai.solver import (
    Generate,
    Solver,
    TaskState,
    solver,
    system_message,
    use_tools,
)
from inspect_ai.tool import Tool, tool
from inspect_ai.util import store

from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.parser import A2uiPart
from a2ui.processor import CatalogConfig
from ..shared.utils import GIT_ROOT, measured_generate

PAYLOAD_STORE_KEY = "a2ui_payload"


@tool
def a2ui_specialist() -> Tool:
    async def execute(input: str) -> str:
        """Generates strictly compliant A2UI JSON payloads. Call this tool when the user requests a UI layout.

        Args:
            input: The UI layout request.
        """
        version = store().get("version", "0.9.1")
        catalog_path = store().get("catalog")
        if not catalog_path:
            raise ValueError("Catalog path is missing from the store.")
        resolved_catalog_path = str(GIT_ROOT / catalog_path)

        catalog_config = CatalogConfig.from_path(
            resolved_catalog_path, protocol_version=version
        )
        direct_json_format = DirectJsonFormat([catalog_config.transformed_catalog])

        role_description = store().get("role_description")
        workflow_description = store().get("workflow_description")

        system_content = direct_json_format.prompt_generator.generate(
            role_description=role_description,
            workflow_description=workflow_description,
            include_schema=True,
        )

        messages: list[ChatMessage] = [
            ChatMessageSystem(content=system_content),
            ChatMessageUser(content=input),
        ]

        output = await get_model().generate(messages)
        if output.completion:
            try:
                parser = direct_json_format.create_parser()
                if not parser.has_format_content(output.completion, complete=True):
                    raise ValueError(
                        "A2UI tags '<a2ui-json>' and '</a2ui-json>' not found"
                    )
                parts = parser.parse_response(output.completion)
                all_messages = []
                for part in parts:
                    if isinstance(part, A2uiPart):
                        for msg in part.a2ui:
                            all_messages.append(
                                msg.model_dump(by_alias=True, exclude_none=True)
                                if hasattr(msg, "model_dump")
                                else msg
                            )
                payload = json.dumps(all_messages, indent=2)
                store().set(PAYLOAD_STORE_KEY, payload)
                return "Success: The UI has been generated and saved out-of-band."
            except Exception as e:
                return (
                    f"Error: Failed to parse A2UI response: {str(e)}. Please make sure"
                    " your response contains valid A2UI JSON enclosed in"
                    " <a2ui-json>...</a2ui-json> tags."
                )

        return "Error: Failed to generate the UI."

    return execute


@solver
def push_metadata_to_store(version: str) -> Solver:
    """Pushes metadata from the TaskState to the global store for tools to access."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        state.store.set("version", version)
        state.store.set("catalog", state.metadata.get("catalog"))
        state.store.set("role_description", state.metadata.get("role_description"))
        state.store.set(
            "workflow_description", state.metadata.get("workflow_description")
        )
        return state

    return solve


@solver
def extract_subagent_payload() -> Solver:
    """Extracts the A2UI payload from the tool response messages."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        payload = state.store.get(PAYLOAD_STORE_KEY)

        if payload is not None and state.output and state.output.choices:
            formatted_payload = f"<a2ui-json>\n{payload}\n</a2ui-json>"
            state.output = ModelOutput(
                model=state.output.model,
                choices=[
                    ChatCompletionChoice(
                        message=ChatMessageAssistant(content=formatted_payload)
                    )
                ],
            )
        return state

    return solve


def subagent_tool_solver(version: str) -> list[Solver]:
    """Returns the solver chain for the 'subagent_tool' evaluation strategy."""
    return [
        system_message(
            "You are a helpful assistant. To fulfill UI requests, you MUST delegate to"
            " the `a2ui_specialist` tool."
        ),
        # Tools cannot access TaskState directly, so we must bridge the metadata into the store
        push_metadata_to_store(version),
        use_tools([a2ui_specialist()]),
        measured_generate(),
        extract_subagent_payload(),
    ]
