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

import json
from inspect_ai.solver import Solver, solver, TaskState, Generate, use_tools, system_message
from inspect_ai.model import ChatMessageSystem, ChatMessageTool, get_model, ModelOutput, ChatCompletionChoice, ChatMessageAssistant, ChatMessageUser
from inspect_ai.tool import tool, Tool
from inspect_ai.util import store
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.schema.catalog import CatalogConfig
from a2ui.parser.parser import parse_response
from ..shared.utils import GIT_ROOT, measured_generate

from .direct import a2ui_system_prompt

PAYLOAD_STORE_KEY = "a2ui_payload"


@tool
def a2ui_specialist() -> Tool:
    async def execute(input: str) -> str:
        """Generates strictly compliant A2UI JSON payloads. Call this tool when the user requests a UI layout.
        
        Args:
            input: The UI layout request.
        """
        catalog_path = store().get("catalog")
        resolved_catalog_path = str(GIT_ROOT / catalog_path)

        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)
        manager = A2uiSchemaManager(version="0.9", catalogs=[catalog_config])
        
        role_description = store().get("role_description")
        workflow_description = store().get("workflow_description")

        system_content = manager.generate_system_prompt(
            role_description=role_description,
            workflow_description=workflow_description,
            include_schema=True,
        )
        
        messages = [
            ChatMessageSystem(content=system_content),
            ChatMessageUser(content=input)
        ]
        
        output = await get_model().generate(messages)
        if output.completion:
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
            
        return "Error: Failed to generate the UI."
        
    return execute

@solver
def push_metadata_to_store() -> Solver:
    """Pushes metadata from the TaskState to the global store for tools to access."""
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        state.store.set("catalog", state.metadata.get('catalog'))
        state.store.set("role_description", state.metadata.get('role_description'))
        state.store.set("workflow_description", state.metadata.get('workflow_description'))
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
                choices=[ChatCompletionChoice(message=ChatMessageAssistant(content=formatted_payload))]
            )
        return state
    return solve

def subagent_tool_solver() -> list[Solver]:
    """Returns the solver chain for the 'subagent_tool' evaluation strategy."""
    return [
        system_message("You are a helpful assistant. To fulfill UI requests, you MUST delegate to the `a2ui_specialist` tool."),
        # Tools cannot access TaskState directly, so we must bridge the metadata into the store
        push_metadata_to_store(),
        use_tools([a2ui_specialist()]),
        measured_generate(),
        extract_subagent_payload()
    ]
