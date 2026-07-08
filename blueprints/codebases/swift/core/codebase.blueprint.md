---
codebase_path: swift/core
associated_module: a2ui_core
module_blueprint_commit: null
implemented_features: []
local_development:
  test_command: './run_tests.sh'
  lint_command: './scripts/fix_format.sh --check'
  format_command: './scripts/fix_format.sh'
---

# **Swift Core Codebase Blueprint**

## **Architecture & Ecosystem Map**

A generic, lightweight Swift target layout validating JSON Schema 2020-12 rules.

- **JSONSchema Target** (`swift/core/JSONSchema`): Highly decoupled target compiling Swift types into schema definitions and testing validation schemas.
- **Apple Swift-Testing**: Utilizes Apple's native swift-testing framework for high-performance and lightweight concurrency validations.

## **Local Technical Decisions & Overrides**

- **Target Boundaries**: Strictly separates core A2UI structures from generic JSONSchema validators to support multi-platform Swift packaging (including server-side Vapor/Swift and client-side SwiftUI).

## **Validation & Execution Recipes**

- **Test execution**: Run tests via `./run_tests.sh`.
- **Formatting**: Format code according to Google Swift Style Guide via `./scripts/fix_format.sh`.
