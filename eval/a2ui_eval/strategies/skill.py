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

"""Skill evaluation strategies for A2UI, modelled on how agent harnesses load SKILL.md.

These solvers measure how well a model generates A2UI when its instructions come
from skills produced by the `SkillGenerator` API rather than from a system prompt
(e.g. the `express` strategy).

How the reference harnesses load skills
=======================================

Google Antigravity, Claude Code, OpenAI Codex and LangChain Deep Agents all use
the same "progressive disclosure" pattern by default: only each skill's `name`
and `description` frontmatter is placed in context up front, and the model reads
the full SKILL.md when it decides a skill is relevant.

- Google Antigravity: "when a conversation starts, the agent sees a list of
  available skills with their names and descriptions ... if a skill looks
  relevant to your task, the agent reads the full SKILL.md content."
  https://antigravity.google/docs/skills/ ("How the agent uses skills")
- Claude Code: "skill descriptions are loaded into context so Claude knows
  what's available, but full skill content only loads when invoked."
  https://code.claude.com/docs/en/skills
  Anthropic states the name and description go into the system prompt:
  https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- OpenAI Codex: "Codex start[s] with each skill's name and description, then
  load[s] the full SKILL.md instructions when they decide to use that skill."
  https://developers.openai.com/codex/skills
  In the source, the catalog is a `developer`-role message and a selected
  skill's full contents are injected as a `user`-role message:
  https://github.com/openai/codex/blob/8bd5a136ffabf5cd4868f9eb8aff298d1f25d8ef/codex-rs/ext/skills/src/fragments.rs#L39-L79
- LangChain Deep Agents: the middleware "injects the name and description fields
  into the system prompt" and "when the agent invokes a skill, it reads the full
  SKILL.md content via read_file."
  https://docs.langchain.com/oss/python/deepagents/skills ("How skills work")

===================================================================================
1. `skill_interactive_tool` (on-demand loading, the default in all four harnesses)
===================================================================================

The system message lists each skill's name and description and tells the model
to call `load_skill`. The model fetches the full SKILL.md through a tool call and
then produces the UI. `load_skill` stands in for the harness's file read or
skill tool.

Context structure:
  ```
  +-------------------------------------------------------------------------------+
  | [System] ChatMessageSystem                                                    |
  |   <domain prompt from dataset, if any>                                        |
  |   You are a helpful AI assistant. You have access to specialized skills for   |
  |   UI generation.                                                              |
  |   ## Available Skills                                                         |
  |   - **a2ui-core**: <description>                                              |
  |   - **a2ui-0.9**: <description>                                               |
  |   When the user requests a user interface, call the `load_skill` tool ...     |
  +-------------------------------------------------------------------------------+
  | [User] ChatMessageUser                                                        |
  |   <original task prompt from dataset, unmodified>                             |
  +-------------------------------------------------------------------------------+
  | [Assistant] tool call: load_skill(skill_name="a2ui-core")                     |
  +-------------------------------------------------------------------------------+
  | [Tool] ChatMessageTool                                                        |
  |   <full SKILL.md markdown for a2ui-core>                                      |
  +-------------------------------------------------------------------------------+
  | (optional further load_skill calls, e.g. "a2ui-0.9")                          |
  +-------------------------------------------------------------------------------+
  | [Assistant] <a2ui> ... generated UI payload ... </a2ui>                       |
  +-------------------------------------------------------------------------------+
  ```

===================================================================================
2. `skill_preloaded` (skill already selected, full content in the user turn)
===================================================================================

None of the four harnesses preloads full SKILL.md content by default. This
strategy models the case where the skill is already known to apply, so its full
content is in context before the model runs, e.g.:

- Codex, when a skill is selected for the turn (such as a `$skill-name`
  mention): the full SKILL.md is injected as a `user`-role `<skill>` message.
  https://github.com/openai/codex/blob/8bd5a136ffabf5cd4868f9eb8aff298d1f25d8ef/codex-rs/ext/skills/src/fragments.rs#L76-L79
- Claude Code subagents with preloaded skills: "the full skill content is
  injected at startup." https://code.claude.com/docs/en/skills

It also acts as an upper bound for skill-based inference, since it removes the
skill selection and tool-calling steps.

Context structure (single turn; the dataset prompt is kept at the end of the user
message):
  ```
  +-------------------------------------------------------------------------------+
  | [System] ChatMessageSystem                                                    |
  |   <domain prompt from dataset>, or if absent:                                 |
  |   "You are an AI assistant. Help the user by generating user interfaces."     |
  +-------------------------------------------------------------------------------+
  | [User] ChatMessageUser                                                        |
  |   Here are the pre-loaded A2UI UI generation rules and component signatures:  |
  |   ---                                                                         |
  |   name: a2ui                                                                  |
  |   description: <description>                                                  |
  |   ---                                                                         |
  |   <full monolithic SKILL.md body: protocol rules + catalog signatures>        |
  |                                                                               |
  |   User Request: <original task prompt from dataset>                           |
  +-------------------------------------------------------------------------------+
  | [Assistant] <a2ui> ... generated UI payload ... </a2ui>                       |
  +-------------------------------------------------------------------------------+
  ```
"""

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
    ChatMessageUser,
)
from inspect_ai.tool import tool, Tool
from inspect_ai.util import store

