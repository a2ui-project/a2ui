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

import A2UICore
import BasicCatalog
import Foundation
import OrderedJSON
import Testing

/// Runs the shared `conformance/core/expressions.yaml` suite.
struct ExpressionsConformanceTests {
  private static let knownParseCaseKeys: Set<String> = [
    "action",
    "expect",
    "expect_error",
    "input",
  ]

  private static let knownValidateCaseKeys: Set<String> = [
    "action",
    "catalog",
    "expect",
    "steps",
  ]

  private static let knownValidateStepKeys: Set<String> = [
    "expectError",
    "payload",
  ]

  private static let knownExpectErrorKeys: Set<String> = [
    "category",
    "message",
  ]

  private let parser = ExpressionParser()

  @Test(
    arguments: ConformanceTestHelper.cases(
      "core/expressions.yaml",
      action: "parse_expression_template"
    )
  )
  func expressionsConformance(_ conformanceCase: ConformanceCase) throws {
    try ConformanceManifest.run(conformanceCase) {
      try runParseExpressionCase(conformanceCase.rawDictionary, name: conformanceCase.name)
    }
  }

  private func runParseExpressionCase(_ testCase: [String: Any], name: String) throws {
    try ConformanceTestHelper.assertKnownKeys(
      testCase,
      Self.knownParseCaseKeys,
      "expressions.yaml parse case '\(name)'"
    )
    let input = try #require(testCase["input"] as? String, "\(name): missing input")

    if let expectError = (testCase["expect_error"] ?? testCase["expectError"]) as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expectError,
        Self.knownExpectErrorKeys,
        "expressions.yaml expect_error in '\(name)'",
        allowMetadata: false
      )
      assertParseExpressionThrows(input: input, expectError: expectError, name: name)
    } else if let expectedRaw = testCase["expect"] as? [Any] {
      let actual = try parser.parse(input)
      let joinedActual = joinLiterals(actual)
      let expectedValues = expectedRaw.map { ConformanceTestHelper.toJSONValue($0) }
      #expect(
        looselyEqual(joinedActual, expectedValues),
        "\(name) mismatch: got \(joinedActual), expected \(expectedValues)"
      )
    } else {
      Issue.record("\(name): test case does not define 'expect' or 'expect_error'")
    }
  }

  private func assertParseExpressionThrows(
    input: String,
    expectError: [String: Any],
    name: String
  ) {
    let expectedMessage = expectError["message"] as? String
    let expectedCategory = expectError["category"] as? String

    do {
      _ = try parser.parse(input)
      Issue.record("\(name): expected an error for input: \(input)")
    } catch let error as FunctionError {
      if let expectedCategory {
        #expect(!expectedCategory.isEmpty, "\(name): expected category '\(expectedCategory)'")
      }
      if let expectedMessage {
        switch error {
        case .executionFailed(_, let message):
          let matches =
            message.localizedCaseInsensitiveContains(expectedMessage)
            || ((try? NSRegularExpression(pattern: expectedMessage).firstMatch(
              in: message,
              range: NSRange(message.startIndex..., in: message)
            )) != nil)
          #expect(
            matches,
            "\(name): message '\(message)' does not match pattern '\(expectedMessage)'"
          )
        default:
          Issue.record("\(name): expected executionFailed error, but got \(error)")
        }
      }
    } catch {
      Issue.record("\(name): threw unexpected error \(error)")
    }
  }

  /// Runs the `validate` cases of `core/expressions.yaml`, which render `formatString` templates
  /// on a v1.0 surface and compare the resolved component properties.
  @MainActor
  @Test(arguments: ConformanceTestHelper.cases("core/expressions.yaml", action: "validate"))
  func expressionsValidateConformance(_ conformanceCase: ConformanceCase) throws {
    try ConformanceManifest.run(conformanceCase) {
      let rawDict = conformanceCase.rawDictionary
      try ConformanceTestHelper.assertKnownKeys(
        rawDict,
        Self.knownValidateCaseKeys,
        "expressions.yaml validate case '\(conformanceCase.name)'"
      )
      if let steps = rawDict["steps"] as? [[String: Any]] {
        for step in steps {
          try ConformanceTestHelper.assertKnownKeys(
            step,
            Self.knownValidateStepKeys,
            "expressions.yaml step in '\(conformanceCase.name)'",
            allowMetadata: false
          )
          if let errDict = step["expectError"] as? [String: Any] {
            try ConformanceTestHelper.assertKnownKeys(
              errDict,
              Self.knownExpectErrorKeys,
              "expressions.yaml step.expectError in '\(conformanceCase.name)'",
              allowMetadata: false
            )
          }
        }
      }
      let testCase = try #require(
        conformanceCase.parsedTestCase(),
        "[\(conformanceCase.name)] Could not parse validate case"
      )
      try runValidateCase(testCase)
    }
  }

  @MainActor
  private func runValidateCase(_ testCase: ConformanceTestCase) throws {
    let processor = MessageProcessor(
      catalogs: try ConformanceTestHelper.buildCatalogs(for: testCase),
      validationConfig: ValidationConfig(targetVersion: "1.0")
    )
    // Expression errors raised while resolving nodes reach the surface as `EXPRESSION_ERROR`
    // rather than being thrown out of `processMessages`.
    var capturedErrors: [RendererError] = []
    processor.outboundListener = { message in
      MainActor.assumeIsolated {
        if case .error(let error) = message {
          capturedErrors.append(error)
        }
      }
    }

    for (stepIndex, step) in testCase.steps.enumerated() {
      guard let payload = step.payload else { continue }
      capturedErrors.removeAll()

      let isFinalStep = stepIndex == testCase.steps.count - 1
      if let expectedError = step.expectError ?? (isFinalStep ? testCase.expectError : nil) {
        assertValidateStepError(
          payload: payload,
          processor: processor,
          capturedErrors: &capturedErrors,
          expectedError: expectedError,
          testName: testCase.name,
          stepIndex: stepIndex
        )
        continue
      }

      try processor.processMessages(payload)
      #expect(
        capturedErrors.isEmpty,
        "\(testCase.name): unexpected error at step \(stepIndex): \(capturedErrors)"
      )

      let expectedSurfaces = (step.expect ?? testCase.expect)?["surfaces"]?.objectValue ?? [:]
      try assertValidateSurfaces(
        OrderedDictionary(uniqueKeysWithValues: expectedSurfaces.map { ($0.key, $0.value) }),
        on: processor,
        testName: testCase.name
      )
    }
  }

  @MainActor
  private func assertValidateStepError(
    payload: JSONValue,
    processor: MessageProcessor,
    capturedErrors: inout [RendererError],
    expectedError: ConformanceExpectError,
    testName: String,
    stepIndex: Int
  ) {
    var errorMessages: [String] = []
    do {
      try processor.processMessages(payload)
    } catch {
      let message = (error as? (any A2UIError))?.message ?? error.localizedDescription
      errorMessages.append(message)
    }
    for error in capturedErrors {
      switch error {
      case .validationFailed(let validationError):
        errorMessages.append(validationError.message)
      case .generic(let genericError):
        errorMessages.append(genericError.message)
      }
    }
    #expect(
      !errorMessages.isEmpty,
      "\(testName): expected an error at step \(stepIndex)"
    )
    if let expectedMessage = expectedError.message {
      #expect(
        errorMessages.contains { $0.localizedCaseInsensitiveContains(expectedMessage) },
        "\(testName): messages \(errorMessages) do not contain '\(expectedMessage)'"
      )
    }
  }

  @MainActor
  private func assertValidateSurfaces(
    _ expectedSurfaces: OrderedDictionary<String, JSONValue>,
    on processor: MessageProcessor,
    testName: String
  ) throws {
    for (surfaceID, expectedSurface) in expectedSurfaces {
      if let surfObj = expectedSurface.objectValue {
        try ConformanceTestHelper.assertKnownKeys(
          surfObj,
          ["components"],
          "expressions.yaml expect.surfaces.\(surfaceID) in '\(testName)'",
          allowMetadata: false
        )
      }
      let surface = try #require(
        processor.surfaceGroupModel[surfaceID],
        "\(testName): expected surface '\(surfaceID)'"
      )
      let expectedComponents = expectedSurface["components"]?.objectValue ?? [:]
      for (componentID, expectedComponent) in expectedComponents {
        let node = try #require(
          surface.findNode(id: componentID),
          "\(testName): expected resolved node '\(componentID)'"
        )
        for (property, expectedValue) in expectedComponent.objectValue ?? [:]
        where property != "component" {
          let binding = try #require(
            node.properties[property] as? DataBinding<String>,
            "\(testName): '\(componentID).\(property)' is not a string binding"
          )
          #expect(
            binding.value == expectedValue.stringValue,
            "\(testName): '\(componentID).\(property)' is '\(String(describing: binding.value))'"
          )
        }
      }
    }
  }

  /// Joins adjacent literal strings and drops empty string literals.
  private func joinLiterals(_ parts: [JSONValue]) -> [JSONValue] {
    var joined: [JSONValue] = []
    for part in parts {
      if case .string(let str) = part, case .string(let last)? = joined.last {
        joined[joined.count - 1] = .string(last + str)
      } else {
        joined.append(part)
      }
    }
    return joined.filter {
      if case .string(let str) = $0 {
        return !str.isEmpty
      }
      return true
    }
  }

  /// Recursively compares parsed expression values, treating integer and floating-point
  /// representations of equivalent numeric values as equal.
  private func looselyEqual(_ lhs: [JSONValue], _ rhs: [JSONValue]) -> Bool {
    guard lhs.count == rhs.count else { return false }
    return zip(lhs, rhs).allSatisfy { looselyEqual($0, $1) }
  }

  private func looselyEqual(_ lhs: JSONValue, _ rhs: JSONValue) -> Bool {
    switch (lhs, rhs) {
    case (.integer(let a), .integer(let b)):
      return a == b
    case (.number(let a), .number(let b)):
      return a == b
    case (.integer(let a), .number(let b)):
      return b.rounded() == b && Double(a) == b && Int(exactly: b) == a
    case (.number(let a), .integer(let b)):
      return a.rounded() == a && Double(b) == a && Int(exactly: a) == b
    case (.string(let a), .string(let b)):
      return a == b
    case (.boolean(let a), .boolean(let b)):
      return a == b
    case (.null, .null):
      return true
    case (.array(let a), .array(let b)):
      guard a.count == b.count else { return false }
      return zip(a, b).allSatisfy { looselyEqual($0, $1) }
    case (.object(let a), .object(let b)):
      guard Set(a.keys) == Set(b.keys) else { return false }
      return a.keys.allSatisfy { key in
        guard let lv = a[key], let rv = b[key] else { return false }
        return looselyEqual(lv, rv)
      }
    default:
      return false
    }
  }
}
