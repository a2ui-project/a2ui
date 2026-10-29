# A2UI Site Architecture & Content Outline (Meta-Document)

> **Internal Planning Document — Not for Publication**  
> This file describes the overall structure and content outline for the new `a2ui.org` website and documentation at `docs/site/`. It is a meta-document used to plan and iterate on sections before authoring and building the actual site pages.

---

## Overall Site Structure

1. **Landing Page (`/`)**: High-impact developer landing page introducing A2UI, the Generative UI spectrum, production use cases, and core technical differentiators.
2. **Docs Section (`/docs/...`)**: Quickstart, conceptual foundations, integration guides, and developer tutorials.
3. **Ecosystem Section (`/ecosystem/...`)**: Community renderers, third-party framework adapters, tools, and community-built agent libraries.
4. **Specification Section (`/specification/...`)**: Versioned protocol specifications, extension guides, and catalog schemas (single-sourced from the root `specification/` directory).

---

## 1. Landing Page Outline (`src/pages/index.astro`)

### Part I: The Problem, The Spectrum & Real-World Adoption

1. **Hero: Give your agents UI on every surface**
   - Headline & value proposition: Chat is a great input, but walls of prose are a terrible output. Give your agents stateful, native UI across mobile, desktop, and web.
   - Interactive visual aid contrasting raw LLM text against an interactive, stateful A2UI surface bound to `dataModel` at 60fps.
2. **The Generative UI Spectrum**
   - Explains how one A2UI environment spans the entire spectrum:
     - **Fully Controlled**: Developer-built deterministic SDUI & fixed schemas.
     - **Controlled / Server Macros**: Predictable domain components chosen by the agent.
     - **Declarative Generative UI**: Agent composes Lego-like catalog primitives on demand for the long tail.
     - **Open-Ended & MCP Apps**: Embedded `ui://` MCP App sandboxes and bespoke surfaces.
   - Interactive spectrum explorer demonstrating control vs. autonomy trade-offs.
3. **Real Use Cases in Production**
   - **Logo Bar**: JetBrains, Alation, ByteDance, Google Home, Gemini Notebook (plus Google Opal & Flutter GenUI).
   - **Interactive Use-Case Tabs with Visual Previews/Screenshots**: Switchable tabs showcasing how each product uses A2UI along the spectrum with architectural highlights.

### Part II: Why A2UI? (Core Technical Differentiators)

