---
name: a2ui-conformance-testing
description: Guidelines and instructions for understanding, creating, and executing A2UI conformance test suites across all Agent and Core SDK implementations.
---

# A2UI Conformance Testing Skill

This skill explains how A2UI conformance tests work overall, how the YAML suites and JSON schemas are structured, and how to create or hook up conformance test harnesses in new or existing language SDKs.

---

## 1. Conformance Testing Architecture

To ensure 100% behavioral parity across all programming language implementations (Python, TypeScript/JavaScript, Swift, Kotlin, Rust, etc.), A2UI separates test definitions from language-specific test runners:

- **Central Conformance Test Suites**: Located under `agent_sdks/conformance/suites/`, organized into subdirectories by target SDK (`agent/` vs `core/`) and layer paths (e.g. `core/state/data_model.yaml`, `agent/processing/parser.yaml`, `agent/validating/validator.yaml`, etc.).
- **Validation Schema**: All YAML test suites are validated against `agent_sdks/conformance/conformance_schema.json`.

---

## 2. Structure of a Core Conformance Suite (`data_model.yaml`)

A Core SDK test suite consists of an array of test case objects. Each test case defines:

- `name`: Unique test case name (e.g., `test_data_model_basic_get_set`).
- `description`: Explanation of what is verified.
- `initial_data`: The starting JSON data structure to load into the store (defaults to `{}`).
- `steps`: An ordered array of step objects that execute actions sequentially.

### Supported Actions in `steps`:

- `get`: Reads the value at `path`. Asks for `expect` (value), `expect_undefined` (boolean), or `expect_error` (regex/string).
- `set`: Updates `path` with `value`. Asks for optional `remove: true` (to remove the key or set to undefined) or `expect_error` (regex/string).
- `subscribe`: Registers an observer on `path` identified by `listener_id`.
- `verify_subscription`: Asserts that the listener identified by `listener_id` has received the exact chronological list of value updates in `expect_updates`.
- `unsubscribe`: Terminates the subscription identified by `listener_id`.
- `dispose`: Cleans up the model instance and clears all active subscriptions.

---

## 3. How to Implement a Conformance Harness in a New Client Language

When building a new Core SDK (e.g., in Swift, Kotlin, or Rust):

1. **Locate the YAML Suite**:
   Resolve the relative or absolute filesystem path to `agent_sdks/conformance/suites/core/state/data_model.yaml`.

2. **Load and Iterate**:
   Parse the YAML file into an array of test cases. Iterate through each test case and instantiate a fresh instance of the language's `DataModel` class with `initial_data`.

3. **Maintain Listener Tracking**:
   Maintain a map of `listener_id -> { subscription, updates }`:
   - When executing `subscribe`, attach a callback to `model.subscribe(path, callback)` that deeply copies any received update and appends it to `updates`.
   - Store the subscription token/handle in `subscription`.
   - When executing `unsubscribe`, invoke the unsubscription method on the stored token.
   - When executing `verify_subscription`, assert `updates == step["expect_updates"]`.

4. **Assert Expected Errors**:
   When `expect_error` is defined on a `get` or `set` step, execute the operation within an error-assertion block and verify that the thrown exception matches the expected error regex.

### Reference Implementations in the Codebase

- **Python Core SDK**: `agent_sdks/python/a2ui_core/tests/test_data_model_conformance.py`
- **TypeScript Web Core SDK**: `renderers/web_core/src/v0_9/state/data-model-conformance.test.ts`
