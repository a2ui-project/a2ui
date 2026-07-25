# A2UI Swift Core Coding Standards

These standards supplement the [Google Swift Style Guide](https://google.github.io/swift/)
and provide specific rules, testing standards, and best practices for developing and
maintaining Swift components within the A2UI (Agent-to-User Interface) monorepo.

Following these guidelines ensures that our codebase remains clean, modular, and reliable for
all developers and agents.

## Table of Contents

- [Core Style Rules](#core-style-rules)
  - [1. One Primary Type per File](#1-one-primary-type-per-file)
  - [2. 100-Character Line Limit](#2-100-character-line-limit)
  - [3. Headers, Copyright, and License](#3-headers-copyright-and-license)
  - [4. Code Formatting](#4-code-formatting)
- [Safety First: Unwrapping and Error Handling](#safety-first-unwrapping-and-error-handling)
- [Testing Standards and Quality](#testing-standards-and-quality)
- [Source Files & Hygiene](#source-files--hygiene)

---

## Core Style Rules

To maintain a clean and highly modular codebase, we adhere to four core style rules:

### 1. One Primary Type per File

Every class, struct, enum, and protocol must reside in its own dedicated source file named exactly
after the type (e.g., `JSONValue.swift` contains only the `JSONValue` enum).
_Nested private helper enums or extensions extending that primary type are allowed in the same_
_file._

### 2. 100-Character Line Limit

To ensure excellent readability on all screens and within pull request diffs, **absolutely no line
of code, comment, docstring, string/JSON literal, or markdown documentation line may exceed 100
characters.**
_Wrap long string literals, comments, regular expressions, and markdown lines across multiple lines
using multiline strings (`"""`), markdown wrapping, or indentations where appropriate._

### 3. Headers, Copyright, and License

Every newly created source file must begin with the standard Google Apache 2.0 copyright header at
the very top. Please use the following template exactly as shown:

```swift
// Copyright 2026 Google LLC
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

### 4. Code Formatting

Before committing any code changes, you must run the repository's native formatting script from
the repository root to ensure consistent styling and compliance:

```bash
./scripts/fix_format.sh
```

---

## Safety First: Unwrapping and Error Handling

To keep our applications rock-solid and crash-free, we prefer avoiding force unwrapping (`!`) and
forced tries (`try!`) entirely.

- **Safe unwrapping:** Whenever possible, use optional binding (`if let`, `guard let`) or handle
  throwing functions properly via `do-catch` blocks.
- **Propagate errors:** Use standard Swift error propagation by throwing `Error` enums.
- **Sensible Defaults & Graceful Handling:** When working with decoders or external data sources
  where conversions might fail, provide sensible defaults where appropriate, or fail
  parsing/validation gracefully by throwing an error, rather than crashing with `fatalError()`
  or force unwrapping.

---

## Testing Standards and Quality

Writing excellent tests ensures high confidence in our SDKs and services.

- **Testing Framework:** Use the new Swift Testing framework (`import Testing`) for all tests.
- **Redundant Annotations:** Avoid using the `@Suite` attribute on test structs or classes unless
  you need custom configurations like display names or traits. Let plain Swift structs serve as
  test suites with `@Test` functions.
- **Descriptive Test Names:** Use standard Swift camelCase identifiers for test function names
  without backticks or spaces. Avoid using raw identifiers (backticks with spaces) in test names.
  For example:
  ```swift
  @Test func testRoundTripSerialization() throws {
      // ...
  }
  ```
- **Assertions:** Prefer `#expect(...)` from Swift Testing over legacy `XCTAssert` macros for
  clearer failure messages.
- **Test Coverage:** Ensure your code changes cover:
  - Deterministic object encoding (e.g., keys sorted alphabetically)
  - Round-trip string serialization/deserialization
  - Order-independent equality checks for dictionaries or objects
- **No force unwraps:** Never use force unwraps (`!`) in tests. Use
  `try #require(...)` from Swift Testing to safely unwrap optionals, which
  produces a clear test failure instead of a crash.

- **Running Tests:** Use the `run_tests.sh` script to run tests on the root package:
  ```bash
  cd swift/core && ./run_tests.sh
  ```

---

## Source Files & Hygiene

- **Compiler Warnings:** Avoid introducing compiler warnings. Fix warnings as they appear,
  for example, by replacing unmutated variables (`var`) with constants (`let`).
- **Directory Structure:** All sources must reside under `swift/<Layer>/Sources/<ModuleName>` and all test
  files under `swift/<Layer>/Tests/<ModuleName>Tests`.
