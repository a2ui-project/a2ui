# A2UI Core SDK Specification

This document describes the detailed programmatic specification and architecture of the A2UI Core SDK. The Core SDK serves as the foundational data, state, and processing layer of A2UI.

This layer handles JSON parsing, state models, JSON pointers, catalogs, and schemas. This logic remains completely framework-agnostic, allowing it to be implemented identically across all target environments (including server-side or headless languages where there is no renderer).

For a high-level overview of the entire A2UI ecosystem (including the Inference SDK and Framework Adapter structure), see the [A2UI Unified SDK Architecture](sdks_spec.md). For UI framework integration and rendering details, see the [A2UI Framework Adapter Specification](framework_adapter_spec.md).

---

## 1. Core SDK Role & Architecture

The A2UI Core SDK acts as the central state coordinator. It is designed to represent core concepts and behaviors described in the A2UI specification, without any UI rendering logic.

Its core responsibilities include:

1. **Catalog Representation:** Define `Catalog` structures and pure technical component metadata/schemas (`ComponentApi`, `FunctionApi`).
2. **Protocol Definitions:** Model strongly-typed inbound and outbound message structures (e.g., `ClientToServer`, `ServerToClient`, etc.).
3. **Surface State Containers:** Track mutable, long-lived rendering states via `SurfaceModel`, `ComponentModel`, and `DataModel`.
4. **Message Processor:** Parse inbound message sequences to mutate local state containers via `MessageProcessor`.
5. **JSON Pointer Scope:** Standardize relative pointer evaluation and reactivity via scoped context managers (`ComponentContext`, `DataContext`).
6. **Validation:** Throw strict schema and reference-resolution errors.

---

## 2. The Core SDK Interfaces

At the heart of the A2UI architecture are key interfaces that connect the data to the screen.

### `ComponentApi`

The framework-agnostic definition of a component. It defines the name and the exact JSON schema footprint of the component, without any rendering logic. It acts as the single source of truth for the component's contract.

```typescript
interface ComponentApi {
  /** The name of the component as it appears in the A2UI JSON (e.g., 'Button'). */
  readonly name: string;
  /** The technical definition used for validation and generating client capabilities. */
  readonly schema: Schema;
}
```

### `SurfaceModel` & `ComponentContext`

The core state containers.

- **`SurfaceModel`**: Represents the entire state of a single UI surface, holding the `DataModel` and a flat list of component configurations.
- **`ComponentContext`**: A transient object created by the `Surface` and passed into a `ComponentImplementation` during rendering. It pairs the component's specific configuration with a scoped window into the data model (`DataContext`).

---

## THE FRAMEWORK-AGNOSTIC DATA LAYER

## 3. The Core Data Layer (Detailed Specifications)

The Data Layer maintains a long-lived, mutable state object. This layer follows the exact same design in all programming languages and **does not require design work when porting to a new framework**.

### Prerequisites

To implement the Data Layer effectively, your target environment needs two foundational utilities:

#### 1. Schema Library

To represent and validate component and function APIs, the Data Layer requires a **Schema Library** (like **Zod** in TypeScript or **Pydantic** in Python) that allows for programmatic definition of schemas and the ability to export them to standard JSON Schema. If no suitable library exists, raw JSON Schema strings or `Codable` structs can be used.

#### 2. Observable Library

A2UI relies on standard observer patterns. The Data Layer needs two types of reactivity:

- **Event Streams**: Simple publish/subscribe mechanisms for discrete events (e.g., `onSurfaceCreated`, `onAction`).
- **Stateful Streams (Signals)**: Reactive variables that hold an initial value synchronously upon subscription, and notify listeners of future changes (e.g., DataModel paths, function results). Crucially, the subscription must provide a clear mechanism to **unsubscribe** (e.g., a `dispose()` method) to prevent memory leaks.

### Design Principles

#### 1. The "Add" Pattern for Composition

We strictly separate **construction** from **composition**. Parent containers do not act as factories for their children.

```typescript
const child = new ChildModel(config);
parent.addChild(child);
```

#### 2. Standard Observer Pattern

Models must provide a mechanism for the rendering layer to observe changes.

