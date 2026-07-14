# Google Closure Compiler externs for Angular A2UI Explorer

This directory contains `@externs` file definitions required when building the Angular A2UI Explorer application with Google Closure Compiler in ADVANCED optimization mode.

## Purpose of externs

When Google Closure Compiler runs in ADVANCED optimization mode, it aggressively renames variables, functions, and object properties accessed via dot notation (such as `action.functionCall` or `args.format`) to short, minified symbols (such as `.a` or `.xs`).

In an agent-driven UI architecture like A2UI, the application receives declarative JSON payloads over the wire from remote agents or local evaluators. These JSON payloads contain explicit string keys that map directly to component property names, action definitions, and function arguments. If the production bundle minifies the property names on the runtime evaluation objects, looking up JSON string keys on those objects fails at runtime.

The `@externs` files in this directory define the public interfaces and schemas as `@record @struct` prototypes. This instructs Closure Compiler to preserve the exact property names in the compiled production bundle while allowing aggressive minification of internal implementation code.

> **Note on Minimalism**: The extern definitions in this directory are intentionally **not exhaustive** representations of the underlying classes, interfaces, or TypeScript enums; we strictly maintain only the _minimal amount of externs_ required for runtime correctness and passing tests in order to clearly identify what may break when we make changes to the package.

## Naming convention

When adding or updating extern definitions, use the canonical naming convention `NameOfActualClassExterns` (or `NameOfConceptExterns` for plain object shapes) as a dummy constructor function (e.g., `function CreateSurfaceMessageExterns() {}`). This standardizes symbol declarations across all extern files and ensures future agents and maintainers can easily trace extern definitions back to their TypeScript interface or Zod schema counterparts.

## Overview of extern files

The external interfaces are organized into four functional files:

- `globals.externs.js` declares browser environment globals, Angular dev server runtimes, and third-party library namespaces.
- `a2ui_web_core_v0_9.externs.js` declares the A2UI v0.9 wire protocol schema, reactive signal interfaces, basic catalog function arguments, and `date-fns` localization lookup tables.
- `angular_framework.externs.js` declares Angular Ivy runtime instructions, lifecycle hooks, signal primitives, dynamic component bindings, and `@angular/common` locale array structures.
- `a2ui_explorer.externs.js` declares the demo application dashboard component, example catalog items, and protocol version enums.

## Top-level declarations by file

### Browser globals and libraries (globals.externs.js)

- `localStorage`: Browser Web Storage API access used by persistence utilities.
- `NOOP_AFTER_RENDER_REF`: Angular core framework after-render hook references.
- `logHmrWarning`: Angular CLI and Vite development server hot module replacement warning loggers.
- `goog`: Google Closure Library global namespace and runtime checks.
- `resolveJitResources`: Angular JIT compiler resource resolution fallbacks during dynamic rendering.
- `Hammer`: HammerJS gesture recognition globals used by Angular touch integrations.

### Web core protocol and basic catalog functions (a2ui_web_core_v0_9.externs.js)

- `CreateSurfaceMessageExterns`: Top-level envelope properties used when initializing a UI surface from JSON server streams across all demo examples.
- `UpdateComponentsMessageExterns`: Component tree structure properties required when rendering or updating component layouts in the demo gallery.
- `UpdateDataModelMessageExterns`: Two-way data binding and model update messages, essential for interactive form examples such as Simple Login Form and Interactive Form.
- `DeleteSurfaceMessageExterns`: Surface teardown messages used when switching between demo surfaces or closing an active surface.
- `A2uiClientActionExterns`: Interactive event payloads dispatched from client components back to the server or local evaluator, such as button clicks in the Interactive Button demo.
- `FunctionCallExterns`: Local function evaluation syntax in expressions, used by string interpolation and basic catalog functions.
- `ChildListExterns`: Template repeater references used in dynamic lists and tabular layouts, such as the daily forecast rows in Weather Current.
- `PreactSignalExterns`: `@preact/signals-core` reactive primitives used by web core's reactive DataModel and signal-based expression evaluator.
- `BasicCatalogFunctionArgsExterns`: Argument object property names needed by sample expressions such as `formatDate` in Weather Current and `formatCurrency` in Financial Data Grid.
- `DateFnsFormattersExterns`: `date-fns` formatting token tables so date formatting expressions can resolve token strings at runtime.
- `DateFnsLocalizeExterns`: `date-fns` localization methods and builder options used during locale formatting.
- `DateFnsLookupKeysExterns`: String keys in `date-fns` lookup dictionaries used when formatting weekdays and time periods in examples like Weather Current.

### Angular framework and runtime (angular_framework.externs.js)

- `AngularIvyInstructionExterns`: Internal Angular Ivy runtime view engine instructions generated by the Angular compiler.
- `AngularLifecycleHookExterns`: Standard Angular component lifecycle hook methods invoked dynamically by change detection on renderer components.
- `AngularInputFlagsExterns`: Angular `@Input` metadata flags and property aliases required by Angular's property binding mechanism.
- `AngularSignalPrimitiveExterns`: Native signal primitive internals used by reactive component inputs and state in modern Angular components.
- `AngularLocaleDataIndexExterns`: `@angular/common` internal locale data array index enum names, preventing `DatePipe` from failing during template rendering in minified builds.

### Explorer application (a2ui_explorer.externs.js)

- `ExampleExterns`: Demo catalog example item metadata used by sidebar navigation to load examples like Weather Current and Interactive Button.
- `VersionEnumExterns`: Protocol version strings used when filtering or selecting specification versions in the explorer UI.
- `ExampleDataModelExterns`: Demo gallery data model properties accessed by string JSON pointers.
