# Requirements for the A2UI typesafe API generator

## Context and goals

A2UI Synthetic Components allow developers to define higher-level, reusable composite UI components programmatically in their backend programming language (starting with Python, followed by TypeScript, Dart, and Kotlin). These synthetic components are published into the component catalog alongside primitive components, enabling LLMs and autonomous agents to generate concise, structured UI while delegating detailed layout expansion to backend code.

To support this capability, A2UI introduces a typesafe API generator. The generator inspects A2UI Component Catalogs (such as the Basic Catalog v0.9.1 and v1.0) and produces typed classes, constructors, function wrappers, and serialization helpers.

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

In these use cases, the API must be capable of emitting standard A2UI message streams or raw component lists directly, with no dependency on the synthetic component processor.

---

## Open questions on API output formats

The exact output data structure of the typesafe API may differ depending on the use case. The design must resolve the following questions:

### Output for synthetic component expansion

- **Single root vs. component lists**: Should a synthetic component function return a single root component node (e.g. `Card`), or should it be allowed to return a list of sibling components (e.g. `list[Component]`) for macro layouts like repeating rows or table bodies?
- **Node tree vs. flattened dictionaries**: Does the synthetic component function return unflattened component nodes that the runtime engine flattens, or does the API flatten the tree into a list of wire dictionaries before returning?
- **Component ID prefixing and scoping**: When a synthetic component is expanded within an existing surface, how are internal component IDs managed? Does the synthetic component processor prefix generated IDs (e.g. `card_0_text_1`) to avoid collisions with other components on the same surface, or does the builder accept a surface-level ID allocator?
- **Bundling data model state**: Can a synthetic component function return initial data model state alongside its component tree (e.g. returning a tuple `(ComponentNode, dict[str, Any])` or a container object), or must state initialization remain separate from UI expansion?

### Output for direct payload authoring

- **Component list vs. message envelopes**: In non-agent applications, should the API output raw component dictionaries (`list[dict[str, Any]]`), or should it provide higher-level surface containers that emit complete protocol message sequences (such as `createSurface`, `updateSurface`, `updateDataModel`)?
- **Surface lifecycle management**: Should the API provide a `Surface` builder object that tracks the surface ID, catalog ID, component tree, and data model state, exposing methods such as `.to_messages()`, `.to_json()`, or `.to_dict()`?
- **Serialization formats**: Should the API serialize directly to JSON strings, return native language dictionaries, or emit typed wire protocol DTOs?

---

## Authoring layer decoupling and the intermediate contract

Developer preferences for UI authoring syntax vary widely across programming languages and teams. Some prefer constructor keyword arguments, others prefer fluent method chaining, and TypeScript developers often prefer TSX or declarative factories. Furthermore, authoring ergonomics are likely to evolve over time.

The system must allow synthetic component functions to use different builder approaches without locking the runtime or synthetic component processor into a single rigid class hierarchy.

### Evaluating intermediate representation options

The requirements evaluate two primary approaches for defining the contract between authoring builders and the runtime engine:

#### Approach 1: Reusing the A2UI JSON format directly (`to_json` / wire serialization)

Under this approach, the authoritative A2UI JSON specification serves directly as the intermediate contract. Any builder node or authoring helper simply provides a method such as `to_json()` or `to_a2ui()` that serializes the structure into standard A2UI component data:

- **Minimal abstraction**: Avoids inventing, maintaining, and standardizing an artificial abstract AST or node object model across multiple programming languages.
- **Broad interoperability**: Any builder style, third-party library, or even raw dictionary output can be used within synthetic components, as long as it serializes to valid A2UI JSON.
- **Direct schema validation**: Output can be validated directly against the catalog's existing JSON Schema without an intermediate translation pass.
- **Design questions to resolve**:
  - _Flattening location_: Does `to_json()` produce a fully flattened list of wire component dictionaries with ID strings (e.g. `[{"id": "root", "component": "Card", "child": "col_1"}, ...]`), or does it produce a nested JSON structure (e.g. `{"component": "Card", "child": {"component": "Column", ...}}`) that a shared runtime utility flattens?
  - _ID allocation timing_: If a developer omits explicit IDs, does `to_json()` accept an optional ID generator or prefix to ensure surface-wide uniqueness, or do builder nodes generate IDs upon construction?