1.  **Low Dependency**: Prefer "lowest common denominator" mechanisms.
2.  **Multi-Cast**: Support multiple listeners registered simultaneously.
3.  **Unsubscribe Pattern**: There MUST be a clear way to stop listening.
4.  **Payload Support**: Communicate specific data updates and lifecycle events.
5.  **Consistency**: Used uniformly across `SurfaceGroupModel` (lifecycle), `SurfaceModel` (actions), `SurfaceComponentsModel` (lifecycle), `ComponentModel` (updates), and `DataModel` (data changes).

#### 3. Granular Reactivity

The model is designed to support high-performance rendering through granular updates.

- **Structure Changes**: The `SurfaceComponentsModel` notifies when items are added/removed.
- **Property Changes**: The `ComponentModel` notifies when its specific configuration changes.
- **Data Changes**: The `DataModel` notifies only subscribers to the specific path that changed.

### Protocol Models & Serialization

The framework-agnostic layer is responsible for defining strict, native type representations of the A2UI JSON schemas. Renderers should not pass raw generic dictionaries (like `Map<String, Any>` or `Record<string, any>`) directly into the state layer.

Developers must create data classes, structs, or interfaces (e.g., `data class` in Kotlin, `Codable struct` in Swift, or Zod-validated `interface` in TypeScript) that perfectly mirror the official JSON specifications. This creates a safe boundary between the raw network stream and the internal state models.

**Required Data Structures:**

- **Server-to-Client Messages:** `A2uiMessage` (a union/protocol type), `CreateSurfaceMessage`, `UpdateComponentsMessage`, `UpdateDataModelMessage`, `DeleteSurfaceMessage`.
- **Client-to-Server Events:** `ClientEvent` (a union/protocol type), `ActionMessage`, `ErrorMessage`.
- **Client Metadata:** `A2uiClientCapabilities`, `InlineCatalog`, `FunctionDefinition`, `ClientDataModel`.

**JSON Serialization & Validation:**

- **Inbound (Parsing)**: The core library must provide a mechanism to deserialize a raw JSON string into a strongly-typed `A2uiMessage`. If the payload violates the A2UI JSON schema, this layer must throw an `A2uiValidationError` _before_ the message reaches the state models.
- **Outbound (Stringifying)**: The core library must serialize client-to-server events and capabilities from their strict native types back into valid JSON strings to hand off to the transport layer.

### The State Models

#### SurfaceGroupModel & SurfaceModel

The root containers for active surfaces and their catalogs, data, and components.

```typescript
interface SurfaceLifecycleListener<T extends ComponentApi> {
  onSurfaceCreated?: (s: SurfaceModel<T>) => void;
  onSurfaceDeleted?: (id: string) => void;
}

class SurfaceGroupModel<T extends ComponentApi> {
  addSurface(surface: SurfaceModel<T>): void;
  deleteSurface(id: string): void;
  getSurface(id: string): SurfaceModel<T> | undefined;

  readonly onSurfaceCreated: EventSource<SurfaceModel<T>>;
  readonly onSurfaceDeleted: EventSource<string>;
  readonly onAction: EventSource<A2uiClientAction>;
}

/**
 * Matches 'action' in specification/v0_9_1/json/client_to_server.json.
 */
interface A2uiClientAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string; // ISO 8601
  context: Record<string, any>;
}

type ActionListener = (action: A2uiClientAction) => void | Promise<void>;

class SurfaceModel<T extends ComponentApi> {
  readonly id: string;
...
  readonly catalog: Catalog<T>;
  readonly dataModel: DataModel;
  readonly componentsModel: SurfaceComponentsModel;
  readonly theme?: Record<string, any>;
  /** If true, the client should send the full data model with actions. */
  readonly sendDataModel: boolean;

  readonly onAction: EventSource<A2uiClientAction>;
  /**
   * Dispatches an action from this surface.
   * @param payload The raw action event from the component.
   * @param sourceComponentId The ID of the component that triggered the action.
   */
  dispatchAction(payload: Record<string, any>, sourceComponentId: string): Promise<void>;
}
```

#### `SurfaceComponentsModel` & `ComponentModel`

Manages the raw JSON configuration of components in a flat map.

```typescript
class SurfaceComponentsModel {
  get(id: string): ComponentModel | undefined;
  addComponent(component: ComponentModel): void;

  readonly onCreated: EventSource<ComponentModel>;
  readonly onDeleted: EventSource<string>;
}

class ComponentModel {
  readonly id: string;
  readonly type: string; // Component name (e.g. 'Button')

  get properties(): Record<string, any>;
  set properties(newProps: Record<string, any>);

  readonly onUpdated: EventSource<ComponentModel>;
}
```

