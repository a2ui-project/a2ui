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

"""Evaluation strategy for A2UI Elemental."""

import json
import os
import re

# Enable experimental extensions
os.environ["A2UI_EXPRESS_ENABLED"] = "true"

from inspect_ai.solver import Solver, solver, TaskState, Generate
from inspect_ai.model import ChatMessageSystem, ModelOutput, ChatCompletionChoice, ChatMessageAssistant
from a2ui.core.catalog import Catalog
from a2ui.experimental.elemental.prompt_generator import ElementalPromptGenerator
from a2ui.experimental.elemental.parser import parse_elemental_response
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.schema.catalog import CatalogConfig
from ..shared.utils import GIT_ROOT, measured_generate


@solver
def a2ui_elemental_prompt(version: str) -> Solver:
    """Solver to inject A2UI Elemental prompt contract instructions."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)
        with open(resolved_catalog_path, "r", encoding="utf-8") as f:
            schema = json.load(f)
        catalog = Catalog.from_json(schema, spec_version=version)
        generator = ElementalPromptGenerator(catalog)
        prompt = generator.generate_prompt()
        state.messages.insert(0, ChatMessageSystem(content=prompt))
        return state

    return solve


@solver
def compile_elemental_dsl(version: str) -> Solver:
    """Solver to compile generated A2UI Elemental HTML back to standard JSON."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        if not state.output or not state.output.completion:
            return state

        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)

        # Initialize the catalog schema validator for parsing and validation
        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)
        manager = A2uiSchemaManager(version=version, catalogs=[catalog_config])
        catalog = manager.get_selected_catalog()
        validator = catalog.validator

        completion = state.output.completion.strip()

        # Try to extract target surface ID from the prompt input
        prompt_text = state.input_text
        surface_id_match = re.search(
            r"surface(?:Id|\s+Id)?(?:\s+of)?\s+['\"]([^'\"]+)['\"]",
            prompt_text,
            re.IGNORECASE,
        )
        surface_id = surface_id_match.group(1) if surface_id_match else "main"

        try:
            # 1. Parse and compile HTML to JSON
            parts = parse_elemental_response(completion, catalog, surface_id=surface_id)
            compiled_jsons = []
            for p in parts:
                if p.a2ui_json:
                    if isinstance(p.a2ui_json, list):
                        compiled_jsons.extend(p.a2ui_json)
                    else:
                        compiled_jsons.append(p.a2ui_json)

            if not compiled_jsons:
                raise ValueError(
                    "No compiled A2UI Elemental JSON payload found in parsed parts."
                )

            # 2. Validate using catalog schema validator (runs integrity checker too)
            validator.validate(compiled_jsons)

            # 3. Successful compilation and validation: format and yield
            formatted = (
                f"<a2ui-json>\n{json.dumps(compiled_jsons, indent=2)}\n</a2ui-json>"
            )
            state.output = ModelOutput(
                model=state.output.model,
                choices=[
                    ChatCompletionChoice(
                        message=ChatMessageAssistant(content=formatted)
                    )
                ],
            )

        except Exception as e:
            state.output = ModelOutput(
                model=state.output.model,
                choices=[
                    ChatCompletionChoice(
                        message=ChatMessageAssistant(
                            content=(
                                f"Compilation/validation failed: {e}\nRaw"
                                f" output:\n{completion}"
                            )
                        )
                    )
                ],
            )

        return state

    return solve


def elemental_solver(version: str) -> list[Solver]:
    """Returns the solver chain for the 'elemental' evaluation strategy."""
    return [
        a2ui_elemental_prompt(version),
        measured_generate(),
        compile_elemental_dsl(version),
    ]
