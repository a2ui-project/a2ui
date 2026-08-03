# A2UI Core & Framework Conformance Test Suite

To ensure behavioral parity across all A2UI Core SDK and Framework implementations (Python, TypeScript, Swift, Kotlin, Rust, etc.), this directory maintains a language-agnostic conformance test suite for A2UI client and core framework specifications.

> **Note on Agent SDK Conformance**: Server-side Agent SDK conformance tests (for `parser`, `validator`, `catalog`, and `schema_manager`) are located in [`agent_sdks/conformance/`](file:///agent_sdks/conformance/README.md). This root-level `/conformance` directory is the authoritative source of truth for **Client Framework / Core SDK** capabilities (e.g. `DataModel`, message processing, state management, and expression evaluation).

---

## Directory Layout

```
conformance/
├── README.md                 # Authoritative guide for Core SDK conformance testing
├── conformance_schema.json   # JSON Schema validating Core YAML conformance suites
├── suites/                   # Language-agnostic YAML test suites
│   └── data_model.yaml       # DataModel reactive store test suite
└── tests/                    # Pytest suite validating schema compliance of YAML files
    └── test_conformance_yaml.py
```

---

## Test Suites Overview

All test suites are located in `conformance/suites/`:

- **`suites/data_model.yaml`**: Contains comprehensive conformance test cases for the A2UI `DataModel` reactive store, verifying:
  - Basic JSON Pointer retrieval and updates (`get`, `set`).
  - Automatic intermediate structure creation (auto-vivification) for dictionaries and arrays.
  - Array and list handling (including sparse arrays, index updates, and nested containers).
  - Removing properties when setting values to `null` or `undefined`.
  - Reactive subscriptions (exact path match, ancestor match under container semantics, descendant match, root match, and unsubscription).
  - RFC 6901 JSON Pointer escaping (`~1` for `/` and `~0` for `~`).
  - Security protections against prototype pollution (`__proto__`, `constructor`, `prototype`).
  - Strict error handling for invalid paths, non-numeric array indexing, and primitive segment traversal.

---

## How Core SDK Test Harnesses Work

Each client language SDK must implement a test harness that:

1. **Loads the YAML Suite**: Reads `conformance/suites/<suite_name>.yaml` using a YAML parser.
2. **Executes Test Steps in Sequence**:
   - Initializes a new target object (e.g., `DataModel` instance) with `initial_data`.
   - Iterates through the ordered list of `steps` in each test case.
   - For each step (`get`, `set`, `subscribe`, `unsubscribe`, `verify_subscription`, `dispose`), executes the operation against the native language implementation.
3. **Asserts Conformance**:
   - For `expect`, asserts that the returned value matches the expected data structure.
   - For `expect_error`, asserts that an error is thrown and its error message or code matches the expected regex/message.
   - For `verify_subscription`, asserts that the subscriber callback received the exact chronological list of value updates specified in `expect_updates`.

### Reference Implementations

- **Python Core SDK**: [`agent_sdks/python/a2ui_core/tests/test_data_model_conformance.py`](file:///agent_sdks/python/a2ui_core/tests/test_data_model_conformance.py)
- **TypeScript Web Core SDK**: [`renderers/web_core/src/v0_9/state/data-model-conformance.test.ts`](file:///renderers/web_core/src/v0_9/state/data-model-conformance.test.ts)

---

## Validating YAML Suites

To verify that all YAML test suites in `conformance/suites/` conform to `conformance_schema.json`, run:

```bash
pytest conformance/tests/
```