#### `DataModel`

A dedicated store for application data.

```typescript
interface Subscription<T> {
  readonly value: T | undefined; // Latest evaluated value
  unsubscribe(): void;
}

class DataModel {
  get(path: string): any; // Resolve JSON Pointer to value
  set(path: string, value: any): void; // Atomic update at path
  subscribe<T>(path: string, onChange: (v: T | undefined) => void): Subscription<T>; // Reactive path monitoring
  dispose(): void;
}
```

**JSON Pointer Implementation Rules**:

1.  **A2UI Extension**: A2UI extends JSON Pointer to support **Relative Paths** that do not start with a forward slash `/` (e.g., `name` vs `/name`). These resolve relative to the current evaluation scope.
2.  **Auto-typing (Auto-vivification)**: When setting a value at a nested path (e.g., `/a/b/0/c`), create intermediate segments. If the next segment is numeric (`0`), initialize as an Array `[]`, otherwise an Object `{}`.
3.  **Notification Strategy (Bubble & Cascade)**: Notify exact matches, bubble up to all parent paths, and cascade down to all nested descendant paths.
4.  **Undefined Handling**: Setting an object key to `undefined` removes the key. Setting an array index to `undefined` preserves length but empties the index (sparse array).

**Type Coercion Standards**:
| Input Type | Target Type | Result |
| :------------------------- | :---------- | :---------------------------------------------------------------------- |
| `String` ("true", "false") | `Boolean` | `true` or `false` (case-insensitive). Any other string maps to `false`. |
| `Number` (non-zero) | `Boolean` | `true` |
| `Number` (0) | `Boolean` | `false` |
| `Any` | `String` | Locale-neutral string representation |
| `null` / `undefined` | `String` | `""` (empty string) |
| `null` / `undefined` | `Number` | `0` |
| `String` (numeric) | `Number` | Parsed numeric value or `0` |

#### The Context Layer

Transient objects created on-demand during rendering to solve "scope" and binding resolution.

```typescript
class DataContext {
  constructor(dataModel: DataModel, path: string);
  readonly path: string;
  set(path: string, value: unknown): void;
  resolveDynamicValue<V>(v: DynamicValue): V;
  subscribeDynamicValue<V>(v: DynamicValue, onChange: (v: V | undefined) => void): Subscription<V>;
  nested(relativePath: string): DataContext;
}

class ComponentContext<T extends ComponentApi> {
  constructor(surface: SurfaceModel<T>, componentId: string, basePath?: string);
  readonly componentModel: ComponentModel;
  readonly dataContext: DataContext;
  readonly surfaceComponents: SurfaceComponentsModel; // The escape hatch
  dispatchAction(action: Record<string, any>): Promise<void>;
}
```

_Escape Hatch_: Component implementations can use `ctx.surfaceComponents` to inspect the metadata of other components in the same surface (e.g. a `Row` checking if children have a `weight` property). This is discouraged but necessary for some layout engines.

---

## 4. The Processing Layer (`MessageProcessor`)

The "Controller" that accepts the raw stream of A2UI messages, parses them, and mutates the Models. It also handles the aggregation of client state for synchronization.

```typescript
class MessageProcessor<T extends ComponentApi> {
  readonly model: SurfaceGroupModel<T>;

  constructor(catalogs: Catalog<T>[], actionHandler: ActionListener);

  // Accepts validated, strongly-typed message objects, not raw JSON
  processMessages(messages: A2uiMessage[]): void;
  addLifecycleListener(l: SurfaceLifecycleListener<T>): () => void;

  // Returns a strictly typed capabilities object ready for JSON serialization
  getClientCapabilities(options?: CapabilitiesOptions): A2uiClientCapabilities;

  /**
   * Returns the aggregated data model for all surfaces that have 'sendDataModel' enabled.
   * This should be used by the transport layer to populate metadata (e.g., 'a2uiClientDataModel').
   */
  getClientDataModel(): A2uiClientDataModel | undefined;
}
```

### Client Data Model Synchronization

When a surface is created with `sendDataModel: true`, the client is responsible for sending the current state of that surface's data model back to the server whenever a client-to-server message (like an `action`) is sent.

