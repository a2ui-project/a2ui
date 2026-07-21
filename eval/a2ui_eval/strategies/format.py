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
from a2ui.inference_formats.transport import TransportFormat
from a2ui.inference_format import InferenceFormat
from ..shared.utils import GIT_ROOT, measured_generate


def _get_strategy(
    format_name: str,
    version: str,
    catalog_config: CatalogConfig,
    surface_id: str = "main",
) -> InferenceFormat:
    """Resolves and instantiates the InferenceFormat strategy for the given format.

    Args:
        format_name: The name of the format strategy (json, express, or elemental).
        version: The specification version (e.g. 0.9.1 or 1.0).
        catalog_config: The catalog configuration details.
        surface_id: The surface identifier target.

    Returns:
        The instantiated InferenceFormat strategy object.
    """
    transport_format = TransportFormat(
        version=version,
        catalogs=[catalog_config],
        experiments={"version_1_0"} if version == "1.0" else None,
    )
    if format_name == "json":
        return transport_format

    catalog = transport_format.get_selected_catalog()
    if format_name == "express":
        from a2ui.inference_formats.experimental.express.format import ExpressFormat

        return ExpressFormat(catalog=catalog, surface_id=surface_id)
    elif format_name == "elemental":
        from a2ui.inference_formats.experimental.elemental.format import ElementalFormat

        return ElementalFormat(catalog=catalog, surface_id=surface_id)
    else:
        raise ValueError(f"Unknown format strategy: {format_name}")


@solver
def format_system_prompt(format_name: str, version: str) -> Solver:
    """Injects system prompt instructions using the selected format strategy."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)

        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)
        strategy = _get_strategy(format_name, version, catalog_config)

        role_description = state.metadata.get("role_description", "")
        workflow_description = state.metadata.get("workflow_description", "")

        prompt = strategy.prompt_generator.generate(
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
            r"<(a2ui|body)\b[^>]*\bid\s*=\s*['\"]([^'\"]+)['\"]",
            completion,
            re.IGNORECASE,
        )
        if match:
            found_id = match.group(2)
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
            if isinstance(strategy, TransportFormat)
            else getattr(strategy, "catalog")
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
