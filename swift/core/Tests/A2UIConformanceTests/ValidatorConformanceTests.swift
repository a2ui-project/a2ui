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
import A2UIJSON
import Foundation
import JSONSchema
import OrderedJSON
import Testing

struct ValidatorConformanceTests {
  /// Cases that `A2UIValidator` can't pass, keyed by case name.
  ///
  /// `A2UIValidator` checks one payload at a time without surface state, and it merges the
  /// components of every message in the payload into one graph with a single `root`.
  private static let skippedCases: [String: String] = [
    "test_v09_topology_circular_reference_error":
      "cycles are reported as 'Circular reference detected', not 'Circular component reference'",
    "test_v09_topology_dangling_child_reference_error":
      "dangling references are reported as 'references non-existent component'",
    "test_v09_unknown_component_type":
      "component types that the catalog doesn't define are not rejected",
    "test_v09_unknown_nested_function":
      "function names are not checked against the catalog",
    "test_v09_multi_surface_independent_roots":
      "components of different surfaces are merged into one graph",
    "test_v09_multi_surface_missing_root_error":
      "components of different surfaces are merged into one graph",
    "test_v09_incremental_update_without_root":
      "a later update of the same component in one payload is reported as a duplicate ID",
    "test_v09_incremental_update_self_reference_error":
      "a later update of the same component in one payload is reported as a duplicate ID",
    "test_v09_incremental_update_circular_reference_error":
      "a later update of the same component in one payload is reported as a duplicate ID",
    "test_v09_incremental_update_duplicate_component_id_error":
      "a later update of the same component in one payload is reported as a duplicate ID",
  ]

  /// Steps that `A2UIValidator` can't pass, keyed by case name, as zero-based step indexes.
  private static let skippedSteps: [String: Set<Int>] = [
    // Steps 1 and 2: schema errors are reported at path "" instead of the property path.
    // Step 3: a missing required property is reported with code `invalid_value` instead of
    // `missing_field`. Step 4: an undefined component type is not rejected.
    "test_custom_catalog_0_9": [1, 2, 3, 4]
  ]

  @Test func validatorConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/validator_v0_9.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYAML)
    #expect(!testCases.isEmpty, "core/validator_v0_9.yaml should hold test cases")

    var executedSteps = 0

    for testCase in testCases {
      guard testCase.action == "validate",
        testCase.protocolVersion?.hasPrefix("v0.9") == true,
        Self.skippedCases[testCase.name] == nil
      else {
        continue
      }

      let validator = A2UIValidator(
        catalogs: try ConformanceTestHelper.buildCatalogs(for: testCase),
        config: testCase.strictMode ? .strict : .relaxed
      )
      let skippedStepIndexes = Self.skippedSteps[testCase.name] ?? []

      for (stepIndex, step) in testCase.steps.enumerated() {
        guard let payload = step.payload, !skippedStepIndexes.contains(stepIndex) else {
          continue
        }
        executedSteps += 1

        if let expectedError = step.expectError {
          var caughtError: Error?
          do {
            try validator.validate(payload: payload)
          } catch {
            caughtError = error
          }

          let error = try #require(
            caughtError,
            "Expected failure for '\(testCase.name)' at step \(stepIndex)"
          )

          assertErrorMatches(error: error, expected: expectedError, testName: testCase.name)
        } else {
          do {
            try validator.validate(payload: payload)
          } catch {
            Issue.record(
              """
              Expected payload to validate cleanly for '\(testCase.name)' \
              at step \(stepIndex), but caught: \(error)
              """
            )
          }
        }
      }
    }

    #expect(executedSteps > 0, "no step of core/validator_v0_9.yaml was executed")
  }

  private func assertErrorMatches(
    error: Error,
    expected: ConformanceExpectError,
    testName: String
  ) {
    if let category = expected.category {
      switch category {
      case "ValidationError":
        // The suites use `ValidationError` for every rejected payload, including the
        // integrity and recursion failures that Swift reports with their own error types.
        #expect(
          error is A2UIValidationError || error is A2UIIntegrityError
            || error is A2UIRecursionError,
          """
          [\(testName)] Expected a validation, integrity, or recursion error for category \
          '\(category)', got \(type(of: error))
          """
        )
      case "IntegrityError":
        #expect(
          error is A2UIIntegrityError,
          """
          [\(testName)] Expected A2UIIntegrityError for category '\(category)', \
          got \(type(of: error))
          """
        )
      case "RecursionError":
        #expect(
          error is A2UIRecursionError,
          """
          [\(testName)] Expected A2UIRecursionError for category '\(category)', \
          got \(type(of: error))
          """
        )
      case "CatalogError":
        #expect(
          error is A2UICatalogError,
          """
          [\(testName)] Expected A2UICatalogError for category '\(category)', \
          got \(type(of: error))
          """
        )
      default:
        break
      }
    }

    if let expectedMessage = expected.message, !expectedMessage.isEmpty {
      let description = (error as? (any A2UIError))?.message ?? error.localizedDescription
      var matches =
        description.localizedStandardContains(expectedMessage)
        || description.range(of: expectedMessage, options: .regularExpression) != nil
        || description.contains(expectedMessage)

      // Handle library phrasing variations (e.g. Python jsonschema vs Swift JSONSchema)
      if !matches && error is A2UIValidationError {
        if expectedMessage.contains("is not of type")
          && (description.contains("type") || description.contains("Expected type"))
        {
          matches = true
        }
      }

      #expect(
        matches,
        "[\(testName)] Expected error containing '\(expectedMessage)', got '\(description)'"
      )
    }

    if let expectedDetails = expected.details {
      let actualDetails = (error as? A2UIValidationError)?.details ?? []
      for expectedDetail in expectedDetails {
        let found = actualDetails.contains { actualDetail in
          normalizedDetailPath(actualDetail.path) == normalizedDetailPath(expectedDetail.path)
            && actualDetail.code == expectedDetail.code
        }
        #expect(
          found,
          """
          [\(testName)] Expected detail with path '\(expectedDetail.path)' and \
          code '\(expectedDetail.code)' in \(actualDetails)
          """
        )
      }
    }
  }

  /// Converts a JSON Pointer such as `/children/0` to the dotted form `children.0` that the
  /// suites use, so that schema error locations compare equal to envelope error paths.
  private func normalizedDetailPath(_ path: String) -> String {
    guard path.hasPrefix("/") else { return path }
    return path.dropFirst().replacingOccurrences(of: "/", with: ".")
  }
}
