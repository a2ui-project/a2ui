---
name: a2ui-swift-development
description: >-
  Grounding, coding standards, testing practices, and verification workflows for developing in the
  A2UI Swift codebase (under the swift/ directory). Use whenever implementing features, modifying
  state logic, creating SwiftUI views, or writing tests in Swift.
---

# Swift development skill

This skill guides AI agents and contributors working in the `swift/` directory. It outlines target
boundaries, coding standards, testing patterns, and mandatory verification steps.

---

## 1. Specification and blueprint grounding

Before modifying or implementing Swift code, inspect the authoritative specifications:

- **Protocol envelopes and schemas**:
  [`specification/v0_9_1/json/`](../../../specification/v0_9_1/json/) defines wire-format types
  and validation schemas.
- **Component catalog schema**:
  [`basic/catalog.json`](../../../specification/v0_9_1/catalogs/basic/catalog.json) defines
  components, properties, and function signatures.
- **Core module blueprint**:
  [`a2ui_core.blueprint.md`](../../../blueprints/modules/a2ui_core.blueprint.md) specifies state
  handling, JSON pointer rules, auto-vivification, and error semantics.
- **Framework adapter blueprint**:
  [`a2ui_framework_adapter.blueprint.md`][framework-adapter-blueprint] specifies view mapping,
  reactive subscription lifecycles, and layout behavior.
- **Reference implementation**: [`renderers/web_core/`](../../../renderers/web_core/) serves as
  the canonical behavioral reference for edge-case resolution.

[framework-adapter-blueprint]: ../../../blueprints/modules/a2ui_framework_adapter.blueprint.md

---

## 2. Swift target architecture

The Swift implementation uses targets defined in root [`Package.swift`](../../../Package.swift):

- **`A2UIJSON`** ([`core/Sources/A2UIJSON`](../../../swift/core/Sources/A2UIJSON)): Pure
  JSON Schema 2020-12 definitions and remote schema registry storage.
- **`A2UICore`** ([`core/Sources/A2UICore`](../../../swift/core/Sources/A2UICore)): Stateful
  runtime engine managing `MessageProcessor`, `DataModel`, `SurfaceGroupModel`, pointer evaluation,
  and action routing.
- **`BasicCatalog`** ([`core/Sources/BasicCatalog`](../../../swift/core/Sources/BasicCatalog)):
  Core schema definitions and function handlers for Basic Catalog components.
- **`A2UISwiftUI`** ([`swiftui/Sources/A2UISwiftUI`](../../../swift/swiftui/Sources/A2UISwiftUI)):
  SwiftUI adapter providing the root `Surface` view, recursive `ComponentNodeView`, and
  environment keys.
- **`BasicCatalogSwiftUI`**
  ([`swiftui/Sources/BasicCatalog`](../../../swift/swiftui/Sources/BasicCatalog)): Concrete
  SwiftUI view implementations conforming to `ComponentImplementation`.
- **`A2UISampleClient`** ([`swift/sample`](../../../swift/sample)): Interactive iOS Gallery
  application managed via Xcode project file.

---

## 3. Mandatory coding standards

All Swift code must strictly follow
[`swift/CODING_STANDARDS.md`](../../../swift/CODING_STANDARDS.md) and the Google Swift Style Guide:

1. **One primary type per file**: Every class, struct, enum, and protocol must live in a dedicated
   file named after the type.
2. **100-character line limit**: No line of code, comment, docstring, or markdown may exceed 100
   characters.
3. **2-space indentation**: Enforced by `swift-format`.
4. **Apache 2.0 copyright header**: Required on every new `.swift` file:
   ```swift
   // Copyright 2024 Google LLC
   //
   // Licensed under the Apache License, Version 2.0 (the "License");
   // you may not use this file except in compliance with the License.
   // You may obtain a copy of the License at
   //
   //     https://www.apache.org/licenses/LICENSE-2.0
   //
   // Unless required by applicable law or agreed to in writing, software
   // distributed under the License is distributed on an "AS IS" BASIS,
   // WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   // See the License for the specific language governing permissions and
   // limitations under the License.
   ```
5. **Safe optional handling**: Never use force-unwrapping (`!`) or forced tries (`try!`). Use
   optional bindings (`if let`, `guard let`) or propagate throwing errors.

---

## 4. Swift Testing conventions

Tests use the native Swift Testing framework:

- Import `Testing` instead of `XCTest`.
- Annotate test functions with `@Test`.
- Use `#expect(...)` for assertions.
- In tests, replace force unwraps with `try #require(...)` to produce clean test failures instead of
  crashes.
- Avoid `@testable import`. Test only the public API surface.
- Use standard camelCase identifiers for test function names without backticks or spaces.

---

## 5. Verification workflow

After making any code changes in `swift/`, run this verification sequence from the repository root:

1. **Auto-format code**:
   ```bash
   swift-format format -i -r Package.swift swift/
   ```
2. **Lint check**:
   ```bash
   swift-format lint -r Package.swift swift/
   ```
3. **Run unit tests**:
   ```bash
   swift test
   ```
   Or run filtered tests during iterative development:
   ```bash
   swift test --filter A2UICoreTests
   swift test --filter A2UISwiftUITests
   ```
4. **Compile check**:
   ```bash
   swift build
   ```

---

## 6. Integration with repository skills

- **Blueprint compliance**: When updating models or schemas, check compliance with
  [`a2ui-blueprint-compliance`](../../../blueprints/skills/a2ui-blueprint-compliance/SKILL.md).
- **Test quality**: Verify assertion strength and boundary cases with
  [`a2ui-test-quality-check`](../a2ui-test-quality-check/SKILL.md).
- **Documentation sync**: Ensure documentation reflects code changes using
  [`a2ui-doc-sync-check`](../a2ui-doc-sync-check/SKILL.md).
