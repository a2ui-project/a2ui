# A2UI Site Architecture & Content Outline (Meta-Document)

> **Internal Planning Blueprint — Not for Publication**  
> This document defines the architecture, page boundaries, URL routing contract, and source-of-truth pointers for implementing the `a2ui.org` developer site under `docs/site/`. It is written so multiple authoring subagents can implement pages in parallel with consistent structure, links, and zero overlapping content.

---

## Global Subagent Authoring & Routing Contract

Every agent authoring or editing pages under `docs/site/` must follow these global rules instead of repeating boilerplate per section:

1. **Mandatory Skills**:
    - Load and follow [`.agents/skills/public-documentation/SKILL.md`](../../.agents/skills/public-documentation/SKILL.md) for `v1.0` / `v0.9.1` protocol version tabbing, multi-SDK tab ordering (`TypeScript` | `Python` | `Dart` | `Swift` with `syncKey="sdk-lang"`), multi-renderer tab ordering (`Flutter` | `Web` | `SwiftUI` | `Jetpack Compose`), single-source `--8<--` spec includes, and the hybrid diagram pattern (themed Mermaid for sequence/lifecycle flows; Astro/Tailwind components for structural/taxonomy visuals).
    - Load and follow [`.agents/skills/natural-writing/SKILL.md`](../../.agents/skills/natural-writing/SKILL.md) for direct, neutral technical prose free of promotional buzzwords and AI-isms.
2. **Derive Code & Payloads from Live Sources of Truth**:
    - Never invent API signatures, package names, CLI commands, or JSON properties from memory. Inspect live schemas under [`specification/`](../../specification/) and [`catalogs/`](../../catalogs/), SDK manifests and public exports under [`python/`](../../python/), [`typescript/`](../../typescript/), [`dart/`](../../dart/), and [`swift/`](../../swift/), runnable apps under [`samples/`](../../samples/), conformance suites under [`conformance/`](../../conformance/), and evaluation harnesses under [`eval/`](../../eval/).
3. **Shared Visual Components**:
    - Implement reusable Astro/Tailwind visual diagrams under `docs/site/src/components/docs/<ComponentName>.astro` and import them into `.mdx` pages. Respect Starlight light and dark theme variables (`--sl-color-*`).
