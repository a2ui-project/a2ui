# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Subagent tool evaluation strategy.

The outer agent sees one tool, `a2ui_specialist`, and must delegate UI
requests to it. The specialist is a second model call with the full A2UI
prompt for `subagent_format`; its answer is parsed and validated by the Python
runner, retried up to `max_validation_retries` times with the validation error
fed back, and the compiled messages are handed back to the outer agent.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Mapping

from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessage,
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageUser,
    Model,
    ModelOutput,
    get_model,
)
from inspect_ai.solver import (
    Generate,
    Solver,
    TaskState,
    solver,
    system_message,
    use_tools,
)
from inspect_ai.tool import Tool, tool
from inspect_ai.util import store

from ..runner import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    RunnerOptions,
    generate_prompt,
    parse_and_validate,
    runner_options_from_metadata,
    validate_format,
)
from ..shared.utils import GIT_ROOT, measured_generate

PAYLOAD_STORE_KEY = "a2ui_payload"
SAMPLE_META_STORE_KEY = "a2ui_sample_meta"
DEFAULT_VERSION = "0.9.1"

# Keys the specialist writes into the sample metadata, copied back onto the
# `TaskState` by `extract_subagent_payload` so scorers and reports see them.
SPECIALIST_RESULT_KEYS = (
    "compiled_messages",
    "subagent_pass_at_1",
    "subagent_validation_retries_used",
)


def _environment_notes(subagent_format: str) -> str:
    """Notes that stop the specialist from calling tools or inventing catalog ids.

    The specialist has no tools, but sample instructions written for the outer
    agent can mention some. The catalog id notes are the ones
    `format_system_prompt` adds for Direct JSON, and like there they are only
    added for Direct JSON.
    """
    if subagent_format == "direct_json":
        payload = (
            "A2UI JSON payload enclosed in literal <a2ui-json> and </a2ui-json> tags"
        )
    else:
        payload = "A2UI payload enclosed in literal <a2ui> and </a2ui> tags"
    notes = (
        "## Environment Notes:\n"
        "- No external tools are available to you in this specialist"
        " environment. Even if the instructions above mention calling"
        " tools (such as data-fetching or app-fetching tools), do NOT call"
        " any tools or emit tool-call syntax; instead, directly construct"
        f" the complete {payload} using synthesized sample data."
    )
    if subagent_format != "direct_json":
        return notes
    return notes + (
        "\n- When specifying `catalogId` (in `createSurface` as the surface"
        " default, or on individual components and function calls), always"
        " use the exact `catalogId` value(s) defined in the provided"
        " Catalog Schema(s); never invent a custom or placeholder"
        " `catalogId` URL or identifier (such as `example.com`), even if"
        " the user prompt mentions a custom catalog.\n"
        "- In `createSurface`, set `catalogId` to the primary catalog ID"
        " as the surface default. Components or functions belonging to"
        " secondary catalogs must specify their own `catalogId`."
    )


def _specialist_system_prompt(
    sample_meta: Mapping[str, Any], snippet: str, subagent_format: str
) -> str:
    """Builds the specialist's system prompt around the runner's prompt snippet.

    The snippet is preceded by the sample's role and workflow and by the
    environment notes, and the result is wrapped in the sample's domain
    instructions when it has any.
    """
    prompt_parts = []
    role_description = sample_meta.get("protocol_role") or sample_meta.get(
        "role_description", ""
    )
    if role_description:
        prompt_parts.append(role_description)
    workflow_description = sample_meta.get("generation_rules") or sample_meta.get(
        "workflow_description", ""
    )
    if workflow_description:
        prompt_parts.append(f"## Workflow Description:\n{workflow_description}")
    prompt_parts.append(_environment_notes(subagent_format))
    prompt_parts.append(snippet)
    a2ui_prompt = "\n\n".join(prompt_parts)
    domain_prompt = str(sample_meta.get("system_prompt", "")).strip()
    if domain_prompt:
        return (
            f"## Domain Instructions\n{domain_prompt}\n\n## UI Protocol"
            f" Instructions\n{a2ui_prompt}"
        )
    return a2ui_prompt


def _retry_message(error: Exception, subagent_format: str) -> str:
    """The user turn that asks the specialist to fix a rejected answer."""
    tag = (
        "<a2ui-json>...</a2ui-json>"
        if subagent_format == "direct_json"
        else "<a2ui>...</a2ui>"
    )
    return (
        f"Your previous response was rejected: {error}\n\nFix the problem and"
        f" reply again with the complete, corrected payload enclosed in {tag}."
    )


async def _ask_specialist(
    model: Model,
    messages: list[ChatMessage],
    parse_args: dict[str, Any],
    max_validation_retries: int,
) -> tuple[list[Any], int]:
    """Runs the specialist until its answer validates or the retries run out.

    Args:
        model: The specialist model.
        messages: The specialist conversation; rejected answers and the error
            feedback are appended to it in place.
        parse_args: Keyword arguments for `parse_and_validate`, minus the
            completion.
        max_validation_retries: How many extra attempts a rejected answer gets.

    Returns:
        The compiled A2UI messages and the number of retries used.

    Raises:
        ValueError: If the last allowed attempt still fails validation.
    """
    retries_used = 0
    while True:
        output = await model.generate(messages)
        completion = output.completion or ""
        try:
            res_dict = await asyncio.to_thread(
                parse_and_validate, **parse_args, completion=completion
            )
            return list(res_dict.get("compiled_jsons", [])), retries_used
        except ValueError as e:
            if retries_used >= max_validation_retries:
                raise
            retries_used += 1
            messages.append(ChatMessageAssistant(content=completion))
            messages.append(
                ChatMessageUser(
                    content=_retry_message(e, str(parse_args["format_name"]))
                )
            )


