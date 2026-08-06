# A2UI Swift Core Agent Guide (AGENTS.md)

This document is the authoritative guide for AI agents operating within the
`swift/` directory tree. It outlines target boundaries, coding conventions, spec
compliance rules, and verification protocols.

---

## 1. Target Architecture & Boundaries

The Swift package uses targets defined in the **root** `Package.swift`.
Agents must strictly respect target boundaries:

1. **`A2UIJSON`** (`swift/core/Sources/A2UIJSON/`):
   - **Purpose**: A2UI-specific JSON Schema definitions for common types used
     across the v0.9.1 protocol.
   - **Dependencies**: `JSONSchema`, `JSONSchemaBuilder` (from
     [swift-json-schema](https://github.com/ajevans99/swift-json-schema)).
   - **Rule**: Define common type schemas as raw `JSONValue` or via the fork's
     `@Schemable` macro (when available on the target platform). Register them
     into `Context.remoteSchemaStorage` for `$ref` resolution.

2. **`A2UICore`** (`swift/core/Sources/A2UICore/`):
   - **Purpose**: Stateful runtime engine — message processing, tree
     resolution, two-way data binding, action routing, schema validation.
   - **Dependencies**: `A2UIJSON` (transitively provides `JSONSchema`,
     `OrderedJSON`).
   - **Rule**: Never import `JSONSchemaBuilder` here. Use `Schema` and
     `JSONValue` types from the fork directly.

3. **`A2UISwiftUI`** (`swift/swiftui/Sources/A2UISwiftUI/`):
   - **Purpose**: Thin SwiftUI rendering layer.
   - **Dependencies**: `A2UICore`.
   - **Rule**: Only SwiftUI views and environment keys. No business logic.

4. **`A2UISampleClient`** (`swift/sample/Sources/A2UISampleClient/`):
   - **Purpose**: Ready-to-run iOS SwiftUI demo app.
   - **Dependencies**: `A2UISwiftUI`, `A2UICore`.
   - **Rule**: Application-level code only. No reusable library types.

---

## 2. Mandatory Coding Conventions

When creating or modifying Swift source files, agents **MUST** strictly adhere
to [CODING_STANDARDS.md](CODING_STANDARDS.md) and the
[Google Swift Style Guide](https://google.github.io/swift/). Review both
guides before writing any code.

Key rules:

- **One type per file** — each struct/enum/protocol gets its own file.
- **100-char line limit** — no line may exceed 100 characters.
- **2-space indentation** — matching `.swift-format`.
- **Apache 2.0 copyright header** on every new file.
- **Swift Testing** — use `import Testing`, `@Test`, `#expect`.
- **No `@testable import`** — test only the public API surface.

---

## 3. Spec Compliance \u0026 Source-of-Truth Hierarchy

When implementing or modifying any wire-format types (message envelopes, action
payloads, error types), JSON Pointer semantics, or data model behavior, agents
**MUST** verify consistency against the authoritative sources in this order:

1. **JSON Schemas** (`specification/v0_9_1/json/`) — the primary authority for
   wire-format field names, required properties, and structural shape.
2. **Core SDK Blueprint** (`blueprints/modules/a2ui_core.blueprint.md`) — defines
   cross-language behavioral rules (e.g., JSON Pointer Implementation Rules,
   auto-vivification, sparse arrays, notification strategy).
3. **`web_core` Reference** (`renderers/web_core/src/v0_9/`) — the canonical
   TypeScript implementation to cross-check behavioral semantics (e.g., how
   `undefined`/`nil` is handled for arrays vs objects, auto-vivification
   conditions, root replacement rules).

Common pitfalls to avoid:

- **Wire payload shape**: Do not mirror component property schemas (e.g.,
  `Action.event`/`Action.functionCall`) in message envelopes. Message payloads
  have their own flat schemas (e.g., `action.name`, `action.surfaceId`).
- **Version fields**: All server-to-client and client-to-server messages require
  a top-level `version` field. Always encode it and validate it on decode.
- **Array deletion vs sparse**: Setting an array index to `nil`/`undefined`
  must preserve array length (set to `.null`), not remove the element. Object
  keys are removed entirely.
- **Root replacement**: The root JSON value can be replaced with any valid
  `JSONValue` type, not just `.object`.
- **Auto-vivification**: Arrays should be vivified for any numeric path segment
  (`Int(key) != nil`), not just index `"0"`.

---

## 4. Verification Protocol

Before completing any task, agents **MUST** execute:

1. **Format code**: `swift-format format -i -r Package.swift swift/`
2. **Run tests**: `(cd swift/core && ./run_tests.sh)`
3. **Compile check**: `swift build`
