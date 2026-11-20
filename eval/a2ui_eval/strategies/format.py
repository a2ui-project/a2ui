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
from dataclasses import dataclass, field
import json
import re
from typing import Any

from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageUser,
    ModelOutput,
)
from inspect_ai.solver import Generate, Solver, TaskState, solver

from ..runner import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    RunnerOptions,
    generate_prompt,
    parse_and_validate,
    runner_options_from_metadata,
    validate_format,
)
from ..shared.utils import GIT_ROOT, measured_generate

_SURFACE_ID_PATTERN = re.compile(
    r"<(a2ui|body)\b[^>]*\bid\s*=\s*['\"]([^'\"]+)['\"]", re.IGNORECASE
)

# Metadata written by `measured_generate`; summed across validation retries.
_INFERENCE_METADATA_KEYS = (
    "inference_duration_seconds",
    "inference_input_tokens",
    "inference_output_tokens",
    "inference_cached_tokens",
    "inference_reasoning_tokens",
)


def _set_completion(state: TaskState, content: str) -> None:
    """Replaces the state's output with a single assistant completion."""
    model = state.output.model if state.output else str(state.model)
    state.output = ModelOutput(
        model=model,
        choices=[ChatCompletionChoice(message=ChatMessageAssistant(content=content))],
    )


@solver
def format_system_prompt(format_name: str, version: str) -> Solver:
    """Injects system prompt instructions using the selected format strategy."""
    validate_format(format_name)

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)
        options = runner_options_from_metadata(state.metadata, resolved_catalog_path)

        generated_snippet = await asyncio.to_thread(
            generate_prompt,
            format_name,
            version,
            resolved_catalog_path,
            options=options,
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


async def _generate_accumulating(
    state: TaskState, generate: Generate, measured: Solver
) -> TaskState:
    """Runs a measured generation, adding its cost to any earlier generation."""
    before = {k: state.metadata.get(k) or 0 for k in _INFERENCE_METADATA_KEYS}
    state = await measured(state, generate)
    for key, previous in before.items():
        state.metadata[key] = (state.metadata.get(key) or 0) + previous
    return state


@dataclass
class _CompileContext:
    """Per-sample inputs shared by every compile attempt."""

    format_name: str
    version: str
    resolved_catalog_path: str
    options: RunnerOptions
    allowed_surface_ids: list[str]


@dataclass
class _CompileResult:
    """Outcome of one parse-and-validate attempt."""

    formatted: str = ""
    compiled_jsons: list[Any] = field(default_factory=list)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


def _find_surface_id(completion: str, allowed_surface_ids: list[str]) -> str:
    """The surface ID named in the completion, or the first allowed one."""
    default_surface_id = allowed_surface_ids[0] if allowed_surface_ids else "main"
    match = _SURFACE_ID_PATTERN.search(completion)
    if match and match.group(2) in allowed_surface_ids:
        return match.group(2)
    return default_surface_id


def _format_output(res_dict: dict[str, Any]) -> tuple[str, list[Any]]:
    """Renders parse results as text with `<a2ui-json>` payload blocks."""
    compiled_jsons = res_dict.get("compiled_jsons", [])
    formatted_parts = []
    for p in res_dict.get("parts", []):
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
        formatted = f"<a2ui-json>\n{json.dumps(compiled_jsons, indent=2)}\n</a2ui-json>"
    return formatted, compiled_jsons


async def _attempt_compile(ctx: _CompileContext, completion: str) -> _CompileResult:
    """Parses and validates one completion, capturing any failure as text."""
    surface_id = _find_surface_id(completion, ctx.allowed_surface_ids)
    try:
        res_dict = await asyncio.to_thread(
            parse_and_validate,
            ctx.format_name,
            ctx.version,
            ctx.resolved_catalog_path,
            surface_id,
            completion,
            DEFAULT_PARSE_TIMEOUT_SEC,
            options=ctx.options,
        )
    except Exception as e:  # pylint: disable=broad-exception-caught
        return _CompileResult(error=str(e))
    formatted, compiled_jsons = _format_output(res_dict)
    return _CompileResult(formatted=formatted, compiled_jsons=compiled_jsons)


def _retry_prompt(error: str) -> str:
    return (
        f"Validation failed: {error}. Fix the A2UI payload and reply with the"
        " complete corrected payload only."
    )


@solver
def compile_format_payload(
    format_name: str,
    version: str,
    max_validation_retries: int = 0,
) -> Solver:
    """Compiles format-specific output back to standard A2UI JSON.

    On success the compiled messages are stored in
    `state.metadata["compiled_messages"]` so the scorer does not parse the
    completion again. With `max_validation_retries > 0`, a failed attempt
    sends the validation error back to the model and retries. `pass_at_1`,
    `pass_at_k` and `validation_retries_used` are recorded in the metadata.

    Args:
        format_name: The name of the format to compile from.
        version: The target A2UI protocol version.
        max_validation_retries: Maximum number of validation retries.

    Returns:
        A Solver step that compiles and validates the format payload.
    """
    validate_format(format_name)
    measured = measured_generate()

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        if not state.output or not state.output.completion:
            return state

        resolved_catalog_path = str(GIT_ROOT / state.metadata["catalog"])
        ctx = _CompileContext(
            format_name=format_name,
            version=version,
            resolved_catalog_path=resolved_catalog_path,
            options=runner_options_from_metadata(state.metadata, resolved_catalog_path),
            allowed_surface_ids=state.metadata.get("allowed_surface_ids", ["main"]),
        )

        completion = state.output.completion.strip()
        result = await _attempt_compile(ctx, completion)
        state.metadata["pass_at_1"] = result.ok

        retries_used = 0
        while not result.ok and retries_used < max_validation_retries:
            retries_used += 1
            state.messages.append(
                ChatMessageUser(content=_retry_prompt(result.error or ""))
            )
            state = await _generate_accumulating(state, generate, measured)
            completion = (
                state.output.completion
                if state.output is not None and state.output.completion
                else ""
            ).strip()
            result = await _attempt_compile(ctx, completion)

        state.metadata["pass_at_k"] = result.ok
        state.metadata["validation_retries_used"] = retries_used
        _apply_compile_result(state, result, completion)
        return state

    return solve


def _apply_compile_result(
    state: TaskState, result: _CompileResult, completion: str
) -> None:
    """Writes the final compile outcome into the state's output and metadata."""
    if result.ok:
        state.metadata["compiled_messages"] = result.compiled_jsons
        _set_completion(state, result.formatted)
        return
    _set_completion(
        state,
        f"Compilation/validation failed: {result.error}\nRaw output:\n{completion}",
    )


def format_solver(
    format_name: str,
    version: str,
    *,
    max_validation_retries: int = 0,
) -> list[Solver]:
    """Assembles the solver chain for the specified evaluation strategy.

    The chain is prompt injection, generation, then compilation. Compilation
    runs for every format, including Direct JSON, so the scorer can reuse
    `compiled_messages` and the retry loop applies uniformly.
    """
    validate_format(format_name)
    return [
        format_system_prompt(format_name, version),
        measured_generate(),
        compile_format_payload(
            format_name,
            version,
            max_validation_retries=max_validation_retries,
        ),
    ]
