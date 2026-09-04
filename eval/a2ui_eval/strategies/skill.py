# Copyright 2026 Google LLC
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

"""Skill evaluation strategies for A2UI replicating common agent harness patterns."""

from typing import Any, Optional
from inspect_ai.solver import (
    Generate,
    Solver,
    solver,
    TaskState,
    use_tools,
)
from inspect_ai.model import (
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageTool,
)
from inspect_ai.tool import tool, Tool
from inspect_ai.util import store

from a2ui.schema.catalog import CatalogConfig
from a2ui.skill.skill import Skill, SkillSet

from .format import _get_strategy, compile_format_payload
from ..shared.utils import GIT_ROOT, measured_generate


@tool
def load_skill() -> Tool:
    """Tool allowing models to fetch A2UI skills dynamically."""

    async def execute(skill_name: str) -> str:
        """Loads the full markdown content of a requested A2UI skill.

        Args:
            skill_name: The name of the skill to load (e.g. 'a2ui-core', 'a2ui-basic', 'a2ui').
        """
        version = store().get("version", "1.0")
        format_name = store().get("format_name", "express")
        catalog_path = store().get("catalog")

        if not catalog_path:
            raise ValueError("Catalog path missing from task store.")

        resolved_catalog_path = str(GIT_ROOT / catalog_path)
        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)

        strategy = _get_strategy(format_name, version, catalog_config)
        skill_set = SkillSet.from_format(strategy)

        # Normalize skill lookup key
        key = skill_name if skill_name.endswith("/SKILL.md") else f"{skill_name}/SKILL.md"
        skill = skill_set.get(key) or skill_set.get(skill_name)

        if skill:
            return skill.to_markdown()

        # Fallback to monolithic skill if requested
        if skill_name in ["a2ui", "a2ui/SKILL.md"]:
            mono_skill = Skill.from_format(strategy, name="a2ui")
            return mono_skill.to_markdown()

        available = list(skill_set.to_dict().keys())
        return f"Error: Skill '{skill_name}' not found. Available skills: {available}"

    return execute


@solver
def skill_preloaded_prompt(format_name: str, version: str) -> Solver:
    """Injects skill markdown into User Context as a pre-loaded skill (Passive Harness Proxy)."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)
        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)

        strategy = _get_strategy(format_name, version, catalog_config)
        skill = Skill.from_format(strategy, name="a2ui")

        domain_prompt = state.metadata.get("system_prompt", "").strip()
        state.messages.insert(
            0,
            ChatMessageSystem(
                content=domain_prompt
                or "You are an AI assistant. Help the user by generating user interfaces."
            ),
        )

        # Pre-load skill content directly into turn context (Antigravity / Vertex AI Harness Proxy)
        if state.messages and hasattr(state.messages[-1], "content"):
            user_msg = state.messages[-1]
            user_msg.content = (
                f"Here are the pre-loaded A2UI UI generation rules and component signatures:\n\n"
                f"{skill.to_markdown()}\n\n"
                f"User Request: {user_msg.content}"
            )

        return state

    return solve


@solver
def skill_interactive_system_prompt(format_name: str, version: str) -> Solver:
    """Injects system prompt with skill frontmatter only (Active Agent Tool Retrieval Proxy)."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)
        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)

        strategy = _get_strategy(format_name, version, catalog_config)
        skill_set = SkillSet.from_format(strategy)

        frontmatter_lines = []
        for sk_obj in skill_set.values():
            frontmatter_lines.append(f"- **{sk_obj.name}**: {sk_obj.description}")

        skills_summary = "\n".join(frontmatter_lines)
        system_content = (
            "You are a helpful AI assistant. You have access to specialized skills for UI generation.\n\n"
            "## Available Skills\n"
            f"{skills_summary}\n\n"
            "When the user requests a user interface, call the `load_skill` tool to retrieve the required syntax and signatures before producing the UI response."
        )

        domain_prompt = state.metadata.get("system_prompt", "").strip()
        if domain_prompt:
            system_content = f"{domain_prompt}\n\n{system_content}"

        state.messages.insert(0, ChatMessageSystem(content=system_content))

        # Push task metadata to store for tool access
        state.store.set("version", version)
        state.store.set("format_name", format_name)
        state.store.set("catalog", catalog_path)

        return state

    return solve


def skill_preloaded_solver(format_name: str = "express", version: str = "1.0") -> list[Solver]:
    """Returns the solver chain for the 'skill_preloaded' evaluation strategy (Pre-loaded Harness Proxy)."""
    return [
        skill_preloaded_prompt(format_name, version),
        measured_generate(),
        compile_format_payload(format_name, version),
    ]


def skill_interactive_tool_solver(format_name: str = "express", version: str = "1.0") -> list[Solver]:
    """Returns the solver chain for the 'skill_interactive_tool' evaluation strategy (Active Agent Retrieval Proxy)."""
    return [
        skill_interactive_system_prompt(format_name, version),
        use_tools([load_skill()]),
        measured_generate(),
        compile_format_payload(format_name, version),
    ]