@tool
def a2ui_specialist(
    subagent_format: str = "direct_json",
    version: str | None = None,
    max_validation_retries: int = 0,
) -> Tool:
    """The UI-generation tool the outer agent delegates to.

    Args:
        subagent_format: The inference format the specialist writes in,
            `direct_json` or `express`.
        version: The protocol version. None uses the sample's `version`
            metadata, then `0.9.1`.
        max_validation_retries: How many times a rejected answer is sent back
            to the specialist with the validation error.
    """
    validate_format(subagent_format)

    async def execute(input: str) -> str:  # pylint: disable=redefined-builtin
        """Generates strictly compliant A2UI JSON payloads. Call this tool when the user requests a UI layout.

        Args:
            input: The UI layout request.
        """
        sample_meta: dict[str, Any] = store().get(SAMPLE_META_STORE_KEY) or {}
        catalog_path = sample_meta.get("catalog")
        if not catalog_path:
            raise ValueError("Catalog path is missing from the store.")
        resolved_catalog_path = str(GIT_ROOT / catalog_path)
        effective_version = version or sample_meta.get("version") or DEFAULT_VERSION
        options: RunnerOptions = runner_options_from_metadata(
            sample_meta, resolved_catalog_path
        )
        allowed_surface_ids = sample_meta.get("allowed_surface_ids") or ["main"]

        generated_snippet = await asyncio.to_thread(
            generate_prompt,
            subagent_format,
            effective_version,
            resolved_catalog_path,
            options=options,
        )
        messages: list[ChatMessage] = [
            ChatMessageSystem(
                content=_specialist_system_prompt(
                    sample_meta, generated_snippet, subagent_format
                )
            ),
            ChatMessageUser(content=input),
        ]
        parse_args: dict[str, Any] = {
            "format_name": subagent_format,
            "version": effective_version,
            "resolved_catalog_path": resolved_catalog_path,
            "surface_id": allowed_surface_ids[0],
            "timeout_sec": DEFAULT_PARSE_TIMEOUT_SEC,
            "require_complete_tags": True,
            "validate": True,
            "options": options,
        }

        try:
            compiled, retries_used = await _ask_specialist(
                get_model(), messages, parse_args, max_validation_retries
            )
        except ValueError as e:
            sample_meta["subagent_pass_at_1"] = False
            sample_meta["subagent_validation_retries_used"] = max_validation_retries
            return (
                f"Error: Failed to generate a valid A2UI response: {str(e)}."
                " Please make sure your request describes the UI clearly."
            )
        except Exception as e:  # pylint: disable=broad-exception-caught
            sample_meta["subagent_pass_at_1"] = False
            sample_meta["subagent_validation_retries_used"] = 0
            return (
                f"Error: Failed to generate a valid A2UI response: {str(e)}."
                " Please make sure your request describes the UI clearly."
            )

        sample_meta["compiled_messages"] = compiled
        sample_meta["subagent_pass_at_1"] = retries_used == 0
        sample_meta["subagent_validation_retries_used"] = retries_used
        store().set(PAYLOAD_STORE_KEY, json.dumps(compiled, indent=2))
        return "Success: The UI has been generated and saved out-of-band."

    return execute


@solver
def push_metadata_to_store() -> Solver:
    """Shares the sample metadata with tools through the sample store.

    Tools cannot see the `TaskState`, so the specialist reads the catalog,
    role and workflow from the store and writes its results back into the
    same dictionary.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        state.store.set(SAMPLE_META_STORE_KEY, state.metadata)
        return state

    return solve


@solver
def extract_subagent_payload() -> Solver:
    """Extracts the A2UI payload from the tool response messages."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        sample_meta = state.store.get(SAMPLE_META_STORE_KEY) or {}
        for key in SPECIALIST_RESULT_KEYS:
            if key in sample_meta:
                state.metadata[key] = sample_meta[key]

        payload = state.store.get(PAYLOAD_STORE_KEY)
        if payload is not None and state.output and state.output.choices:
            formatted_payload = f"<a2ui-json>\n{payload}\n</a2ui-json>"
            state.output = ModelOutput(
                model=state.output.model,
                choices=[
                    ChatCompletionChoice(
                        message=ChatMessageAssistant(content=formatted_payload)
                    )
                ],
            )
        return state

    return solve


def subagent_tool_strategy(
    version: str | None = None,
    subagent_format: str = "direct_json",
    max_validation_retries: int = 0,
) -> list[Solver]:
    """Returns the solver chain for the 'subagent_tool' evaluation strategy.

    Args:
        version: The protocol version the specialist targets. None uses each
            sample's `version` metadata, then `0.9.1`.
        subagent_format: The inference format the specialist writes in,
            `direct_json` or `express`.
        max_validation_retries: How many times a rejected specialist answer is
            sent back with the validation error before the tool gives up.

    Returns:
        The list of solvers for the `subagent_tool` strategy.
    """
    validate_format(subagent_format)
    return [
        system_message(
            "You are a helpful assistant. To fulfill UI requests, you MUST"
            " delegate to the `a2ui_specialist` tool."
        ),
        push_metadata_to_store(),
        use_tools([
            a2ui_specialist(
                subagent_format=subagent_format,
                version=version,
                max_validation_retries=max_validation_retries,
            )
        ]),
        measured_generate(),
        extract_subagent_payload(),
    ]