**Implementation Flow:**

1.  The `MessageProcessor` tracks the `sendDataModel` flag for each surface.
2.  The `getClientDataModel()` method iterates over all active surfaces and returns a map of data models for those where the flag is enabled.
3.  The **Transport Layer** (e.g., A2A, MCP) calls `getClientDataModel()` before sending any message to the server.
4.  If a non-empty data model map is returned, it is included in the transport's metadata field (e.g., `a2uiClientDataModel` in A2A metadata).

- **Surface Lifecycle**: It is an error to receive a `createSurface` message for a `surfaceId` that is already active. The processor MUST throw an error or report a validation failure if this occurs.
- **Component Lifecycle**: If an `updateComponents` message provides an existing `id` but a _different_ `type`, the processor MUST remove the old component and create a fresh one to ensure framework renderers correctly reset their internal state.

### Generating Client Capabilities and Schema Types

To dynamically generate the `a2uiClientCapabilities` payload (specifically `inlineCatalogs`), the processor must convert internal component schemas into valid JSON Schemas.

**Schema Types Location**: Foundational schema types _should_ be defined in a dedicated directory like `schema`. You can see the `renderers/web_core/src/v0_9/schema/common-types.ts` file in the reference web implementation as an example.

**Detectable Common Types**: Shared definitions (like `DynamicString`) must emit external JSON Schema `$ref` pointers. This is achieved by "tagging" the schemas using their `description` property (e.g., `REF:common_types.json#/$defs/DynamicString`).

When `getClientCapabilities()` converts internal schemas to generate `inlineCatalogs`:

1. **Components**: Translate each component schema into a raw JSON Schema. Wrap it in the standard A2UI component envelope (`allOf` containing `ComponentCommon`).
2. **Functions**: Map each function in the catalog to a `FunctionDefinition` object, converting its argument schema to JSON Schema.
3. **Theme**: Convert the catalog's theme schema into a JSON Schema representation.
4. **Reference Processing**: For all generated schemas (components, functions, and themes), traverse the tree looking for descriptions starting with `REF:`. Strip the tag and replace the node with a valid JSON Schema `$ref` object.

---

## 5. The Catalog API & Functions

A catalog groups component definitions and function definitions together, along with an optional theme schema.

```typescript
interface FunctionApi {
  readonly name: string;
  readonly returnType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';
  readonly schema: Schema; // The expected arguments
}

/**
 * A function implementation. Splitting API from Implementation is less critical than
 * for components because functions are framework-agnostic, but it allows for
 * re-using API definitions across different implementation providers.
 */
interface FunctionImplementation extends FunctionApi {
  // Executes the function logic. Accepts static inputs, returns a value or a reactive stream.
  execute(args: Record<string, any>, context: DataContext): unknown | Observable<unknown>;
}

class Catalog<T extends ComponentApi> {
  readonly id: string; // Unique catalog ID (string identifier)
  readonly components: ReadonlyMap<string, T>;
  readonly functions?: ReadonlyMap<string, FunctionImplementation>;
  readonly themeSchema?: Schema;

  constructor(
    id: string,
    components: T[],
    functions?: FunctionImplementation[],
    themeSchema?: Schema,
  ) {
    // Initializes the properties
  }
}
```

**Function Implementation Details**:
Functions in A2UI accept statically resolved values as input arguments (not observable streams). However, they can return an observable stream (or Signal) to provide reactive updates to the UI, or they can simply return a static value synchronously.

Functions generally fall into a few common patterns:

1.  **Pure Logic (Synchronous)**: Functions like `add` or `concat`. Their logic is immediate and depends only on their inputs. They typically return a static value.
2.  **External State (Reactive)**: Functions like `clock()` or `networkStatus()`. These return long-lived streams that push updates to the UI independently of data model changes.
3.  **Effect Functions**: Side-effect handlers (e.g., `openUrl`, `closeModal`) that return `void`. These are triggered by user actions rather than interpolation.

If a function returns a reactive stream, it MUST use an idiomatic listening mechanism that supports standard unsubscription. To properly support an AI agent, functions SHOULD include a schema to generate accurate client capabilities.

### Composing Your Own Catalog

