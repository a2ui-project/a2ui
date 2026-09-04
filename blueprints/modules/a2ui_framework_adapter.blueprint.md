---
name: a2ui_framework_adapter
type: module
description: View and Rendering layer interface bridging A2UI Core SDK to native UI frameworks.
---

# A2UI Framework Adapter Specification

This document describes the specification and architecture of an A2UI Framework-Specific Adapter (the View/Rendering Layer). The design defines how a framework-agnostic A2UI Core SDK (documented in the [A2UI Core SDK Specification](a2ui_core.blueprint.md)) connects to native UI frameworks to paint the pixels.

Both the core data structures and the rendering components interact with **Catalogs**. Within a catalog, the implementation follows a structured split: from the pure **Component Schema** (defined in the Core SDK) down to the **Framework-Specific Adapter** that renders native components (React, Angular, Flutter, SwiftUI, Jetpack Compose, iOS Views, Android Views, Vanilla DOM). Note that a catalog's `id` (`catalogId`) is an arbitrary string identifier rather than a resolvable URI.

---

## 1. Framework Adapter Overview

The A2UI client architecture has a well-defined data flow that bridges language-agnostic data structures with native UI frameworks.

1. **A2UI Messages** arrive from the server (JSON).
2. The **`MessageProcessor`** (part of Core SDK) parses these and updates the **`SurfaceModel`** (Agnostic State).
3. The **`Surface`** (Framework Entry View) listens to the `SurfaceModel` and begins rendering.
4. The `Surface` instantiates and renders individual **`ComponentImplementation`** nodes to build the UI tree.

This establishes a fundamental split:

- **The Framework-Agnostic Layer (Data Layer / Core SDK)**: Handles JSON parsing, state management, JSON pointers, and schemas. This logic is identical across all UI frameworks within a given language.
- **The Framework-Specific Layer (View Layer / Framework Adapter)**: Handles turning the structured state into actual pixels (React Nodes, Flutter Widgets, iOS Views).

---

## 2. The View-Layer Interfaces

At the heart of the A2UI framework-specific architecture are the interfaces that render components and manage the native UI lifecycle.

### `ComponentImplementation`

The framework-specific logic for rendering a component. It extends `ComponentApi` (defined in [Core SDK Specification](a2ui_core.blueprint.md)) to include a `build` or `render` method.

How this looks depends on the target framework's paradigm:

#### Functional / Reactive Frameworks (e.g., Flutter, SwiftUI, React)

```typescript
interface ComponentImplementation extends ComponentApi {
  /**
   * @param ctx The component's context containing its data and state.
   * @param buildChild A closure provided by the surface to recursively build children.
   */
  build(
    ctx: ComponentContext<ComponentImplementation>,
    buildChild: (id: string, basePath?: string) => NativeWidget,
  ): NativeWidget;
}
```

#### Stateful / Imperative Frameworks (e.g., Vanilla DOM, Android Views)

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

The entrypoint widget/view for a specific framework. It is instantiated with a `SurfaceModel` (from the Core SDK). It listens to the model for lifecycle events and dynamically builds the UI tree, initiating the recursive rendering loop at the component with ID `root`.

---

## 3. Component Implementation Strategies

While the `ComponentImplementation` API dictates that a component must be able to `build()` or `mount()`, _how_ a developer connects that view to the reactive data model inside `ComponentContext` varies by language and framework capabilities.

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

### Strategy 2: Binder-Based UI Components

For complex applications, scattering manual A2UI subscription logic across all view components becomes repetitive and error-prone. The **Binder Layer** in the Core SDK abstractly resolves and evaluates reactive inputs into a standard stream of `ResolvedProps`.

The framework-specific UI component simply subscribes to this generic stream and updates the rendering.

### Strategy 3: Generic Binders for Dynamic Languages

In highly dynamic ecosystems like TypeScript/JavaScript, we can completely automate the creation of wrappers that automatically bind binders to UI components, offering compile-time type-safety:

```typescript
// Concept: The developer writes a simple, stateless UI component.
// The `props` argument is strictly inferred from the ButtonSchema binder.
const ReactButton = createReactComponent(ButtonBinder, ({ props, buildChild }) => {
  return (
    <button onClick={props.action}>
      {props.child ? buildChild(props.child.id, props.child.basePath) : props.label}
    </button>
  );
});
```

Because of the generic types flowing through the adapter, if the developer typos `props.action` as `props.onClick`, or treats `props.label` as an object instead of a string, the compiler will immediately flag a type error.

---

## 4. Example: Framework-Specific Adapters

The adapter acts as a wrapper that instantiates the binder, binds its output stream to the framework's state mechanism, injects structural rendering helpers (`buildChild`), and hooks into the native destruction lifecycle to call `dispose()`.

### React Pseudo-Adapter

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

### Angular Pseudo-Adapter

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

---

## 5. Framework Binding Lifecycles & Traits

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

## 6. Standard & Custom Component Overrides

The standard A2UI Basic Catalog specifies a set of core components (Button, Text, Row, Column) and functions.

### Strict API / Implementation Separation

When building libraries that provide the Basic Catalog, separating the pure API from visual renderers is vital.

- **Multi-Framework Code Reuse**: Allows core binders to be reused across different UI framework adapter libraries.
- **Developer Overrides**: By exposing the standard API definitions, developers adopting A2UI can easily swap in custom UI implementations (e.g., replacing the default `Button` with their company's internal Design System `Button`) without having to rewrite the complex A2UI validation, data binding, and capability generation logic.

For a detailed walkthrough on how to visually and functionally implement each basic component and function, refer to the [Basic Catalog Implementation Guide](../../specification/v0_9_1/docs/basic_catalog_implementation_guide.md).

---

## 7. The Gallery App Specification

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
