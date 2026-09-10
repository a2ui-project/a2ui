# A2UI Swift coding standards

These standards supplement the [Google Swift Style Guide](https://google.github.io/swift/) and
provide specific rules, testing standards, and best practices for developing in the
`swift/` directory.

---

## 1. Core style rules

### One primary type per file

Every class, struct, enum, and protocol must reside in its own dedicated source file named
exactly after the type (for example, `JSONValue.swift` contains only `JSONValue`). Private helper
types or local extensions extending that primary type are permitted in the same file.

### 100-character line limit

No line of code, comment, docstring, string/JSON literal, or markdown documentation line may exceed
100 characters. Wrap long lines across multiple lines using multiline strings (`"""`), markdown
wrapping, or standard indentations.

### Headers, copyright, and license

Every newly created Swift source file must begin with the standard Apache 2.0 copyright header:

```swift
// Copyright 2024 Google LLC
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

### Code formatting

Format Swift code using the repository's native script or `swift-format`:

```bash
swift-format format -i -r Package.swift swift/
```

---

## 2. Safety: unwrapping and error handling

To keep the runtime solid and crash-free, avoid force unwrapping (`!`) and forced tries (`try!`):

- **Safe unwrapping**: Use optional binding (`if let`, `guard let`) or handle throwing functions
  in `do-catch` blocks.
- **Error propagation**: Propagate errors using standard Swift `throws` and typed `Error` enums.
- **Sensible defaults**: When parsing external data streams, fail gracefully or provide fallbacks
  rather than crashing with `fatalError()`.

---

## 3. Testing standards and quality

- **Testing framework**: Use the native Swift Testing framework (`import Testing`) for all test
  suites.
- **Annotations**: Use plain structs as test suites with `@Test` functions. Avoid redundant
  `@Suite` annotations unless configuring custom display traits.
- **Test names**: Use standard camelCase identifiers for test function names without backticks or
  spaces:
  ```swift
  @Test func roundTripSerialization() throws {
    // ...
  }
  ```
- **Assertions**: Use `#expect(...)` from Swift Testing for all assertions.
- **Safe unwrap in tests**: Never use force unwraps (`!`) in tests. Use `try #require(...)`
  to safely unwrap optionals, producing clear failure diagnostics instead of process crashes.
- **Public surface**: Test only the public API surface. Avoid `@testable import`.

---

## 4. Running tests

Execute all Swift package tests from the repository root:

```bash
swift test
```

Or run target-specific suites:

```bash
swift test --filter A2UICoreTests
swift test --filter A2UISwiftUITests
```

Or execute via `./swift/run_tests.sh`.
