# A2UI Agent Source of Truth (AGENTS.md)

This document is the authoritative guide for all AI agents working within the A2UI repository. It outlines the design philosophy, repository structure, running instructions, and guidelines for keeping this repository and its skills up to date.

---

## 1. What is A2UI?

**A2UI (Agent-to-User Interface)** is a platform-agnostic, streaming-first UI protocol designed specifically for Large Language Models (LLMs) and autonomous agents.

Unlike traditional APIs that require hardcoded clients or static responses, A2UI enables an agent/server to progressively stream abstract, JSONL-formatted user interface layouts to a client. The client (which can be web-based, desktop, mobile, or a CLI) parses this stream on the fly and renders it dynamically using native components (e.g., Row, Column, Button, Text, Modals, ChoicePickers) and styling rules.

Key capabilities of A2UI include:

- **Streaming UI:** Components and data bind values are painted progressively as they arrive from the server, minimizing user-perceived latency.
- **Two-Way Data Binding:** Seamless synchronization of values between client state and server/agent memory.
- **Function Evaluation (Catalogs):** The protocol supports local validation and execution functions (such as logic gates, formatting, and mathematical operations) registered in Component Catalogs.

---

## 2. Protocol Versioning & Authority

> **IMPORTANT VERSIONING NOTICE:**
>
> - **v0.9.1** is the **latest published and active protocol version** implemented by our multi-language SDKs, renderers, and sample clients.
> - **v0.10** is currently in **draft status** and under active design/development.
> - **Authority Rule:** Unless explicitly instructed otherwise by the user, **all core architectural decisions, features, refactoring, and code changes must target version v0.9.1 as the absolute authority.** Do not implement changes or conform to schemas outside of the `specification/v0_9_1/` directory unless specifically directed to work on v0.10 or another version.

---

## 3. Codebase & Repository Structure

The A2UI codebase is highly modular, containing specifications, multi-language agent SDKs, client frameworks, renderers, and visualization/authoring tools.

### `specification/` — Core Protocol Specifications

Contains versioned specifications, schemas, evaluation suites, and catalogs:

- **`v0_8/`**: Stable protocol version 0.8.
- **`v0_9/`**: Closed protocol version 0.9.
- **`v0_9_1/`**: Current active protocol version 0.9.1 (contains basic and minimal catalog schemas).
- **`v0_10/`**: Future protocol version under development (draft status).
- Each version subdirectory typically contains:
  - `docs/`: Markdown specification documents (e.g., protocol definitions, renderer guides, styling guides).
  - `json/`: Official JSON Schema definitions for server-to-client messages, client-to-server events, common primitives, and capabilities.
  - `catalogs/`: Component and validation function catalogs (e.g., `basic/catalog.json`, `minimal/catalog.json`).
  - `eval/`: Genkit/TypeScript evaluation suites to test conformance.

### `agent_sdks/` — Server/Agent Integration SDKs

Libraries for agent developers to easily stream A2UI-conforming payloads from their backends:

- **`python/`**: Python SDK (`pyproject.toml` based).
- **`kotlin/`**: Kotlin/JVM SDK (`build.gradle.kts` based).
- **`conformance/`**: Core conformance schema and test suites to validate custom agent library implementations.

### `renderers/` — Platform-Specific UI Renderers

The rendering libraries that turn abstract A2UI messages into active platform-native widgets:

- **`web_core/`**: Shared core logic, JSON Pointer resolution, state models, and subscription management for web renderers.
- **`lit/`**: The primary web renderer library built using Lit and Vite.
- **`angular/`**: Shared Angular renderer library for Angular apps.
- **`react/`**: React renderer library.
- **`markdown/`**: Utilities to render markdown content inside A2UI components (e.g., using `markdown-it`).
- **`flutter/`**: Placeholder folder with a README for the native Flutter renderer (hosted in a separate repository at `https://github.com/flutter/genui`).

