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

"""Skill-mode evaluation strategy.

Instead of putting the whole A2UI prompt in the system message, this strategy
tells the model which skills exist (`a2ui-core` plus one `a2ui-<catalog>` skill
per catalog) and gives it a `read_a2ui_skill` tool to load the ones it needs.
The skills are built with the Python SDK's `SkillGenerator`, so their text
matches what an agent developer would ship from `a2ui.skill`.
"""

from __future__ import annotations

import asyncio
from typing import Any, Mapping

from a2ui.skill import SkillGenerator
from inspect_ai.model import ChatMessageSystem
from inspect_ai.solver import Generate, Solver, TaskState, solver, use_tools
from inspect_ai.tool import Tool, tool
from inspect_ai.util import store

from ..runner import (
    build_catalogs_and_examples,
    get_python_strategy,
    runner_options_from_metadata,
    validate_format,
)
from ..shared.utils import GIT_ROOT, measured_generate
from .format import compile_format_payload

SKILLS_STORE_KEY = "a2ui_skills"
SKILLS_READ_STORE_KEY = "a2ui_skills_read"
CORE_SKILL_NAME = "a2ui-core"


def build_skills(
    format_name: str,
    version: str,
    metadata: Mapping[str, Any],
    resolved_catalog_path: str,
) -> dict[str, tuple[str, str]]:
    """Builds the skill set a sample's catalogs call for.

    Args:
        format_name: The inference format the skills teach.
        version: The protocol version the catalogs and format target.
        metadata: The sample metadata (`catalog_specs`, `allowed_messages`,
            `allowed_surface_ids` are read).
        resolved_catalog_path: The absolute catalog path used when the sample
            names no `catalog_specs`.

    Returns:
        Skill name to `(description, markdown)`, with `a2ui-core` first.
    """
    options = runner_options_from_metadata(metadata, resolved_catalog_path)
    # The same loader the Python runner uses, so pruning and few-shot examples
    # shape the skills exactly as they shape the monolithic prompt.
    catalogs, examples = build_catalogs_and_examples(
        resolved_catalog_path, version, options.to_dict()
    )
    surface_ids = metadata.get("allowed_surface_ids") or ["main"]
    fmt = get_python_strategy(
        format_name,
        version,
        catalogs,
        surface_id=surface_ids[0],
        examples=examples,
        allowed_messages=options.allowed_messages,
    )
    skill_set = SkillGenerator(fmt).generate_skillset(
        catalogs, core_name=CORE_SKILL_NAME
    )
    return {
        skill.name: (skill.description, skill.to_markdown())
        for skill in skill_set.values()
    }


def _skill_index_prompt(
    format_name: str, version: str, skills: Mapping[str, tuple[str, str]]
) -> str:
    """The short protocol section that replaces the full A2UI prompt."""
    tag = (
        "<a2ui-json>...</a2ui-json>"
        if format_name == "direct_json"
        else "<a2ui>...</a2ui>"
    )
    lines = [
        "## A2UI Skills",
        (
            f"You answer UI requests in the A2UI `{format_name}` format (protocol"
            f" version {version}). The format rules and component catalogs are"
            " not in this prompt. Before writing any UI, call `read_a2ui_skill`"
            " with the name of each skill you need, starting with"
            f" `{CORE_SKILL_NAME}`, and follow the loaded instructions exactly."
            f" Then reply with the UI enclosed in {tag}."
        ),
        "",
        "Available skills:",
    ]
    lines.extend(f"- `{name}`: {desc}" for name, (desc, _) in skills.items())
    return "\n".join(lines)


def _wrap_with_sample_text(metadata: Mapping[str, Any], protocol_prompt: str) -> str:
    """Adds the sample's role, workflow and domain text as `format_system_prompt` does."""
    role_description = metadata.get("protocol_role") or metadata.get(
        "role_description", ""
    )
    workflow_description = metadata.get("generation_rules") or metadata.get(
        "workflow_description", ""
    )
    prompt_parts = []
    if role_description:
        prompt_parts.append(role_description)
    if workflow_description:
        prompt_parts.append(f"## Workflow Description:\n{workflow_description}")
    prompt_parts.append(protocol_prompt)
    a2ui_prompt = "\n\n".join(prompt_parts)

    domain_prompt = str(metadata.get("system_prompt", "")).strip()
    if domain_prompt:
        return (
            f"## Domain Instructions\n{domain_prompt}\n\n## UI Protocol"
            f" Instructions\n{a2ui_prompt}"
        )
    return a2ui_prompt


@solver
def skill_mode_system_prompt(format_name: str, version: str) -> Solver:
    """Injects the skill index prompt and shares the skills with the tool."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        resolved_catalog_path = str(GIT_ROOT / state.metadata["catalog"])
        skills = await asyncio.to_thread(
            build_skills,
            format_name,
            version,
            state.metadata,
            resolved_catalog_path,
        )
        state.store.set(
            SKILLS_STORE_KEY, {name: text for name, (_, text) in skills.items()}
        )
        state.store.set(SKILLS_READ_STORE_KEY, [])
        prompt = _wrap_with_sample_text(
            state.metadata, _skill_index_prompt(format_name, version, skills)
        )
        state.messages.insert(0, ChatMessageSystem(content=prompt))
        return state

    return solve


@tool
def read_a2ui_skill() -> Tool:
    """The tool that loads one A2UI skill's instructions on demand."""

    async def execute(skill_name: str) -> str:
        """Loads the instructions of one A2UI skill. Call it before writing any UI.

        Args:
            skill_name: The skill to load, one of the names listed in the system prompt.
        """
        skills: dict[str, str] = store().get(SKILLS_STORE_KEY) or {}
        text = skills.get(skill_name)
        if text is None:
            valid = ", ".join(f"`{name}`" for name in skills)
            return f"Error: unknown skill '{skill_name}'. Valid skill names: {valid}."
        skills_read: list[str] = list(store().get(SKILLS_READ_STORE_KEY) or [])
        if skill_name not in skills_read:
            skills_read.append(skill_name)
        store().set(SKILLS_READ_STORE_KEY, skills_read)
        return text

    return execute


@solver
def record_skills_read() -> Solver:
    """Copies the names of the skills the model loaded into the sample metadata."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        state.metadata["skills_read"] = list(
            state.store.get(SKILLS_READ_STORE_KEY) or []
        )
        return state

    return solve


def skill_mode_strategy(
    format_name: str = "express",
    version: str = "1.0",
    max_validation_retries: int = 0,
) -> list[Solver]:
    """Returns the solver chain for the 'skill_mode' evaluation strategy.

    Args:
        format_name: The inference format the model answers in.
        version: The protocol version.
        max_validation_retries: Self-retry budget for the compile step.

    Returns:
        The list of solvers for the `skill_mode` strategy.
    """
    validate_format(format_name)
    return [
        skill_mode_system_prompt(format_name, version),
        use_tools([read_a2ui_skill()]),
        measured_generate(),
        record_skills_read(),
        compile_format_payload(
            format_name,
            version,
            max_validation_retries=max_validation_retries,
        ),
    ]