#### Approach 2: Abstract component node representation

Under this approach, all builders must produce instances conforming to a formal node interface (e.g. `ComponentNode`) with explicit methods for inspecting component types, properties, and child slots before serialization:

- **Strengths**: Enables tree inspection, transformations, or AST analysis prior to serialization.
- **Trade-offs**: More prescriptive. Requires maintaining a standardized node object model across Python, TypeScript, Dart, and Kotlin, increasing SDK maintenance overhead.

### Requirement: Flexible, non-prescriptive contract

The design must avoid being overly prescriptive about the internal node format. The core requirement is that the synthetic component engine and payload emitters accept any result that cleanly converts to standard A2UI JSON (for example, through a `.to_json()` / `.to_a2ui()` protocol method, or by directly returning standard dictionaries). This allows different ergonomic builder implementations to be introduced, tested, and evolved independently over time.

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

### Concrete example: Payroll summary synthetic component

To ground the ergonomic requirements in a real development task, consider a synthetic component that computes and renders a confidential payroll matrix. The component performs backend data calculations, filters based on parameters (`department`, `include_bonus`), constructs repeating rows, and wraps the result in a structured layout.

#### Version A: Authoring with raw untyped dictionaries (without typesafe API)

Without a generated typesafe API, the developer writes raw nested Python dictionaries conforming to the wire protocol:

```python
from typing import Any

EMPLOYEE_DB = {
    "emp_1": {
        "name": "Alice Chen",
        "role": "Staff Engineer",
        "base": 185000,
        "bonus": 35000,
    },
    "emp_2": {
        "name": "Bob Smith",
        "role": "Product Designer",
        "base": 140000,
        "bonus": 20000,
    },
}


def render_payroll_summary(
    department: str = "Engineering", include_bonus: bool = True
) -> dict[str, Any]:
    total_base = 0
    total_bonus = 0
    rows: list[dict[str, Any]] = []

    for emp_id, record in EMPLOYEE_DB.items():
        total_base += record["base"]
        total_bonus += record["bonus"]

        cols: list[dict[str, Any]] = [
            {"component": "Text", "text": record["name"], "variant": "body"},
            {"component": "Text", "text": record["role"], "variant": "caption"},
            {
                "component": "Text",
                "text": f"${record['base']:,}",
                "variant": "body",
            },
        ]
        if include_bonus:
            cols.append({
                "component": "Text",
                "text": f"${record['bonus']:,}",
                "variant": "body",
            })

        rows.append({
            "component": "Row",
            "justify": "spaceBetween",
            "align": "center",
            "children": cols,
        })
        rows.append({"component": "Divider", "axis": "horizontal"})

    total_cols: list[dict[str, Any]] = [
        {"component": "Text", "text": "TOTAL PAYROLL", "variant": "h4"},
        {"component": "Text", "text": f"${total_base:,}", "variant": "h4"},
    ]
    if include_bonus:
        total_cols.append({
            "component": "Text",
            "text": f"${total_bonus:,}",
            "variant": "h4",
        })

    return {
        "component": "Card",
        "child": {
            "component": "Column",
            "children": [
                {
                    "component": "Row",
                    "justify": "spaceBetween",
                    "align": "center",
                    "children": [
                        {
                            "component": "Row",
                            "align": "center",
                            "children": [
                                {"component": "Icon", "name": "lock"},
                                {
                                    "component": "Text",
                                    "text": (
                                        f"Payroll Summary: {department}"
                                    ),
                                    "variant": "h3",
                                },
                            ],
                        },
                        {
                            "component": "Text",
                            "text": "Confidential",
                            "variant": "caption",
                        },
                    ],
                },
                {"component": "Divider", "axis": "horizontal"},
                *rows,
                {
                    "component": "Row",
                    "justify": "spaceBetween",
                    "align": "center",
                    "children": total_cols,
                },
            ],
        },
    }
```

#### Version B: Authoring with the generated typesafe API

With the generated typesafe API, the developer authors the exact same component tree using typed constructors:

```python
from a2ui.basic import Card, Column, Row, Text, Icon, Divider

EMPLOYEE_DB = {
    "emp_1": {
        "name": "Alice Chen",
        "role": "Staff Engineer",
        "base": 185000,
        "bonus": 35000,
    },
    "emp_2": {
        "name": "Bob Smith",
        "role": "Product Designer",
        "base": 140000,
        "bonus": 20000,
    },
}


def render_payroll_summary(
    department: str = "Engineering", include_bonus: bool = True
) -> Card:
    total_base = 0
    total_bonus = 0
    rows: list[Row | Divider] = []

    for emp_id, record in EMPLOYEE_DB.items():
        total_base += record["base"]
        total_bonus += record["bonus"]

        cols: list[Text] = [
            Text(text=record["name"], variant="body"),
            Text(text=record["role"], variant="caption"),
            Text(text=f"${record['base']:,}", variant="body"),
        ]
        if include_bonus:
            cols.append(Text(text=f"${record['bonus']:,}", variant="body"))

        rows.append(
            Row(
                justify="spaceBetween",
                align="center",
                children=cols,
            )
        )
        rows.append(Divider(axis="horizontal"))

    total_cols: list[Text] = [
        Text(text="TOTAL PAYROLL", variant="h4"),
        Text(text=f"${total_base:,}", variant="h4"),
    ]
    if include_bonus:
        total_cols.append(Text(text=f"${total_bonus:,}", variant="h4"))

    return Card(
        child=Column(
            children=[
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=[
                        Row(
                            align="center",
                            children=[
                                Icon(name="lock"),
                                Text(
                                    text=f"Payroll Summary: {department}",
                                    variant="h3",
                                ),
                            ],
                        ),
                        Text(text="Confidential", variant="caption"),
                    ],
                ),
                Divider(axis="horizontal"),
                *rows,
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=total_cols,
                ),
            ]
        )
    )
```

#### Comparative analysis and authoring differences

Comparing Version A and Version B demonstrates the specific developer experience gaps the typesafe API generator must solve:

- **Static type verification**:
  - In Version A, all structure relies on string keys (`"component"`, `"children"`, `"variant"`). A misspelling like `"compnent"` or `"colums"` passes type checkers and is only caught when a client fails to render.
  - In Version B, every component and property name is checked at edit-time and compile-time by `mypy` or `pyright`.
- **Enum validation**:
  - In Version A, strings like `"body"` or `"spaceBetween"` have no typing. Writing `"space-between"` (kebab-case) or `"head"` causes runtime rendering anomalies.
  - In Version B, enums are typed `Literal` unions (`Literal["h1", "h2", "h3", "h4", "h5", "caption", "body"]`). Invalid values are flagged immediately in the IDE.
- **Child slot constraints**:
  - In Version A, nothing prevents a developer from mistakenly passing a list to `Card.child` or a single element to `Column.children`.
  - In Version B, the constructor signatures enforce `child: Component` on `Card` and `children: Sequence[Component]` on `Column` and `Row`. Leaf components like `Text` or `Divider` do not accept child arguments.
- **IDE discovery and documentation**:
  - In Version A, the developer must read catalog documentation in a separate browser tab to know valid attributes and enum values.
  - In Version B, typing `Text(` triggers IDE parameter hints and docstrings extracted directly from the catalog schema.
- **Component ID decoupling**:
  - In Version B, the developer does not write manual ID allocation code. The serialization logic assigns unique, scoped component IDs when flattening the nested tree.

### Ergonomics of running code generation

Developers and SDK maintainers who generate the typed API from catalog definitions need a straightforward, repeatable process:

- **Single command execution**: Generating the API must require a single CLI command (for example, `a2ui-codegen --catalog <path-or-url> --lang <language> --out <directory>`).
- **Catalog evolution and custom catalogs**: When a catalog schema changes, or when an organization creates a domain-specific catalog, running the generator must produce updated code without manual patches or overrides.
- **Zero manual configuration for standard catalogs**: The generator must work out-of-the-box with the official A2UI Basic Catalog and Minimal Catalog across supported protocol versions (v0.9, v0.9.1, v1.0).
- **Deterministic output**: Running the generator against the same catalog schema must produce identical output files, ensuring reproducible builds and clean version control diffs.