4. **Canonical Topic Ownership (Anti-Overlap Rules)**:
    - Each core topic has a single canonical owner page. Other pages must summarize the concept in 1–2 sentences and link to the owner rather than repeating tables, benchmarks, or deep explanations:
        - **Wire message envelopes & v0.9.1 $\rightarrow$ v1.0 message renames**: Owned by [`Messages`](#messages) (`/concepts/messages/`).
        - **Official SDK inventories, Core SDK dependency, source links & registry links**: Owned by [`Agent SDKs`](#agent-sdks) (`/concepts/agent-sdks/`) and [`Renderer SDKs`](#renderer-sdks) (`/concepts/renderer-sdks/`).
        - **Inference format mechanics (Express, Direct JSON) & token/latency benchmark table**: Owned by [`Swappable Inference Formats`](#swappable-inference-formats) (`/concepts/inference-formats/`).
        - **Server-side `@macro` expansion & data baking**: Owned by [`Macros`](#macros) (`/concepts/macros/`).
        - **Module blueprints & YAML conformance suites**: Owned by [`SDK Development`](#sdk-development) (`/guides/sdk-development/`).
5. **Specification JSON Schema Permalink Contract**:
    - Whenever any page links to a protocol or catalog JSON Schema definition, link to the human-browsable **JSON Schemas Explorer** route rather than raw `.json` files (where browsers ignore `#` fragments):
        - **Explorer Routes**: `/specification/v1.0/schemas/`, `/specification/v0.9.1/schemas/`, `/specification/v0.8/schemas/` (prefixed with `import.meta.env.BASE_URL` when constructing links in Astro components).
        - **Whole Schema File**: `/specification/<version>/schemas/#<schema-file>`
            - Examples: `/specification/v1.0/schemas/#agent_to_renderer.json`, `/specification/v0.9.1/schemas/#server_to_client.json`.
            - Catalogs stored outside `json/` use stable aliases: `#basic_catalog.json` and `#mcp_catalog.json`.
        - **Specific Definition / JSON Pointer**: `/specification/<version>/schemas/#<schema-file>/<json-pointer>`
            - Examples:
                - `/specification/v1.0/schemas/#agent_to_renderer.json/$defs/CreateSurfaceMessage`
                - `/specification/v0.9.1/schemas/#server_to_client.json/$defs/CreateSurfaceMessage`
                - `/specification/v1.0/schemas/#common_types.json/$defs/ChildList`
                - `/specification/v1.0/schemas/#basic_catalog.json/components/Button`
    - See [Section 4.2](#42-json-schemas-explorer--permalink-architecture) for how `<SchemaExplorer />` and `remark-a2ui-includes.mjs` implement and validate this contract.

### Canonical Site Route & Content File Map

All cross-page links must target these exact Starlight routes (with `docs/site/src/content/docs/` file paths matching the slugs below):

| Section           | Page Title                                       | Content File (`docs/site/src/...`)                                                               | Canonical URL Route                                                                             |
| :---------------- | :----------------------------------------------- | :----------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| **Landing**       | Landing Page                                     | `pages/index.astro`                                                                              | `/`                                                                                             |
| **Getting Start** | Quick start                                      | `content/docs/quickstart.mdx`                                                                    | `/quickstart/`                                                                                  |
| **Concepts**      | Overview: How A2UI Works                         | `content/docs/concepts/overview.mdx`                                                             | `/concepts/overview/`                                                                           |
| **Concepts**      | Messages                                         | `content/docs/concepts/messages.mdx`                                                             | `/concepts/messages/`                                                                           |
| **Concepts**      | Catalogs, Components and Functions               | `content/docs/concepts/catalogs.mdx`                                                             | `/concepts/catalogs/`                                                                           |
| **Concepts**      | Data Model and Data Binding                      | `content/docs/concepts/data-binding.mdx`                                                         | `/concepts/data-binding/`                                                                       |
| **Concepts**      | Actions and Functions                            | `content/docs/concepts/actions-and-functions.mdx`                                                | `/concepts/actions-and-functions/`                                                              |
| **Concepts**      | Agent SDKs                                       | `content/docs/concepts/agent-sdks.mdx`                                                           | `/concepts/agent-sdks/`                                                                         |
| **Concepts**      | Renderer SDKs                                    | `content/docs/concepts/renderer-sdks.mdx`                                                        | `/concepts/renderer-sdks/`                                                                      |
| **Concepts**      | Swappable Inference Formats                      | `content/docs/concepts/inference-formats.mdx`                                                    | `/concepts/inference-formats/`                                                                  |
| **Concepts**      | Macros                                           | `content/docs/concepts/macros.mdx`                                                               | `/concepts/macros/`                                                                             |
| **Concepts**      | Security and Trust Boundaries                    | `content/docs/concepts/security.mdx`                                                             | `/concepts/security/`                                                                           |
| **Concepts**      | Accessibility (A11y)                             | `content/docs/concepts/accessibility.mdx`                                                        | `/concepts/accessibility/`                                                                      |
| **Concepts**      | Glossary                                         | `content/docs/concepts/glossary.md`                                                              | `/concepts/glossary/`                                                                           |
| **Guides**        | How to Integrate with My Client                  | `content/docs/guides/client-integration.mdx`                                                     | `/guides/client-integration/`                                                                   |
| **Guides**        | How to Integrate with My Agent Server            | `content/docs/guides/agent-integration.mdx`                                                      | `/guides/agent-integration/`                                                                    |
| **Guides**        | How to Define a Catalog                          | `content/docs/guides/defining-a-catalog.mdx`                                                     | `/guides/defining-a-catalog/`                                                                   |
| **Guides**        | Architecting an A2UI Integration                 | `content/docs/guides/architecting-an-integration.mdx`                                            | `/guides/architecting-an-integration/`                                                          |
| **Guides**        | How to Improve Latency                           | `content/docs/guides/improving-latency.mdx`                                                      | `/guides/improving-latency/`                                                                    |
| **Guides**        | A2UI over MCP                                    | `content/docs/guides/a2ui-over-mcp.md`                                                           | `/guides/a2ui-over-mcp/`                                                                        |
| **Guides**        | MCP Apps in A2UI Surfaces                        | `content/docs/guides/mcp-apps-in-a2ui.md`                                                        | `/guides/mcp-apps-in-a2ui/`                                                                     |
| **Guides**        | A2UI Dynamic Rendering within MCP Applications   | `content/docs/guides/a2ui-in-mcp-apps.md`                                                        | `/guides/a2ui-in-mcp-apps/`                                                                     |
| **Guides**        | Authoring Universal Web Components               | `content/docs/guides/authoring-universal-components.md`                                          | `/guides/authoring-universal-components/`                                                       |
| **Guides**        | SDK Development                                  | `content/docs/guides/sdk-development.md`                                                         | `/guides/sdk-development/`                                                                      |
| **Roadmap**       | Roadmap                                          | `content/docs/roadmap.md`                                                                        | `/roadmap/`                                                                                     |
| **Ecosystem**     | Ecosystem Renderers & Tools                      | `content/docs/ecosystem/renderers.md`                                                            | `/ecosystem/renderers/`                                                                         |
| **Specification** | `<ver>` Protocol Specification                   | `content/docs/specification/<ver>-a2ui.md`                                                       | `/specification/<ver>-a2ui/`                                                                    |
| **Specification** | `<ver>` Custom Functions Guide                   | `content/docs/specification/<ver>-custom-functions.md`                                           | `/specification/<ver>-custom-functions/`                                                        |
| **Specification** | `<ver>` SDKs Specification                       | `content/docs/specification/<ver>-sdks.md`                                                       | `/specification/<ver>-sdks/`                                                                    |
| **Specification** | `<ver>` JSON Schemas Explorer                    | `content/docs/specification/<ver>-schemas.mdx`                                                   | `/specification/<ver>/schemas/`                                                                 |
| **Specification** | `<ver>` A2A Extension                            | `content/docs/specification/<ver>-a2ui-extension-specification.md` (and `v0.8-a2a-extension.md`) | `/specification/<ver>-a2ui-extension-specification/` (and `/specification/v0.8-a2a-extension/`) |
| **Specification** | `<ver>` Evolution Guide / Custom Catalog Changes | `content/docs/specification/<ver>-evolution-guide.md` (and `v0.8-custom-catalog-changes.md`)     | `/specification/<ver>-evolution-guide/` (and `/specification/v0.8-custom-catalog-changes/`)     |
| **Specification** | `<ver>` Basic Catalog Guide                      | `content/docs/specification/<ver>-basic-catalog-implementation-guide.md`                         | `/specification/<ver>-basic-catalog-implementation-guide/`                                      |

_(Where `<ver>` is `v1.0`, `v0.9.1`, or `v0.8`, matching the route mappings in [`docs/site/src/plugins/remark-a2ui-includes.mjs`](src/plugins/remark-a2ui-includes.mjs).)_

---

## 1. Landing Page Outline (`src/pages/index.astro`)

### Part I: The Problem, The Spectrum & Real-World Adoption

1. **Hero: Give your agents UI on every surface**
    - Headline & value proposition: Chat is a great input, but walls of prose are a poor output. Give your agents stateful, interactive UI across mobile, desktop, and web.
    - Interactive visual aid contrasting raw LLM prose against a stateful A2UI surface bound to `dataModel`.
2. **The Generative UI Spectrum**
    - Interactive spectrum explorer showing how one A2UI environment spans:
        1. **Fully Controlled**: Deterministic server-driven UI & fixed schemas.
        2. **Controlled / Server Macros**: Predictable composite domain components chosen by the agent.
        3. **Declarative Generative UI**: Agent composes catalog primitives on demand for long-tail requests.
        4. **Open-Ended & MCP Apps**: Sandboxed `ui://` MCP App surfaces.
3. **Real Use Cases in Production**
    - **Logo Bar**: JetBrains, Alation, ByteDance, Google Home, Gemini Notebook (plus Google Opal & Flutter GenUI).
    - **Interactive Use-Case Tabs**: Switchable tabs with visual previews and architectural notes along the spectrum.

### Part II: Why A2UI? (Core Technical Differentiators)

4. **Express: Compact inference format (~70–80% fewer output tokens than JSON)**
    - Visual teaser contrasting compact Express DSL against wire JSON, linking to [Swappable Inference Formats](#swappable-inference-formats) (`/concepts/inference-formats/`).
5. **Macros: Give the model bigger words**
    - Teaser showing server-defined `@macro` calls expanding into standard wire primitives, linking to [Macros](#macros) (`/concepts/macros/`).
6. **Multi-Platform Client Rendering**
    - Interactive 6-platform renderer switcher (Flutter, React, Angular, Lit Web Components, SwiftUI, Jetpack Compose), linking to [Renderer SDKs](#renderer-sdks) (`/concepts/renderer-sdks/`).

---

## 2. Docs Section Outline

### Quick start (`/quickstart/`)

> **[TODO]**: Approach and structure to be decided later (e.g. interactive 5-minute sandbox, starter repository template, or CLI walkthrough).

### Concepts

#### Overview: How A2UI Works

- **Diagram Source of Truth**: Replicate **Slide 25** of [GenUI.pptx](https://docs.google.com/presentation/d/1UOPyN1jz7TqxQsrYugs0qkm4F9v4jmV4/edit?resourcekey=0-9BovZnkNLA3k39KuhaKLHg#slide=id.h16378dc14ad48b5a_2_49) as a rich Astro/Tailwind component (`<ArchitecturePipelineOverview />`):
    - Demarcate **SERVER · YOUR AGENT** on the left and **CLIENT · YOUR APP** on the right.
    - **Boundary Rule**: The `A2UI AGENT SDK` container strictly encloses the **Skill generator** and **Compiler**. The `Agent` (e.g. Gemini Interactions API / LLM runtime) sits outside the SDK box as user application code that consumes domain skills + generated A2UI skills and feeds model output into the compiler.
    - Include cards for **Component schemas (your catalog)**, **Domain skills**, **A2UI Agent SDK**, **Agent**, **A2UI Protocol JSON** (`updateComponents`), and **Data sent separately** (`updateDataModel`), paired with the client phone mockup ("Berlin to San Francisco today, and two tickets back." and flight cards outlined with _"A2UI renderer draws this part"_).
- **Content Outline**:
    1. **Core Mental Model**: Introduce Component Schemas (`catalog.json`), the A2UI Agent SDK (linking to [Agent SDKs](#agent-sdks)), the Agent application runtime, decoupled layout (`updateComponents`) vs. state (`updateDataModel`) messages, and the Client App & Renderer SDK (linking to [Renderer SDKs](#renderer-sdks)).
    2. **End-to-End Architecture Walkthrough**: Place `<ArchitecturePipelineOverview />` near the top and walk through the 5 stages: (1) Catalog definition, (2) Skill generation, (3) Agent prompting & reasoning, (4) Parsing, compilation & validation, and (5) Incremental client rendering.
    3. **Capabilities & Catalog Negotiation**: Explain how the client advertises `a2uiRendererCapabilities` (`supportedCatalogIds`, `inlineCatalogs`) and how the agent selects the active catalog.

#### Messages

- **Page-Specific Rules**:
    - Link every message to its canonical schema definition using the **JSON Schema Permalink Contract** (`/specification/v1.0/schemas/#...` and `/specification/v0.9.1/schemas/#...`).
    - Explicitly call out every message or envelope property renamed or restructured between `v0.9.1` and `v1.0`.
- **Content Outline**:
    1. **Protocol Architecture & Top-Level Envelope Rename**: Explain asynchronous bidirectional messaging over standard transports (AG-UI, A2A, SSE, WebSockets, MCP), layout vs. state separation, and the v1.0 envelope rename from `server_to_client.json` / `client_to_server.json` (v0.9.1) to `agent_to_renderer.json` / `renderer_to_agent.json` (v1.0).
    2. **Agent-to-Renderer Messages** (derive details from [`specification/v1_0/json/agent_to_renderer.json`](../../specification/v1_0/json/agent_to_renderer.json) and [`specification/v0_9_1/json/server_to_client.json`](../../specification/v0_9_1/json/server_to_client.json)):
        - `createSurface`: Surface allocation, `sendDataModel`, and v0.9.1 $\rightarrow$ v1.0 changes (`theme` removed in v1.0, `catalogId` made optional, inline initial `components` and `dataModel` added).
        - `updateComponents`: Flat component array updates and subtree replacement.
        - `updateDataModel`: JSON Pointer state updates; note the key-deletion version delta (`value: null` in v1.0 vs. omitting `value` in v0.9.1).
        - `deleteSurface`: Surface teardown and cleanup.
        - `callRendererFunction` (v1.0): Agent-initiated client RPC; mark that it was named `callFunction` in v0.9.1 and now pairs with `rendererFunctionResponse`.
        - `agentFunctionResponse` (v1.0): Agent response to `callAgentFunction` (new in v1.0).
    3. **Renderer-to-Agent Messages** (derive details from [`specification/v1_0/json/renderer_to_agent.json`](../../specification/v1_0/json/renderer_to_agent.json) and [`specification/v0_9_1/json/client_to_server.json`](../../specification/v0_9_1/json/client_to_server.json)):
        - `action`: User event dispatch with resolved `context` and optional `sendDataModel` metadata (note `userMessage` and `metadata.extensions` added in v1.0).
        - `callAgentFunction` (v1.0): Client-initiated remote RPC (new in v1.0).
        - `rendererFunctionResponse` (v1.0): Client `value` / `error` response to `callRendererFunction` (new in v1.0).
        - `error` & Self-Correction Loop: Structured validation/runtime error codes (note `functionCallId` mutually exclusive with `surfaceId` in v1.0) and how errors feed back into the LLM for automatic retry.
    4. **Flat Component Tree (Adjacency List) & ID Rules**: Explain why A2UI uses flat ID-referenced arrays instead of nested JSON trees, the single `id: "root"` rule, targeted node updates by ID, and v1.0 UAX #31 identifier rules (e.g. `btn_one` valid, `btn-1` invalid in v1.0).
    5. **End-to-End Flight Booking Sequence Diagram**: Include a themed Mermaid `sequenceDiagram` matching the Overview scenario: (1) user prompt $\rightarrow$ `createSurface`, (2) `updateComponents` + `updateDataModel`, (3) user clicks "Select" $\rightarrow$ `action` $\rightarrow$ `updateDataModel`, plus `opt`/`alt` blocks demonstrating `callAgentFunction`/`agentFunctionResponse`, `callRendererFunction`/`rendererFunctionResponse`, `error`, and `deleteSurface`.

#### Catalogs, Components and Functions

- **Content Outline**:
    1. **Catalog Anatomy Visual (`<CatalogAnatomy />`)**: Two-column Tailwind card showing a sample catalog URI (`components` chips with property/slot badges on the left; `functions` chips with caller badges on the right) plus a callout explaining `allowedCallers` (`rendererOnly` | `agentOnly` | `rendererOrAgent`) and `requiresUserActivation`.
    2. **Conceptual Foundations**: Define Catalogs (`catalogId` URI contract, `instructions`), Components (properties, `ChildList` slots, `checks`, `allowedParents` / `allowedChildren`), and Functions (local zero-latency renderer functions vs. remote `callAgentFunction` RPCs).
    3. **Using and Extending Catalogs Across SDKs**:
        - _Agent Side (`TypeScript` | `Python` | `Dart`)_: Show loading a `catalog.json` (`Catalog`, `CatalogConfig`) and pruning components (`ComponentPruningTransformer`), verified against `python/a2ui_agent/`, `typescript/agents/a2ui_agent/`, and `dart/a2ui_agent/`.
        - _Renderer Side (`Flutter` | `Web` | `SwiftUI` | `Jetpack Compose`)_: Show registering component adapters and local function implementations with `MessageProcessor`.
    4. **The Basic Catalog**: Explain [`catalogs/basic/v1/catalog.json`](../../catalogs/basic/v1/catalog.json) as an optional, styleable reference catalog that teams can use directly, replace with custom domain catalogs, reimplement with their own design system, or mix per component via `catalogId`.

#### Data Model and Data Binding

- **Sources**: [`specification/v1_0/json/common_types.json`](../../specification/v1_0/json/common_types.json), [`specification/v0_9_1/json/common_types.json`](../../specification/v0_9_1/json/common_types.json), and [`catalogs/basic/v1/examples/`](../../catalogs/basic/v1/examples/).
- **Content Outline**:
    1. **What is the Data Model?**: Per-surface reactive JSON state scoped to `surfaceId`, updated independently of the UI tree via `updateDataModel` JSON Pointers.
    2. **Populating the Data Model**: Contrast deterministic backend/tool data injection with LLM-generated initial `dataModel` or `updateDataModel` messages.
    3. **Visual Architecture (`<DataBindingAnatomy />`)**: Side-by-side card mapping a surface `dataModel` JSON object to bound widget properties via JSON Pointers.
    4. **Core Data Binding Patterns** (show synced `v1.0` `@path`/`@call` and `v0.9.1` `path`/`call` JSON tabs, linking to schema permalinks):
        1. _Two-Way Input Binding & Action Context_: Input widgets (`TextField`, `CheckBox`) mutating local `dataModel` paths and submit buttons resolving those paths in `action.event.context`.
        2. _Reactive Formatting & String Interpolation_: Binding properties to `@call` (e.g. `formatCurrency`) and `formatString` `${/path}` expressions.
        3. _Local Control-to-Control Binding_: Multiple widgets bound to the same path updating in lockstep locally with zero network round-trips.
        4. _Collection Scopes & Dynamic List Templates (`ChildList` & `@index`)_: Container templates (`{"path": "/items", "componentId": "itemCard"}`), scoped relative JSON Pointers (`{"@path": "title"}`), and `@index`. **Protocol Trap**: Note that `ChildList` in `common_types.json#/$defs/ChildList` uses `"path"` (not `"@path"`) in both v0.9.1 and v1.0.
    5. **Synchronizing State Back to the Agent**: Clarify that local two-way edits do not send per-keystroke messages; contrast explicit `action.event.context` resolution with full-surface `sendDataModel: true` metadata sync.

#### Actions and Functions

- **Sources**: [`specification/v1_0/docs/a2ui_custom_functions.md`](../../specification/v1_0/docs/a2ui_custom_functions.md), `agent_to_renderer.json`, and `renderer_to_agent.json`.
- **Content Outline**:
    1. **The Four Execution Paths**: Present a 4-row comparison table (columns: _Execution Path_, _Trigger_, _Executor_, _Wire Messages_, _Catalog & Security Rules_) covering: (1) User Action Event (`action.event`), (2) Local Client Function (`action.functionCall` or property `@call`), (3) Renderer-to-Agent RPC (`callAgentFunction` $\rightarrow$ `agentFunctionResponse`), and (4) Agent-to-Renderer RPC (`callRendererFunction` $\rightarrow$ `rendererFunctionResponse`, noting `requiresUserActivation: true` functions cannot be invoked remotely by the agent).
        - **Protocol Trap Callout**: Highlight implicit fallback routing (`§callAgentFunction`): if a component calls a function name not registered in the client renderer's local table, the renderer dispatches it over the network as `callAgentFunction`, so a typo in a local function name triggers a network round-trip ending in `UNKNOWN_FUNCTION`.
    2. **Actions with Context & Dynamic `userMessage`**: Tabbed `v1.0` / `v0.9.1` JSON example showing `action.event` with resolved `context` pointers and v1.0 `DynamicString` `userMessage`.
    3. **Action Lifecycle**: Walk through declaration (including form `checks` gating button state), user trigger & local pointer evaluation, outbound `action` message, and incremental agent response.

#### Agent SDKs

- **Canonical Owner**: Single source of truth for official Agent SDKs, framework extensions, and their Core SDK dependencies.
- **Content Outline**:
    1. **Foundation on the Core SDK**: Explain that every Agent SDK depends on a language-specific Core SDK (`a2ui-core`, `@a2ui/web_core`, `a2ui_core`) implementing the shared data structures and behaviors common to both agents and renderers (protocol message models, `Catalog` schemas, surface/`dataModel` state containers, JSON Pointer resolution, expression evaluation, and validation primitives).
    2. **Primary Responsibilities**: (1) Catalog loading, `CatalogTransformer` pruning, and `a2uiRendererCapabilities` negotiation; (2) Skill & system prompt generation (`SkillGenerator` / `PromptGenerator` + decompiled examples); (3) Swappable inference format compilation & streaming (Express DSL, Direct JSON chunk healing); (4) Stateful validation against `RendererState` & LLM self-correction; (5) Server-side `@macro` expansion and agent framework integrations (ADK, A2A, AG-UI).
    3. **Why Use an Official Agent SDK?**: Replaces brittle hand-written schema prompts with catalog-driven skills, cuts output tokens via Express without client changes, catches invalid references/schemas before emission, and abstracts `v0.9.1` vs. `v1.0`.
    4. **Available Official Agent SDKs Table**:
        - **Columns**: (1) _Language / Runtime_, (2) _Packages & Roles_ (Agent SDK, framework adapters like ADK/A2A, and Core SDK dependency), (3) _Protocol Versions_, (4) _GitHub Source_ (deep link in `a2ui-project/a2ui`), (5) _Published Package_ (direct link on PyPI, npm, pub.dev, or explicit in-repo status).
        - **Discovery Instructions**: Inspect `python/*/pyproject.toml`, `typescript/agents/*/package.json`, `typescript/core/*/package.json`, `dart/*/pubspec.yaml`, and `kotlin/` legacy notes; verify `"private"` flags, release tags, and live registry URLs. Note that Swift targets client rendering (`A2UICore` / `A2UISwiftUI`) rather than server-side agent generation.
    5. **Community & Custom SDKs**: Cross-link to [`/ecosystem/renderers/`](#ecosystem-renderers--tools-ecosystemrenderers) and [`/guides/sdk-development/`](#sdk-development).

#### Renderer SDKs

- **Canonical Owner & Framing Rules**:
    - Single source of truth for official client Renderer SDKs and Core SDKs.
    - Do **not** mention `60fps`.
    - Refer to **incremental updates** (applying incremental component tree and data model updates), **not** "streaming" (an agent-side concept).
    - Do **not** pitch "native widget rendering" as a standalone feature bullet; explain instead that framework adapters include a **built-in implementation of the Basic Catalog** and make **custom catalogs** straightforward by letting developers supply per-`Component` rendering logic while the framework handles reactive state updates.
- **Content Outline**:
    1. **Foundation on the Core SDK**: Explain that every Renderer SDK depends on a language-specific Core SDK (`@a2ui/web_core`, `a2ui_core`, `A2UICore`, AndroidX A2UI core) implementing shared message models, `SurfaceModel` / `DataModel` state trees, JSON Pointer resolution, `@path` / `@call` evaluation, and validation rules common to agents and renderers.
    2. **Built-In Basic Catalog & Custom Catalog Ergonomics**: Framework adapters ship with the Basic Catalog built in for immediate use, and let teams implement custom catalogs by registering rendering functions per `Component` (plus local functions) while the adapter and Core SDK manage incremental updates, reactive bindings, scoped list templates, validation `checks`, and event dispatch.
    3. **Primary Responsibilities**: (1) Applying incremental `createSurface`, `updateComponents`, `updateDataModel`, and `deleteSurface` updates; (2) Reactive state, scoped `ChildList` templates, relative JSON Pointers, `@index`, and two-way input bindings; (3) Local function evaluation, `checks`, and `allowedCallers` / `requiresUserActivation` enforcement; (4) Advertising `a2uiRendererCapabilities`, dispatching `action` / RPC messages, and reporting structured `error` payloads; (5) Host platform accessibility mapping and live-region throttling.
    4. **Why Use an Official Renderer SDK?**: (1) **Abstracts protocol versions** (`v0.9.1` and `v1.0`), (2) **Implements subtle reactive state changes reliably** (incremental ID updates, nested `ChildList` lexical scopes, relative pointers, two-way bindings, reactive `checks`), and (3) **Supports all protocol features** (bidirectional RPCs, caller security gates, `sendDataModel`, accessibility attributes, structured `error` reporting).
    5. **Available Official Renderer SDKs Table**:
        - **Columns**: (1) _UI Framework / Platform_, (2) _Language_, (3) _Packages & Core Dependency_ (Framework Adapter, Core SDK, and Basic Catalog package if separate), (4) _Protocol Versions_, (5) _GitHub / Source Code_, (6) _Published Package_.
        - **Discovery Instructions**: Inspect `typescript/{core,renderers,catalogs}/*/package.json`, `dart/*/pubspec.yaml`, and `swift/*/Package.swift`, verifying `"private"` flags and live registry links. Explicitly include the **Jetpack Compose SDK**, consulting [https://developer.android.com/develop/ui/compose/agentic](https://developer.android.com/develop/ui/compose/agentic) for authoritative Maven coordinates, source links, and documentation.
    6. **Community Renderers & Custom Adapters**: Cross-link to [`/ecosystem/renderers/`](#ecosystem-renderers--tools-ecosystemrenderers) and [`/guides/sdk-development/`](#sdk-development).

#### Swappable Inference Formats

- **Canonical Owner & Sources**: Single home for inference formats and token/latency benchmarks. Grounded in [Fast and Reliable A2UI](https://developers.googleblog.com/fast-reliable-a2ui/), `python/a2ui_agent/src/a2ui/inference_formats/`, `typescript/agents/a2ui_agent/`, `dart/a2ui_agent/`, and `eval/`.
- **Content Outline**:
    1. **Wire Standard vs. Generation Formats**: Standard A2UI JSON on the wire vs. decoupled LLM generation formats on the server: **Express** (`ExpressFormatFactory`, default compact positional DSL), **Direct JSON** (`DirectJsonFormatFactory`, incremental chunk healing via `open_stream()`), and experimental **Atom** / **Elemental** (`[Badge: Experimental]`).
    2. **Inference Pipeline Visual (`<InferencePipeline />`)**: 3-stage Astro/Tailwind card (`Prompt Synthesis` $\rightarrow$ `Model Generation` $\rightarrow$ `Wire Compilation & Validation`).
    3. **Configuring the Inference Format (`TypeScript` | `Python` | `Dart`)**: Verified snippets configuring `inference_format_factory` on `A2uiGenerator`.
    4. **Comparative Example & Canonical Benchmarks**: Side-by-side Express vs. compiled wire JSON example (generated via the Express decompiler) and the single authoritative benchmark table (~70–80% / ~3.8x output token reduction and decode latency comparisons, referencing `eval/`).
    5. **Driving A2UI via Decision Models**: Deterministic state machines / classifiers driving A2UI for zero-hallucination regulated workflows.

#### Macros

- **Canonical Owner & Sources**: Single home for server-side macros. Grounded in [`python/a2ui_agent/src/a2ui/transformers/macros/README.md`](../../python/a2ui_agent/src/a2ui/transformers/macros/README.md) and [`samples/community/macros/README.md`](../../samples/community/macros/README.md).
- **Content Outline**:
    1. **What are Macros?**: Coarse-grained composite components defined on the server (`@macro`) and lowered into standard catalog primitives by `MacroExpander` before wire transmission (zero client binary changes).
    2. **Benefits & Nuances**: Server-side data baking and token reduction; key nuances around static literal baking vs. reactive `@path` data bindings, and per-invocation child component ID scoping.
    3. **3-Stage Walkthrough**: Verified code walkthrough showing (1) `@macro` definition, (2) compact Express invocation, and (3) expanded primitive wire components via `transform_to_transport`.
    4. **Wiring Macros into an Agent**: Using `MacroExpander` (`transform_to_inference_catalog` and `transform_to_transport`) and `a2ui_cli` builder codegen for custom catalogs.

#### Security and Trust Boundaries

- **Sources**: [`specification/v1_0/docs/a2ui_protocol.md`](../../specification/v1_0/docs/a2ui_protocol.md) and [`specification/v1_0/docs/a2ui_custom_functions.md`](../../specification/v1_0/docs/a2ui_custom_functions.md).
- **Content Outline**:
    1. **Declarative Wire Protocol**: Zero executable JS, HTML `<script>`, or arbitrary CSS injection over the wire.
    2. **Catalog as Explicit Allowlist**: Strict registration of allowed components/functions and JSON Schema rejection of undeclared properties.
    3. **Function Caller & Gesture Gates**: `allowedCallers` (`rendererOnly`, `agentOnly`, `rendererOrAgent`) isolation and `requiresUserActivation: true` human-gesture enforcement (e.g. `openUrl`).
    4. **Data Model Privacy**: Per-surface `dataModel` isolation and restricting `sendDataModel: true` state payloads strictly to the creating agent.
    5. **Sandboxed Third-Party Micro-Apps**: Double-iframe isolation (omitting `allow-same-origin`) when embedding HTML MCP Apps, linking to [`/guides/mcp-apps-in-a2ui/`](#mcp-apps-in-a2ui-surfaces).

#### Accessibility (A11y)

- **Sources**: [`specification/v1_0/docs/a2ui_protocol.md`](../../specification/v1_0/docs/a2ui_protocol.md) and `/specification/v1.0/schemas/#common_types.json/$defs/AccessibilityAttributes`.
- **Content Outline**:
    1. **Semantic Native Widget Trees**: Contrast accessible host widget trees (screen readers, switch control, keyboard focus) against canvas or screenshot UIs.
    2. **`AccessibilityAttributes` Schema**: Document `label` (`DynamicString`), `description` (`DynamicString`), `live` (`"off"` | `"polite"` | `"assertive"`), and `hidden` (`DynamicBoolean`) inherited via `ComponentCommon`.
    3. **Catalog & Renderer Requirements**: Accessible label requirements on interactive components, SDK schema linting, and debouncing `live` region announcements during rapid incremental updates.
    4. **Framework Adapter Mappings**: Verified mappings across Flutter (`Semantics`), Web (WAI-ARIA), SwiftUI (`.accessibility*` modifiers), and Jetpack Compose (verified against [https://developer.android.com/develop/ui/compose/agentic](https://developer.android.com/develop/ui/compose/agentic)).

#### Glossary

- Port [`docs/public/concepts/glossary.md`](../public/concepts/glossary.md), updated with `v1.0` terminology (`agent_to_renderer`, `renderer_to_agent`, `@path`, `@call`, `callAgentFunction`, `callRendererFunction`).

### Guides

#### How to Integrate with My Client

- **Sources**: Link to [Renderer SDKs](#renderer-sdks) (`/concepts/renderer-sdks/`) for package coordinates; verify APIs against `dart/a2ui_flutter/`, `typescript/renderers/`, `swift/swiftui/`, `samples/client/`, and [https://developer.android.com/develop/ui/compose/agentic](https://developer.android.com/develop/ui/compose/agentic).
- **Content Outline** (tabbed across `Flutter` | `Web` | `SwiftUI` | `Jetpack Compose`):
    1. **Overview**: Link to `/concepts/renderer-sdks/` and summarize the 6 integration steps.
    2. **Step 1: Install Dependencies**: Tabbed install commands matching `/concepts/renderer-sdks/`.
    3. **Step 2: Initialize `MessageProcessor` & Register Catalogs**: Registering the built-in Basic Catalog plus custom component/function adapters.
    4. **Step 3: Advertise `a2uiRendererCapabilities`**: Attaching `supportedCatalogIds` and `inlineCatalogs` in request/session metadata.
    5. **Step 4: Connect Transport & Apply Incremental Updates**: Passing transport payloads (AG-UI, A2A, SSE, WebSockets) into `processMessages` without assuming hardcoded JSONL framing.
    6. **Step 5: Mount Surface Components**: Verified surface widget/component mounting snippets per renderer.
    7. **Step 6: Handle Outbound Actions, RPCs & Validation Errors**: Subscribing to outbound `action` (with `sendDataModel` when enabled), `callAgentFunction`, `rendererFunctionResponse`, and `error` events.

#### How to Integrate with My Agent Server

- **Sources**: Link to [Agent SDKs](#agent-sdks) (`/concepts/agent-sdks/`) for package coordinates; verify APIs against `python/a2ui_agent/`, `python/a2ui_adk/`, `python/a2ui_a2a/`, `typescript/agents/a2ui_agent/`, `dart/a2ui_agent/`, and [`docs/public/guides/a2ui-with-any-agent-framework.md`](../public/guides/a2ui-with-any-agent-framework.md).
- **Content Outline** (tabbed across `TypeScript` | `Python` | `Dart`):
    1. **Overview**: Link to `/concepts/agent-sdks/` and summarize the 6 server steps.
    2. **Step 1: Install Dependencies**: Tabbed install commands matching `/concepts/agent-sdks/`.
    3. **Step 2: Configure `A2uiGenerator`, Catalogs & Inference Format**: Initializing `CatalogConfig` and `inference_format_factory` (with 1-sentence link to `/concepts/macros/` for `MacroExpander`).
    4. **Step 3: Negotiate Capabilities & Inject System Prompt**: Creating a request processor from `a2uiRendererCapabilities` and appending `prompt_snippet` to LLM system instructions.
    5. **Step 4: Parse Output, Validate & Self-Correct**: Using `parse_response` / `open_stream`, validating against `RendererState`, and feeding `VALIDATION_FAILED` errors back to the LLM for retry.
    6. **Step 5: Multi-Turn Actions & RPCs**: Feeding inbound `action` events (`context` + `sendDataModel`) into conversation state and answering `callAgentFunction` with `agentFunctionResponse`.
    7. **Step 6: Agent Framework & Transport Wiring**: Consolidate ADK (`a2ui-adk` toolset/store + `a2ui-adk[a2a]` `A2uiEventConverter`), A2A (`a2ui-a2a` part helpers), and AG-UI / CopilotKit / custom SSE or WebSocket harnesses.

#### How to Define a Catalog

- **Sources**: [`docs/public/guides/defining-your-own-catalog.md`](../public/guides/defining-your-own-catalog.md), [`docs/public/guides/authoring-components.md`](../public/guides/authoring-components.md), `/specification/v1.0/schemas/#catalog_definition.json`, [`catalogs/basic/v1/catalog.json`](../../catalogs/basic/v1/catalog.json), and [`specification/v0_9_1/catalogs/basic/catalog.json`](../../specification/v0_9_1/catalogs/basic/catalog.json).
- **Content Outline**:
    1. **When You Need a Standalone `catalog.json`**: Sharing a language-agnostic contract across separate agent and client runtimes.
    2. **Catalog Schema Anatomy (`v1.0` vs. `v0.9.1` Tabs)**: Envelope metadata (`$id`, `catalogId` URI, `protocolVersion`, `instructions`), top-level `components` and `functions` maps (direct component properties + `allowedParents`/`allowedChildren`/`checks` and function `returnType`/`allowedCallers`/`requiresUserActivation` in v1.0 vs. `allOf` `ComponentCommon` wrappers in v0.9.1), and `$defs` (`anyComponent`, `anyFunction`).
    3. **Ingesting on the Agent SDK**: Verified multi-SDK snippets loading `catalog.json` into `Catalog` / `CatalogConfig`.
    4. **Registering on the Client Renderer**: Implementing per-`Component` UI widgets and local `functions` and binding the `catalogId` in `MessageProcessor`.
    5. **Client-Server Schema Parity Testing**:
        - > **[VERIFICATION REQUIREMENT FOR IMPLEMENTING AGENT]**: Before recommending round-trip catalog JSON schema equality assertions across SDKs, check `dart/a2ui_core/test/catalog_json_test.dart` and verify how Python, TypeScript, Dart, and Swift serialize/validate `catalog.json` so the guide only recommends patterns that pass today.

#### Architecting an A2UI Integration

- **Content Outline**:
    1. **Catalog Strategy (Basic vs. Custom vs. Hybrid & Macros)**: Compare off-the-shelf Basic Catalog, custom design-system catalogs, and hybrid composition, plus a 1-sentence trade-off linking to [`/concepts/macros/`](#macros) (agile web client components vs. server macros avoiding mobile app-store release cycles).
    2. **Transport Selection**: Compare AG-UI & A2A (linking to [`/guides/agent-integration/`](#how-to-integrate-with-my-agent-server)), SSE + HTTP POST (noting HTTP/1.1 connection limits vs. HTTP/2), WebSockets (full-duplex RPCs), and MCP (`ui://` resources, linking to [`/guides/a2ui-over-mcp/`](#a2ui-over-mcp)).
    3. **Content Persistence & Session Replay**: Explain the **Wire-Only Replay Trap** (local two-way input bindings mutate `dataModel` without emitting wire messages, so replaying `agent_to_renderer` messages alone loses user form edits) and the recommended pattern (persisting per-surface `renderer_data_model.json` snapshots alongside messages, filtering transient `callRendererFunction` RPCs, and rendering historical turns read-only when appropriate) vs. static rendered snapshots.
    4. **Surface Scoping & Lifecycle**: Compare Conversation Scoping (single `MessageProcessor` per conversation enabling retroactive in-place updates) vs. Turn Scoping (isolated `MessageProcessor` per turn, requiring turn-prefixed unique `surfaceId`s like `turn_2_main` rather than reusing `"main"`).

#### How to Improve Latency

- **Content Outline**:
    1. **The Latency Equation**: Deconstruct Time-to-First-Meaningful-Render ($\text{TTFT} + \text{Output Tokens} \times \text{ITL} + \text{Transport} + \text{Client Render}$) and recommend emitting `root` early in `updateComponents`.
    2. **Lever 1 — Compact Inference Formats (Express)**: 1–2 sentence summary linking to [`/concepts/inference-formats/`](#swappable-inference-formats) for the canonical benchmark table.
    3. **Lever 2 — Component Granularity (Coarse Client Components vs. Server Macros)**: Contrast coarse client widgets with server `@macro` expansion, linking to [`/concepts/macros/`](#macros).
    4. **Lever 3 — Right-Sizing the LLM**: Pairing catalog-generated skills with fast models (e.g. Flash / Flash-Lite tiers) for 2x–3x higher decode throughput.
    5. **Lever 4 — Tuning Thinking Budget**: Setting `thinking_budget = 0` for structured catalog UI generation to eliminate pre-first-token thinking delay.
    6. **Lever 5 — Unbuffered Transport Flushing**: Disabling proxy buffering and feeding messages incrementally into `MessageProcessor.processMessages`.

#### A2UI over MCP

- Port [`docs/public/guides/a2ui_over_mcp.md`](../public/guides/a2ui_over_mcp.md), referencing [`samples/community/mcp/a2ui-over-mcp-recipe/`](../../samples/community/mcp/a2ui-over-mcp-recipe/).

#### MCP Apps in A2UI Surfaces

- Port [`docs/public/guides/mcp-apps-in-a2ui.md`](../public/guides/mcp-apps-in-a2ui.md) (Double-Iframe Isolation Pattern).

#### A2UI Dynamic Rendering within MCP Applications

- Port [`docs/public/guides/a2ui-in-mcp-apps.md`](../public/guides/a2ui-in-mcp-apps.md), referencing [`samples/community/mcp/a2ui-in-mcpapps/`](../../samples/community/mcp/a2ui-in-mcpapps/).

#### Authoring Universal Web Components

- Port [`docs/public/guides/authoring-universal-components.md`](../public/guides/authoring-universal-components.md) (`A2uiLitElement` shared across React, Angular, and Lit).

#### SDK Development

- **Canonical Owner**: Single home for Spec-Driven Development (SDD) blueprints and conformance testing.
- **Content Outline**:
    1. **Writing Your Own SDK**: Link to [`/concepts/agent-sdks/`](#agent-sdks) and [`/concepts/renderer-sdks/`](#renderer-sdks) for official SDKs, and explain how to build custom SDKs (e.g. Rust, Go, C#, Vue, Svelte).
    2. **Module Blueprints**: Point to [`a2ui_core.blueprint.md`](../../blueprints/modules/a2ui_core.blueprint.md), [`a2ui_agent.blueprint.md`](../../blueprints/modules/a2ui_agent.blueprint.md), and [`a2ui_framework_adapter.blueprint.md`](../../blueprints/modules/a2ui_framework_adapter.blueprint.md).
    3. **YAML Conformance Suites**: Explain validating implementations against [`conformance/core/`](../../conformance/core/), [`conformance/agent/`](../../conformance/agent/), and [`conformance/README.md`](../../conformance/README.md).

### Roadmap (`/roadmap/`)

> **[TODO]**: Roadmap scope and milestone structure to be defined later.

---

## 3. Ecosystem Section Outline

### Ecosystem Renderers & Tools (`/ecosystem/renderers/`)

- Port and clean up [`docs/public/ecosystem/renderers.md`](../public/ecosystem/renderers.md):
    1. **Introduction & Disclaimer**: Clarify community maintenance and link to [`/concepts/agent-sdks/`](#agent-sdks) and [`/concepts/renderer-sdks/`](#renderer-sdks) for official first-party SDKs.
    2. **Unified Community Renderers Table**: Project/package name, target platform/framework, supported protocol versions (`v0.8`, `v0.9.1`, `v1.0`), maintenance status, and repo/registry links.
    3. **Agent-Side Libraries & Ecosystem Utilities**: Community server libraries, transports, and developer tools.
    4. **Submitting to the Ecosystem**: PR instructions against `a2ui-project/a2ui`.

---

## 4. Specifications Section Outline

### 4.1 Navigation & Version Hierarchy

Single-source specification markdown files directly from `specification/` and `catalogs/` via `--8<--` includes (omitting `v0.9`, as `v0.9.1` supersedes it with minor patch refinements):

- **v1.0 (Candidate)** `[Badge: Candidate]`
    - `v1.0 Protocol Specification`: [`specification/v1_0/docs/a2ui_protocol.md`](../../specification/v1_0/docs/a2ui_protocol.md)
    - `v1.0 Custom Functions Guide`: [`specification/v1_0/docs/a2ui_custom_functions.md`](../../specification/v1_0/docs/a2ui_custom_functions.md)
    - `v1.0 SDKs Specification`: [`specification/v1_0/docs/sdks_spec.md`](../../specification/v1_0/docs/sdks_spec.md)
    - `v1.0 JSON Schemas Explorer`: `/specification/v1.0/schemas/`
    - `v1.0 A2A Extension`: [`specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md`](../../specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md)
    - `v1.0 Evolution Guide`: [`specification/v1_0/docs/evolution_guide.md`](../../specification/v1_0/docs/evolution_guide.md)
    - `v1.0 Basic Catalog Guide`: [`catalogs/basic/v1/basic_catalog_implementation_guide.md`](../../catalogs/basic/v1/basic_catalog_implementation_guide.md)
- **v0.9.1 (Active / Current)** `[Badge: Active]` _(note briefly that v0.9.1 supersedes v0.9)_
    - `v0.9.1 Protocol Specification`: [`specification/v0_9_1/docs/a2ui_protocol.md`](../../specification/v0_9_1/docs/a2ui_protocol.md)
    - `v0.9.1 Custom Functions Guide`: [`specification/v0_9_1/docs/a2ui_custom_functions.md`](../../specification/v0_9_1/docs/a2ui_custom_functions.md)
    - `v0.9.1 SDKs Specification`: [`specification/v0_9_1/docs/sdks_spec.md`](../../specification/v0_9_1/docs/sdks_spec.md)
    - `v0.9.1 JSON Schemas Explorer`: `/specification/v0.9.1/schemas/`
    - `v0.9.1 A2A Extension`: [`specification/v0_9_1/docs/a2ui_extension_specification.md`](../../specification/v0_9_1/docs/a2ui_extension_specification.md)
    - `v0.9.1 Evolution Guide`: [`specification/v0_9_1/docs/evolution_guide.md`](../../specification/v0_9_1/docs/evolution_guide.md)
    - `v0.9.1 Basic Catalog Guide`: [`specification/v0_9_1/docs/basic_catalog_implementation_guide.md`](../../specification/v0_9_1/docs/basic_catalog_implementation_guide.md)
- **v0.8 (Legacy)**
    - `v0.8 Protocol Specification`: [`specification/v0_8/docs/a2ui_protocol.md`](../../specification/v0_8/docs/a2ui_protocol.md)
    - `v0.8 JSON Schemas Explorer`: `/specification/v0.8/schemas/`
    - `v0.8 A2A Extension`: [`specification/v0_8/docs/a2ui_extension_specification.md`](../../specification/v0_8/docs/a2ui_extension_specification.md)
    - `v0.8 Custom Catalog Changes`: [`specification/v0_8/docs/custom_catalog_changes.md`](../../specification/v0_8/docs/custom_catalog_changes.md)

---

### 4.2 JSON Schemas Explorer & Permalink Architecture

Each version's **JSON Schemas Explorer** (`/specification/<ver>/schemas/`, implemented via `<SchemaExplorer version="<ver>" />`) renders all canonical schemas for that version on one interactive page while fulfilling the **Specification JSON Schema Permalink Contract**:

1. **Categorized Schema Selector**:
    - **v1.0**:
        - _Wire Messages_: `agent_to_renderer.json`, `renderer_to_agent.json`
        - _Common Types_: `common_types.json`
        - _Catalogs & Data Model_: `catalog_definition.json`, `renderer_data_model.json`, `basic_catalog.json` (`catalogs/basic/v1/catalog.json`), `mcp_catalog.json` (`catalogs/mcp/v1/catalog.json`)
        - _Capabilities_: `agent_capabilities.json`, `renderer_capabilities.json`
        - _Batching & Wrappers_: `agent_to_renderer_list.json`, `renderer_to_agent_list.json`, `agent_to_renderer_list_wrapper.json`, `renderer_to_agent_list_wrapper.json`
    - **v0.9.1**:
        - _Wire Messages_: `server_to_client.json`, `client_to_server.json`
        - _Common Types_: `common_types.json`
        - _Catalogs & Data Model_: `client_data_model.json`, `basic_catalog.json` (`specification/v0_9_1/catalogs/basic/catalog.json`)
        - _Capabilities_: `server_capabilities.json`, `client_capabilities.json`
        - _Batching & Wrappers_: `server_to_client_list.json`, `client_to_server_list.json`, `server_to_client_list_wrapper.json`, `client_to_server_list_wrapper.json`
    - **v0.8**:
        - _Wire Messages_: `server_to_client.json`, `client_to_server.json`, `server_to_client_with_standard_catalog.json`
        - _Catalogs & Capabilities_: `standard_catalog_definition.json`, `catalog_description_schema.json`, `a2ui_client_capabilities_schema.json`
2. **Utility Bar per Schema**:
    - Displays the canonical `$id` URI with a 1-click **Copy `$id`** button, a **Raw JSON** link (pointing to the static schema staged in `public/specification/` by [`prepare-spec-assets.mjs`](scripts/prepare-spec-assets.mjs)), and a **Jump to Definition / Copy Permalink** dropdown.
3. **Permalink Contract Implementation**:
    - **Build-Time Pointer-to-Line Index**: At Astro build time, `<SchemaExplorer />` reads each canonical JSON file directly from disk (zero duplication) and parses a JSON AST to emit a `{ "<json-pointer>": [startLine, endLine] }` map indexing top-level keys plus `$defs/*`, `components/*`, `functions/*`, and `properties/*` alongside the Expressive Code block.
    - **Client-Side Fragment Resolution**: On `DOMContentLoaded` and `hashchange`, a client script parses `location.hash` (`#<schema-file>` or `#<schema-file>/<json-pointer>`), activates the matching schema panel, highlights lines `startLine..endLine` in Expressive Code, and scrolls the definition into view.
    - **Automatic Spec Link Rewriting**: Update [`remark-a2ui-includes.mjs`](src/plugins/remark-a2ui-includes.mjs) so relative links to `../json/<file>.json` or `../json/<file>.json#/$defs/...` inside single-sourced `specification/*/docs/*.md` files rewrite to `/specification/<ver>/schemas/#<file>.json/$defs/...` instead of raw `.json` endpoints.
    - **Build-Time Permalink Verification**: Provide a verification script checking every `/specification/<ver>/schemas/#...` link across `src/content/docs/` against the parsed JSON schemas so broken schema pointers fail CI.

---

### 4.3 Basic Catalog Guidance & Custom Catalog Cross-Linking

- Across all versioned Basic Catalog guides, add a callout clarifying that the Basic Catalog is an optional, styleable reference catalog included for convenience, linking developers to [How to Define a Catalog](#how-to-define-a-catalog) (`/guides/defining-a-catalog/`).
