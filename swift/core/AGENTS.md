# A2UI Swift Core Agent Guide (AGENTS.md)

This document is the authoritative guide for AI agents operating within the `swift/core`
directory. It outlines target boundaries, coding conventions, and verification protocols.

---

## 1. Target Architecture & Boundaries

The package is divided into distinct targets. Agents must strictly respect their boundaries:

1. **`JSONSchema`** (`JSONSchema/Sources`):
   - **Purpose**: Generic JSON Schema Draft 2020-12 validator and DSL builder.
   - **Rule**: **NEVER** add A2UI-specific types, schemas, event validations, or
     tests here. Keep this target completely independent, generic, and
     specification-compliant.

---

## 2. Mandatory Coding Conventions for Agents

When creating or modifying Swift source files, agents **MUST** strictly adhere to
[CODING_STANDARDS.md](CODING_STANDARDS.md) and
[Google Swift Style Guide](https://google.github.io/swift/). Review both guides
before writing any code.

---

## 3. Verification Protocol

Before completing any task, agents **MUST** execute the following verification steps:

1. **Format Code**:
   - Run the formatting script from the repository root to ensure all changes conform
     to style rules:
     ```bash
     ./scripts/fix_format.sh
     ```

2. **Run Unit Tests**:
   - Execute the test runner script to run all unit tests:
     ```bash
     ./run_tests.sh
     ```
   - Ensure that all tests pass.