---

## Protocol versioning and cross-version considerations

A2UI has multiple protocol versions with ongoing evolution (v0.9, v0.9.1, and v1.0). The generator must account for versioning in both its architecture and its generated APIs.

### Versioning architectural options

The design must decide between two core versioning strategies:

- **Strategy A: Dedicated per-version generated modules**:
  - The generator produces independent, versioned packages or namespaces (e.g. `a2ui.catalogs.v0_9_1.basic` and `a2ui.catalogs.v1_0.basic`).
  - _Advantages_: Guarantees strict compile-time type precision. Each version exposes exactly the properties and components supported by its catalog schema. Autocomplete contains no confusing deprecated properties or premature future properties.
  - _Trade-offs_: Code written against v0.9.1 must update its import paths when upgrading to v1.0.
- **Strategy B: Unified builder API with version-targeted emitters**:
  - The developer uses a single unversioned builder API (`a2ui.basic`), and passes a target protocol version flag during serialization (e.g. `surface.to_messages(version="v1.0")`).
  - _Advantages_: Minimizes migration churn if components share similar names across versions.
  - _Trade-offs_: Compromises compile-time type safety. The builder must accept the union of all properties across versions, deferring version compatibility errors (e.g. using a v1.0-only property with a v0.9.1 target) to runtime validation.

### Key differences between v0.9.1 and v1.0

To understand the requirements for multi-version support, the generator design must account for the structural and conceptual differences between v0.9.1 and v1.0:

| Dimension                     | Protocol v0.9.1                                                                                                                                                                         | Protocol v1.0                                                                                                                                                                                                        |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server-to-Client Messages** | Uses `server_to_client.json` with separate messages: `beginRendering` (sets surface ID, root ID, catalog ID), `surfaceUpdate` (component list), `dataModelUpdate`, and `deleteSurface`. | Uses `agent_to_renderer.json` with combined messages: `createSurface` (bundles surface ID, catalog ID, components, and initial data model in one payload), `updateSurface`, `updateDataModel`, and `destroySurface`. |
| **Catalog Schema Structure**  | Components in `catalog.json` use JSON Schema `allOf` constructs combining `ComponentCommon`, `CatalogComponentCommon`, and property objects.                                            | Components in `catalog.json` use direct, flat object definitions without `allOf` indirection.                                                                                                                        |
| **Catalog Overrides**         | Catalog ID is declared at the surface level during `beginRendering`.                                                                                                                    | Components include an optional `catalogId` property in `ComponentCommon`, enabling per-component catalog overrides within a multi-catalog surface.                                                                   |
| **Accessibility Attributes**  | Supports `label` and `description` as `DynamicString`.                                                                                                                                  | Expands accessibility to include `live` (announcement priority: `"off"`, `"polite"`, `"assertive"`) and `hidden` (`DynamicBoolean`).                                                                                 |
| **Metadata Extensions**       | No standardized extension metadata on components.                                                                                                                                       | Adds `metadata.extensions` to `ComponentCommon`, allowing vendor-specific or experimental metadata.                                                                                                                  |
| **Child References**          | Container schemas define `child` as `ComponentId` and `children` as `ChildList` (`oneOf` string array or dynamic template object).                                                      | Formally introduces `$defs/Child` alongside `$defs/ChildList`.                                                                                                                                                       |
| **Validation Checks**         | `Checkable` components define validation rules via `checks: list[CheckRule]`, where each rule has `condition` (`DynamicBoolean`) and `message` (`string`).                              | In the Basic Catalog, checks can be declared directly as function call expressions (e.g. `{"call": "required"}`) with built-in or parameter-based error messaging.                                                   |
| **Function Invocations**      | Function calls declare `returnType` within schema `allOf` validation blocks.                                                                                                            | Function calls introduce optional `CallId` for tracking individual execution instances.                                                                                                                              |

The generator must be architected so that differences in message wrappers, component common attributes, and catalog schema structures are handled cleanly, whether through version-specific modules or parameterized serialization backends.

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
