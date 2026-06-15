---
name: a2ui-agent-maintenance
description: Maintenance and synchronization guidelines for A2UI agent instruction files (AGENTS.md) and skills. Use when tasks modify the codebase, specifications, schemas, or directories, or when updating the workspace guides.
---

# A2UI Agent Files & Skills Maintenance Skill

Guidelines for keeping agent instruction files (`AGENTS.md`) and specialized skills (`.agents/skills/`) synchronized with codebase developments.

## Core Principles

1. **Maintain Strict Agent Agnosticism:** Write all agent-facing configuration files, baseline instructions, and skill guides in a generic, vendor-agnostic manner. Do not use environment-specific or proprietary names (e.g. "Gemini", "Gemini CLI", `codebase_investigator`, `invoke_agent`). Use generic alternatives (e.g. "helper subagent", "context retrieval tool", etc.).
2. **Counteract Recency Bias with Subagents:** Before modifying documentation or skills after completing a task, invoke a specialized helper or research subagent to perform an objective codebase audit. Do not rely solely on your recent task memory.
3. **Prioritize Specifications over Stale Documentation:** Base all updates on specifications found in `specification/` rather than general workspace markdown files. Look at JSON schemas first, catalogs second, and protocol guides third.
4. **Enforce Separation of Concerns:** Point agents to primary sources of truth inside `AGENTS.md`. Maintain brief, step-by-step task recipes in skills; do not duplicate specifications or schema details in skill definitions.
5. **Enforce Monorepo Script Uniformity:** Guarantee that all Node.js projects are registered as Yarn workspaces in root `package.json` and implement canonical targets (`build`, `lint`, `lint:fix`, `test`, `format`, `format:check`).

## Maintenance Workflow

1. **Audit the Repository:** Invoke a research helper or subagent to extract codebase, schema, or directory list modifications.
2. **Analyze Scope:** Determine if modifications alter specifications, major SDK features, or core directory structures.
3. **Verify Workspace Script Hygiene:** Audit modified or newly added `package.json` files to ensure compliance with canonical Yarn workspace script targets.
4. **Update AGENTS.md:** Surgically edit `AGENTS.md`. Maintain a factual, technical, and concise tone.
5. **Update Skills:** Refactor relevant skill definitions under `.agents/skills/` without introducing duplicate references.
6. **Suggest Changes:** Never automatically commit or push updates. Present your recommended documentation updates as a suggestion in your response, explaining _why_ the update is needed.
