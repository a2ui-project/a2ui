# Requirements for the A2UI typesafe API generator

## Context and goals

A2UI Synthetic Components allow developers to define higher-level, reusable composite UI components programmatically in their backend programming language (starting with Python, followed by TypeScript, Dart, and Kotlin). These synthetic components are published into the component catalog alongside primitive components, enabling LLMs and autonomous agents to generate concise, structured UI while delegating detailed layout expansion to backend code.

To support this capability, A2UI introduces a typesafe API generator. The generator inspects A2UI Component Catalogs (such as the Basic Catalog v0.9.1) and produces typed classes, constructors, function wrappers, and serialization helpers.

This document establishes the requirements for the typesafe API generator. It addresses two primary contexts:

- **Synthetic components**: Writing macro components whose expansion bodies are executed by an agent or synthetic component processor to produce primitive A2UI component trees.
- **Direct payload authoring**: Writing A2UI surfaces, dialogs, cards, or messages directly in non-agent backends, deterministic web servers, MCP tool implementations, test fixtures, and workflow engines without involving an LLM or synthetic component processor.

---

## Core use cases

### Programmatic synthetic component expansion

In the synthetic component model, a developer registers a code function as a component. The function defines the layout using typed A2UI constructors:

- **Input**: The function accepts typed parameters (for example, numbers, strings, booleans, data dictionaries, child component slots, or action definitions).
- **Body**: The function body constructs an A2UI component tree using the typesafe catalog API. It can evaluate native language logic, such as conditional statements (`if`/`else`), iterations (`for`, list comprehensions), string formatting, and mathematical calculations.
- **Output**: The function returns a root component or a list of components.
- **Catalog synthesis**: The synthetic component processor inspects the function signature, type annotations, and docstrings to generate an entry in the synthetic component catalog. The LLM can then invoke this synthetic component during inference.
- **Expansion pipeline**: When the LLM emits a call to the synthetic component, the synthetic component processor runs the registered code function with the provided arguments, expanding the synthetic component into standard primitive components before messages are sent to the client renderer.

### Direct A2UI payload authoring

Many backend services need to emit A2UI messages directly without an LLM or a synthetic component processor. The typesafe API must support these direct authoring scenarios:

- **Model Context Protocol (MCP) tool servers**: An MCP server executes a tool (for example, querying a database or fetching telemetry) and returns an A2UI payload in the tool result for client display.
- **Deterministic backend services**: Web applications, microservices, or admin panels emitting standard A2UI responses (such as order confirmation receipts, authentication prompts, or billing tables) based on deterministic business logic.
- **Test suites and fixtures**: Unit, integration, and conformance tests that construct expected A2UI component trees and verify serialization correctness with compiler-enforced schema validity.
- **Standalone UI generators**: Command-line tools or batch scripts that generate static A2UI surfaces from data files.

In these use cases, the API must be capable of emitting standard A2UI message streams (`beginRendering`, `surfaceUpdate`, `dataModelUpdate`) or raw component lists directly, with no dependency on the synthetic component processor.

---

## Developer ergonomics

### Ergonomics of writing layouts

Developers authoring A2UI layouts (either inside synthetic components or in direct payload generation) require an interface that feels natural in their host language:

- **Idiomatic constructors**:
  - In Python: standard keyword arguments, typed classes or functions, support for keyword-only parameters, and clear docstrings displayed in IDEs.
  - In TypeScript: object literals with strict type checking, optional builder patterns, or TSX-compatible factories.
  - In Dart: widget-like tree constructors with named parameters, matching the style of Flutter.
  - In Kotlin: type-safe builders or DSL markers.
- **Component ID management**:
  - **Automatic IDs by default**: Developers must not be forced to invent and pass unique string IDs for every component in a tree. When IDs are omitted, the API or serializer must assign unique, deterministic, collision-free IDs automatically.
  - **Optional explicit IDs**: Developers must be able to specify explicit component IDs when desired (for example, `id="user_profile_card"` or `id="submit_button"`), enabling precise test assertions, targeted delta updates, or descriptive log messages.
- **Natural tree nesting**:
  - Container components must accept child components directly in their `child` or `children` parameters.
  - The developer writes a tree structure (for example, `Card(child=Column(children=[Text(text="Hello"), Button(text="Click")]))`).
  - The serialization logic must automatically flatten the tree into the standard A2UI flat list of component dictionaries, converting nested `child` and `children` objects into component ID references.
- **Slot and child composition**:
  - Synthetic component functions must be able to declare parameters of type `Component` or `list[Component]`.
  - Callers can pass arbitrary subtrees into these slots, and the engine must preserve and link them into the parent container correctly.
- **Editor support**:
  - Full autocomplete for component names, property names, and enum values.
  - Inline documentation and parameter descriptions pulled directly from catalog JSON schemas.
  - Jump-to-definition leading to readable generated code or type stubs.

### Ergonomics of running code generation

Developers and SDK maintainers who generate the typed API from catalog definitions need a straightforward, repeatable process:

