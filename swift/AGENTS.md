# A2UI Swift agent guide (AGENTS.md)

This document is the authoritative rule file for AI agents operating within the `swift/`
directory tree. It outlines target boundaries, coding conventions, specification compliance rules,
and verification protocols across all Swift modules.

---

## 1. Target architecture and boundaries

The Swift package uses targets defined in root [Package.swift](../Package.swift). Agents must
respect target boundaries:

1. **`A2UIJSON`** (`swift/core/Sources/A2UIJSON/`):
   - **Purpose**: A2UI-specific JSON Schema definitions for types used across the v0.9.1 protocol.
   - **Dependencies**: `JSONSchema`, `JSONSchemaBuilder` (from `swift-json-schema`).
   - **Rule**: Define common type schemas as raw `JSONValue` or via `@Schemable` macros when
     available. Register them into `Context.remoteSchemaStorage` for `$ref` resolution.

2. **`A2UICore`** (`swift/core/Sources/A2UICore/`):
   - **Purpose**: Stateful runtime engine managing message processing, JSON pointer evaluation,
     data bindings, and action routing.
   - **Dependencies**: `A2UIJSON` (transitively provides `JSONSchema`, `OrderedJSON`).
   - **Rule**: Never import `JSONSchemaBuilder` here. Use `Schema` and `JSONValue` directly.

3. **`BasicCatalog`** (`swift/core/Sources/BasicCatalog/`):
   - **Purpose**: Component APIs, schema builders, and standard function handlers for the Basic
     Catalog.
   - **Dependencies**: `A2UICore`, `JSONSchema`, `JSONSchemaBuilder`.

4. **`A2UISwiftUI`** (`swift/swiftui/Sources/A2UISwiftUI/`):
   - **Purpose**: Thin SwiftUI rendering adapter layer.
   - **Dependencies**: `A2UICore`.
   - **Rule**: SwiftUI views and environment keys only. No business logic or state machine code.

5. **`BasicCatalogSwiftUI`** (`swift/swiftui/Sources/BasicCatalog/`):
   - **Purpose**: Concrete SwiftUI view implementations of Basic Catalog components conforming to
     `ComponentImplementation`.
   - **Dependencies**: `A2UICore`, `A2UISwiftUI`, `BasicCatalog`, `OrderedJSON`.

6. **`A2UISampleClient`** (`swift/sample/Sources/A2UISampleClient/`):
   - **Purpose**: iOS SwiftUI Gallery app for interactive streaming testing and inspection.
   - **Build management**: Managed via native Xcode project
     (`swift/sample/A2UISampleClient.xcodeproj`).
   - **Rule**: Application code only. Uses Xcode Folder References for test streams.

---

## 2. Mandatory coding conventions

When creating or modifying Swift source files, agents must adhere to
[CODING_STANDARDS.md](CODING_STANDARDS.md) and the Google Swift Style Guide:

- **One type per file**: Every class, struct, enum, and protocol resides in its own dedicated file.
- **100-character line limit**: No line of code, comment, docstring, or markdown may exceed 100
  characters.
- **2-space indentation**: Enforced by `swift-format`.
- **Apache 2.0 copyright header**: Required on all new files.
- **Safe unwrapping**: No force unwraps (`!`) or `try!`. Use optional binding and error
  propagation.
- **Swift Testing**: Use `import Testing`, `@Test`, `#expect`, and `try #require(...)`.
- **No `@testable import`**: Test only the public API surface.

---

## 3. Specification compliance hierarchy

When implementing wire-format types, pointer semantics, or data model behavior, verify
consistency against authoritative specifications:

1. **JSON schemas** (`specification/v0_9_1/json/`): Primary authority for wire fields,
   required properties, and envelope structures.
2. **Core SDK blueprint** (`blueprints/modules/a2ui_core.blueprint.md`): Cross-language behavioral
   rules for pointer resolution, auto-vivification, and sparse array semantics.
3. **Framework adapter blueprint** (`blueprints/modules/a2ui_framework_adapter.blueprint.md`):
   Component instantiation, dynamic child lists, and lifecycle subscription rules.
4. **Reference implementation** (`renderers/web_core/`): Canonical TypeScript implementation
   for cross-checking edge-case semantics.

---

## 4. Verification protocol

Before completing any task in `swift/`, agents must execute:

1. **Format code**:
   ```bash
   swift-format format -i -r Package.swift swift/
   ```
2. **Lint check**:
   ```bash
   swift-format lint -r Package.swift swift/
   ```
3. **Run tests**:
   ```bash
   swift test
   ```
4. **Compile check**:
   ```bash
   swift build
   ```
