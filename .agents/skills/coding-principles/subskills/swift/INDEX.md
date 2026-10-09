# Swift & SwiftUI Progressive Discovery Router

Use this router whenever a pull request or local change modifies Swift or SwiftUI files across `swift/` or `Package.swift`.

---

## Evaluate Swift & SwiftUI Subskill Triggers

Inspect the Swift files in `git diff main --stat` and read the subskill document below:

### 1. Swift Architecture, Coding Standards, Testing & Verification

- **Document**: [`coding-standards-and-testing.md`](coding-standards-and-testing.md)
- **Activate if**:
  - Any `*.swift` file or `Package.swift` is added, modified, or refactored.
  - Implementing features or modifying state logic in `A2UIJSON`, `A2UICore`, or `BasicCatalog`.
  - Creating or updating SwiftUI views in `A2UISwiftUI`, `BasicCatalogSwiftUI`, or `A2UISampleClient`.
  - Writing or updating unit tests using the Swift `Testing` framework (`@Test`, `#expect`, `try #require`).
  - Running `swift-format`, `swift test`, or `swift build`.
