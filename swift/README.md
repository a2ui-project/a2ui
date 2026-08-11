# A2UI Swift Implementation & SDKs

This directory contains the official native Apple client implementation for A2UI (Agent-to-User Interface), supporting iOS, macOS, iPadOS, tvOS, visionOS, and watchOS.

---

## Directory Structure & Modules

The Swift library packages are governed by the root monorepo `Package.swift`, separating state evaluation engines from UI frameworks:

- **`core/`** (`A2UISwiftCore` library product)
  - **`A2UIJSON`** (`core/Sources/A2UIJSON/`): Pure JSON Schema definitions and common schema registries supporting the A2UI protocol.
  - **`A2UICore`** (`core/Sources/A2UICore/`): Stateful runtime processing engine responsible for parsing server messages, JSON pointer cascading, two-way data model binding, and action dispatching.
- **`swiftui/`** (`A2UISwiftUI` library product)
  - **`A2UISwiftUI`** (`swiftui/Sources/A2UISwiftUI/`): Thin SwiftUI rendering adaptation layer mapping core engine node trees and themes into native Apple declarative view builders.
- **`sample/`** (`A2UISampleClient.xcodeproj`)
  - **`A2UISampleClient`**: Ready-to-run iOS Gallery Application built with SwiftUI for testing interactive message streaming, state model inspection, and progressive component rendering.

---

## Getting Started & Building

### Library Targets & Running Unit Tests

All non-application library targets and unit test suites are managed via Swift Package Manager (SPM) at the monorepo root:

```bash
# Build library targets from repo root:
swift build

# Execute unit tests:
swift test
```

### Running the Sample Gallery App

The iOS sample client application is built and executed using native Xcode project tools. Consult **[swift/sample/README.md](sample/README.md)** for step-by-step instructions on opening in Xcode or executing via command line (`xcodebuild` + `simctl`).

---

## Agent Source of Truth

For AI agents and contributors working within this directory hierarchy, consult **[swift/core/AGENTS.md](core/AGENTS.md)** for target architectural boundaries, mandatory coding conventions, and Spec-Driven Development compliance rules.