You can define your own catalog by composing components and functions that reflect your design system. While you can build a catalog entirely from scratch, you can also import or combine definitions with the Basic Catalog to save time.

_Example of composing a catalog:_

```python
# Pseudocode
myCustomCatalog = Catalog(
  id="https://mycompany.com/catalogs/custom_catalog.json",
  functions=basicCatalog.functions,
  components=basicCatalog.components + [MyCompanyLogoComponent()],
  themeSchema=basicCatalog.themeSchema # Inherit theme schema
)
```

---

## 6. The Binder Layer Pattern (State Bridge)

For complex applications, scattering manual A2UI subscription logic across all view components becomes repetitive and error-prone.

The **Binder Layer** is a framework-agnostic intermediate abstraction inside the Core SDK. It takes raw component configurations and transforms the reactive A2UI bindings into a single, cohesive stream of strongly-typed `ResolvedProps`. The native UI components (described in the [Framework Adapter Specification](framework_adapter_spec.md)) simply listen to this generic stream.

```typescript
export interface ComponentBinding<ResolvedProps> {
  readonly propsStream: StatefulStream<ResolvedProps>; // e.g. BehaviorSubject
  dispose(): void; // Cleans up all underlying data model subscriptions
}

export interface ComponentBinder<ResolvedProps> {
  readonly schema: Schema;
  bind(context: ComponentContext<any>): ComponentBinding<ResolvedProps>;
}
```

### Generic Binders for Dynamic Languages

In languages with powerful runtime reflection (like TypeScript/Zod), the Binder Layer can be entirely automated. You can write a generic factory that inspects a component's schema and automatically creates all necessary data model subscriptions, inferring strict types.

This provides the ultimate "happy path" developer experience. The developer writes a simple, stateless UI component that receives native types, completely abstracted from A2UI's internals.

```typescript
// 1. The framework adapter infers the prop types from the Binder's Schema.
// The raw `DynamicString` label and `Action` object have been automatically
// resolved into a static `string` and a callable `() => void` function.

// Conceptually, the inferred type looks like this:
interface ButtonResolvedProps {
  label?: string; // Resolved from DynamicString
  action: () => void; // Resolved from Action
  child?: string; // Resolved structural ComponentId
}
```

---

## 7. The Basic Catalog Standard (Core APIs)

The standard A2UI Basic Catalog specifies a set of core components (Button, Text, Row, Column) and functions.

### Strict API / Implementation Separation

When building libraries that provide the Basic Catalog, it is **crucial** to separate the pure API (the Schemas and `ComponentApi`/`FunctionApi` definitions) from the actual UI implementations.