- **Single command execution**: Generating the API must require a single CLI command (for example, `a2ui-codegen --catalog <path-or-url> --lang <language> --out <directory>`).
- **Catalog evolution and custom catalogs**: When a catalog schema changes, or when an organization creates a domain-specific catalog, running the generator must produce updated code without manual patches or overrides.
- **Zero manual configuration for standard catalogs**: The generator must work out-of-the-box with the official A2UI Basic Catalog and Minimal Catalog across supported protocol versions (v0.9, v0.9.1, v1.0).
- **Deterministic output**: Running the generator against the same catalog schema must produce identical output files, ensuring reproducible builds and clean version control diffs.

---

## Maintainer ergonomics and generator architecture

Maintaining code generators across multiple languages presents ongoing operational costs. The architecture must address:

### Multi-language transferability

The approach must support Python initially, followed by TypeScript, Dart, Kotlin, and Swift:

- The core model of A2UI catalogs (components, properties, enums, functions, and common types) is language-agnostic.
- The generator architecture must avoid duplicating the catalog parsing, schema validation, and reference resolution logic across separate repositories or implementations.

### Evaluation of generation strategies

The design must evaluate three architectural options:

- **Option 1: Single central generator with multi-language backends**:
  - A single CLI tool (written in Python or TypeScript) parses the catalog schema and common type definitions.
  - Pluggable code emitters or templates produce the typed code for each target language.
  - _Advantage_: Schema resolution, validation rules, and feature additions happen in one place.
  - _Trade-off_: The generator maintainer must understand code generation idioms for all target languages.
- **Option 2: Language-specific generators**:
  - Each language SDK repository maintains its own generator script.
  - _Advantage_: Each team uses native language tools and idioms.
  - _Trade-off_: High risk of behavioral drift and duplicated effort when catalog schemas or protocol versions update.
- **Option 3: Off-the-shelf schema generators**:
  - Using existing tools such as `datamodel-code-generator` (Python), `quicktype` (multi-language), or `json-schema-to-typescript`.
  - _Limitations_: Off-the-shelf tools generate passive data transfer objects (DTOs). They do not understand A2UI component hierarchies, automatic tree flattening, dynamic expression dual-typing, or catalog function call wrapping. They can generate underlying type interfaces, but the developer-facing builder layer still requires custom code.

### Maintainability requirements

- Clear separation between raw schema data types (DTOs representing wire format) and the developer-facing ergonomic API (constructors, tree builders, auto-ID handlers).
- Minimal runtime dependencies in the generated code. Generated libraries should avoid depending on heavy third-party frameworks.
- Comprehensive test suites verifying that generated code compiles cleanly, runs in strict type-checking modes, and serializes to valid A2UI payloads.

---

## Type safety and compiler diagnostics

The primary objective of a generated API is catching errors early during development rather than at runtime.

### Required compile-time checks

The generated API must enable the host language's compiler or type checker (`mypy`/`pyright` in Python, `tsc` in TypeScript, `dart analyze` in Dart, `kotlinc` in Kotlin) to detect the following classes of errors:

- **Unknown components**: Catching misspellings or invented components (for example, `Colum(...)` instead of `Column(...)`).
- **Misspelled properties**: Catching invalid attribute names (for example, `Text(title="...")` instead of `Text(text="...")`).
- **Incorrect primitive types**: Passing a boolean where a number is expected, or an integer where a string is expected.
- **Invalid enum values**: Specifying an unrecognized string for enum fields (for example, `Text(variant="huge")` when allowed values are `"h1"`, `"h2"`, `"h3"`, `"h4"`, `"h5"`, `"caption"`, `"body"`).
- **Missing required properties**: Omitting mandatory fields (for example, `Image()` without `url`, or `Text()` without `text`).
- **Disallowed child assignment**:
  - Attempting to assign a `child` or `children` to leaf components that do not accept children (such as `Divider`, `Icon`, `Text`, `Image`, `Spacer`).
  - Attempting to assign a list to a single-child container (such as `Card(child=[...])` instead of `Card(child=Column(children=[...]))`).
  - Attempting to assign a single component to a container expecting a list (such as `Column(children=Text(...))` instead of `Column(children=[Text(...)])`).
- **Invalid action definitions**: Passing an arbitrary string where an `Action` object or event specification is required.
- **Malformed function calls**: Passing missing or incorrect argument types to catalog functions (for example, calling `formatString` without the `value` argument).

---

## Representation of protocol edge cases

A2UI payloads include several dynamic and polymorphic constructs that must be represented cleanly in typed code.

### Dual-typing for dynamic values

In the A2UI specification, properties frequently use dynamic types: `DynamicString`, `DynamicNumber`, `DynamicBoolean`, and `DynamicValue`.

A property typed as `DynamicString` (such as `Text.text`) can receive three distinct inputs:

1. A literal primitive string: `"Hello World"`
2. A client data model reference: `{ "path": "/user/displayName" }`
3. A catalog function call returning a string: `{ "call": "formatString", "args": { "value": "Welcome, ${/user/name}" } }`

