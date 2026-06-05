# Unified Architecture & Implementation Guide

This document describes the architecture of an A2UI client implementation. The design separates concerns into distinct layers to maximize code reuse, ensure memory safety, and provide a streamlined developer experience when adding custom components.

Both the core data structures and the rendering components interact with **Catalogs**. Within a catalog, the implementation follows a structured split: from the pure **Component Schema** down to the **Framework-Specific Adapter** that paints the pixels.

## 1. Unified Architecture Overview

The A2UI client architecture has a well-defined data flow that bridges language-agnostic data structures with native UI frameworks.

1. **A2UI Messages** arrive from the server (JSON).
2. The **`MessageProcessor`** parses these and updates the **`SurfaceModel`** (Agnostic State).
3. The **`Surface`** (Framework Entry View) listens to the `SurfaceModel` and begins rendering.
4. The `Surface` instantiates and renders individual **`ComponentImplementation`** nodes to build the UI tree.

This establishes a fundamental split:

- **The Framework-Agnostic Layer (Data Layer)**: Handles JSON parsing, state management, JSON pointers, and schemas. This logic is identical across all UI frameworks within a given language.
- **The Framework-Specific Layer (View Layer)**: Handles turning the structured state into actual pixels (React Nodes, Flutter Widgets, iOS Views).

### Implementation Topologies

Because A2UI spans multiple languages and UI paradigms, the strictness and location of these architectural boundaries will vary depending on the target ecosystem.

#### Dynamic Languages (e.g., TypeScript / JavaScript)

In highly dynamic ecosystems like the web, the architecture is typically split across multiple packages to maximize code reuse across diverse UI frameworks (React, Angular, Vue, Lit).

- **Core Library (`web_core`)**: Implements the Core Data Layer, Component Schemas, and a Generic Binder Layer. Because TS/JS has powerful runtime reflection, the core library can provide a generic binder that automatically handles all data binding without framework-specific code.
- **Framework Library (`react_renderer`, `angular_renderer`)**: Implements the Framework-Specific Adapters and the actual view implementations (the React `Button`, `Text`, etc.).

#### Static Languages (e.g., Kotlin, Swift, Dart)

In statically typed languages (and AOT-compiled languages like Dart), runtime reflection is often limited or discouraged for performance reasons.

- **Core Library (e.g., `kotlin_core`)**: Implements the Core Data Layer and Component Schemas. The core library typically provides a manually implemented **Binder Layer** for the standard Basic Catalog components. This ensures that even in static environments, basic components have a standardized, framework-agnostic reactive state definition.
- **Code Generation (Future/Optional)**: While the core library starts with manual binders, it may eventually offer Code Generation (e.g., KSP, Swift Macros) to automate the creation of Binders for custom components.
- **Custom Components**: In the absence of code generation, developers implementing new, ad-hoc components typically utilize a **"Binderless" Implementation** flow, which allows for direct binding to the data model without intermediate boilerplate.
- **Framework Library (e.g., `compose_renderer`)**: Uses the predefined Binders to connect to native UI state and implements the actual visual components.

#### Combined Core + Framework Libraries (e.g., Swift + SwiftUI)

In ecosystems dominated by a single UI framework (like iOS with SwiftUI), developers often build a single, unified library rather than splitting Core and Framework into separate packages.

- **Relaxed Boundaries**: The strict separation between Core and Framework libraries can be relaxed. The generic `ComponentContext` and the framework-specific adapter logic are often tightly integrated.
- **Why Keep the Binder Layer?**: Even in a combined library, defining the intermediate Binder Layer remains highly recommended. It standardizes how A2UI data resolves into reactive state. This allows developers adopting the library to easily write alternative implementations of well-known components without having to rewrite the complex, boilerplate-heavy A2UI data subscription logic.

## 2. The Core Interfaces

At the heart of the A2UI architecture are five key interfaces that connect the data to the screen.

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

### `ComponentImplementation`

The framework-specific logic for rendering a component. It extends `ComponentApi` to include a `build` or `render` method.

How this looks depends on the target framework's paradigm:

**Functional / Reactive Frameworks (e.g., Flutter, SwiftUI, React)**

```typescript
interface ComponentImplementation extends ComponentApi {
  /**
   * @param ctx The component's context containing its data and state.
   * @param buildChild A closure provided by the surface to recursively build children.
   */
  build(
    ctx: ComponentContext<ComponentImplementation>,
    buildChild: (id: string) => NativeWidget,
  ): NativeWidget;
}
```

