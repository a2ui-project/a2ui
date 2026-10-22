# Copyright 2024 Google LLC
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

"""Format-based solver strategies for A2UI evaluation."""

from __future__ import annotations

import asyncio
import json
import re

from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessageAssistant,
    ChatMessageSystem,
    ModelOutput,
)
from inspect_ai.solver import Generate, Solver, TaskState, solver

from ..bridges import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    get_sdk_bridge,
    validate_sdk_format,
)
from ..shared.utils import GIT_ROOT, measured_generate


@solver
def format_system_prompt(format_name: str, version: str, sdk: str = "python") -> Solver:
    """Injects system prompt instructions using the selected format strategy and SDK."""
    validate_sdk_format(sdk, format_name)

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)

        bridge = get_sdk_bridge(sdk)
        generated_snippet = await asyncio.to_thread(
            bridge.generate_prompt,
            format_name,
            version,
            resolved_catalog_path,
        )

        role_description = state.metadata.get("protocol_role") or state.metadata.get(
            "role_description", ""
        )
        workflow_description = state.metadata.get(
            "generation_rules"
        ) or state.metadata.get("workflow_description", "")

        prompt_parts = []
        if role_description:
            prompt_parts.append(role_description)
        if workflow_description:
            prompt_parts.append(f"## Workflow Description:\n{workflow_description}")
        if format_name == "direct_json":
            prompt_parts.append(
                "## Environment Notes:\n"
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
        a2ui_prompt = "\n\n".join(prompt_parts)

        domain_prompt = state.metadata.get("system_prompt", "").strip()
        if domain_prompt:
            full_prompt = (
                f"## Domain Instructions\n{domain_prompt}\n\n## UI Protocol"
                f" Instructions\n{a2ui_prompt}"
            )
        else:
            full_prompt = a2ui_prompt

        state.messages.insert(0, ChatMessageSystem(content=full_prompt))
        return state

    return solve


@solver
def compile_format_payload(
    format_name: str, version: str, sdk: str = "python"
) -> Solver:
    """Solver to compile format-specific output back to standard A2UI JSON."""
    validate_sdk_format(sdk, format_name)

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        if not state.output or not state.output.completion:
            return state

        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)

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

        bridge = get_sdk_bridge(sdk)
        try:
            res_dict = await asyncio.to_thread(
                bridge.parse_and_validate,
                format_name,
                version,
                resolved_catalog_path,
                surface_id,
                completion,
                DEFAULT_PARSE_TIMEOUT_SEC,
            )

            compiled_jsons = res_dict.get("compiled_jsons", [])
            parts = res_dict.get("parts", [])

            formatted_parts = []
            for p in parts:
                text_part = p.get("text")
                if text_part:
                    formatted_parts.append(text_part)
                json_part = p.get("a2ui_json")
                if json_part:
                    formatted_parts.append(
                        f"<a2ui-json>\n{json.dumps(json_part, indent=2)}\n</a2ui-json>"
                    )

            formatted = "\n\n".join(formatted_parts).strip()
            if "<a2ui-json>" not in formatted:
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

        except Exception as e:  # pylint: disable=broad-exception-caught
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


def format_solver(format_name: str, version: str, sdk: str = "python") -> list[Solver]:
    """Assembles the solver chain for the specified evaluation strategy."""
    validate_sdk_format(sdk, format_name)
    chain = [
        format_system_prompt(format_name, version, sdk=sdk),
        measured_generate(),
    ]
    if format_name != "direct_json":
        chain.append(compile_format_payload(format_name, version, sdk=sdk))
    return chain
