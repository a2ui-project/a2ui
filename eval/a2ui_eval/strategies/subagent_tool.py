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
from inspect_ai.solver import (
    Generate,
    Solver,
    solver,
    system_message,
    TaskState,
    use_tools,
)
from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessage,
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageUser,
    get_model,
    ModelOutput,
)
from inspect_ai.tool import tool, Tool
from inspect_ai.util import store
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.schema.catalog import CatalogConfig
from a2ui.parser.parser import parse_response
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

        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)
        direct_json_format = DirectJsonFormat(
            version=version,
            catalogs=[catalog_config],
            experiments={"version_1_0"} if version == "1.0" else None,
        )

        protocol_role = store().get("protocol_role") or ""
        generation_rules = store().get("generation_rules") or ""

        system_content = direct_json_format.prompt_generator.generate(
            role_description=protocol_role,
            workflow_description=generation_rules,
            include_schema=True,
        )

        messages: list[ChatMessage] = [
            ChatMessageSystem(content=system_content),
            ChatMessageUser(content=input),
        ]

        output = await get_model().generate(messages)
        if output.completion:
            try:
                parts = parse_response(output.completion)
                all_messages = []
                for part in parts:
                    if part.a2ui_json:
                        if isinstance(part.a2ui_json, list):
                            all_messages.extend(part.a2ui_json)
                        else:
                            all_messages.append(part.a2ui_json)
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
def subagent_system_prompt() -> Solver:
    """Injects system prompt instructions, including domain prompt if present."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        base_prompt = (
            "You are a helpful assistant. To fulfill UI requests, you MUST delegate"
            " to the `a2ui_specialist` tool."
        )
        domain_prompt = state.metadata.get("system_prompt", "").strip()
        if domain_prompt:
            full_prompt = (
                f"## Domain Instructions\n{domain_prompt}\n\n## UI Protocol"
                f" Instructions\n{base_prompt}"
            )
        else:
            full_prompt = base_prompt

        state.messages.insert(0, ChatMessageSystem(content=full_prompt))
        return state

    return solve


@solver
def push_metadata_to_store(version: str) -> Solver:
    """Pushes metadata from the TaskState to the global store for tools to access."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        state.store.set("version", version)
        state.store.set("catalog", state.metadata.get("catalog"))
        state.store.set(
            "protocol_role",
            state.metadata.get("protocol_role", ""),
        )
        state.store.set(
            "generation_rules",
            state.metadata.get("generation_rules", ""),
        )
        return state

    return solve


@solver
def extract_subagent_payload() -> Solver:
    """Extracts the A2UI payload from the tool response messages and preserves prose."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        payload = state.store.get(PAYLOAD_STORE_KEY)

        if payload is not None and state.output and state.output.choices:
            prose = state.output.completion.strip() if state.output.completion else ""
            formatted_payload = f"<a2ui-json>\n{payload}\n</a2ui-json>"
            if prose:
                if "<a2ui-json>" in prose:
                    combined_content = prose
                else:
                    combined_content = f"{prose}\n\n{formatted_payload}"
            else:
                combined_content = formatted_payload

            state.output = ModelOutput(
                model=state.output.model,
                choices=[
                    ChatCompletionChoice(
                        message=ChatMessageAssistant(content=combined_content)
                    )
                ],
            )
        return state

    return solve


def subagent_tool_solver(version: str) -> list[Solver]:
    """Returns the solver chain for the 'subagent_tool' evaluation strategy."""
    return [
        subagent_system_prompt(),
        # Tools cannot access TaskState directly, so we must bridge the metadata into the store
        push_metadata_to_store(version),
        use_tools([a2ui_specialist()]),
        measured_generate(),
        extract_subagent_payload(),
    ]
