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
  private let parser = ExpressionParser()

  @Test func expressionsConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/expressions.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/expressions.yaml should hold test cases")

    var executed = 0

    for testCase in cases {
      guard let action = testCase["action"] as? String, action == "parse_expression_template" else {
        continue
      }

      guard let name = testCase["name"] as? String,
        let input = testCase["input"] as? String
      else {
        continue
      }

      executed += 1

      if let expectError = (testCase["expect_error"] ?? testCase["expectError"]) as? [String: Any] {
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

    #expect(executed > 0, "No cases of expressions.yaml could be executed")
  }

  /// Runs the `validate` cases of `core/expressions.yaml`, which render `formatString` templates
  /// on a v1.0 surface and compare the resolved component properties.
  @MainActor
  @Test func expressionsValidateConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/expressions.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYAML)

    var executed = 0

    for testCase in testCases where testCase.action == "validate" {
      executed += 1
      try runValidateCase(testCase)
    }

    #expect(executed > 0, "No validate case of expressions.yaml could be executed")
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
      guard let payload = step.payload else {
        continue
      }
      capturedErrors.removeAll()

      let isFinalStep = stepIndex == testCase.steps.count - 1
      if let expectedError = step.expectError ?? (isFinalStep ? testCase.expectError : nil) {
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
          "\(testCase.name): expected an error at step \(stepIndex)"
        )
        if let expectedMessage = expectedError.message {
          #expect(
            errorMessages.contains { $0.localizedCaseInsensitiveContains(expectedMessage) },
            "\(testCase.name): messages \(errorMessages) do not contain '\(expectedMessage)'"
          )
        }
        continue
      }

      try processor.processMessages(payload)
      #expect(
        capturedErrors.isEmpty,
        "\(testCase.name): unexpected error at step \(stepIndex): \(capturedErrors)"
      )

      let expectedSurfaces = (step.expect ?? testCase.expect)?["surfaces"]?.objectValue ?? [:]
      for (surfaceID, expectedSurface) in expectedSurfaces {
        let surface = try #require(
          processor.surfaceGroupModel[surfaceID],
          "\(testCase.name): expected surface '\(surfaceID)'"
        )
        let expectedComponents = expectedSurface["components"]?.objectValue ?? [:]
        for (componentID, expectedComponent) in expectedComponents {
          let node = try #require(
            surface.findNode(id: componentID),
            "\(testCase.name): expected resolved node '\(componentID)'"
          )
          for (property, expectedValue) in expectedComponent.objectValue ?? [:]
          where property != "component" {
            let binding = try #require(
              node.properties[property] as? DataBinding<String>,
              "\(testCase.name): '\(componentID).\(property)' is not a string binding"
            )
            #expect(
              binding.value == expectedValue.stringValue,
              "\(testCase.name): '\(componentID).\(property)' is '\(binding.value)'"
            )
          }
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
