---
name: a2ui-test-quality-check
description: Auditing test suites for assertion utility, boundary cases coverage, and verification strength.
---

# A2UI Test Quality & Assertions Auditing Skill

This skill guides you through the process of auditing codebase test suites to verify that tests are providing robust, meaningful assertions and verifying critical invariants, rather than simply running paths for code coverage.

---

## **Instructions**

1. **Locate Test Suites**:
   - Find all test directories and test files in each platform's implementation folder (e.g. `tests/`, `test/`, `*Tests.swift`).

2. **Audit Assertion Quality**:
   - For each test case, inspect the assertions used:
     - Flag "weak assertions" that only verify non-null or truthy values without checking specific payload structure, field values, or types (e.g. `expect(result).not.toBeNull()` on a complex object).
     - Flag "empty tests" that execute code blocks but lack any assertions or mocks verifications (e.g. executing to check for lack of exceptions, unless it is explicitly marked as a no-throw smoke test).
     - Ensure that return models, state side effects, and events dispatched have corresponding value-matching assertions.

3. **Audit Behavioral and Boundary Coverage**:
   - Review if tests exist for typical logical edge cases:
     - Null, empty, or overflow values.
     - Invalid JSON or parsing errors (e.g., throwing correct exceptions).
     - Exception propagation and error boundaries.
     - Timeout handling and cleanup side effects.
   - Look for cases where tests might pass when they should fail.
   - Cross-reference with the codebase's main files: if a file has complex parsing/validation code, ensure there are dedicated failing test cases asserting that errors are reported correctly.

4. **Audit Mocking Realism**:
   - Ensure mocks and stubs verify their call parameters (e.g., verifying that a mock transport received the exact payload sent by the SDK, rather than just asserting it was called).

5. **Format the Report**:
   - Build a Markdown report summarizing the findings:
     - Table of audited test suites and files.
     - **Weak Assertions**: List of test cases that rely on weak or missing assertions.
     - **Missing Edge Case Tests**: Critical logic boundaries and exception paths lacking tests.
     - **Mocking Mismatches**: Mock implementations that fail to verify call structures.
   - Return this Markdown report as your final response.
