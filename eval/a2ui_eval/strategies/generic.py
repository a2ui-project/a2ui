# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import json
import re
from inspect_ai.solver import Solver, solver, TaskState, Generate
from inspect_ai.model import (
    ChatMessageSystem,
    ModelOutput,
    ChatCompletionChoice,
    ChatMessageAssistant,
)
from a2ui.schema.catalog import CatalogConfig
from a2ui.strategies.schema import A2uiSchemaManager
from a2ui.inference_strategy import InferenceStrategy
from ..shared.utils import GIT_ROOT, measured_generate


def _get_strategy(
    format_name: str,
    version: str,
    catalog_config: CatalogConfig,
    surface_id: str = "main",
) -> InferenceStrategy:
    manager = A2uiSchemaManager(
        version=version,
        catalogs=[catalog_config],
        experiments={"version_1_0"},
    )
    if format_name == "json":
        return manager

    catalog = manager.get_selected_catalog()
    if format_name == "express":
        from a2ui.experimental.express.strategy import ExpressInferenceStrategy

        return ExpressInferenceStrategy(catalog=catalog, surface_id=surface_id)
    elif format_name == "elemental":
        from a2ui.experimental.elemental.strategy import ElementalInferenceStrategy

        return ElementalInferenceStrategy(catalog=catalog, surface_id=surface_id)
    else:
        raise ValueError(f"Unknown format strategy: {format_name}")


@solver
def format_system_prompt(format_name: str, version: str) -> Solver:
    """Solver to inject system prompt instructions using the selected format strategy."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)

        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)
        strategy = _get_strategy(format_name, version, catalog_config)

        role_description = state.metadata.get("role_description", "")
        workflow_description = state.metadata.get("workflow_description", "")

        prompt = strategy.generate_system_prompt(
            role_description=role_description,
            workflow_description=workflow_description,
            include_schema=True,
        )
        state.messages.insert(0, ChatMessageSystem(content=prompt))
        return state

    return solve


@solver
def compile_format_payload(format_name: str, version: str) -> Solver:
    """Solver to compile format-specific output back to standard A2UI JSON."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        if not state.output or not state.output.completion:
            return state

        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)

        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)
        completion = state.output.completion.strip()

        allowed_surface_ids = state.metadata.get("allowed_surface_ids", ["main"])
        default_surface_id = allowed_surface_ids[0] if allowed_surface_ids else "main"

        surface_id = default_surface_id
        match = re.search(
            r"<a2ui\b[^>]*\bid=['\"]([^'\"]+)['\"]", completion, re.IGNORECASE
        )
        if match:
            found_id = match.group(1)
            if found_id in allowed_surface_ids:
                surface_id = found_id

        strategy = _get_strategy(
            format_name,
            version,
            catalog_config,
            surface_id=surface_id,
        )
        catalog = (
            strategy.get_selected_catalog()
            if isinstance(strategy, A2uiSchemaManager)
            else strategy.catalog
        )
        validator = catalog.validator

        try:
            parts = strategy.parser.parse_response(completion)
            compiled_jsons = []
            for p in parts:
                a2ui_json = getattr(p, "a2ui_json", None)
                if a2ui_json:
                    if isinstance(a2ui_json, list):
                        compiled_jsons.extend(a2ui_json)
                    else:
                        compiled_jsons.append(a2ui_json)

            if not compiled_jsons:
                raise ValueError(
                    f"No compiled A2UI {format_name} user interface found "
                    "in parsed parts."
                )

            validator.validate(compiled_jsons)

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


def format_solver(format_name: str, version: str) -> list[Solver]:
    """Assembles the solver chain for the specified evaluation strategy."""
    chain = [
        format_system_prompt(format_name, version),
        measured_generate(),
    ]
    if format_name != "json":
        chain.append(compile_format_payload(format_name, version))
    return chain
