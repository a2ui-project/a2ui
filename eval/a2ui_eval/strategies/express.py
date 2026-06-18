# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import json
import os
os.environ["A2UI_EXPRESS_ENABLED"] = "true"
from inspect_ai.solver import Solver, solver, TaskState, Generate
from inspect_ai.model import ChatMessageSystem, ModelOutput, ChatCompletionChoice, ChatMessageAssistant, ChatMessageUser
from a2ui.express.prompt_generator import ExpressPromptGenerator
from a2ui.express.compiler import ExpressCompiler
from ..shared.utils import measured_generate

@solver
def a2ui_express_prompt(catalog_path: str) -> Solver:
    """Solver to inject A2UI Express prompt contract instructions."""
    generator = ExpressPromptGenerator(catalog_path)
    prompt = generator.generate_prompt()

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        state.messages.insert(0, ChatMessageSystem(content=prompt))
        for message in state.messages:
            if message.role == "user" and isinstance(message.content, str):
                content = message.content
                content = re.sub(
                    r"(?i)generate a JSON message containing a?|generate a JSON payload containing a?",
                    "Generate a",
                    content
                )
                content = re.sub(
                    r"(?i)generate a JSON message|generate a JSON payload",
                    "generate A2UI Express DSL",
                    content
                )
                content = re.sub(
                    r"(?i)generate a? 'createSurface' message (?:and|followed by) a? 'updateComponents' message",
                    "generate A2UI Express DSL",
                    content
                )
                content = re.sub(
                    r"(?i)generate a? 'createSurface' (?:message )?and a? 'updateComponents' (?:message)?",
                    "generate A2UI Express DSL",
                    content
                )
                content = re.sub(
                    r"(?i)generate 'createSurface' and 'updateComponents' messages?",
                    "generate A2UI Express DSL",
                    content
                )
                message.content = (
                    "Translate the following request into A2UI Express DSL wrapped inside <a2ui> and </a2ui> sentinels:\n\n"
                    + content
                    + "\n\nREMINDER: You must output ONLY A2UI Express DSL wrapped in <a2ui> and </a2ui> sentinels. "
                    "Do NOT output JSON or <a2ui-json> blocks under any circumstances. Directly generating JSON will fail compilation."
                )
        print("MESSAGES PATH:", [(m.role, m.content[:40]) for m in state.messages])
        return state
        
    return solve

import re

@solver
def compile_express_dsl(catalog_path: str) -> Solver:
    """Solver to compile generated A2UI Express DSL back to standard JSON."""
    compiler = ExpressCompiler(catalog_path)

    # Initialize the catalog schema validator for parsing
    from a2ui.schema.manager import A2uiSchemaManager
    from a2ui.schema.catalog import CatalogConfig
    catalog_config = CatalogConfig.from_path("basic_catalog", catalog_path)
    manager = A2uiSchemaManager(version="1.0", catalogs=[catalog_config])
    catalog = manager.get_selected_catalog()
    validator = catalog.validator

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        if not state.output or not state.output.completion:
            return state

        completion = state.output.completion.strip()

        # Try to extract target surface ID from the prompt input
        prompt_text = state.input if isinstance(state.input, str) else str(state.input)
        surface_id_match = re.search(
            r"surface(?:Id|\s+Id)?(?:\s+of)?\s+['\"]([^'\"]+)['\"]",
            prompt_text,
            re.IGNORECASE
        )
        surface_id = surface_id_match.group(1) if surface_id_match else "main"

        # Extract DSL content inside <a2ui> tags if present, or clean markdown blocks
        dsl_content = completion
        if "<a2ui>" in completion:
            start_idx = completion.find("<a2ui>") + len("<a2ui>")
            end_idx = completion.find("</a2ui>")
            if end_idx != -1:
                dsl_content = completion[start_idx:end_idx].strip()
            else:
                dsl_content = completion[start_idx:].strip()
        else:
            if dsl_content.startswith("```"):
                lines = dsl_content.splitlines()
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                dsl_content = "\n".join(lines).strip()

        try:
            # 1. Compile DSL to JSON
            compiled_json = compiler.compile(dsl_content, surface_id=surface_id)
            
            # 2. Validate using catalog schema validator (runs integrity checker too)
            validator.validate([compiled_json])

            # 3. Successful compilation and validation: format and yield
            messages = [compiled_json]
            formatted = f"<a2ui-json>\n{json.dumps(messages, indent=2)}\n</a2ui-json>"
            state.output = ModelOutput(
                model=state.output.model,
                choices=[ChatCompletionChoice(message=ChatMessageAssistant(content=formatted))]
            )

        except Exception as e:
            state.output = ModelOutput(
                model=state.output.model,
                choices=[ChatCompletionChoice(message=ChatMessageAssistant(
                    content=f"Compilation/validation failed: {e}\nRaw output:\n{dsl_content}"
                ))]
            )

        return state

    return solve

def express_solver(schema_path: str, catalog_path: str) -> list[Solver]:
    """Returns the solver chain for the 'express' evaluation strategy."""
    return [
        a2ui_express_prompt(catalog_path),
        measured_generate(),
        compile_express_dsl(catalog_path)
    ]
