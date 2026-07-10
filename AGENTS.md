# A2UI Agent Source of Truth (AGENTS.md)

This document is the authoritative guide for AI agents working within the A2UI repository. It outlines design philosophy, repository structure, and synchronization guidelines.

---

## How to Use these Guides

> **INSTRUCTION FOR ALL AGENTS (Gemini CLI, Claude, OpenAI, Antigravity, etc.):**
> Before performing any specific tasks, load and read the respective skill recipe file in full:

- **For working with Spec-Driven Development (SDD) or repository blueprints:** Read [blueprints/README.md](blueprints/README.md)
- **For implementing new SDKs in a client language:** Read [.agents/skills/a2ui-implement-new-sdks-for-client-language/SKILL.md](.agents/skills/a2ui-implement-new-sdks-for-client-language/SKILL.md)

---

## 1. What is A2UI?

**A2UI (Agent-to-User Interface)** is a platform-agnostic, streaming-first UI protocol designed specifically to allow Large Language Models (LLMs) and autonomous agents to generate user interfaces.

Key capabilities:

- **Streaming UI:** Progressive rendering of components and values on the fly to minimize latency.
- **Two-Way Data Binding:** Seamless state synchronization between client and agent.
- **Local Function Evaluation:** Execution of validation/logic functions registered in Component Catalogs.

---

## 2. Protocol Versioning & Authority

The repository supports multiple versions of the A2UI protocol:

- **v0.8**: Stable specification; not supported by the latest SDKs.
- **v0.9**: Stable specification; implemented in SDKs; very minor differences from v0.9.1.
- **v0.9.1**: **Latest published and active protocol version** implemented by our multi-language SDKs, renderers, and sample clients.
- **v1.0**: Candidate specification for stable release (previously v0.10).
- **Authority Rule:** Default to version **v0.9.1** as the primary authority when working on SDKs or adapters, unless the user specifies otherwise or a different version is requested.

---

## 3. Spec-Driven Development (SDD)

> **IMPORTANT:** By default, agents should **IGNORE the `blueprints/` folder** unless explicitly instructed by the user to work with blueprints or Spec-Driven Development.

To scale development across multiple programming languages and UI frameworks, the A2UI repository adopts **Spec-Driven Development (SDD)**. Under this methodology:

- **Language-Agnostic Blueprints** define high-level architecture and features under the `blueprints/` directory (`blueprints/modules/` and `blueprints/features/`).
- **Concrete Codebases** track their module compliance by git commit hash using a `codebase.blueprint.md` file stored under `blueprints/codebases/<relative_codebase_path>/codebase.blueprint.md`.
- **SDD Skills**: SDD skills live in `blueprints/skills/` and can be symlinked into `.agents/skills/` by running `./blueprints/link_skills.sh`. To remove them when done, remove the `.agents/skills/a2ui-*` symlinks.

For a detailed explanation of the methodology, lifecycle, and workflows, read the [Spec-Driven Development Proposal](specification/proposals/spec_driven_development.md).

---

## 4. Codebase & Repository Structure

- **`blueprints/`**: Isolated central repository for language-agnostic module blueprints (`modules/`), feature blueprints (`features/`, `features/archived/`), codebase compliance blueprints (`codebases/`), and SDD skills (`skills/`).
- **`docs/`**: Documentation hierarchy. Public site documentation published via MkDocs resides in `docs/public/`, while non-public contributor or internal documentation resides under `docs/` alongside `docs/scripts/`.
- **`specification/`**: Versioned subdirectories (`v0_8/`, `v0_9/`, `v0_9_1/`, `v1_0/`) containing JSON schemas, component/function catalogs, and human-readable guides. The `specification/<version>/docs/a2ui_protocol.md` file is the most important source of truth for each protocol version, and the `specification/<version>/json` directory contains the associated schemas for the protocol.
- **`agent_sdks/`**: Server integration SDKs for Python (`python/`), Kotlin (`kotlin/`), and core conformance tests (`conformance/`).
- **`renderers/`**: Shared core state logic (`web_core/`), Lit renderer (`lit/`), Angular renderer (`angular/`), React renderer (`react/`), markdown parser (`markdown/`), and placeholder for Flutter (`flutter/`).
- **`samples/`**: Ready-to-run demo agents utilizing Python ADK (`agent/adk/`), MCP server (`agent/mcp/`), and sample clients (`client/lit/`, `client/angular/`, `client/react/`, `client/flutter/`).
- **`tools/`**: Developer utility suite including visual Editor (`editor/`), visual Composer (`composer/`), payload Inspector (`inspector/`), and catalog builder (`build_catalog/`).

---

## 5. Yarn Workspaces & Standard Script Targets

All Node.js and TypeScript projects inside the repository must be managed as **Yarn workspaces** registered inside the `"workspaces"` array of the root `package.json`.

When creating or modifying workspaces, guarantee strict script uniformity by implementing canonical targets:

- **`"build"`**: TypeScript compilation via `wireit` or `tsc -b`.
- **`"lint"` / `"lint:fix"`**: Standardized to `"eslint ."` / `"eslint . --fix"` extending root `eslint.preset.mjs` via modern `eslint.config.mjs` flat configs. Pure container folders lacking code must cleanly echo `"Workspace has no lint configuration."`.
- **`"test"`**: Unit test execution (`vitest`, `node --test`). Packages lacking tests must implement the standard auto-detecting Node fallback script to cleanly emit `"Workspace has no tests."` and exit 0.
- **`"format"` / `"format:check"`**: Natively runs local Prettier formatting (`"prettier --write ."` / `"prettier --check ."`).

**New Node Projects:** Guarantee that any newly initialized Node/TypeScript project uses Yarn Berry, is situated within the monorepo directory structure, is correctly registered in root `"workspaces"`, and fully defines these five canonical script targets.

---

## 6. Running the Demos and Tools

Do not use hardcoded or guessed build/run sequences. Each subdirectory contains detailed setup, build, dependency resolution, and execution steps.

- **Prerequisite:** Consult the `README.md` under `renderers/` to build shared web core and renderer packages before running any web tools or clients.
- **Running SDKs & Samples:** Consult the local `README.md` inside any targeted directory under `agent_sdks/`, `samples/`, or `tools/` for specific run/test/build commands.

---

## 7. Maintenance & Update Policy

As A2UI evolves, keep agent documentation and skills perfectly synchronized with specification and codebase changes:

- Update `AGENTS.md` and associated skill files when specifications, schemas, or directory layouts are added, modified, or removed.
- Enforce Yarn workspace script hygiene across all Node packages.
- Suggest updates to the user at the end of your task if any changes affect documented files.

---

## 8. Core Guidelines for Agents

To ensure the integrity, consistency, and high quality of the repository, all agents must adhere to the following core guidelines:

- **Prioritize Authoritative Specifications**: Always base designs, protocol changes, and implementations on the formal schemas and documents under the versioned `specification/` directory (schemas first, catalogs second, protocol guides third) rather than general workspace markdown files.
- **Maintain Agent-Agnostic Instructions**: When creating or modifying agent instruction files, skills, or guides, write them in a generic, vendor-agnostic manner. Avoid proprietary or environment-specific names (e.g., model names, specific tool terms) and use generic terms (e.g., "assistant", "subagent", "retrieval tool").
- **Enforce Script Uniformity**: Strictly maintain Yarn workspace script hygiene. Ensure all Node/TypeScript packages implement the five canonical targets (`build`, `lint`, `lint:fix`, `test`, `format`, `format:check`).
