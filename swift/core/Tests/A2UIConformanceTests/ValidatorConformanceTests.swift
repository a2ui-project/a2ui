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
  @Test func validatorConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/validator.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    // Filter to v0.9 and v0.9.1 test cases
    let v09TestCases = testCases.filter { testCase in
      if let version = testCase.catalogConfiguration?["version"]?.stringValue {
        return version == "0.9" || version == "0.9.1"
      }
      return testCase.name.contains("0_9") || testCase.name.contains("v09")
    }

    #expect(!v09TestCases.isEmpty, "Should find v0.9 / v0.9.1 test cases in validator.yaml")

    for testCase in v09TestCases {
      let validationConfiguration = ValidationConfig(
        allowOrphanComponents: testCase.name.contains("orphans_allowed"),
        allowDanglingReferences: testCase.name.contains("incremental"),
        allowMissingRoot: testCase.name.contains("no_root")
          || testCase.name.contains("incremental"),
        targetVersion: "v0.9.1"
      )

      var catalogs: [AnyCatalog] = []
      if let catalog = ConformanceTestHelper.buildCatalog(
        from: testCase.catalogConfiguration
      ) {
        catalogs.append(catalog)
      }

      let validator = A2UIValidator(catalogs: catalogs, config: validationConfiguration)

      for (stepIndex, step) in testCase.steps.enumerated() {
        guard let payload = step.payload else { continue }

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
  }

  private func assertErrorMatches(
    error: Error,
    expected: ConformanceExpectError,
    testName: String
  ) {
    if let category = expected.category {
      switch category {
      case "ValidationError":
        #expect(
          error is A2UIValidationError,
          """
          [\(testName)] Expected A2UIValidationError for category '\(category)', \
          got \(type(of: error))
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

    if let expectedDetails = expected.details,
      let validationError = error as? A2UIValidationError
    {
      for expectedDetail in expectedDetails {
        let found = validationError.details.contains { actualDetail in
          actualDetail.path == expectedDetail.path && actualDetail.code == expectedDetail.code
        }
        #expect(
          found,
          """
          [\(testName)] Expected detail with path '\(expectedDetail.path)' and \
          code '\(expectedDetail.code)' in \(validationError.details)
          """
        )
      }
    }
  }
}
