import json
from inspect_ai.solver import Solver, solver, TaskState, Generate, use_tools, system_message
from inspect_ai.model import ChatMessageSystem, ChatMessageTool, get_model
from inspect_ai.agent import Agent, agent, as_tool
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.schema.catalog import CatalogConfig
from a2ui.parser.parser import parse_response
from ..shared.utils import WORKFLOW_OVERRIDE, measured_generate

from .direct import a2ui_system_prompt

A2UI_PAYLOAD_STORE_KEY = "a2ui_subagent_payload"

@agent(name="a2ui_specialist", description="Generates strictly compliant A2UI JSON payloads. Call this tool when the user requests a UI layout.")
def a2ui_specialist(schema_path: str, catalog_path: str) -> Agent:
    """Specialist subagent that handles generating A2UI JSON."""

    async def execute(state: TaskState) -> TaskState:
        # Reuse the system prompt solver from the direct strategy
        system_prompt_solver = a2ui_system_prompt(
            schema_path=schema_path,
            catalog_path=catalog_path,
            role_description="You are an A2UI expert. Generate strictly compliant A2UI JSON payloads for the requested UI. Return ONLY the JSON."
        )
        # Apply the solver directly to our subagent's task state
        state = await system_prompt_solver(state, None)
        
        state.output = await get_model().generate(state.messages)
        state.messages.append(state.output.message)
        
        # Parse and isolate the A2UI JSON payload
        if state.output and state.output.completion:
            parts = parse_response(state.output.completion)
            a2ui_json_blocks = [part.a2ui_json for part in parts if part.a2ui_json is not None]
            payload = json.dumps(a2ui_json_blocks, indent=2)
            state.output.completion = payload
            # Save it to the shared Inspect AI TaskState store
            state.store.set(A2UI_PAYLOAD_STORE_KEY, payload)
            
        return state
        
    return execute

@solver
def extract_subagent_payload() -> Solver:
    """Extracts the A2UI payload from the shared sample storage."""
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        payload = state.store.get(A2UI_PAYLOAD_STORE_KEY)
        if payload is not None:
            state.output.completion = payload
        return state
    return solve

def subagent_tool_solver(schema_path: str, catalog_path: str) -> list[Solver]:
    """Returns the solver chain for the 'subagent_tool' evaluation strategy."""
    return [
        system_message("You are a helpful assistant. To fulfill UI requests, you MUST delegate to the `a2ui_specialist` tool."),
        use_tools([as_tool(a2ui_specialist(schema_path, catalog_path))]),
        measured_generate(),
        extract_subagent_payload()
    ]
