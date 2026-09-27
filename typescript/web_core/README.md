# @a2ui/web_core

The `@a2ui/web_core` package provides state management, protocol parsing, and schema generation for the A2UI framework. It is framework-agnostic and provides the foundational engine for renderer packages such as Angular, React, and Lit.

## Features

- **Protocol Handling**: Implements A2UI specification message validation and state handling across all supported protocol versions.
- **State Management**: Reactive data and component models using `@preact/signals-core`.
- **DataContext**: Data binding, scoping, and function evaluation with dependency tracking.
- **Catalog System**: Component and function catalogs supporting runtime validation and schema generation.
- **Schema-Driven Code Generation**: Auto-generates Zod schemas and TypeScript component/function definitions directly from specification JSON schemas.

## Architecture

Rendering is driven by a `SurfaceGroupModel` and its constituent `SurfaceModel` instances, with `DataModel` managing reactive state, `DataContext` providing expression evaluation, and `MessageProcessor` validating and applying incoming protocol messages.

## Schema & Code Generation

Protocol message schemas, common types, and catalog definitions are generated directly from the JSON schemas in the `specification/` directory.

### Running Code Generation

To regenerate all Zod schemas and catalog APIs:

```bash
# Generate all protocol Zod schemas and versioned Basic Catalog APIs
yarn generate-zod-schemas

# Or run individual version generators directly
node src/v0_9/scripts/generate-catalog.mjs
node src/v1_0/scripts/generate-catalog.mjs
```

### Catalog Schema Contract

The code generator uses **Schema Flattening** to remain version-, catalog-, and type-agnostic. Schema files adhere to the following structure:

#### 1. Catalog JSON (`catalog.json`)

- **Top-Level Dictionaries**:
  - `components`: Maps component names to JSON schema objects.
  - `functions`: Maps function names to JSON schema objects.
- **Discriminator**:
  - Derived from `catalog.discriminator.propertyName` (defaults to `"component"`).
  - The discriminator property and `"id"` are omitted from generated property schemas as they are handled by the runtime component envelope.
- **Inheritance & Envelopes**:
  - Components may use `allOf` to reference common envelopes (such as `ComponentCommon` or `CatalogComponentCommon`). The generator recursively resolves `$ref` pointers and merges `allOf` branches into a flat property bag.
- **Functions**:
  - Functions specify a `returnType` (e.g. `"string"`, `"number"`, `"boolean"`, `"validationResult"`) at the root level and define arguments inside an `args` or `parameters` object property.

#### 2. Reusable Type Definitions (`common_types.json`)

- **`$defs` Scope**:
  - Reusable type schemas reside under `$defs`. Definition names are not hardcoded; any definition present in `$defs` is resolved dynamically when referenced.
- **Reference Annotations**:
  - When a component property references `$defs/<DefName>`, the generator maps it to `<DefName>Schema` and attaches a `.describe('REF:#/$defs/<DefName>|<description>')` annotation.
  - At runtime, `generateCatalogSchema` inspects these markers to emit `$ref` pointers and tree-shake unused `$defs` definitions.
- **Child References**:
  - Single child references and child collections are identified when their `$defs` reference targets or descriptions indicate a child component relationship (such as references to `ComponentId`, `Child`, or `ChildList`).

## Development

### Building

The package uses `wireit` for build orchestration:

```bash
yarn build
```

### Testing

Run unit tests:

```bash
yarn test
```

Run conformance test suite:

```bash
node tests/conformance/conformance_test.mjs
```

### Formatting & Linting

```bash
yarn format
yarn lint
```