- **Multi-Framework Code Reuse**: In ecosystems like the Web, this allows a shared `web_core` library to define the Basic Catalog API and Binders once, while separate packages (`react_renderer`, `angular_renderer`) provide the native view implementations.
- **Developer Overrides**: By exposing the standard API definitions, developers adopting A2UI can easily swap in custom UI implementations (e.g., replacing the default `Button` with their company's internal Design System `Button`) without having to rewrite the complex A2UI validation, data binding, and capability generation logic.

For a detailed walkthrough on how to visually and functionally implement each basic component and function, refer to the [Basic Catalog Implementation Guide](basic_catalog_implementation_guide.md).

### Strongly-Typed Catalog Implementations

To ensure all components are properly implemented and match the exact API signature, platforms with strong type systems should utilize their advanced typing features. This ensures that a provided renderer not only exists, but its `name` and `schema` strictly match the official Catalog Definition, catching mismatches at compile time rather than runtime.

#### Statically Typed Languages (e.g. Kotlin/Swift)

In languages like Kotlin, you can define a strict interface or class that demands concrete instances of the specific component APIs defined by the Core Library.

```kotlin
// The Core Library defines the exact shape of the catalog
class BasicCatalogImplementations(
    val button: ButtonApi, // Must be an instance of the ButtonApi class
    val text: TextApi,
    val row: RowApi
    // ...
)
```

#### Dynamic Languages (e.g. TypeScript)

In TypeScript, we can use intersection types to force the framework renderer to intersect with the exact definition.

```typescript
// Concept: Forcing implementations to match the spec
type BasicCatalogImplementations = {
  Button: ComponentImplementation & {name: 'Button'; schema: Schema};
  Text: ComponentImplementation & {name: 'Text'; schema: Schema};
  Row: ComponentImplementation & {name: 'Row'; schema: Schema};
  // ...
};
```

### Expression Resolution Logic (`formatString`)

The Basic Catalog requires a `formatString` function capable of interpreting `${expression}` syntax within string properties.

**Implementation Requirements**:

1.  **Recursion**: The implementation MUST use `DataContext.resolveDynamicValue()` or `DataContext.subscribeDynamicValue()` to recursively evaluate nested expressions or function calls (e.g., `${formatDate(value:${/date})}`).
2.  **Tokenization**: Distinguish between DataPaths (e.g., `${/user/name}`) and FunctionCalls (e.g., `${now()}`).
3.  **Escaping**: Literal `${` sequences must be handled (typically escaping as `\${`).
4.  **Reactive Coercion**: Results are transformed into strings using the standard Type Coercion rules.

---

## 8. Agent Implementation Guide: Core SDK Phases

If you are an AI Agent tasked with building a new Core SDK for A2UI, you MUST follow this strict, phased sequence of operations.

### Phase 1: Context to Ingest

Thoroughly review:

- `specification/v0_9_1/docs/sdks_spec.md` (unified topologies and layer context)
- `specification/v0_9_1/docs/a2ui_protocol.md` (protocol rules)
- `specification/v0_9_1/json/common_types.json` (dynamic binding types)
- `specification/v0_9_1/json/server_to_client.json` (message envelopes)
- `specification/v0_9_1/catalogs/basic/catalog.json` (your target)
- `specification/v0_9_1/docs/basic_catalog_implementation_guide.md` (for functional specs and spacing rules for when you get to the basic catalog)

### Phase 2: Key Architecture Decisions (Write a Plan Document)

Create a comprehensive design document detailing:

- **Dependencies**: Which Schema Library and Observable/Reactive Library will you use? _Note: Ensure your reactive library supports both discrete event subscription (EventEmitter style) and stateful, signal-like data streams (BehaviorSubject/Signal style)._
- **Component Architecture**: How will you define the `ComponentApi` structure for this language?
- **Binding Strategy**: Detail your plans for the intermediate Core Binder Layer and dynamic/static types.
- **STOP HERE. Ask the user for approval on this design document before proceeding.**

### Phase 3: Core Model Layer

Implement the framework-agnostic Data Layer (Section 3 & 4).

- Implement event streams and stateful signals.
- Implement strict Protocol Models (`A2uiMessage`, `A2uiClientCapabilities`, etc.) with JSON serialization/deserialization and schema validation logic.
- Implement `DataModel`, ensuring correct JSON pointer resolution and the cascade/bubble notification strategy.
- Implement `ComponentModel`, `SurfaceComponentsModel`, `SurfaceModel`, and `SurfaceGroupModel`.
- Implement `DataContext` and `ComponentContext`.
- Implement `MessageProcessor` and ClientCapabilities generation.
- **Action**: Write unit tests for JSON validation, the `DataModel` (especially pointer resolution/cascade logic), and `MessageProcessor`. Ensure they pass before continuing.

### Phase 4: Foundational Basic Catalog Support

Target a foundational subset of the Basic Catalog (equivalent to the former minimal catalog) to bootstrap your implementation:

- **Components**: Define the pure API schemas and binders for:
  - `Text`
  - `Row`
  - `Column`
  - `Button`
  - `TextField`
- **Functions**: Implement the `formatString` function (which is required for basic text rendering and expression resolution, see Section 7).
- **Bundle**: Group these components and functions into a `Catalog` instance.
- **Verification**: Write unit tests to verify that `DataModel` updates and expressions resolve reactively when the underlying data changes, and that binders/bindings correctly propagate resolved props.

### Phase 5: Complete Basic Catalog Support

Once the foundational architecture and subset are proven robust, complete the implementation of the Basic Catalog:

- **Core Binders**: Create definitions and binders for all remaining components in `basic/catalog.json`.
- **Core Functions**: Implement the remaining basic functions (e.g., math, logical, and array operations). Note that string interpolation and expression parsing should ONLY happen within the `formatString` function. Do not attempt to add global string interpolation to all strings.
- **Verification & Tests**: Look at existing reference implementations (e.g., `web_core`) to formulate and run comprehensive unit tests for data coercion, JSON pointer bubble/cascade notifications, and all function execution paths.