**Stateful / Imperative Frameworks (e.g., Vanilla DOM, Android Views)**
Because the catalog only holds a single "blueprint" of each `ComponentImplementation`, stateful frameworks need a way to instantiate individual objects for each component rendered on screen.

```typescript
interface ComponentInstance {
  mount(container: NativeElement): void;
  update(ctx: ComponentContext<ComponentImplementation>): void;
  unmount(): void;
}

interface ComponentImplementation extends ComponentApi {
  /** Creates a new stateful instance of this component type. */
  createInstance(ctx: ComponentContext<ComponentImplementation>): ComponentInstance;
}
```

### `Surface`

The entrypoint widget/view for a specific framework. It is instantiated with a `SurfaceModel`. It listens to the model for lifecycle events and dynamically builds the UI tree, initiating the recursive rendering loop at the component with ID `root`.

### `SurfaceModel` & `ComponentContext`

The state containers.

- **`SurfaceModel`**: Represents the entire state of a single UI surface, holding the `DataModel` and a flat list of component configurations.
- **`ComponentContext`**: A transient object created by the `Surface` and passed into a `ComponentImplementation` during rendering. It pairs the component's specific configuration with a scoped window into the data model (`DataContext`).

---

## THE FRAMEWORK-AGNOSTIC LAYER

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
 * Matches 'action' in specification/v0_9/json/client_to_server.json.
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

### The Processing Layer (`MessageProcessor`)

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

#### Client Data Model Synchronization

When a surface is created with `sendDataModel: true`, the client is responsible for sending the current state of that surface's data model back to the server whenever a client-to-server message (like an `action`) is sent.

**Implementation Flow:**

1.  The `MessageProcessor` tracks the `sendDataModel` flag for each surface.
2.  The `getClientDataModel()` method iterates over all active surfaces and returns a map of data models for those where the flag is enabled.
3.  The **Transport Layer** (e.g., A2A, MCP) calls `getClientDataModel()` before sending any message to the server.
4.  If a non-empty data model map is returned, it is included in the transport's metadata field (e.g., `a2uiClientDataModel` in A2A metadata).

- **Surface Lifecycle**: It is an error to receive a `createSurface` message for a `surfaceId` that is already active. The processor MUST throw an error or report a validation failure if this occurs.
- **Component Lifecycle**: If an `updateComponents` message provides an existing `id` but a _different_ `type`, the processor MUST remove the old component and create a fresh one to ensure framework renderers correctly reset their internal state.

#### Generating Client Capabilities and Schema Types

To dynamically generate the `a2uiClientCapabilities` payload (specifically `inlineCatalogs`), the processor must convert internal component schemas into valid JSON Schemas.

**Schema Types Location**: Foundational schema types _should_ be defined in a dedicated directory like `schema`. You can see the `renderers/web_core/src/v0_9/schema/common-types.ts` file in the reference web implementation as an example.

**Detectable Common Types**: Shared definitions (like `DynamicString`) must emit external JSON Schema `$ref` pointers. This is achieved by "tagging" the schemas using their `description` property (e.g., `REF:common_types.json#/$defs/DynamicString`).

When `getClientCapabilities()` converts internal schemas to generate `inlineCatalogs`:

1. **Components**: Translate each component schema into a raw JSON Schema. Wrap it in the standard A2UI component envelope (`allOf` containing `ComponentCommon`).
2. **Functions**: Map each function in the catalog to a `FunctionDefinition` object, converting its argument schema to JSON Schema.
3. **Theme**: Convert the catalog's theme schema into a JSON Schema representation.
4. **Reference Processing**: For all generated schemas (components, functions, and themes), traverse the tree looking for descriptions starting with `REF:`. Strip the tag and replace the node with a valid JSON Schema `$ref` object.

## 4. The Catalog API & Functions

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
  readonly id: string; // Unique catalog URI
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

## THE FRAMEWORK-SPECIFIC LAYER

## 5. Component Implementation Strategies

While the `ComponentImplementation` API dictates that a component must be able to `build()` or `mount()`, _how_ a developer connects that view to the reactive data model inside `ComponentContext` varies by language capabilities.

### Strategy 1: Direct / Binderless Implementation

The most straightforward approach. The developer implements the `ComponentImplementation` and manually manages A2UI reactivity directly within the `build` method using the framework's native reactive tools (e.g., `StreamBuilder` in Flutter, or manual `useEffect` in React).

_Example: Flutter Direct Implementation_

