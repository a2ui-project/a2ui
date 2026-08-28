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

import asyncio
import json
import re
from typing import Any
from inspect_ai.solver import Solver, solver, TaskState, Generate
from inspect_ai.model import (
    ChatMessageSystem,
    ModelOutput,
    ChatCompletionChoice,
    ChatMessageAssistant,
)
from a2ui.schema.catalog import CatalogConfig
from a2ui.inference_formats.direct_json import DirectJsonFormat
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
        format_name: The name of the format strategy (direct_json, express, elemental, or atom).
        version: The specification version (e.g. 0.9.1 or 1.0).
        catalog_config: The catalog configuration details.
        surface_id: The surface identifier target.

    Returns:
        The instantiated InferenceFormat strategy object.
    """
    direct_json_format = DirectJsonFormat(
        version=version,
        catalogs=[catalog_config],
        experiments={"version_1_0"} if version == "1.0" else None,
    )
    if format_name == "direct_json":
        return direct_json_format

    catalog = direct_json_format.get_selected_catalog()
    formatted_version = f"v{version}" if not version.startswith("v") else version
    if format_name == "express":
        from a2ui.inference_formats.experimental.express.format import ExpressFormat

        return ExpressFormat(
            catalog=catalog, surface_id=surface_id, version=formatted_version
        )
    elif format_name == "elemental":
        from a2ui.inference_formats.experimental.elemental.format import ElementalFormat

        return ElementalFormat(catalog=catalog, surface_id=surface_id)
    elif format_name == "atom":
        from a2ui.inference_formats.experimental.atom.format import AtomFormat

        return AtomFormat(catalog=catalog, surface_id=surface_id)
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

        role_description = state.metadata.get("protocol_role") or state.metadata.get(
            "role_description", ""
        )
        workflow_description = state.metadata.get(
            "generation_rules"
        ) or state.metadata.get("workflow_description", "")

        a2ui_prompt = strategy.prompt_generator.generate(
            role_description=role_description,
            workflow_description=workflow_description,
            include_schema=True,
        )

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


import multiprocessing


def _parse_and_validate_in_process(
    format_name: str,
    version: str,
    resolved_catalog_path: str,
    surface_id: str,
    completion: str,
) -> dict[str, Any]:
    catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)
    strategy = _get_strategy(
        format_name,
        version,
        catalog_config,
        surface_id=surface_id,
    )
    catalog = (
        strategy.get_selected_catalog()
        if isinstance(strategy, DirectJsonFormat)
        else getattr(strategy, "catalog")
    )
    validator = catalog.validator

    parts = strategy.parser.parse_response(completion)
    compiled_jsons = []
    serialized_parts = []
    for p in parts:
        part_dict = {"text": p.text, "a2ui_json": getattr(p, "a2ui_json", None)}
        serialized_parts.append(part_dict)
        a2ui_json = getattr(p, "a2ui_json", None)
        if a2ui_json:
            if isinstance(a2ui_json, list):
                compiled_jsons.extend(a2ui_json)
            else:
                compiled_jsons.append(a2ui_json)

    if not compiled_jsons:
        raise ValueError(
            f"No compiled A2UI {format_name} user interface found in parsed parts."
        )

    validator.validate(compiled_jsons)
    return {"compiled_jsons": compiled_jsons, "parts": serialized_parts}


import traceback


def _process_target_wrapper(
    format_name: str,
    version: str,
    resolved_catalog_path: str,
    surface_id: str,
    completion: str,
    return_dict: dict,
):
    try:
        res = _parse_and_validate_in_process(
            format_name, version, resolved_catalog_path, surface_id, completion
        )
        return_dict["result"] = res
    except Exception as e:
        return_dict["error"] = f"{e}\n{traceback.format_exc()}"


def parse_with_hard_kill_timeout(
    format_name: str,
    version: str,
    resolved_catalog_path: str,
    surface_id: str,
    completion: str,
    timeout_sec: float = 5.0,
) -> dict[str, Any]:
    with multiprocessing.Manager() as manager:
        return_dict = manager.dict()
        p = multiprocessing.Process(
            target=_process_target_wrapper,
            args=(
                format_name,
                version,
                resolved_catalog_path,
                surface_id,
                completion,
                return_dict,
            ),
        )
        p.start()
        p.join(timeout=timeout_sec)
        if p.is_alive():
            p.kill()
            p.join()
            raise TimeoutError(
                f"Format compilation timed out after {timeout_sec}s and process was"
                " killed."
            )

        if "error" in return_dict:
            raise ValueError(return_dict["error"])
        if "result" not in return_dict:
            raise ValueError("Compilation produced no output.")
        return return_dict["result"]


@solver
def compile_format_payload(format_name: str, version: str) -> Solver:
    """Solver to compile format-specific output back to standard A2UI JSON."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
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

        try:
            res_dict = await asyncio.to_thread(
                parse_with_hard_kill_timeout,
                format_name,
                version,
                resolved_catalog_path,
                surface_id,
                completion,
                timeout_sec=5.0,
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
    if format_name != "direct_json":
        chain.append(compile_format_payload(format_name, version))
    return chain