from a2ui.schema.catalog import CatalogConfig
from a2ui.skill import SkillGenerator

from .format import _get_strategy, compile_format_payload
from ..shared.utils import GIT_ROOT, measured_generate


@tool
def load_skill() -> Tool:
    """Tool allowing models to fetch A2UI skills dynamically.

    Stands in for the file read or skill tool that harnesses such as Antigravity,
    Claude Code, Codex and Deep Agents use to read a full SKILL.md on demand.
    """

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
        generator = SkillGenerator(strategy)
        skill_set = generator.generate_skillset()

        # Normalize skill lookup key
        key = (
            skill_name if skill_name.endswith("/SKILL.md") else f"{skill_name}/SKILL.md"
        )
        skill = skill_set.get(key) or skill_set.get(skill_name)

        if skill:
            return skill.to_markdown()

        # Fallback to monolithic skill if requested
        if skill_name in ["a2ui", "a2ui/SKILL.md"]:
            mono_skill = generator.generate_skill(name="a2ui")
            return mono_skill.to_markdown()

        available = list(skill_set.to_dict().keys())
        return f"Error: Skill '{skill_name}' not found. Available skills: {available}"

    return execute


@solver
def skill_preloaded_prompt(format_name: str, version: str) -> Solver:
    """Prepends the full monolithic skill markdown to the user turn (skill already selected).

    Context layout:
    - System message: Domain prompt / role instructions.
    - User message: Full skill markdown prepended directly to the user's task prompt.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)
        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)

        strategy = _get_strategy(format_name, version, catalog_config)
        generator = SkillGenerator(strategy)
        skill = generator.generate_skill(name="a2ui")

        domain_prompt = state.metadata.get("system_prompt", "").strip()
        state.messages.insert(
            0,
            ChatMessageSystem(
                content=domain_prompt
                or "You are an AI assistant. Help the user by generating user interfaces."
            ),
        )

        # Prepend the full skill to the user turn, keeping the original request at the end.
        if len(state.messages) > 1 and hasattr(state.messages[-1], "content"):
            user_msg = state.messages[-1]
            user_msg.content = (
                "Here are the pre-loaded A2UI UI generation rules and component"
                f" signatures:\n\n{skill.to_markdown()}\n\nUser Request:"
                f" {user_msg.content}"
            )

        return state

    return solve


@solver
def skill_interactive_system_prompt(format_name: str, version: str) -> Solver:
    """Lists skill names and descriptions in the system prompt (on-demand loading).

    Context layout:
    - System message: Descriptions of available skills + directive to call `load_skill`.
    - User message: Original user prompt (unmodified).
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)
        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)

        strategy = _get_strategy(format_name, version, catalog_config)
        generator = SkillGenerator(strategy)
        skill_set = generator.generate_skillset()

        frontmatter_lines = []
        for sk_obj in skill_set.values():
            frontmatter_lines.append(f"- **{sk_obj.name}**: {sk_obj.description}")

        skills_summary = "\n".join(frontmatter_lines)
        system_content = (
            "You are a helpful AI assistant. You have access to specialized skills for"
            f" UI generation.\n\n## Available Skills\n{skills_summary}\n\nWhen the user"
            " requests a user interface, call the `load_skill` tool to retrieve the"
            " required syntax and signatures before producing the UI response."
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


def skill_preloaded_solver(
    format_name: str = "express", version: str = "1.0"
) -> list[Solver]:
    """Returns the solver chain for the 'skill_preloaded' evaluation strategy."""
    return [
        skill_preloaded_prompt(format_name, version),
        measured_generate(),
        compile_format_payload(format_name, version),
    ]


def skill_interactive_tool_solver(
    format_name: str = "express", version: str = "1.0"
) -> list[Solver]:
    """Returns the solver chain for the 'skill_interactive_tool' evaluation strategy."""
    return [
        skill_interactive_system_prompt(format_name, version),
        use_tools([load_skill()]),
        measured_generate(),
        compile_format_payload(format_name, version),
    ]