```dart
Widget build(ComponentContext context, ChildBuilderCallback buildChild) {
  return StreamBuilder(
    // Manually observe the dynamic value stream
    stream: context.dataContext.observeDynamicValue(context.componentModel.properties['label']),
    builder: (context, snapshot) {
      return ElevatedButton(
        onPressed: () => context.dispatchAction(context.componentModel.properties['action']),
        child: Text(snapshot.data?.toString() ?? ''),
      );
    }
  );
}
```

### Strategy 2: The Binder Layer Pattern

For complex applications, scattering manual A2UI subscription logic across all view components becomes repetitive and error-prone.

The **Binder Layer** is an intermediate abstraction. It takes raw component properties and transforms the reactive A2UI bindings into a single, cohesive stream of strongly-typed `ResolvedProps`. The view component simply listens to this generic stream.

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

### Strategy 3: Generic Binders for Dynamic Languages

In languages with powerful runtime reflection (like TypeScript/Zod), the Binder Layer can be entirely automated. You can write a generic factory that inspects a component's schema and automatically creates all necessary data model subscriptions, inferring strict types.

This provides the ultimate "happy path" developer experience. The developer writes a simple, stateless UI component that receives native types, completely abstracted from A2UI's internals.

```typescript
// 1. The framework adapter infers the prop types from the Binder's Schema.
// The raw `DynamicString` label and `Action` object have been automatically
// resolved into a static `string` and a callable `() => void` function.

// Conceptually, the inferred type looks like this:
interface ButtonResolvedProps {
  label?: string;      // Resolved from DynamicString
  action: () => void;  // Resolved from Action
  child?: string;      // Resolved structural ComponentId
}

// 2. The developer writes a simple, stateless UI component.
// The `props` argument is strictly inferred from the ButtonSchema.
const ReactButton = createReactComponent(ButtonBinder, ({ props, buildChild }) => {
  return (
    <button onClick={props.action}>
      {props.child ? buildChild(props.child) : props.label}
    </button>
  );
});
```

Because of the generic types flowing through the adapter, if the developer typos `props.action` as `props.onClick`, or treats `props.label` as an object instead of a string, the compiler will immediately flag a type error.

### Example: Framework-Specific Adapters

The adapter acts as a wrapper that instantiates the binder, binds its output stream to the framework's state mechanism, injects structural rendering helpers (`buildChild`), and hooks into the native destruction lifecycle to call `dispose()`.

#### React Pseudo-Adapter

```typescript
// Pseudo-code concept for a React adapter
function createReactComponent(binder, RenderComponent) {
  return function ReactWrapper({ context, buildChild }) {
    // Hook into component mount
    const [props, setProps] = useState(binder.initialProps);

    useEffect(() => {
      // Create binding on mount
      const binding = binder.bind(context);

      // Subscribe to updates
      const sub = binding.propsStream.subscribe(newProps => setProps(newProps));

      // Cleanup on unmount
      return () => {
        sub.unsubscribe();
        binding.dispose();
      };
    }, [context]);

    return <RenderComponent props={props} buildChild={buildChild} />;
  }
}
```

#### Angular Pseudo-Adapter

```typescript
// Pseudo-code concept for an Angular adapter
@Component({
  selector: 'app-angular-wrapper',
  imports: [MatButtonModule],
  template: `
    @if (props(); as props) {
      <button mat-button>{{ props.label }}</button>
    }
  `,
})
export class AngularWrapper {
  private binder = inject(BinderService);
  private context = inject(ComponentContext);

  private bindingResource = resource({
    loader: async () => {
      const binding = this.binder.bind(this.context);

      return {
        instance: binding,
        props: toSignal(binding.propsStream), // Convert Observable to Signal
      };
    },
  });

  props = computed(() => this.bindingResource.value()?.props() ?? null);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.bindingResource.value()?.instance.dispose();
    });
  }
}
```

## 6. Framework Binding Lifecycles & Traits

Regardless of the implementation strategy chosen, the framework adapter or `ComponentImplementation` MUST strictly manage subscriptions to ensure performance and prevent memory leaks.

### Contract of Ownership

A crucial part of A2UI's architecture is understanding who "owns" the data layers.

- **The Data Layer (Message Processor) owns the `ComponentModel`**. It creates, updates, and destroys the component's raw data state based on the incoming JSON stream.
- **The Framework Adapter owns the `ComponentContext` and `ComponentBinding`**. When the native framework decides to mount a component onto the screen (e.g., React runs `render`), the Framework Adapter creates the `ComponentContext` and passes it to the Binder. When the native framework unmounts the component, the Framework Adapter MUST call `binding.dispose()`.

