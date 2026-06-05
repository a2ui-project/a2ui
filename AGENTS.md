# A2UI Agent Source of Truth (AGENTS.md)

This document is the authoritative guide for AI agents working within the A2UI repository. It outlines design philosophy, repository structure, and synchronization guidelines.

---

## How to Use these Guides

> **INSTRUCTION FOR ALL AGENTS (Gemini CLI, Claude, OpenAI, Antigravity, etc.):**
> Before performing any specific tasks, load and read the respective skill recipe file in full:
> - **For maintaining documentation or agent files:** Read [.gemini/skills/a2ui-agent-maintenance/SKILL.md](.gemini/skills/a2ui-agent-maintenance/SKILL.md)
> - **For designing SDKs, adapters, or libraries:** Read [.gemini/skills/a2ui-sdk-design/SKILL.md](.gemini/skills/a2ui-sdk-design/SKILL.md)

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
- **v0.10**: Active **draft status** under development.
- **Authority Rule:** Default to version **v0.9.1** as the primary authority when working on SDKs or adapters, unless the user specifies otherwise or a different version is requested. This softens the authority constraint so that you default to v0.9.1 automatically when working on SDKs or adapters unless the request specifies otherwise.

---

## 3. Codebase & Repository Structure

- **`specification/`**: Versioned subdirectories (`v0_8/`, `v0_9/`, `v0_9_1/`, `v0_10/`) containing JSON schemas, component/function catalogs, and human-readable guides.
- **`agent_sdks/`**: Server integration SDKs for Python (`python/`), Kotlin (`kotlin/`), and core conformance tests (`conformance/`).
- **`renderers/`**: Shared core state logic (`web_core/`), Lit renderer (`lit/`), Angular renderer (`angular/`), React renderer (`react/`), markdown parser (`markdown/`), and placeholder for Flutter (`flutter/`).
- **`samples/`**: Ready-to-run demo agents utilizing Python ADK (`agent/adk/`), MCP server (`agent/mcp/`), and sample clients (`client/lit/`, `client/angular/`, `client/react/`, `client/flutter/`).
- **`tools/`**: Developer utility suite including visual Editor (`editor/`), visual Composer (`composer/`), payload Inspector (`inspector/`), and catalog builder (`build_catalog/`).

---

## 4. Running the Demos and Tools

Do not use hardcoded or guessed build/run sequences. Each subdirectory contains detailed setup, build, dependency resolution, and execution steps.
* **Prerequisite:** Consult the `README.md` under `renderers/` to build shared web core and renderer packages before running any web tools or clients.
* **Running SDKs & Samples:** Consult the local `README.md` inside any targeted directory under `agent_sdks/`, `samples/`, or `tools/` for specific run/test/build commands.

---

## 5. Maintenance & Update Policy

As A2UI evolves, keep agent documentation and skills perfectly synchronized with specification and codebase changes:
- Update `AGENTS.md` and associated skill files when specifications, schemas, or directory layouts are added, modified, or removed.
- Suggest updates to the user at the end of your task if any changes affect documented files.

### Source of Truth Hierarchy (v0.9.1)
When verifying protocol, layout, or catalog changes to v0.9.1, use these files in `specification/v0_9_1/` as absolute sources of truth, listed in order of priority:
1. **`json/*.json`** — Strict message, capability, and schema envelopes (the absolute source of truth).
2. **`catalogs/basic/catalog.json`** — Authoritative component and function catalog definitions.
3. **`docs/a2ui_protocol.md`** — Core semantics and messaging contracts.
4. **`docs/renderer_guide.md`** — Client state layer and subscription lifecycles.