4. **Express: Compact inference format (~70–80% fewer output tokens than JSON)**
   - High-level visual teaser contrasting compact Express DSL against wire JSON, linking to the canonical [Swappable Inference Formats](#swappable-inference-formats) concept page for full pipeline details and benchmarks.
5. **Macros: Give the model bigger words**
   - High-level teaser illustrating how server-defined `@macro` calls expand on the server into standard primitive nodes on the wire, linking to the canonical [Macros](#macros) concept page.
6. **Native Rendering across Mobile, Desktop, and Web**
   - Interactive 6-platform renderer switcher (Flutter, React, Angular, Lit Web Components, SwiftUI, Jetpack Compose) showing native host widgets alongside SDK code and ecosystem transports.

---

## 2. Docs Section Outline

### Quick start
> **[TODO]**: Approach and structure to be decided later (e.g. interactive 5-minute sandbox, starter repository template, or CLI walkthrough).

### Concepts

#### Overview: How A2UI Works

##### Authoring Guidance & Presentation Rules
- **Purpose**: Serves as the conceptual entry point for first-time readers, establishing the core mental model and vocabulary before diving into component catalogs, state binding, or wire messages.
- **Diagram Format**: Use a bespoke Astro/Tailwind visual component (`<ArchitectureOverview />`) showing the end-to-end flow from Agent to Client Renderer.

##### Page Content Outline
1. **The Core Mental Model**:
   - Introduce the five foundational building blocks of A2UI:
     - **Agent**: The server or local runtime (LLM, decision model, or deterministic tool) that generates UI declarations and responds to user interactions.
     - **Renderer**: The native client framework adapter (Flutter, React, Angular, Lit, SwiftUI, Jetpack Compose) that mounts and renders native host widgets.
     - **Surface**: An isolated UI canvas identified by a unique `surfaceId` (e.g. a card in a chat stream, a side panel, or a full-screen dashboard) holding a component tree and a reactive `dataModel`.
     - **Catalog**: A versioned contract declaring the allowed UI components (`Button`, `Card`, `TextField`) and client-evaluable functions (`formatCurrency`, `required`) that an agent can use on a surface.
     - **Transport**: The communication channel (AG-UI, A2A, SSE, WebSockets, or MCP) carrying messages between the Agent and the Renderer.
2. **End-to-End Architecture Diagram (`<ArchitectureOverview />`)**:
   - Visual 4-stage horizontal card layout:
     1. **Agent SDK (`a2ui-agent-sdk` / `@a2ui/agent` / `a2ui_agent`)**: Reflects over the active `Catalog` to synthesize system prompts, parses LLM output in a swappable inference format (e.g. Express or Direct JSON), and validates output against the catalog schema.
     2. **Wire Transport**: Streams validated A2UI JSON messages (`createSurface`, `updateComponents`, `updateDataModel`) over AG-UI, A2A, SSE, WebSockets, or MCP.
     3. **Core State Engine (`@a2ui/web_core` / `a2ui_core` / `A2UICore`)**: `MessageProcessor` ingests messages, manages surface lifecycles, resolves JSON Pointer data bindings (`@path`), and evaluates local catalog functions (`@call`).
     4. **Native Framework Adapter**: Renders stateful native widgets at 60fps and dispatches user `action` events back to the Agent.
3. **Capabilities & Catalog Negotiation**:
   - Explain how the client advertises which catalogs it can render via `a2uiRendererCapabilities` (`supportedCatalogIds`, `inlineCatalogs`), and how the agent negotiates the active catalog for a session or turn.

#### Catalogs, Components and Functions

##### Authoring Guidance & Presentation Rules
- **Diagram Format**: Use a bespoke Astro/Tailwind visual component (`<CatalogAnatomy />`) with structured cards, status badges, and monospace chips—avoiding raw Mermaid `graph TD` flowcharts.
- **Multi-SDK Tabs**: Clearly distinguish between **Agent SDK** definitions (`TypeScript`, `Python`, `Dart`) and **Client Renderer** widget registrations (`Flutter`, `Web (React / Angular / Lit)`, `SwiftUI`, `Jetpack Compose`).

##### Page Content Outline

1. **Catalog Anatomy Visual Component (`<CatalogAnatomy />`)**:
   - Specify a structured two-column Tailwind card layout at the top of the page:
     - **Primary Card — `Catalog: https://example.com/catalogs/store.json`**:
       - *Column 1: Components (UI Primitives)*: Chips for `Button`, `Text`, `Card`, `TextField` with property and child-slot badges.
       - *Column 2: Functions (Catalog-Declared)*: Chips for `formatCurrency(value, currency)` (`rendererOnly`) and `validateStock(sku, qty)` (`rendererOrAgent`).
     - **Callout Card — `Execution & Caller Boundaries (`allowedCallers`)`**:
       - Explains how catalog functions declare `allowedCallers` (`rendererOnly` | `agentOnly` | `rendererOrAgent`) and `requiresUserActivation`, and distinguishes catalog-declared functions from pure agent-side business endpoints.

2. **Conceptual Foundations**:
   - **Catalogs**: A versioned contract and namespace (`catalogId`, recommended as a URI) identifying the UI components, functions, and prompt instructions (`instructions`) available on a surface.
   - **Components**: Declarative, composable UI building blocks with typed properties, child slots (`ChildList`), validation rules (`checks`), hierarchy constraints (`allowedParents`, `allowedChildren`), and action handlers.
   - **Functions & Execution Boundaries**:
     - *Local Renderer Functions*: Evaluated directly on the client renderer (e.g. `formatString`, `formatCurrency`, `required`, `regex`, `numeric`) with zero network latency.
     - *Remote Agent Functions (`callAgentFunction`)*: Invoked by the renderer when a function executes on the agent server. Functions declared in a catalog can constrain who may invoke them via `allowedCallers` (`rendererOnly`, `agentOnly`, `rendererOrAgent`) and enforce human gesture checks via `requiresUserActivation: true` (e.g. `openUrl`).

3. **Using and Extending Catalogs Across SDKs**:
   - **Agent Side (Loading & Transforming Catalogs — Tabs: `TypeScript` | `Python` | `Dart`)**:
     ```python
     # Python: Loading a catalog JSON and pruning components for an agent
     from a2ui.catalog_transformers import ComponentPruningTransformer
     from a2ui.core import Catalog
     from a2ui.processor import CatalogConfig

     store_catalog = Catalog.from_json(catalog_json_str)
     config = CatalogConfig(
         catalog=store_catalog,
         transformers=[ComponentPruningTransformer(allowed_components=["Card", "Text", "Button"])],
     )
     ```
   - **Client Renderer Side (Registering Component Adapters — Tabs: `Flutter` | `Web (React / Angular / Lit)` | `SwiftUI` | `Jetpack Compose`)**:
     - Show how each framework adapter maps catalog component names (e.g. `"FlightStatusCard"`) to native host widgets and registers local function implementations with the `MessageProcessor`.

4. **The Basic Catalog (Reference Catalog)**:
   - Explain that the Basic Catalog ([`catalogs/basic/v1/catalog.json`](../../catalogs/basic/v1/catalog.json)) is a styleable reference catalog included out of the box.
   - Highlight developer flexibility: teams can use it directly, ignore it in favor of custom domain catalogs, reimplement it against their own design system widgets, or mix catalogs on the same surface (using component-level `catalogId` overrides).

#### Data Model and Data Binding

##### Authoring Guidance & Presentation Rules
- **Tone & Style**: Neutral, clear technical prose following the `natural-writing` skill.
- **Strict Schema Validation**: Every JSON snippet must validate against `specification/v1_0/json/` and `specification/v0_9_1/json/`. Present wire JSON in synced **v1.0 (Candidate)** and **v0.9.1 (Current)** tabs (`@path`/`@call` in v1.0 vs. `path`/`call` in v0.9.1).
- **Visuals**: Include a bespoke side-by-side visual card (`<DataBindingAnatomy />`) mapping a surface `dataModel` JSON tree to bound UI widget properties.

##### Page Content Outline

1. **What is the Data Model?**:
   - **Per-Surface Reactive State**: A reactive JSON object tree scoped to a specific `surfaceId`.
   - **Decoupled from UI Hierarchy**: The data model exists independently of the component tree. An agent can stream state updates via `updateDataModel` (using JSON Pointer paths, upsert semantics, and `value: null` for key deletion) without resending or rebuilding the UI component hierarchy.
2. **Populating the Data Model: Deterministic vs. Generative**:
   - **Deterministic Sources**: External API responses, database queries, or tool outputs can populate the data model directly.
   - **Direct LLM Generation**: Agents can emit initial `dataModel` state in `createSurface` or stream incremental `updateDataModel` messages.
3. **Visual Architecture (`<DataBindingAnatomy />`)**:
   - Left card: Surface `dataModel` JSON (e.g. an order summary with `/order/items`, `/invoice/total`).
   - Right card: Rendered UI view with pointer callouts linking widget properties to JSON Pointers.
4. **Core Data Binding Patterns**:
   - **Pattern 1: Two-Way Input Binding & Action Context**:
     - Interactive inputs (e.g. `TextField`, `CheckBox`) bind their `value` to a data model path (e.g. `/form/email`). When the user types, the renderer mutates the local `dataModel` immediately.
     - A submit `Button` references those paths in its action `context` (shown in **v1.0** and **v0.9.1** tabs):
       - **v1.0**:
         ```json
         "context": {
           "email": { "@path": "/form/email" },
           "optIn": { "@path": "/form/subscribeNewsletter" }
         }
         ```
       - **v0.9.1**:
         ```json
         "context": {
           "email": { "path": "/form/email" },
           "optIn": { "path": "/form/subscribeNewsletter" }
         }
         ```
   - **Pattern 2: Reactive Formatting & String Interpolation (`@call` & `formatString`)**:
     - Component properties can bind to catalog functions whose arguments reference data model paths:
       - **v1.0**:
         ```json
         "text": {
           "@call": "formatCurrency",
           "args": {
             "value": { "@path": "/invoice/total" },
             "currency": "USD"
           }
         }
         ```
       - **v0.9.1**:
         ```json
         "text": {
           "call": "formatCurrency",
           "args": {
             "value": { "path": "/invoice/total" },
             "currency": "USD"
           }
         }
         ```
     - Show string interpolation using `formatString` with `${/path}` and nested function expressions (e.g. `"Hello ${/user/name}, your total is ${formatCurrency(value: ${/invoice/total}, currency: 'USD')}"`).
   - **Pattern 3: Local Control-to-Control Two-Way Binding**:
     - A `Slider` bound to `/settings/volume` and a `Text` widget bound to `/settings/volume` update in lockstep on the client at 60fps with zero network round-trips.
   - **Pattern 4: Collection Scopes & Dynamic List Templates (`ChildList` & `@index`)**:
     - Explain how container components (`List`, `Row`, `Column`) dynamically generate children from a data model array using a template object:
       ```json
       "children": {
         "path": "/breeds",
         "componentId": "breedTemplate"
       }
       ```
     - Explain **relative JSON Pointer paths** inside the template component (e.g. `{"@path": "url"}` resolves relative to the current array element) and index binding via `@index`.
5. **Synchronizing State Back to the Agent (`context` vs. `sendDataModel`)**:
   - Clarify that local two-way bindings do **not** stream every keystroke over the wire.
   - State returns to the agent when an `action` or `callAgentFunction` is triggered:
     - **Explicit Action Context**: Resolves only the paths declared in `action.event.context`.
     - **Full Surface State Sync (`sendDataModel: true`)**: When `createSurface` specifies `"sendDataModel": true`, the renderer attaches the full surface data model in the outbound message metadata (sent strictly to the agent that created the surface).

#### Actions and Functions

##### Authoring Guidance & Presentation Rules
- **Tone & Style**: Direct, technical explanation following the `natural-writing` skill.
- **Version Parity**: Present wire payloads in synced **v1.0 (Candidate)** and **v0.9.1 (Current)** tabs.

##### Page Content Outline

1. **The Four Execution Paths**:
   Present a structured 4-row matrix comparing how interactions and logic execute across the protocol:

   | Execution Path | Trigger | Executor | Wire Message(s) | Catalog & Security Rules |
   | :--- | :--- | :--- | :--- | :--- |
   | **1. User Action Event** (`action.event`) | User gesture (e.g. button click) | Agent LLM or server handler | `action` (Renderer $\rightarrow$ Agent) | Resolves `context` pointers before sending |
   | **2. Local Client Function** (`action.functionCall` or property `@call`) | User gesture or reactive data binding | Client Renderer (local) | *None (zero network round-trip)* | Must be registered locally; `allowedCallers`: `rendererOnly` or `rendererOrAgent` |
   | **3. Renderer-to-Agent RPC** (`callAgentFunction`) | Client function call targeting remote function | Agent Server endpoint | `callAgentFunction` $\rightarrow$ `agentFunctionResponse` | `allowedCallers`: `agentOnly` or `rendererOrAgent` |
   | **4. Agent-to-Renderer RPC** (`callRendererFunction`) | Agent instruction during active session | Client Renderer | `callRendererFunction` $\rightarrow$ `rendererFunctionResponse` | Cannot invoke functions with `requiresUserActivation: true` |

   - > **Warning — Implicit Fallback Routing**: Per the v1.0 specification (`§callAgentFunction`), if a component invokes a function name that is **not** registered in the client renderer's local function table, the renderer automatically falls back to dispatching it as a `callAgentFunction` RPC over the network. A typo in a local function name will therefore result in an unexpected network call that fails with `UNKNOWN_FUNCTION`.

2. **Actions with Context & Dynamic `userMessage`**:
   - Show how an interactive component declares an `action.event` with resolved `context` and a `DynamicString` `userMessage` (using `formatString` for interpolation, in **v1.0** and **v0.9.1** tabs):
     - **v1.0**:
       ```json
       "action": {
         "event": {
           "name": "book_flight",
           "userMessage": {
             "@call": "formatString",
             "args": {
               "value": "Booking flight AA120 for ${/booking/name}"
             }
           },
           "context": {
             "flightNumber": "AA120",
             "passengerName": { "@path": "/booking/name" },
             "seat": { "@path": "/booking/selectedSeat" }
           }
         }
       }
       ```
     - **v0.9.1**:
       ```json
       "action": {
         "event": {
           "name": "book_flight",
           "context": {
             "flightNumber": "AA120",
             "passengerName": { "path": "/booking/name" },
             "seat": { "path": "/booking/selectedSeat" }
           }
         }
       }
       ```

3. **Lifecycle & Wire Messages Associated with Actions**:
   - **Step 1: Declaration**: The agent sends a `Button` component with `action.event` (and optional `checks` to disable the button until form validation passes).
   - **Step 2: Trigger & Context Resolution**: The user clicks the button. The renderer evaluates all `@path` / `@call` expressions in `userMessage` and `context` against the current `dataModel`.
   - **Step 3: Renderer-to-Agent Message**:
     ```json
     {
       "version": "1.0",
       "action": {
         "name": "book_flight",
         "userMessage": "Booking flight AA120 for Alice",
         "surfaceId": "flight_checkout_1",
         "sourceComponentId": "btn_confirm",
         "timestamp": "2026-10-29T15:00:00Z",
         "context": {
           "flightNumber": "AA120",
           "passengerName": "Alice",
           "seat": "14B"
         }
       }
     }
     ```
   - **Step 4: Agent Response**: The agent processes the action and streams back `updateDataModel` or `updateComponents` messages.

#### Messages and Lifecycle

##### Authoring Guidance & Presentation Rules
- **Nomenclature and Version Tabs**:
  - Present comparative tabbed examples labeled **v1.0 (Candidate)** and **v0.9.1 (Current)** synced across the page.
  - Include a concise **v0.9.1 $\rightarrow$ v1.0 Terminology & Wire Delta Table** (`server_to_client` $\rightarrow$ `agent_to_renderer`, `client_to_server` $\rightarrow$ `renderer_to_agent`, `path` $\rightarrow$ `@path`, `call` $\rightarrow$ `@call`, `theme` removed from `createSurface`, inline `components`/`dataModel` added to `createSurface`, UAX #31 component IDs).
- **Diagram Format**:
  - Use **Themed Mermaid (`sequenceDiagram`)** for the temporal message exchange. *(Prerequisite: add `starlight-mermaid` to `docs/site/package.json` and `docs/site/astro.config.mjs`).*

##### Page Content Outline

1. **Lifecycle Overview & Sequence Diagram**:
   ```mermaid
   sequenceDiagram
       autonumber
       actor User
       participant Renderer
       participant Agent

       Agent->>Renderer: createSurface (surfaceId, catalogId, sendDataModel)
       Agent->>Renderer: updateComponents (flat component array with "root")
       Agent->>Renderer: updateDataModel (initial state / streaming values)
       Note over Renderer: Surface rendered and bound to dataModel
       User->>Renderer: Interacts with UI (types, clicks button)
       Renderer->>Agent: action (resolved context + optional dataModel metadata)
       Agent->>Renderer: updateDataModel / updateComponents (reactive updates)
       opt Renderer-Initiated RPC (v1.0)
           Renderer->>Agent: callAgentFunction (functionCallId, callFunction)
           Agent->>Renderer: agentFunctionResponse (functionCallId, result / error)
       end
       opt Agent-Initiated RPC (v1.0)
           Agent->>Renderer: callRendererFunction (functionCallId, callFunction)
           Renderer->>Agent: rendererFunctionResponse (functionCallId, result / error)
       end
       alt Validation or Execution Failure
           Renderer->>Agent: error (code, path, message, surfaceId)
       end
       opt Tear Down
           Agent->>Renderer: deleteSurface (surfaceId)
       end
   ```

2. **The Flat Component Tree (Adjacency List) & ID Rules**:
   - Explain why A2UI uses a **flat array of component objects with ID references** (e.g. `children: ["btn_one", "btn_two"]`) rather than deeply nested JSON trees:
     - **Streaming-First**: Components can be emitted progressively one object at a time without balancing deep closing braces.
     - **Out-of-Order Buffering**: There must be exactly one component with `id: "root"` per surface, but non-root components arriving before `root` (or child IDs not yet received) are buffered seamlessly with placeholders until resolved.
     - **Targeted Subtree Updates**: Later `updateComponents` messages can replace or insert individual nodes by `id` without resending the rest of the tree (and may omit `root` if `root` was already established).
     - **Identifier Format**: In v1.0, component IDs must be valid UAX #31 identifiers (e.g. `btn_one`, `userCard`; hyphenated IDs like `btn-1` are invalid in v1.0, whereas v0.9.1 was more permissive).

3. **Agent-to-Renderer Messages**:
   - `createSurface`:
     - Allocates a surface identified by a globally unique `surfaceId` (creating an already-existing `surfaceId` without deleting it first raises `INTEGRITY_ERROR`).
     - **Catalog Resolution Order**: In v1.0, `catalogId` resolution checks (1) component/function `catalogId`, (2) the surface's `catalogId` from `createSurface`, and (3) if neither is specified, raises a resolution error (there is **no** implicit fallback to renderer capabilities). In v0.9.1, `catalogId` is required on `createSurface`.
     - Includes `sendDataModel` (boolean), optional `metadata`, and (in v1.0) optional inline `components` and `dataModel`.
   - `updateComponents`:
     - Adds or updates components by `id` within the surface's flat component map.
   - `updateDataModel`:
     - Upserts data at a JSON Pointer `path` (or root `/`). Setting `value: null` deletes the target key.
   - `deleteSurface`:
     - Tears down the surface and frees state and subscriptions.
   - `callRendererFunction` & `agentFunctionResponse` *(v1.0)*:
     - Bidirectional RPC envelopes correlated by `functionCallId`.

4. **Renderer-to-Agent Messages & Self-Correction Loop**:
   - `action`: User interaction event payload.
   - `callAgentFunction` & `rendererFunctionResponse` *(v1.0)*: RPC request and response envelopes.
   - `error` & **The Self-Correction Loop**:
     - Document the standard error codes: `VALIDATION_FAILED`, `UNALLOWED_PARENT`, `UNALLOWED_CHILD`, `INTEGRITY_ERROR`, `INVALID_FUNCTION_CALL`, `EXECUTION_ERROR`, `EXPRESSION_ERROR`, and `UNKNOWN_FUNCTION`.
     - Explain how both the Agent SDK (`validate_payload` / `RendererState`) and the Client Renderer validate messages and feed structured validation errors back to the LLM to automatically self-correct malformed UI outputs.

#### Swappable Inference Formats

##### Authoring Guidance & Presentation Rules
- **Reference**: Grounded in [Google Developers Blog: *Fast and Reliable Agent-to-UI (A2UI)*](https://developers.googleblog.com/fast-reliable-a2ui/) and `python/a2ui_agent/src/a2ui/inference_formats/`.
- **Single Canonical Home**: This page is the single authoritative home explaining inference formats and token/latency benchmarks. Other pages (Landing Page, Latency Guide) should summarize in 1–2 sentences and link here.
- **Visuals**: Use a bespoke Astro/Tailwind 3-stage pipeline component (`<InferencePipeline />`) rather than a raw Mermaid flowchart.

##### Page Content Outline

1. **Wire Standard vs. Generation Formats**:
   - **Canonical Wire Format**: All client renderers consume standard A2UI JSON over the wire.
   - **Swappable Generation Formats**: On the agent server, how the LLM generates UI is decoupled from the wire format:
     - **Express (`ExpressFormatFactory` — Default in Agent SDK)**: A compact, positional DSL (`<a2ui-express>...</a2ui-express>`) that eliminates JSON punctuation overhead and compiles whole blocks into wire JSON.
     - **Direct JSON (`DirectJsonFormatFactory`)**: Instructs the LLM to emit A2UI JSON (`<a2ui-json>...</a2ui-json>`). Supports fine-grained incremental chunk healing via `DirectJsonParser.open_stream()`.
     - **Experimental Formats (`[Badge: Experimental]`)**: **Atom** and **Elemental** (`a2ui.inference_formats.experimental`), exploring ultra-compact and structural streaming trade-offs.

2. **Inference Pipeline Visual Component (`<InferencePipeline />`)**:
   - Specify a 3-stage horizontal Astro/Tailwind visual card:
     - **Stage 1: Prompt Synthesis**: `Catalog Schema` + `JSON Examples` $\rightarrow$ `PromptGenerator` & `Decompiler` $\rightarrow$ `System Prompt Snippet`.
     - **Stage 2: Model Generation**: `LLM` generates compact output (e.g. `Express` or `Direct JSON`).
     - **Stage 3: Wire Compilation & Validation**: `Parser` compiles notation into canonical A2UI JSON, validates against `RendererState`, and streams to the `Client Renderer`.

3. **Configuring the Inference Format (Agent SDK Tabs: `TypeScript` | `Python` | `Dart`)**:
   - Note that `ExpressFormatFactory` is the default in `A2uiGenerator`, and show how to configure or swap to `DirectJsonFormatFactory`:
     ```python
     # Python: Configuring A2uiGenerator with Express (default) or Direct JSON
     from a2ui.inference_formats import DirectJsonFormatFactory, ExpressFormatFactory
     from a2ui.processor import A2uiGenerator, CatalogConfig

     generator = A2uiGenerator(
         catalogs=[CatalogConfig.from_path("path/to/catalog.json")],
         format_factory=ExpressFormatFactory(),  # Or DirectJsonFormatFactory()
     )
     ```

4. **Comparative Example & Canonical Benchmarks: Direct JSON vs. Express**:
   - Side-by-side comparison generated via the Express decompiler (e.g. `05_product-card.a2ui` / `10_notification-permission.a2ui`):
     ```a2ui
     $/price = 199.99
     root = Card(main_column)
     main_column = Column([title_text, price_text, add_cart_btn])
     title_text = Text("Wireless Headphones Pro")
     price_text = Text(formatCurrency($/price, "USD"))
     add_cart_btn = Button(Text("Add to Cart"), "primary", Event("addToCart"))
     ```
   - **Authoritative Token & Latency Benchmark Table**:
     - Present a single unified table comparing character count, output token count (~70–80% reduction / ~3.8x fewer output tokens for Express vs. raw JSON), and total decode time across model tiers, noting the evaluation methodology under `eval/`.

5. **Driving A2UI via Decision Models**:
   - Explain how deterministic decision models or state machines can drive A2UI for zero-hallucination regulated workflows, linking to [Fast and Reliable A2UI](https://developers.googleblog.com/fast-reliable-a2ui/).

#### Macros

##### Authoring Guidance & Presentation Rules
- **Reference**: Grounded in `python/a2ui_agent/src/a2ui/transformers/macros/README.md` and `samples/community/macros/README.md`.
- **Single Canonical Home**: This page is the single canonical explanation of server-side macros. Other pages (`Architectural Options`, `How to Improve Latency`, `How to Integrate with My Agent Server`) should provide a 1-sentence summary and link here.

##### Page Content Outline

1. **What are Macros?**:
   - **Composite Components from Primitives**: Macros let developers define coarse-grained domain components on the agent server in terms of smaller catalog primitives (`Card`, `Column`, `Row`, `Text`, `Button`).
   - **Server-Side Expansion (`MacroExpander`)**: The LLM outputs a concise macro call; the agent server expands it into standard primitive components before transmitting over the wire. Client renderers require zero custom widget code or binary updates.

2. **Core Benefits & Architectural Trade-Offs**:
   - **Server-Side Data Baking**: Internal services or sensitive fields can be queried and injected inside the macro function on the server so the LLM only passes high-level identifiers (reducing token overhead and avoiding exposing raw backend records to the prompt).
   - **Token & Latency Reduction**: Compresses a multi-node component subtree into a single macro invocation.
   - **Important Nuances & Edge Cases**:
     - *Static Expansion vs. Reactive State*: Values baked directly into component properties during macro expansion become static literals on the wire; data that must update reactively or support two-way user editing should be written to the surface `dataModel` and bound via `@path`.
     - *Component ID Uniqueness*: When a macro is invoked multiple times on the same surface, expanded child component IDs must be uniquely scoped per invocation to avoid ID collisions.

3. **Visual Walkthrough: Macro Definition $\rightarrow$ Express Call $\rightarrow$ Expanded Wire Components**:
   - **Stage 1: Macro Definition (`Python`)**:
     ```python
     @macro
     def FlightCard(flight_number: str, on_check_in: Action) -> Card:
         """Renders a flight status card with gate and departure info."""
         flight_info = flight_service.lookup(flight_number)
         return Card(
             child=Column(
                 children=[
                     Text(text=f"Flight {flight_number}"),
                     Text(text=f"Status: {flight_info.status} • Gate {flight_info.gate}"),
                     Button(child=Text(text="Check In"), action=on_check_in, variant="primary"),
                 ]
             )
         )
     ```
   - **Stage 2: Express Invocation**:
     ```a2ui
     root = Column([card_1])
     card_1 = FlightCard("UA852", Event("checkIn"))
     ```
   - **Stage 3: Lowered Wire Output & Rendered Surface**:
     - Show how `expander.transform_to_transport(typed_messages)` lowers `FlightCard` into standard `Card`, `Column`, `Text`, and `Button` components.

4. **Using Macros in Your Agent**:
   - Concise overview of wiring `@macro` functions into `MacroExpander`, generating `inference_catalog = expander.transform_to_inference_catalog(base_catalog)`, and calling `expander.transform_to_transport(messages)`. (Note: for custom catalogs, document how `a2ui_cli` codegen generates builder classes when working from a repository checkout).

#### Security and Trust Boundaries

##### Authoring Guidance & Presentation Rules
- **Reference**: Grounded in `specification/v1_0/docs/a2ui_protocol.md` and `specification/v1_0/docs/a2ui_custom_functions.md`.
- **Purpose**: Explains why A2UI is safe to render in production applications compared to raw HTML/JS injection.

##### Page Content Outline
1. **Declarative Wire Protocol (Zero Executable Code)**:
   - Agents never transmit executable JavaScript, HTML `<script>` tags, or arbitrary styles over the wire—only structured JSON component trees and data models.
2. **The Catalog as an Explicit Allowlist**:
   - Client renderers only mount component types and execute functions explicitly registered in the application's trusted catalog registry.
   - Strict JSON Schema validation (`additionalProperties: false` / `unevaluatedProperties: false`) strips or rejects undeclared properties and malformed payloads.
3. **Function Execution & Activation Controls (`allowedCallers` & `requiresUserActivation`)**:
   - `allowedCallers` (`rendererOnly`, `agentOnly`, `rendererOrAgent`) enforces strict caller isolation so an agent cannot remotely invoke internal renderer-only functions.
   - `requiresUserActivation: true` guarantees that sensitive client functions (such as `openUrl`) can only be triggered by a direct human gesture (e.g. a user clicking a button), preventing an agent from silently triggering external navigation on surface load or via `callRendererFunction`.
4. **Data Model Privacy & Multi-Agent Isolation**:
   - A surface's `dataModel` is scoped strictly to that surface. When `sendDataModel: true` is used, state updates are only transmitted back to the specific agent that created the surface, preventing cross-agent data leakage.
5. **Sandboxed Third-Party Micro-Apps (Double-Iframe Isolation)**:
   - When embedding full HTML/JS applications via Model Context Protocol (MCP Apps), A2UI enforces a double-iframe sandbox excluding `allow-same-origin`. Cross-link to [MCP Apps in A2UI Surfaces](#mcp-apps-in-a2ui-surfaces-guidesmcp-apps-in-a2ui).

#### Accessibility (A11y)

##### Authoring Guidance & Presentation Rules
- **Reference**: Grounded in `specification/v1_0/docs/a2ui_protocol.md` (Catalog-Agnostic Accessibility Requirements) and `common_types.json`.
- **Tone & Style**: Neutral, authoritative technical prose following the `natural-writing` skill.

##### Page Content Outline

1. **Why A2UI is Inherently Accessible**:
   - Unlike screenshot-based or canvas-rendered UI, A2UI generates structured, semantic widget trees accessible to native screen readers, switch controls, and keyboard navigation.
2. **Protocol Specification (`AccessibilityAttributes`)**:
   - Every component inherits `accessibility` attributes via `ComponentCommon`:
     ```json
     "accessibility": {
       "label": "Close dialog",
       "description": "Dismisses the current window and returns to dashboard",
       "live": "polite",
       "hidden": false
     }
     ```
   - Explain `label` (`DynamicString`), `description` (`DynamicString`), `live` (`"off"` | `"polite"` | `"assertive"`), and `hidden` (`DynamicBoolean`).
3. **Requirements on Catalog & SDK Developers**:
   - Catalog schemas must provide accessible properties where text cannot be inferred from children, and SDK linters **must** validate accessibility constraints.
   - **Streaming & Live Region Throttling**: When streaming rapid token updates into components with `live: "polite"` or `"assertive"`, renderers should debounce announcements so screen readers are not flooded with per-token interruptions.
4. **Framework Adapter Mappings**:
   - **Flutter**: `Semantics(label: ..., hint: ..., liveRegion: ..., excludeSemantics: ...)`
   - **Web (React / Angular / Lit)**: WAI-ARIA attributes (`aria-label`, `aria-describedby`, `aria-live`, `aria-hidden`) and semantic HTML elements.
   - **SwiftUI**: `.accessibilityLabel()`, `.accessibilityHint()`, `.accessibilityHidden()`, and accessibility announcements for `live` regions.
   - **Jetpack Compose**: `Modifier.semantics { contentDescription = ...; liveRegion = ... }`.

#### Glossary
- Port of the existing glossary page (`docs/public/concepts/glossary.md`), updated to include v1.0 terminology (`agent_to_renderer`, `renderer_to_agent`, `@path`, `@call`, `callAgentFunction`, `callRendererFunction`).

### Guides

#### SDK Support Matrix

##### Authoring Guidance & Presentation Rules
- **Scope**: Focus exclusively on official first-party SDKs and renderers (including the official AndroidX Jetpack Compose renderer in its separate repository).
- **Tone & Style**: Neutral, informative developer documentation following the `natural-writing` skill.
- **Repository Links**: Include direct links to the relevant monorepo directories and external repositories.

##### Page Content Outline

1. **Architecture Overview: The Three SDK Tiers**:
   - **Core SDK**: Implements reactive state storage, JSON Pointer path resolution, local function evaluation, two-way data binding, and protocol schema models.
   - **Agent SDK**: Implements prompt synthesis, catalog schema reflection, swappable inference formats (Express, Direct JSON), wire validation, and framework integrations (`a2ui-adk`, `a2ui-a2a`).
   - **Client Renderers**: Native framework adapters that mount surfaces, register catalogs, instantiate host UI widgets, and forward user interaction events.

2. **Official Support Matrix**:
   Display a clear reference table covering all supported languages and official renderers:

   | Language / Ecosystem | Core SDK | Agent SDK | Official Renderers (UI Frameworks) | Repository Location |
   | :--- | :--- | :--- | :--- | :--- |
   | **TypeScript / Web** | ✅ Yes (`@a2ui/web_core`) | ✅ Yes (`@a2ui/agent`) | • **React** (`@a2ui/react`)<br>• **Angular** (`@a2ui/angular`)<br>• **Lit** (`@a2ui/lit`) | [`a2ui-project/a2ui`](https://github.com/a2ui-project/a2ui) |
   | **Python** | ✅ Yes (`a2ui-core`) | ✅ Yes (`a2ui-agent-sdk`, `a2ui-adk`, `a2ui-a2a`) | *N/A (Server / Agent only)* | [`a2ui-project/a2ui`](https://github.com/a2ui-project/a2ui) |
   | **Dart / Flutter** | ✅ Yes (`a2ui_core`) | ✅ Yes (`a2ui_agent`) | • **Flutter** (`a2ui_flutter`) | [`a2ui-project/a2ui`](https://github.com/a2ui-project/a2ui) |
   | **Swift / Apple** | ✅ Yes (`A2UICore`) | — | • **SwiftUI** (`A2UISwiftUI`) | [`a2ui-project/a2ui`](https://github.com/a2ui-project/a2ui) |
   | **Kotlin / Android** | ✅ Yes (AndroidX Core) | Legacy | • **Jetpack Compose** (`androidx.compose.material3.a2ui`) | [AndroidX Open Source Repository](https://cs.android.com/androidx/platform/frameworks/support/+/androidx-main:compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/a2ui/) |

3. **Community SDKs and Renderers**:
   - Note that beyond the official SDKs maintained by the core A2UI team, the open-source community maintains renderers and tools for additional frameworks and platforms.
   - Cross-link directly to the dedicated [Ecosystem Section](#3-ecosystem-section-outline) (`/ecosystem/renderers`).

4. **Building Custom SDKs**:
   - Briefly state that developers can build their own A2UI SDKs for any language or framework using our language-agnostic module blueprints and YAML conformance test suites, linking directly to the [SDK Development](#sdk-development) guide for full details.

#### Architectural Options

##### Authoring Guidance & Presentation Rules
- **Tone & Style**: Pragmatic architectural guidance comparing trade-offs, following the `natural-writing` skill.
- **Focus**: Help engineering teams make intentional architectural decisions before integrating A2UI.

##### Page Content Outline

1. **Catalog Architecture: Basic vs. Custom vs. Hybrid**:
   - **Basic Catalog Out of the Box**:
     - *Best for*: Rapid prototyping, general-purpose LLM interfaces, and projects that want off-the-shelf support across all official renderers with zero custom client component code.
   - **Custom Domain Catalog**:
     - *Best for*: Production applications with established design systems (e.g. internal UI libraries, Material Design, Tailwind, Cupertino).
     - *Trade-off*: Requires registering custom UI component adapters on each client renderer you support.
   - **Hybrid Composition**:
     - *Best for*: Composing standard layout primitives (`Row`, `Column`, `Divider`) from the Basic Catalog while registering domain-specific card widgets (`FlightStatusCard`).
   - **Client Components vs. Server Macros**:
     - Summarize the deployment trade-off in one sentence (authoring native client components for agile web deployments vs. expanding composite components on the server to avoid mobile app store release cycles) and link to the canonical [Macros](#macros) concept page.

2. **Transport & Streaming Protocol**:
   - **AG-UI & A2A (Standardized Agent Protocols)**:
     - The v1.0 protocol specification recognizes **AG-UI** and **A2A** as primary standard transport bindings for bidirectional agent-user communication.
     - Cross-link to [How to Integrate with My Agent Server](#how-to-integrate-with-my-agent-server) for wiring A2UI into AG-UI / CopilotKit, ADK, and A2A.
   - **Server-Sent Events (SSE) + HTTP POST**:
     - Unidirectional streaming from agent to client over HTTP, paired with HTTP POST for outbound `action` events and RPC responses.
     - Note HTTP/1.1 browser connection pool limits (6 concurrent connections per origin) vs. multiplexed HTTP/2.
   - **WebSockets**:
     - Full-duplex persistent connection for low-latency bidirectional RPCs (`callRendererFunction` / `callAgentFunction`) and high-frequency state updates.
   - **Model Context Protocol (MCP)**:
     - Serving A2UI surfaces from MCP tools (`ui://` resources) or embedding sandboxed MCP applications. Cross-link to the [MCP Guides](#a2ui-over-mcp-guidesa2ui-over-mcp).

3. **Content Persistence & Session Replay**:
   - **Persisting Wire Messages + Data Model Snapshots**:
     - *Warning — The Wire-Only Replay Trap*: Because two-way data bindings (e.g. typing into a `TextField` or toggling a `CheckBox`) mutate the client `dataModel` locally without sending wire messages on every keystroke, replaying raw `agent_to_renderer` wire messages alone only restores what the agent originally sent—losing all user-entered form edits.
     - *Recommended Pattern*: Persist a **per-surface `dataModel` snapshot** (matching `renderer_data_model.json`) alongside the message stream, filter out transient RPC requests (`callRendererFunction`) during replay, and render historical turn surfaces in read-only/disabled state when appropriate.
   - **Persisting Rendered Snapshots**:
     - Store the final evaluated component tree or static snapshot once a surface is no longer active to reduce memory overhead in long chat histories.

4. **Surface Scoping & Lifecycle Models**:
   - **Option A: Conversation Scoping (Single `MessageProcessor` per Conversation)**:
     - A single `MessageProcessor` instance manages all surfaces across the conversation, using globally unique `surfaceId`s (e.g. `order_summary_turn_2`).
     - *Key Capability*: Supports **retroactive in-place editing**—later turns can send `updateDataModel` or `updateComponents` targeting an earlier `surfaceId`.
   - **Option B: Turn Scoping (Isolated `MessageProcessor` per Turn)**:
     - Each chat turn instantiates its own isolated `MessageProcessor`, freezing older turns once completed.
     - *Important ID Guidance*: Even when isolating `MessageProcessor` instances per turn, assign **turn-prefixed unique `surfaceId`s** (e.g. `turn_1_main`, `turn_2_main`) rather than reusing `"main"` everywhere. Reusing `"main"` across turns makes inbound `action` events and `sendDataModel` metadata maps ambiguous unless disambiguated by external transport metadata.

#### How to Integrate with My Client

##### Authoring Guidance & Presentation Rules
- **Tone & Style**: Direct, step-by-step developer tutorial.
- **Canonical Renderer Tab Order**: Present framework-specific code tabs in the canonical order defined in `.agents/skills/public-documentation/SKILL.md` (Section 4):
  1. **Flutter**
  2. **Web (React / Angular / Lit)**
  3. **SwiftUI**
  4. **Jetpack Compose**

##### Page Content Outline

1. **Integration Overview**:
   - Outlines the **6 key integration steps** required on the client side:
     1. Install renderer and core packages.
     2. Initialize the Core State Engine (`MessageProcessor`) and register Catalogs.
     3. Advertise Renderer Capabilities (`a2uiRendererCapabilities`) to the agent.
     4. Connect the Network Transport and feed messages into `processMessages`.
     5. Mount the Surface View in the host UI tree.
     6. Handle outbound User Actions, RPC responses, and Validation Errors.

2. **Step 1: Install Dependencies**:
   - Flutter: `flutter pub add a2ui_flutter a2ui_core`
   - Web: npm/yarn for `@a2ui/web_core` plus `@a2ui/react`, `@a2ui/angular`, or `@a2ui/lit`
   - Swift: Swift Package Manager for `A2UISwiftCore` (`A2UICore`, `BasicCatalog`) and `A2UISwiftUI` (`BasicCatalogSwiftUI`)
   - Android Gradle: `androidx.compose.material3:material3-a2ui`

3. **Step 2: Initialize `MessageProcessor` & Register Catalogs**:
   - Instantiate `MessageProcessor` and register the Basic Catalog and any custom domain component adapters or local functions.

4. **Step 3: Advertise Renderer Capabilities**:
   - Configure and attach `a2uiRendererCapabilities` (`supportedCatalogIds`, `inlineCatalogs`) in session or request metadata so the agent knows which catalogs the client supports.

5. **Step 4: Connect Network Transport & Process Messages**:
   - Connect your active transport (AG-UI, A2A, SSE, or WebSockets) and pass incoming parsed message payloads into `messageProcessor.processMessages(messages)` (avoid assuming any single wire framing format such as JSONL—the transport layer delivers messages according to the chosen protocol binding).

6. **Step 5: Mount Surface Components (Canonical Renderer Tabs)**:
   - Flutter: `A2uiSurface(surfaceId: 'main', processor: processor)`
   - Web (React / Angular / Lit):
     - React: `<A2uiSurface surfaceId="main" processor={processor} />`
     - Angular: `<a2ui-component-host [surfaceId]="'main'"></a2ui-component-host>`
     - Lit: `<a2ui-surface surface-id="main" .processor=${processor}></a2ui-surface>`
   - SwiftUI: `A2UISurfaceView(surfaceId: "main", processor: processor)`
   - Jetpack Compose: `A2uiSurface(surfaceId = "main", processor = processor)`

7. **Step 6: Handle Outbound Actions, RPCs, and Errors**:
   - Subscribe to outbound renderer-to-agent messages:
     - Forwarding user `action` events (and attaching `sendDataModel` metadata when requested by the surface).
     - Forwarding `callAgentFunction` requests and returning `rendererFunctionResponse` payloads when the agent invokes `callRendererFunction`.
     - Emitting structured `error` payloads when client validation fails.

#### How to Integrate with My Agent Server

##### Authoring Guidance & Presentation Rules
- **Tone & Style**: Direct, step-by-step developer tutorial.
- **Canonical Agent SDK Tabs**: Provide tabs strictly for supported Agent SDK languages (omitting Swift, which is client-only):
  1. **TypeScript** (`@a2ui/agent`, `@a2ui/web_core`)
  2. **Python** (`a2ui-agent-sdk`, `a2ui-core`, `a2ui-adk`, `a2ui-a2a`)
  3. **Dart** (`a2ui_agent`, `a2ui_core`)

##### Page Content Outline

1. **Integration Overview**:
   - Outlines the **6 key integration steps** on the agent server:
     1. Install Agent SDK packages.
     2. Configure `A2uiGenerator` with Catalogs and an Inference Format.
     3. Negotiate Client Capabilities & Generate System Prompt Instructions.
     4. Parse Model Output, Validate against `RendererState`, and Self-Correct.
     5. Deliver Messages & Handle Multi-Turn Actions and RPCs.
     6. Wire into Agent Frameworks & Transports (ADK, A2A, AG-UI / CopilotKit).

2. **Step 1: Install Dependencies**:
   - TypeScript: `npm install @a2ui/agent @a2ui/web_core`
   - Python: `pip install a2ui-agent-sdk a2ui-core` (plus optional `a2ui-adk`, `a2ui-a2a`)
   - Dart: `dart pub add a2ui_agent a2ui_core`

3. **Step 2: Configure `A2uiGenerator`, Catalogs & Inference Format**:
   - Initialize `A2uiGenerator` with your `CatalogConfig` list and chosen `format_factory` (`ExpressFormatFactory()` by default, or `DirectJsonFormatFactory()`).
   - If using server-side macros, briefly note where `MacroExpander` plugs in and link to the canonical [Macros](#macros) page.

4. **Step 3: Negotiate Capabilities & Inject System Prompt Snippet**:
   - Create a per-request processor from the client's `a2uiRendererCapabilities` and inject `processor.prompt_snippet` into your LLM system instructions:
     ```python
     # Python: Creating a request processor and retrieving the system prompt snippet
     from a2ui.processor import A2uiGenerator, CatalogConfig

     generator = A2uiGenerator(catalogs=[CatalogConfig.from_path("catalog.json")])
     processor = generator.create_processor(renderer_capabilities)
     system_prompt = f"You are a helpful assistant.\n\n{processor.prompt_snippet}"
     ```

5. **Step 4: Parse Output, Validate & Run the Self-Correction Loop**:
   - Parse LLM responses via `processor.parse_response(llm_output)` (or `open_stream()` when streaming Direct JSON).
   - **Self-Correction Loop**: Show how validation against `RendererState` (or receiving a client `error` message such as `VALIDATION_FAILED`) catches schema errors and feeds the structured error back to the LLM for automatic retry before reaching the user.

6. **Step 5: Handle Multi-Turn State, Inbound Actions & RPCs**:
   - Append inbound client `action` events (and any accompanying `sendDataModel` state) into the agent's conversation history to drive the next turn.
   - Handle inbound `callAgentFunction` requests and return `agentFunctionResponse` payloads.

7. **Step 6: Integrating with Agent Frameworks & Standard Transports (ADK, A2A, AG-UI / CopilotKit)**:
   - Consolidates and updates the guidance from `docs/public/guides/a2ui-with-any-agent-framework.md`:
     - **Google ADK (`a2ui-adk`)**: Using `SendA2uiToClientToolset` and `A2uiProcessorStore` to equip ADK agents with A2UI rendering capabilities.
     - **A2A Protocol (`a2ui-a2a`)**: Using `create_a2ui_part`, `to_a2a_parts`, and `A2uiEventConverter` to transmit A2UI payloads over Agent-to-Agent envelopes.
     - **AG-UI / CopilotKit & Custom Harnesses**: Wiring A2UI message streams into AG-UI event streams, LangGraph, or custom SSE/WebSocket agent harnesses.

#### How to Define a Catalog

##### Authoring Guidance & Presentation Rules
- **Reference**: Grounded in `docs/public/guides/defining-your-own-catalog.md` and `docs/public/guides/authoring-components.md`.
- **Specification Links**:
  - v1.0 Catalog Schema: [`specification/v1_0/json/catalog_definition.json`](../../specification/v1_0/json/catalog_definition.json)
  - v1.0 Basic Catalog Reference: [`catalogs/basic/v1/catalog.json`](../../catalogs/basic/v1/catalog.json)
  - v0.9.1 Basic Catalog Reference: [`specification/v0_9_1/catalogs/basic/catalog.json`](../../specification/v0_9_1/catalogs/basic/catalog.json)
- **Tone & Style**: Direct, technical explanation following the `natural-writing` skill.

##### Page Content Outline

1. **When Do You Need a Standalone Catalog JSON Schema?**:
   - **Cross-Language Source of Truth**: Explain that authoring a standalone `catalog.json` file is needed when the catalog serves as a language-agnostic contract shared between separate server and client runtimes (e.g. a Python agent server communicating with SwiftUI, Jetpack Compose, Flutter, and Web clients).

2. **Catalog Schema Anatomy (v1.0 vs. v0.9.1)**:
   - Walk through the schema sections and contrast **v1.0 (Candidate)** and **v0.9.1 (Current)** in tabbed JSON examples:
     - **Envelope Metadata**: `$schema`, `$id`, `catalogId` (URI convention, e.g. `https://example.com/catalogs/analytics.json`), `title`, `description`, and (in v1.0) `protocolVersion: "1.0"`, `metadata`, and `instructions` (Markdown prompt guidelines and few-shot examples).
     - **Top-Level `components` and `functions` Maps**:
       - In **v1.0**, each component under `components` defines its specific properties directly (`type: "object"`, `properties: {"component": {"const": "StatCard"}, ...}`) without boilerplate `allOf` wrappers; also supports `allowedParents` and `allowedChildren` hierarchy constraints and `checks` (`Checkable`). Functions under `functions` support `returnType`, `allowedCallers` (`rendererOnly` | `agentOnly` | `rendererOrAgent`), and `requiresUserActivation`.
       - In **v0.9.1**, each component under `components` wraps its properties in `allOf: [{"$ref": ".../ComponentCommon"}, {"$ref": "#/$defs/CatalogComponentCommon"}, {...}]` with `unevaluatedProperties: false`.
     - **`$defs` (`anyComponent` & `anyFunction`)**:
       - Discriminator unions (`oneOf` referencing `#/components/...` and `#/functions/...`) plus shared leaf definitions (such as `Weight`).

3. **Ingesting the Catalog on the Agent Server**:
   - Show how the Agent SDK loads `catalog.json`:
     ```python
     # Python: Loading a standalone catalog.json into the Agent SDK
     from pathlib import Path
     from a2ui.core import Catalog
     from a2ui.processor import CatalogConfig

     analytics_catalog = Catalog.from_json(Path("analytics_catalog.json").read_text())
     config = CatalogConfig.from_path("analytics_catalog.json")
     ```

4. **Registering the Catalog on the Client Renderer**:
   - Outline how the client renderer implements native UI widgets for each component in `components`, implements local functions in `functions`, and registers the catalog ID with the client's `MessageProcessor`.

5. **Client-Server Schema Parity & Round-Trip Testing**:
   - Recommend adding a unit test asserting that client-registered component schemas match the canonical `catalog.json` ingested by the server.
   - > **[INTERNAL NOTE FOR DOC AUTHORS — Verify Before Publishing]**: Catalog round-tripping and JSON Schema normalization have historically been tricky across SDKs (see existing Dart tests in `dart/a2ui_core/test/catalog_json_test.dart`). Before publishing this recommendation to users, verify that round-trip schema parity tests work cleanly across Python, TypeScript, Dart, and Swift against the Basic Catalog.

#### How to Improve Latency

##### Authoring Guidance & Presentation Rules
- **Tone & Style**: Practical, engineering-focused optimization guide framing concrete architectural levers.
- **No Duplicate Prose**: Summarize **Express** and **Macros** concisely and link to their canonical Concept pages ([Swappable Inference Formats](#swappable-inference-formats) and [Macros](#macros)) and the single authoritative benchmark table rather than repeating full explanations or quoting conflicting numbers.

##### Page Content Outline
1. **The Latency Equation in Generative UI**:
   - Deconstruct Time-to-First-Meaningful-Render:
     $$\text{Latency} = \text{TTFT (Prefill + Thinking)} + (\text{Output Tokens} \times \text{Inter-Token Latency}) + \text{Network Transport} + \text{Client Render}$$
   - Tip: Emit the `root` component early in `updateComponents` so the renderer can mount the surface tree immediately rather than buffering child components waiting for `root`.

2. **Lever 1: Use Compact Inference Formats (Express)**:
   - Summarize how **Express** (`ExpressFormatFactory`, enabled by default in the Agent SDK) eliminates JSON syntax overhead to cut output tokens by ~70–80%, reducing total decode time. Cross-link to [Swappable Inference Formats](#swappable-inference-formats) for the canonical benchmark table and pipeline details.

3. **Lever 2: Optimize Component Granularity (Custom Client Components vs. Server Macros)**:
   - **Coarse-Grained Client Components**: Registering higher-level domain components on the client reduces LLM output to just component IDs and input arguments (ideal for web apps with continuous deployment).
   - **Server-Side Macros**: Defining `@macro` templates on the server lets the LLM output a single macro call that expands into basic primitives on the server (ideal for mobile/cross-platform apps to avoid app store release cycles). Cross-link to [Macros](#macros).

4. **Lever 3: Right-Size the LLM**:
   - When paired with catalog-derived system instructions, fast lightweight models (such as Gemini Flash Lite or Gemini Flash) achieve high schema compliance at 2x–3x the token generation throughput of flagship reasoning models.

5. **Lever 4: Eliminate or Tune the Thinking Budget**:
   - Reasoning models spend upfront seconds generating thinking tokens before emitting the first UI token, inflating TTFT.
   - For structured UI generation against established catalogs, setting `thinking_budget = 0` eliminates upfront thinking delay while preserving 90%+ schema accuracy.

6. **Lever 5: Unbuffered Transport Flushing & Incremental Processing**:
   - Configure server transports to flush chunks immediately without proxy buffering, and feed incoming messages directly into `MessageProcessor.processMessages` for progressive rendering.

#### A2UI over MCP (`/guides/a2ui-over-mcp`)
- **Source**: Direct port of [`docs/public/guides/a2ui_over_mcp.md`](../../public/guides/a2ui_over_mcp.md) (published at [https://a2ui.org/guides/a2ui_over_mcp/](https://a2ui.org/guides/a2ui_over_mcp/)).
- **Scope & Purpose**:
  - Demonstrates how to serve interactive A2UI interfaces from an MCP server using Tools and Embedded Resources (`ui://`).
  - References the runnable recipe sample: [`samples/community/mcp/a2ui-over-mcp-recipe/`](../../samples/community/mcp/a2ui-over-mcp-recipe/).

#### MCP Apps in A2UI Surfaces (`/guides/mcp-apps-in-a2ui`)
- **Source**: Direct port of [`docs/public/guides/mcp-apps-in-a2ui.md`](../../public/guides/mcp-apps-in-a2ui.md) (published at [https://a2ui.org/guides/mcp-apps-in-a2ui/](https://a2ui.org/guides/mcp-apps-in-a2ui/)).
- **Scope & Purpose**:
  - Explains how Model Context Protocol (MCP) HTML applications are securely integrated and displayed within an A2UI surface using the **Double-Iframe Isolation Pattern** (`sandbox.html` proxy + inner iframe without `allow-same-origin`).

#### A2UI Dynamic Rendering within MCP Applications (`/guides/a2ui-in-mcp-apps`)
- **Source**: Direct port of [`docs/public/guides/a2ui-in-mcp-apps.md`](../../public/guides/a2ui-in-mcp-apps.md) (published at [https://a2ui.org/guides/a2ui-in-mcp-apps/](https://a2ui.org/guides/a2ui-in-mcp-apps/)).
- **Scope & Purpose**:
  - Explains how an MCP server returns an MCP App that internally embeds an A2UI surface to dynamically render native components and collaborate with remote agents.
  - References [`samples/community/mcp/a2ui-in-mcpapps/`](../../samples/community/mcp/a2ui-in-mcpapps/).

#### Authoring Universal Web Components
- Direct port of [`docs/public/guides/authoring-universal-components.md`](../../public/guides/authoring-universal-components.md).
- Explains how to author a custom component once as a Web Component (using Lit and `A2uiLitElement`) and consume it across React, Angular, and Lit renderers without rewriting framework-specific wrappers.

#### SDK Development

- **Writing Your Own SDK (Single Canonical Home for Blueprints & Conformance)**:
  - Developers can implement their own A2UI SDKs for languages, UI frameworks, or runtimes not covered by the official SDKs (e.g. Rust, Go, C#, Vue, Svelte).
  - Explains our **Spec-Driven Development (SDD)** methodology: every official SDK is implemented against language-agnostic module blueprints and validated against shared conformance suites.
- **Language-Agnostic Module Blueprints**:
  - Directs builders to follow the canonical module specifications under [`blueprints/modules/`](../../blueprints/modules/):
    - [`a2ui_core.blueprint.md`](../../blueprints/modules/a2ui_core.blueprint.md): Core state management, message processor, surface lifecycle, and data binding.
    - [`a2ui_agent.blueprint.md`](../../blueprints/modules/a2ui_agent.blueprint.md): Agent-side message emission, surface tracking, and catalog builders.
    - [`a2ui_framework_adapter.blueprint.md`](../../blueprints/modules/a2ui_framework_adapter.blueprint.md): Framework rendering lifecycle, catalog registration, and reactive binding bridges.
- **Validating with Conformance Tests**:
  - Details how to test a custom SDK against the declarative YAML test suites under [`conformance/`](../../conformance/):
    - [`conformance/core/`](../../conformance/core/): Verifies state management, JSON Pointer resolution, lexical scopes, and function evaluation.
    - [`conformance/agent/`](../../conformance/agent/): Verifies prompt generation, format compilation/decompilation, macro expansion, and catalog validation.
  - References [`conformance/README.md`](../../conformance/README.md) for implementing a test runner in any target language.

### Roadmap

##### Authoring Guidance & Presentation Rules
- **Tone & Style**: Direct, measured, and transparent regarding development status. Avoid forward-looking hype or uncommitted deadlines; clearly delineate between what is actively shipped, in current development, and planned explorations.
- **Visual Presentation**: Present statuses using clean badge tables and status markers (`Stable`, `Candidate`, `In Progress`, `Planned`).

##### Page Content Outline
1. **Introduction & Development Philosophy**:
   - The roadmap reflects ongoing work across the A2UI core team and community contributors, driven by Spec-Driven Development (SDD).
2. **Protocol Versioning Milestones**:
   - `v0.8`: Prior release (legacy A2A baseline).
   - `v0.9` / `v0.9.1`: Current stable production standard across all SDKs and renderers.
   - `v1.0`: Release candidate specification featuring `@path`/`@call` directives, bidirectional RPCs (`callAgentFunction` / `callRendererFunction`), top-level catalog maps, and decoupled host branding.
3. **Multi-Platform Renderers**:
   - Web Renderers: React, Angular, and Lit/Web Components (stable).
   - Flutter: Multi-platform mobile, desktop, and web support (stable).
   - Apple Ecosystem: Swift core state engine (`A2UICore`) and native SwiftUI renderer (`A2UISwiftUI`).
   - Android Ecosystem: Native Jetpack Compose renderer (`androidx.compose.material3.a2ui` in AndroidX).
4. **Inference & Streaming Performance**:
   - Compact DSL optimizations (Express and experimental Atom/Elemental formats).
   - Server-side macro transformers and zero-thinking budget tuning for lightweight LLMs.
5. **Ecosystem & Interoperability**:
   - First-class integrations with agent frameworks and protocols (ADK, A2A, AG-UI / CopilotKit, LangGraph, MCP).

---

## 3. Ecosystem Section Outline

### Ecosystem Renderers & Tools (`/ecosystem/renderers`)

- **Page Overview**:
  - Direct, cleaned-up port of the existing ecosystem renderers page: [`docs/public/ecosystem/renderers.md`](../../public/ecosystem/renderers.md).
  - Highlights community-driven implementations, framework adapters, and tools across web, mobile, desktop, and terminal environments.

- **Page Structure**:
  1. **Introduction & Disclaimer**: Explains that community projects are maintained by their respective authors and notes where to find the official core SDKs.
  2. **Unified Community Renderers Table**: A single consolidated table showing:
     - Project / Package name
     - Target Platform / Framework
     - Supported Protocol Versions (v0.8, v0.9.1, v1.0)
     - Maintenance / Activity status
     - Links (GitHub, package registries, documentation)
  3. **Agent-Side Libraries & Ecosystem Utilities**: Tools and server libraries that produce, wrap, or extend A2UI content.
  4. **Submitting to the Ecosystem**: Clear step-by-step instructions for community authors on submitting new renderers or libraries via a GitHub Pull Request against `a2ui-project/a2ui`.

---

## 4. Specifications Section Outline

### 4.1 Navigation & Version Hierarchy

Preserve the multi-document version browsing structure from the previous site, upgraded with Starlight sidebar badges and single-source-of-truth file inclusion:

- **v1.0 (Candidate)** `[Badge: Candidate]`
  - `v1.0 Protocol Specification`: Single-source include of [`specification/v1_0/docs/a2ui_protocol.md`](../../specification/v1_0/docs/a2ui_protocol.md).
  - `v1.0 Custom Functions Guide`: Single-source include of [`specification/v1_0/docs/a2ui_custom_functions.md`](../../specification/v1_0/docs/a2ui_custom_functions.md).
  - `v1.0 SDKs Specification`: Single-source include of [`specification/v1_0/docs/sdks_spec.md`](../../specification/v1_0/docs/sdks_spec.md).
  - `v1.0 JSON Schemas Explorer`: Interactive embedded viewer for all canonical v1.0 JSON schemas.
  - `v1.0 A2A Extension`: Single-source include of [`specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md`](../../specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md).
  - `v1.0 Evolution Guide`: Evolution differences and migration from v0.9.1 ([`specification/v1_0/docs/evolution_guide.md`](../../specification/v1_0/docs/evolution_guide.md)).
  - `v1.0 Basic Catalog Guide`: Reference implementation guide ([`catalogs/basic/v1/basic_catalog_implementation_guide.md`](../../catalogs/basic/v1/basic_catalog_implementation_guide.md)).
- **v0.9.1 (Active / Current)** `[Badge: Active]`
  - `v0.9.1 Protocol Specification`: Single-source include of [`specification/v0_9_1/docs/a2ui_protocol.md`](../../specification/v0_9_1/docs/a2ui_protocol.md).
  - `v0.9.1 Custom Functions Guide`: Single-source include of [`specification/v0_9_1/docs/a2ui_custom_functions.md`](../../specification/v0_9_1/docs/a2ui_custom_functions.md).
  - `v0.9.1 SDKs Specification`: Single-source include of [`specification/v0_9_1/docs/sdks_spec.md`](../../specification/v0_9_1/docs/sdks_spec.md).
  - `v0.9.1 JSON Schemas Explorer`: Interactive embedded viewer for all canonical v0.9.1 JSON schemas.
  - `v0.9.1 A2A Extension`: Single-source include of [`specification/v0_9_1/docs/a2ui_extension_specification.md`](../../specification/v0_9_1/docs/a2ui_extension_specification.md).
  - `v0.9.1 Evolution Guide`: Differences and evolution from v0.9 ([`specification/v0_9_1/docs/evolution_guide.md`](../../specification/v0_9_1/docs/evolution_guide.md)).
  - `v0.9.1 Basic Catalog Guide`: Reference implementation guide ([`specification/v0_9_1/docs/basic_catalog_implementation_guide.md`](../../specification/v0_9_1/docs/basic_catalog_implementation_guide.md)).
- **v0.9 (Previous Stable)**
  - `v0.9 Protocol Specification`: Single-source include of [`specification/v0_9/docs/a2ui_protocol.md`](../../specification/v0_9/docs/a2ui_protocol.md).
  - `v0.9 Custom Functions Guide`: Single-source include of [`specification/v0_9/docs/a2ui_custom_functions.md`](../../specification/v0_9/docs/a2ui_custom_functions.md).
  - `v0.9 JSON Schemas Explorer`: Interactive embedded viewer for all canonical v0.9 JSON schemas.
  - `v0.9 A2A Extension`: Single-source include of [`specification/v0_9/docs/a2ui_extension_specification.md`](../../specification/v0_9/docs/a2ui_extension_specification.md).
  - `v0.9 Evolution Guide`: Evolution notes from v0.8 ([`specification/v0_9/docs/evolution_guide.md`](../../specification/v0_9/docs/evolution_guide.md)).
  - `v0.9 Basic Catalog Guide`: Reference implementation guide ([`specification/v0_9/docs/basic_catalog_implementation_guide.md`](../../specification/v0_9/docs/basic_catalog_implementation_guide.md)).
- **v0.8 (Legacy)**
  - `v0.8 Protocol Specification`: Single-source include of [`specification/v0_8/docs/a2ui_protocol.md`](../../specification/v0_8/docs/a2ui_protocol.md).
  - `v0.8 JSON Schemas Explorer`: Interactive embedded viewer for all canonical v0.8 JSON schemas.
  - `v0.8 A2A Extension`: Single-source include of [`specification/v0_8/docs/a2ui_extension_specification.md`](../../specification/v0_8/docs/a2ui_extension_specification.md).
  - `v0.8 Custom Catalog Changes`: Single-source include of [`specification/v0_8/docs/custom_catalog_changes.md`](../../specification/v0_8/docs/custom_catalog_changes.md).

---

### 4.2 JSON Schemas Explorer Experience (Embedded Single-Page Viewer)

To improve the developer experience over the legacy site—where JSON schemas were raw unlinked files—each specification version features a dedicated **JSON Schemas Explorer** page (e.g. `/specification/v1.0/schemas/`):

1. **Version-Specific Categorized Schema Tabs / Selector**:
   Schemas are grouped logically per protocol version to match the exact files in `specification/<version>/json/` and `catalogs/`:
   - **v1.0 Schema Groups**:
     - *Wire Messages*: `agent_to_renderer.json`, `renderer_to_agent.json`
     - *Common Types & Primitives*: `common_types.json`
     - *Catalogs & Data Model*: `catalog_definition.json`, `renderer_data_model.json`, `catalogs/basic/v1/catalog.json`
     - *Capabilities & Handshake*: `agent_capabilities.json`, `renderer_capabilities.json`
     - *Batching & Wrapper Envelopes*: `agent_to_renderer_list.json`, `renderer_to_agent_list.json`, `agent_to_renderer_list_wrapper.json`, `renderer_to_agent_list_wrapper.json`
   - **v0.9.1 & v0.9 Schema Groups**:
     - *Wire Messages*: `server_to_client.json`, `client_to_server.json`
     - *Common Types & Primitives*: `common_types.json`
     - *Catalogs & Data Model*: `client_data_model.json`, `catalogs/basic/catalog.json`
     - *Capabilities & Handshake*: `server_capabilities.json`, `client_capabilities.json`
     - *Batching & Wrapper Envelopes*: `server_to_client_list.json`, `client_to_server_list.json`, `server_to_client_list_wrapper.json`, `client_to_server_list_wrapper.json`
   - **v0.8 Schema Groups**:
     - *Wire Messages*: `server_to_client.json`, `client_to_server.json`, `server_to_client_with_standard_catalog.json`
     - *Catalogs & Capabilities*: `standard_catalog_definition.json`, `catalog_description_schema.json`, `a2ui_client_capabilities_schema.json`

2. **Schema Metadata & Developer Utility Bar**:
   Above each embedded schema, render an action bar featuring:
   - **Canonical `$id` URL**: Displays the schema's `$id` URI with a 1-click **Copy URL** button for developers writing `$ref` imports or schema validators.
   - **Raw JSON Link**: Direct link to open or download the raw schema file.
   - **Schema Summary & Key Definitions**: Brief overview of the top-level definitions in that file.

3. **Zero-Duplication Embedded Code Viewers**:
   - Each schema is embedded directly into Starlight tab panels via our Remark include plugin (`--8<-- "specification/<version>/json/<file>.json"`).
   - Rendered using Expressive Code with syntax highlighting, line numbers, search, and collapsible root blocks.

---

### 4.3 Basic Catalog Guidance & Custom Catalog Cross-Linking

- In all versioned Basic Catalog guides:
  - **Explicit Independence Note**: Prominently emphasize that the Basic Catalog is an optional, styleable reference implementation included for convenience.
  - **Custom Catalog Callout**: Direct developers to [How to Define a Catalog](#how-to-define-a-catalog) and the hybrid composition pattern (borrowing layout primitives like `Row`/`Column` while registering custom domain components).