### Data Props vs. Structural Props

It's important to distinguish between Data Props (like `label` or `value`) and Structural Props (like `child` or `children`).

- **Data Props:** Handled entirely by the Binder. The adapter receives a stream of fully resolved values (e.g., `"Submit"` instead of a `DynamicString` path). Whenever a data value updates, the binder should emit a _new reference_ (e.g. a shallow copy of the props object) to ensure declarative frameworks that rely on strict equality (like React) correctly detect the change and trigger a re-render.
- **Structural Props:** The Binder does not attempt to resolve component IDs into actual UI trees. Instead, it outputs metadata for the children that need to be rendered.
  - For a simple `ComponentId` (e.g., `Card.child`), it emits an object like `{ id: string, basePath: string }`.
  - For a `ChildList` (e.g., `Column.children`), it evaluates the array. If the array is driven by a dynamic template bound to the data model, the binder must iterate over the array, using `context.dataContext.nested()` to generate a specific context for each index, and output a list of `ChildNode` streams.
- The framework adapter is then responsible for taking these node definitions and calling a framework-native `buildChild(id, basePath)` method recursively.

> **Implementation Tip: Context Propagation**
> When implementing the recursive `buildChild` helper, ensure that it correctly inherits the _current_ component's data context path by default. If a nested component (like a Text field inside a List template) uses a relative path, it must resolve against the scoped path provided by its immediate structural parent (e.g., `/restaurants/0`), not the root path. Failing to propagate this context is a common cause of "empty" data in nested components.

### Component Subscription Lifecycle Rules

1.  **Lazy Subscription**: Only bind and subscribe to data paths or property updates when the component is actually mounted/attached to the UI.
2.  **Path Stability**: If a component's property changes via an `updateComponents` message, you MUST unsubscribe from the old path before subscribing to the new one.
3.  **Destruction / Cleanup**: When a component is removed from the UI (e.g., via a `deleteSurface` message), the implementation MUST hook into its native lifecycle to dispose of all data model subscriptions.

### Reactive Validation (`Checkable`)

Interactive components that support the `checks` property should implement the `Checkable` trait.

- **Aggregate Error Stream**: The component should subscribe to all `CheckRule` conditions defined in its properties.
- **UI Feedback**: It should reactively display the `message` of the first failing check as a validation error hint.
- **Action Blocking**: Actions (like `Button` clicks) should be reactively disabled or blocked if any validation check fails.

---

## STANDARDS & TOOLING

## 7. The Basic Catalog Standard

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

// The Framework Adapter implements the native views extending the base APIs
class ComposeButton : ButtonApi() {
    // Framework specific render logic
}

// The compiler forces all required components to be provided
val implementations = BasicCatalogImplementations(
    button = ComposeButton(),
    text = ComposeText(),
    row = ComposeRow()
)

val catalog = Catalog("id", listOf(implementations.button, implementations.text, implementations.row))
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

