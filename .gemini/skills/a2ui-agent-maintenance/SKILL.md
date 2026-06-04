---
name: a2ui-agent-maintenance
description: Maintenance and synchronization guidelines for A2UI agent instruction files (AGENTS.md) and skills. Use when tasks modify the codebase, specifications, schemas, or directories, or when updating the workspace guides.
---

# A2UI Agent Files & Skills Maintenance Skill

This skill provides expert procedures and instructions on how to maintain, synchronize, and update the repository's baseline instructions (`.gemini/AGENTS.md`) and specialized skills (under `.gemini/skills/`).

## Core Principles of Agent Maintenance

To ensure that future AI assistants and agents operate effectively and safely in this repository, all instructions, structure mappings, and tool guides must reflect the absolute current state of the codebase.

### 1. Maintain Strict Agent Agnosticism

All agent-facing configuration files, baseline instructions (`AGENTS.md`, and any entry-point configuration files), and specialized skill guides (`.gemini/skills/*.md`) **MUST be written in a generic, vendor-agnostic manner**.

- **Do NOT** use platform-specific, vendor-exclusive, or proprietary terminology (such as "Gemini", "Gemini CLI", specific proprietary subagent names like `codebase_investigator` or `generalist`, or proprietary tool names like `invoke_agent`).
- **Instead, use generic alternatives** (e.g., "available file-reading tool", "helper subagent", "codebase exploration assistant", "terminal command tool", etc.).
- This ensures that any LLM agent or assistant (such as those powered by Claude, OpenAI, or Gemini) can seamlessly parse and follow the guidelines.

### 2. Leverage Subagents for General Perspective

If you have been deeply focusing on a specific engineering or implementation task (e.g., writing a specific renderer component or patching an adapter), **your active context is heavily biased toward that specific task**.

- **Do NOT** rewrite `AGENTS.md` or update skills solely based on your recent memory.
- **Instead, you MUST spin up a specialized subagent** (using your environment's delegation, multi-agent execution, or helper-agent capabilities) to perform a fresh, objective audit of the codebase structure, modified files, and directories.
- This ensures that agent instructions are updated from a **general, repository-wide perspective** rather than an overly focused or narrow view.

### 3. Authority of the Specifications

When updating agent guides or skills, you must use the latest active specifications under `specification/` as your absolute source of truth. Do not make assumptions. Read these files in full using available context retrieval tools:

- **Protocol & Message Semantics:** `specification/v0_9_1/docs/a2ui_protocol.md`
- **Renderer & Subscription Lifecycles:** `specification/v0_9_1/docs/renderer_guide.md`
- **JSON Schemas:** `specification/v0_9_1/json/*.json`
- **Layouts, Components, & Functions:** `specification/v0_9_1/catalogs/basic/catalog.json`

### 4. Use Subagents to Explore and Summarize

When updating documentation or skills for other parts of the codebase (such as client libraries, agent SDKs, or demos), use specialized subagents or helper assistants to inspect and summarize those regions. For example:

- _Client Libraries:_ Invoke a helper agent to check for new packages, configurations (`package.json`), or initialization flows.
- _Sample Apps:_ Invoke a helper agent to test or check if running scripts (e.g. `uv run`, `npm run dev`) have changed.

---

## Mandatory Maintenance Workflow

When a task requires updating or synchronizing the agent instructions:

### Step 1: Research the Repo (Subagent Delegation)

Delegate the codebase inspection to a helper or subagent to get an objective summary of recent changes. Instruct the helper/subagent with a clear prompt:

> _"Inspect the repository structure, specifically identifying any changes to directories, client libraries, samples, or tools. Compare the actual files found against the current listings in `.gemini/AGENTS.md` to identify discrepancies."_

### Step 2: Formulate the Strategy

Review the findings compiled by your helper agent. Identify:

- New features or directories to document.
- Deprecated files or steps to remove.
- Setup or build scripts that need updating in the running instructions.

### Step 3: Write to the Source of Truth (`AGENTS.md`)

Make surgical updates to `.gemini/AGENTS.md`. Never use vague or flowery language (e.g., "significantly enhances", "powerful tool"). Keep the style factual, technical, generic, and concise.

### Step 4: Keep Entry-Point Gatekeepers Simple

Any entry-point gatekeeper file (such as `.gemini/GEMINI.md` or equivalent) must remain a simple direct-import or folder-pointer that directs agents to read `AGENTS.md`. It must not contain or duplicate details already maintained inside `AGENTS.md`.

### Step 5: Post-Task Suggestion Rule

Never automatically commit updates to `AGENTS.md` or skills unless explicitly requested by the user. Always present your recommended changes as a clean suggestion at the end of your response, explaining _why_ the update is needed.
