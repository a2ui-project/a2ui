# Subskill: Testing Rigor & DOM Test Environment Isolation

## Activation Criteria

Activate this subskill when:

- PR modifies or introduces unit tests (`*.test.ts`, `*.spec.ts`), integration tests, test harnesses, or test fixtures.
- PR modifies catalog component implementations.

---

## Principles

### 1. Isolate and Teardown Mock DOM Environments Across Test Suites

- **Problem & Rationale**: Tests adding custom elements to `document.body` or mutating global registries (`customElements`, `adoptedStyleSheets`) bleed state into subsequent tests, creating flaky test runs and order-dependent failures.
- **Reviewer Checklist**:
  - [ ] Always reset DOM state in `beforeEach` and `afterEach` hooks (e.g. `document.body.innerHTML = ''`).
  - [ ] Never rely on `try/finally` blocks inside individual test cases for environment cleanup.

---

### 2. Assert on Rendered DOM Properties and Content (Reject Shallow Truthiness)

- **Problem & Rationale**: Tests that only assert `assert.ok(element)` or `expect(el).toBeDefined()` only prove that a constructor did not throw. They fail to verify that bindings, attributes, event handlers, and templates rendered as expected.
- **Reviewer Checklist**:
  - [ ] Require assertions on rendered text content, attribute values, and child element counts.
  - [ ] Use exact cardinality assertions (`.toBe(1)`) rather than loose inequalities (`.toBeGreaterThan(0)`).
  - [ ] Test interactive state changes and event dispatches.

---

### 3. Never Swallow Test Failures with Defensive `try/catch` Blocks

- **Problem & Rationale**: Wrapping assertion blocks in `try/catch` or silently continuing when an element is not found hides regressions and lets broken builds pass CI.
- **Reviewer Checklist**:
  - [ ] Flag any `try/catch` inside test bodies that logs or swallows exceptions instead of failing the test.

---

### 4. Provide Complete Catalog Test Coverage for Every Component Primitive

- **Problem & Rationale**: When updating a catalog contract, testing only one sample component leaves regressions undiscovered in sibling components.
- **Reviewer Checklist**:
  - [ ] Require dedicated unit tests for every new or modified catalog component primitive.
