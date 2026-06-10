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
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.schema.catalog import CatalogConfig
from a2ui.parser.parser import parse_response
from ..shared.utils import WORKFLOW_OVERRIDE, measured_generate

from .direct import a2ui_system_prompt


@tool
def a2ui_specialist(schema_path: str, catalog_path: str) -> Tool:
    async def execute(input: str) -> str:
        """Generates strictly compliant A2UI JSON payloads. Call this tool when the user requests a UI layout.
        
        Args:
            input: The UI layout request.
        """
        # Load schema and catalog
        schema_manager = A2uiSchemaManager(schema_path)
        catalog = CatalogConfig.from_file(catalog_path)
        
        system_content = (
            "You are an A2UI expert. Generate strictly compliant A2UI JSON payloads for the requested UI. Return ONLY the JSON.\n\n"
            f"Schema:\n{schema_manager.schema}\n\n"
            f"Catalog:\n{catalog.to_json()}"
        )
        
        messages = [
            ChatMessageSystem(content=system_content),
            ChatMessageUser(content=input)
        ]
        
        output = await get_model().generate(messages)
        if output.completion:
            parts = parse_response(output.completion)
            a2ui_json_blocks = [part.a2ui_json for part in parts if part.a2ui_json is not None]
            return json.dumps(a2ui_json_blocks, indent=2)
            
        return ""
        
    return execute

@solver
def extract_subagent_payload() -> Solver:
    """Extracts the A2UI payload from the tool response messages."""
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        payload = None
        for msg in reversed(state.messages):
            if isinstance(msg, ChatMessageTool):
                payload = msg.text
                break
                
        if payload is not None and state.output and state.output.choices:
            state.output = ModelOutput(
                model=state.output.model,
                choices=[ChatCompletionChoice(message=ChatMessageAssistant(content=payload))]
            )
        return state
    return solve

def subagent_tool_solver(schema_path: str, catalog_path: str) -> list[Solver]:
    """Returns the solver chain for the 'subagent_tool' evaluation strategy."""
    return [
        system_message("You are a helpful assistant. To fulfill UI requests, you MUST delegate to the `a2ui_specialist` tool."),
        use_tools([a2ui_specialist(schema_path, catalog_path)]),
        measured_generate(),
        extract_subagent_payload()
    ]
