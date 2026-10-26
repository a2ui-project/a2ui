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

"""Subagent tool evaluation strategy."""

from __future__ import annotations

import asyncio
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

from ..runner import DEFAULT_PARSE_TIMEOUT_SEC, generate_prompt, parse_and_validate
from ..shared.utils import GIT_ROOT, measured_generate

PAYLOAD_STORE_KEY = "a2ui_payload"


@tool
def a2ui_specialist() -> Tool:
    async def execute(input: str) -> str:  # pylint: disable=redefined-builtin
        """Generates strictly compliant A2UI JSON payloads. Call this tool when the user requests a UI layout.

        Args:
            input: The UI layout request.
        """
        version = store().get("version", "0.9.1")
        catalog_path = store().get("catalog")
        if not catalog_path:
            raise ValueError("Catalog path is missing from the store.")
        resolved_catalog_path = str(GIT_ROOT / catalog_path)

        generated_snippet = await asyncio.to_thread(
            generate_prompt,
            "direct_json",
            version,
            resolved_catalog_path,
        )

        role_description = store().get("role_description")
        workflow_description = store().get("workflow_description")

        prompt_parts = []
        if role_description:
            prompt_parts.append(role_description)
        if workflow_description:
            prompt_parts.append(f"## Workflow Description:\n{workflow_description}")
        prompt_parts.append(
            "## Environment Notes:\n"
            "- No external tools are available to you in this specialist"
            " environment. Even if the instructions above mention calling"
            " tools (such as data-fetching or app-fetching tools), do NOT call"
            " any tools or emit tool-call syntax; instead, directly construct"
            " the complete A2UI JSON payload enclosed in literal <a2ui-json>"
            " and </a2ui-json> tags using synthesized sample data.\n"
            "- When specifying `catalogId` (in `createSurface` as the surface"
            " default, or on individual components and function calls), always"
            " use the exact `catalogId` value(s) defined in the provided"
            " Catalog Schema(s); never invent a custom or placeholder"
            " `catalogId` URL or identifier (such as `example.com`), even if"
            " the user prompt mentions a custom catalog.\n"
            "- In `createSurface`, set `catalogId` to the primary catalog ID"
            " as the surface default. Components or functions belonging to"
            " secondary catalogs must specify their own `catalogId`."
        )
        prompt_parts.append(generated_snippet)
        system_content = "\n\n".join(prompt_parts)

        messages: list[ChatMessage] = [
            ChatMessageSystem(content=system_content),
            ChatMessageUser(content=input),
        ]

        allowed_surface_ids = store().get("allowed_surface_ids") or ["main"]
        surface_id = allowed_surface_ids[0]

        output = await get_model().generate(messages)
        if output.completion:
            try:
                # The specialist only parses, without strict validation.
                # Validation runs once, in the scorer. Validating here would
                # return validation errors to the model and let it retry, so
                # results would not be comparable with older runs.
                res_dict = await asyncio.to_thread(
                    parse_and_validate,
                    "direct_json",
                    version,
                    resolved_catalog_path,
                    surface_id,
                    output.completion,
                    DEFAULT_PARSE_TIMEOUT_SEC,
                    True,
                    validate=False,
                )
                all_messages = res_dict.get("compiled_jsons", [])
                payload = json.dumps(all_messages, indent=2)
                store().set(PAYLOAD_STORE_KEY, payload)
                return "Success: The UI has been generated and saved out-of-band."
            except Exception as e:  # pylint: disable=broad-exception-caught
                return (
                    f"Error: Failed to parse A2UI response: {str(e)}. Please"
                    " make sure your response contains valid A2UI JSON enclosed"
                    " in <a2ui-json>...</a2ui-json> tags."
                )

        return "Error: Failed to generate the UI."

    return execute


@solver
def push_metadata_to_store(version: str) -> Solver:
    """Pushes metadata from the TaskState to the global store for tools to access."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        state.store.set("version", version)
        state.store.set("catalog", state.metadata.get("catalog"))
        state.store.set(
            "allowed_surface_ids",
            state.metadata.get("allowed_surface_ids", ["main"]),
        )
        state.store.set("role_description", state.metadata.get("role_description"))
        state.store.set(
            "workflow_description", state.metadata.get("workflow_description")
        )
        return state

    return solve


@solver
def extract_subagent_payload() -> Solver:
    """Extracts the A2UI payload from the tool response messages."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
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
            "You are a helpful assistant. To fulfill UI requests, you MUST"
            " delegate to the `a2ui_specialist` tool."
        ),
        # Tools cannot access TaskState directly, so we must bridge the metadata into the store
        push_metadata_to_store(version),
        use_tools([a2ui_specialist()]),
        measured_generate(),
        extract_subagent_payload(),
    ]