### `samples/` — Ready-to-Run Demos

Ready-to-run clients and servers showcase the end-to-end streaming A2UI workflow:

- **`agent/`**:
  - `adk/`: Python agent demos utilizing the Python ADK. Examples include `contact_lookup`, `restaurant_finder`, `rizzcharts`, and the main `orchestrator`.
  - `mcp/`: An MCP server sample representing A2UI over MCP (Model Context Protocol).
- **`client/`**:
  - `lit/`: Lit-based clients (such as `contact`, `shell`, `personalized_learning`).
  - `angular/`: Angular-based client samples (such as `orchestrator`, `contact`, `restaurant`, `rizzcharts`).
  - `react/`: React-based clients.
  - `flutter/`: Flutter-based client configurations.

### `tools/` — Developer Utility Suite

Utilities to edit, visualize, and debug A2UI interfaces:

- **`editor/`**: A web-based visual editor (`npm run dev`) to test layouts, bind logic, and render dynamically. Requires a Gemini API key.
- **`inspector/`**: A web-based tool to inspect, log, and step through raw streaming A2UI server payloads.
- **`composer/`**: Next.js-based visual canvas composer to author catalogs and interfaces.
- **`build_catalog/`**: Python utility to parse and compile component catalogs.

---

## 4. Running the Demos and Tools

To run A2UI, you typically run an **A2UI Server/Agent** and point an **A2UI Client** to it.

### Step A: Building the Core Web Renderers (Prerequisite)

Before launching web clients or tools, you must compile the core shared renderer libraries:

```bash
# 1. Build Markdown Render Utilities
cd renderers/markdown/markdown-it
npm install && npm run build

# 2. Build Web Core State Machine
cd ../../web_core
npm install && npm run build

# 3. Build Lit Renderer
cd ../lit
npm install && npm run build
```

### Step B: Running a Demo Server (Python ADK)

Navigate to any agent sample in `samples/agent/adk/` and launch it using `uv`:

```bash
cd samples/agent/adk/contact_lookup
uv run .
```

_(Ensure you copy `.env.example` to `.env` and configure any required API keys first)._

### Step C: Running a Client (Lit)

With the server running, navigate to a Lit client sample (e.g., `contact` or `shell`) and run the dev server:

```bash
cd samples/client/lit/contact
npm install
npm run dev
```

### Step D: Running a Client (Angular)

To run an Angular sample client, run the following:

```bash
cd samples/client/angular
npm install
npm start -- contact   # Or specify 'restaurant', 'gallery', 'rizzcharts', 'orchestrator'
```

### Step E: Running the Development Tools

- **Visual Editor:** `cd tools/editor && npm install && npm run dev`
- **Visual Composer:** `cd tools/composer && npm install && npm run dev`
- **Payload Inspector:** `cd tools/inspector && npm install && npm run dev`

---

## 5. Maintenance & Update Policy

As the A2UI protocol and codebase evolve, our agent documentation and skills **MUST** be kept perfectly synchronized with the repository's latest state.

### Keep Docs Up To Date

- Whenever you add, rename, or remove folders, schemas, components, or setup scripts, those modifications **MUST** be updated in `.gemini/AGENTS.md`.
- After completing any implementation task, always check if `.gemini/AGENTS.md` or any skill under `.gemini/skills/` requires an update, and suggest this to the user.

### Source of Truth Hierarchy

When verifying protocol, layout, or catalog changes, use the following files under `specification/` as the absolute sources of truth:

1. **`specification/v0_9_1/docs/a2ui_protocol.md`** — Core semantics and flow.
2. **`specification/v0_9_1/docs/renderer_guide.md`** — Client state layer and subscription lifecycles.
3. **`specification/v0_9_1/json/*.json`** — Strict message, capability, and schema envelopes.
4. **`specification/v0_9_1/catalogs/basic/catalog.json`** — Authoritative layout, component list, and function schemas.
