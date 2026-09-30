# A2UI Swift implementation

This directory contains the official native Apple client implementation for A2UI
(Agent-to-User Interface), supporting iOS, macOS, iPadOS, tvOS, visionOS, and watchOS.

For the platform-agnostic protocol specification and guidelines, see
[specification/v0_9_1/docs/a2ui_protocol.md](../specification/v0_9_1/docs/a2ui_protocol.md).

---

## Directory structure and modules

The Swift library packages are governed by root [Package.swift](../Package.swift):

- **[core/](core)** (`A2UISwiftCore` and `BasicCatalog` library products):
  - `A2UIJSON` (`core/Sources/A2UIJSON/`): Pure JSON Schema 2020-12 definitions and registries.
  - `A2UICore` (`core/Sources/A2UICore/`): Stateful runtime processing engine, message parsing,
    JSON pointer resolution, and data model bindings.
  - `BasicCatalog` (`core/Sources/BasicCatalog/`): Core component schemas and standard functions.
  - See [core/README.md](core/README.md) for details.
- **[swiftui/](swiftui)** (`A2UISwiftUI` and `BasicCatalogSwiftUI` library products):
  - `A2UISwiftUI` (`swiftui/Sources/A2UISwiftUI/`): Declarative SwiftUI rendering adapter layer.
  - `BasicCatalogSwiftUI` (`swiftui/Sources/BasicCatalog/`): Concrete SwiftUI component views.
  - See [swiftui/README.md](swiftui/README.md) for details.
- **[sample/](sample)** (`A2UISampleClient.xcodeproj`):
  - `A2UISampleClient`: Ready-to-run iOS Gallery Application built with SwiftUI for testing
    interactive streaming, data models, and progressive component rendering.
  - See [sample/README.md](sample/README.md) for instructions.

---

## Building and running tests

All library targets and unit test suites are managed via Swift Package Manager at the monorepo root:

```bash
# Build library targets:
swift build

# Execute unit tests:
swift test

# Or run via script:
./swift/run_tests.sh
```

---

## Plural selection

`BasicCatalog` uses Foundation by default for `pluralize`. Set its language with
`PluralizeFunction(locale: Locale(identifier: "ar"))`, or omit the locale to use `.current`.
Applications can continue to supply their own `PluralResolver`.

The function uses Foundation's public localized formatting API and the package's bundled
`PluralCategories.stringsdict`. This single, unlocalized resource contains category names, not
translations or language rules. Keep it outside `.lproj` directories and include the SwiftPM resource
bundle when distributing the library. Server-provided text is selected after category resolution and
is never evaluated as a format string. Missing category text falls back to `other`.

Plural rules and numeric boundary behavior follow the installed operating system, including for
fractional and very large counts. They are not pinned to an ICU release and may differ from Web
`Intl.PluralRules`. Non-finite numbers return `other`.

## Agent guidelines and coding standards

For AI agents and contributors working in this directory hierarchy:

- **[AGENTS.md](AGENTS.md)**: Authoritative agent rule file for target boundaries,
  spec compliance hierarchy, and verification protocols.
- **[CODING_STANDARDS.md](CODING_STANDARDS.md)**: Coding standards, safe optional handling,
  and Swift Testing patterns.
- **[.agents/skills/a2ui-swift-development/](../.agents/skills/a2ui-swift-development/SKILL.md)**:
  Specialized skill for Swift development.