**Requirement**: The typesafe API must allow developers to pass literal values, data model path references, or function calls directly to the property without requiring manual type casting or disabling compiler checks.

### Client data model references

A2UI uses JSON Pointer paths for client-side data binding (for example, `/session/user/name` or `/cart/total`):

- The API must provide a clean, typed helper to express data model references (for example, `bind("/path/to/data")` or `DataBinding(path="/path/to/data")`).
- Two-way data binding on input components (such as `TextField` or `Slider`) must accept path bindings to update client state automatically.

### Catalog functions

Catalog functions (`formatString`, `regex`, `length`, `concat`, etc.) execute on the client renderer to evaluate dynamic strings or conditions:

- The API generator must emit typed wrapper functions for all functions declared in the catalog.
- Each wrapper must enforce the function's expected argument types and return a typed expression object matching the function's declared return type (`string`, `number`, `boolean`, etc.).
- These expression objects must be assignable to any component property that accepts a dynamic value of that type.

### Client-side checks and validation

Input components in A2UI can define validation rules via the `Checkable` interface:

- Each check rule consists of a `condition` (`DynamicBoolean`) and an error `message` (`string`).
- The API must allow developers to pass check rules cleanly:
  - For example: `checks=[CheckRule(condition=regex(pattern="^[A-Z0-9]+$", value=bind("/code")), message="Code must be alphanumeric")]`.

### Action definitions

The A2UI `Action` type supports two interaction patterns:

1. **Server-side events**: Dispatching an event name and context dictionary to the server agent.
2. **Client-side functions**: Invoking a local function on the client.

The API must provide constructors for both action types:

- `Action.event(name="submit", context={"userId": bind("/user/id")})`
- `Action.client_function(call="navigate", args={"url": "/home"})`

### Dynamic child lists

In addition to static lists of children, A2UI containers support dynamic child lists driven by an array in the client data model:

- A container can specify a template component and a data model path pointing to a list of objects.
- The API must represent both static children lists (`children=[...]`) and dynamic child bindings (`children=DynamicChildList(component=..., path="/items")`).

---

## Exhaustive list of layout scenarios

The API generator must be capable of expressing every component and layout pattern supported by the A2UI protocol. Below is an exhaustive list of layouts and use cases that must be verified:

### 1. Leaf display components

- Plain text with standard variants (`h1`, `h2`, `h3`, `h4`, `h5`, `body`, `caption`).
- Text with inline Markdown formatting.
- Images with various fit modes (`contain`, `cover`, `fill`, `none`, `scaleDown`) and size variants (`icon`, `avatar`, `smallFeature`, `mediumFeature`, `largeFeature`, `header`).
- Icons with standard names from catalog enums.
- Horizontal and vertical dividers.
- Spacers with explicit or flexible dimensions.

### 2. Container and layout structures

- Vertical layouts (`Column`) with alignment and distribution options.
- Horizontal layouts (`Row`) with flex spacing and distribution options.
- Card containers wrapping single child hierarchies with borders and elevation.
- Section layouts combining title headers with body content.
- Grid layouts displaying multi-column arrangements.
- Nested containers (for example, a `Card` containing a `Column` containing multiple `Row` elements).

### 3. Interactive input components

- Text fields with placeholders, initial values, and label hints.
- Text fields with client-side validation rules (`checks`).
- Two-way bound text fields synchronized with data model paths.
- Numeric sliders with minimum, maximum, and step intervals.
- Binary toggles (`Switch`, `Checkbox`).
- Selection controls (`Dropdown`, `RadioGroup`) with options and bound selection paths.

### 4. Interactive buttons and triggers

- Standard text buttons with click actions.
- Icon buttons with accessibility labels and descriptions.
- Primary, secondary, and tonal button variants.
- Buttons with server event actions containing literal and data-bound context arguments.
- Buttons with client-side function calls.

### 5. Reactive and data-bound layouts

- Telemetry dashboards where metrics display live data via path subscriptions.
- Multi-field forms bound to a shared client data model object.
- Dynamic text that combines synthetic components with bound paths via `formatString`.

### 6. Collections and repeating lists

- Programmatic loops in synthetic component functions (unrolling lists of cards or rows using native language loops).
- Dynamic lists driven by client data model arrays (`ChildList` with `componentId` and `path`).
- Table-like data grids built from nested rows and columns.

### 7. Slot-based synthetic components

- Master-detail synthetic components that accept a custom header component, body component, and footer action bar.
- Card grids where the caller passes an arbitrary list of child cards into a grid slot.
- Two-column split layouts where left and right panes accept arbitrary subtrees.

### 8. Complex application views

- Team rosters with member avatars, role badges, and action buttons.
- Feedback boards with categorized feedback items and interactive rating controls.
- Knowledge panels displaying structured entity metadata, lists of attributes, and external links.
- Multi-step wizard dialogs with navigation buttons and conditional content.
