---
name: a2ui-implement-new-sdks-for-client-language
description: Step-by-step phased instructions for building new A2UI Core SDKs, Framework Adapters, and Inference SDKs from scratch in any client language.
---

# A2UI SDK Implementation Guide (Phased Execution)

This skill provides expert instructions and sequences for AI agents or contributors tasked with implementing A2UI Core SDKs, Framework Adapters, or Agent/Inference SDKs in a new programming language or UI framework.

---

## **1. Core State SDK Phases**

If you are building a new **Core SDK** (e.g., in Rust, Swift, Go, or C++), you must follow this sequence of phases:

### **Phase 1: Context & Schemas Ingestion**

Thoroughly review:

- `blueprints/modules/a2ui_core.blueprint.md` (for state and message structures).
- `specification/v1_0/json/common_types.json` (dynamic binding schemas).
- `specification/v1_0/json/server_to_client.json` (message envelopes).
- `specification/v1_0/catalogs/basic/catalog.json` (target components catalog).

### **Phase 2: Technical Architecture Planning**

Create a detailed, local architectural proposal detailing:

- **Dependencies**: Which Schema library and Observable/Reactive library will you use? Note that the reactive library must support both discrete event subscription and stateful, signal-like data streams (e.g., BehaviorSubject/Signal).
- **Component APIs**: How will you define the `ComponentApi` interface in this language?
- **Binding Strategy**: How will you structure the abstract Core Binder Layer?
- _STOP and obtain human reviewer approval on this plan before writing code._

### **Phase 3: Core Model Layer**

Implement the framework-agnostic data and processor layers:

1.  **Observables & Signals**: Implement multi-cast reactive streams with clear unsubscribe mechanism to prevent leaks.
2.  **Protocol Structures**: Create strictly-typed native classes/structs representing `A2uiMessage` envelopes and client capabilities with serialization/deserialization.
3.  **DataModel & JSON Pointers**: Implement relative/absolute path resolution, auto-vivification (auto-typing intermediate segments), and bubble/cascade path change notifications.
4.  **Core State Models**: Implement `ComponentModel`, `SurfaceComponentsModel`, `SurfaceModel`, and `SurfaceGroupModel`.
5.  **Context Mapping**: Implement `DataContext` and `ComponentContext`.
6.  **MessageProcessor**: Ingest incoming messages and mutate the state models. Generate `inlineCatalogs` client capabilities.
7.  **Verification**: Write comprehensive unit tests for pointer cascading, JSON deserialization/validation, and message dispatching.

### **Phase 4: Foundational Basic Catalog Support**

Bootstrap support for the Basic Catalog:

- **Foundational Components**: Define the pure API schemas and Binders for: `Text`, `Row`, `Column`, `Button`, and `TextField`.
- **Foundational Functions**: Implement `formatString` to interpret `${expression}` syntaxes, supporting recursive token evaluations and reactive coercion.
- **Verification**: Ensure properties update reactively when underlying data paths emit notifications.

### **Phase 5: Complete Basic Catalog Support**

- **Full Components & Binders**: Define core binders for all other components in `basic/catalog.json`.
- **Full Functions**: Implement remaining basic mathematical, logical, and array operations.
- **Validation**: Ensure strict type coercion rules are satisfied and memory disposals work flawlessly.

---

## **2. Framework Adapter SDK Phases**

If you are building a new **UI Framework Adapter / Renderer** (e.g., in Flutter/Dart, SwiftUI, Jetpack Compose, Vue, or Svelte), follow this sequence:

### **Phase 1: Ingestion & Core Integration**

Review:

- `blueprints/modules/a2ui_framework_adapter.blueprint.md` (View and rendering architecture).
- `specification/v1_0/docs/basic_catalog_implementation_guide.md` (spacing, alignment, and typography specifications).

### **Phase 2: Architectural Plan**

Draft a plan specifying:

- **Component Registry**: How components are dynamically resolved and instantiated.
- **Surface Widget**: How the root canvas mounts and recurses through the layout tree starting at `root`.
- **Observer/State Bridge**: Which Strategy (Direct, Predefined Binders, or Automated wrappers) will connect core signals to native views.
- _STOP and obtain human reviewer approval on this plan._

### **Phase 3: Adapter & Lifecycle Layer**

- Implement `ComponentImplementation` base traits/classes.
- Implement the framework-native `Surface` entrypoint widget.
- Implement subscription management: lazy-subscribing only on mount, handling path stability updates, and strictly calling `dispose()` on unmount.

### **Phase 4: Bootstrapping Basic Catalog Rendering**

- Build native visual elements for: `Text`, `Row`, `Column`, `Button`, and `TextField`.
- Bundle these elements into the first framework catalog adapter.
- Verify reactive layout properties dynamically.

### **Phase 5: Gallery Application Milestone**

Build the **Gallery App** as a testing playground with:

- Left Column: Sample navigation.
- Center Column: Surface preview, JSON message stream, and step-by-step interactive message stepper.
- Right Column: Live data model inspect pane and action logger.
- Load the 5 foundational verification examples: `00_simple-text.json`, `00_row-layout.json`, `00_complex-layout.json`, `00_interactive-button.json`, and `00_simple-login-form.json`.
- _STOP and obtain human reviewer approval of the UI and visual rendering performance._

### **Phase 6: Full Catalog Support**

- Implement all remaining widgets (e.g. Card, Image, List, etc.) and validation traits like `Checkable`.
- Update the Gallery App to support all official examples in `specification/v1_0/catalogs/basic/examples/`.
- Run visual parity and event action tests to verify correctness.