// If a developer forgets 'Row' or spells it wrong, the compiler throws an error.
const catalog = new Catalog('id', [
  implementations.Button,
  implementations.Text,
  implementations.Row,
]);
```

### Expression Resolution Logic (`formatString`)

The Basic Catalog requires a `formatString` function capable of interpreting `${expression}` syntax within string properties.

**Implementation Requirements**:

1.  **Recursion**: The implementation MUST use `DataContext.resolveDynamicValue()` or `DataContext.subscribeDynamicValue()` to recursively evaluate nested expressions or function calls (e.g., `${formatDate(value:${/date})}`).
2.  **Tokenization**: Distinguish between DataPaths (e.g., `${/user/name}`) and FunctionCalls (e.g., `${now()}`).
3.  **Escaping**: Literal `${` sequences must be handled (typically escaping as `\${`).
4.  **Reactive Coercion**: Results are transformed into strings using the standard Type Coercion rules.

## 8. The Gallery App

The Gallery App is a comprehensive development and debugging tool that serves as the reference environment for an A2UI renderer. It allows developers to visualize components, inspect the live data model, step through progressive rendering, and verify interaction logic.

### UX Architecture

The Gallery App must implement a three-column layout:

1.  **Left Column (Sample Navigation)**: A list of available A2UI samples.
2.  **Center Column (Rendering & Messages)**:
    - **Surface Preview**: Renders the active A2UI `Surface`.
    - **JSON Message Stream**: Displays the list of A2UI JSON messages.
    - **Interactive Stepper**: An "Advance" button allows processing messages one by one to verify progressive rendering.
3.  **Right Column (Live Inspection)**:
    - **Data Model Pane**: A live-updating view of the full Data Model.
    - **Action Logs Pane**: A log of triggered actions and their context.

### Integration Testing Requirements

Every renderer implementation must include a suite of automated integration tests that utilize the Gallery App's logic to verify:

- **Static Rendering**: Opening "Simple Text" renders correctly.
- **Layout Integrity**: "Row Layout" places elements correctly.
- **Two-Way Binding**: Typing in a TextField updates both the UI and the Data Model viewer simultaneously.
- **Reactive Logic**: Changes in one component dynamically update dependent components.
- **Action Context Scoping**: Actions emitted from nested templates (like Lists) contain correctly resolved data scopes.

## 9. Agent Implementation Guide

If you are an AI Agent tasked with building a new renderer for A2UI, you MUST follow this strict, phased sequence of operations.

### 1. Context to Ingest

Thoroughly review:

- `specification/v0_9/docs/a2ui_protocol.md` (protocol rules)
- `specification/v0_9/json/common_types.json` (dynamic binding types)
- `specification/v0_9/json/server_to_client.json` (message envelopes)
- `specification/v0_9/json/catalogs/minimal/minimal_catalog.json` (your initial target)
- `specification/v0_9/docs/basic_catalog_implementation_guide.md` (for rendering and spacing rules for when you get to the basic catalog)

### 2. Key Architecture Decisions (Write a Plan Document)

Create a comprehensive design document detailing:

- **Dependencies**: Which Schema Library and Observable/Reactive Library will you use? _Note: Ensure your reactive library supports both discrete event subscription (EventEmitter style) and stateful, signal-like data streams (BehaviorSubject/Signal style)._
- **Component Architecture**: How will you define the `ComponentImplementation` API for this language and framework?
- **Surface Architecture**: How will the `Surface` framework entry point function to recursively build children?
- **Binding Strategy**: Will you use an intermediate Generic Binder Layer, or a direct binderless implementation?
- **STOP HERE. Ask the user for approval on this design document before proceeding.**

### 3. Core Model Layer

Implement the framework-agnostic Data Layer (Section 3).

- Implement event streams and stateful signals.
- Implement strict Protocol Models (`A2uiMessage`, `A2uiClientCapabilities`, etc.) with JSON serialization/deserialization and schema validation logic.
- Implement `DataModel`, ensuring correct JSON pointer resolution and the cascade/bubble notification strategy.
- Implement `ComponentModel`, `SurfaceComponentsModel`, `SurfaceModel`, and `SurfaceGroupModel`.
- Implement `DataContext` and `ComponentContext`.
- Implement `MessageProcessor` and ClientCapabilities generation.
- **Action**: Write unit tests for JSON validation, the `DataModel` (especially pointer resolution/cascade logic), and `MessageProcessor`. Ensure they pass before continuing.

### 4. Framework-Specific Layer

Implement the bridge between models and native UI (Section 5 & 6).

- Define the concrete `ComponentImplementation` base class/interface.
- Implement the `Surface` view/widget that recurses through components.
- Implement subscription lifecycle management (lazy mounting, unmounting disposal).

### 5. Minimal Catalog Support

Target the `minimal_catalog.json` first.

- Implement the pure API schemas for `Text`, `Row`, `Column`, `Button`, `TextField`.
- Implement the specific native UI rendering components for these.
- Implement the `capitalize` function.
- Bundle these into a `Catalog`.
- **Action**: Write unit tests verifying that properties update reactively when data changes.

### 6. Gallery Application (Milestone)

Build the Gallery App following the requirements in **Section 8**.

- Load JSON samples from `specification/v0_9/json/catalogs/minimal/examples/`.
- Verify progressive rendering and reactivity.
- **STOP HERE. Ask the user for approval of the architecture and gallery application before proceeding to step 7.**

### 7. Basic Catalog Support

Once the minimal architecture is proven robust, refer to the [Basic Catalog Implementation Guide](basic_catalog_implementation_guide.md) and:

- **Core Library**: Implement the full suite of basic functions. It is crucial to note that string interpolation and expression parsing should ONLY happen within the `formatString` function. Do not attempt to add global string interpolation to all strings.
- **Core Library**: Create definitions/binders for the remaining Basic Catalog components.
- **Framework Library**: Implement all remaining UI widgets.
- **Tests**: Look at existing reference implementations (e.g., `web_core`) to formulate and run comprehensive unit and integration test cases for data coercion and function logic.
- Update the Gallery App to load samples from `specification/v0_9/json/catalogs/basic/examples/`.
