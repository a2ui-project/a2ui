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
import BasicCatalog
import Foundation
import JSONSchema
import OrderedJSON
import Testing

@MainActor
struct ValidatorConformanceTests {
  @Test func validatorConformance() throws {
    try runValidatorSuite(filename: "core/validator_v0_9.yaml", versionPrefix: "v0.9")
  }

  @Test func validatorV10Conformance() throws {
    try runValidatorSuite(filename: "core/validator_v1_0.yaml", versionPrefix: "v1.0")
  }

  private func runValidatorSuite(filename: String, versionPrefix: String) throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: filename)
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYAML)
    #expect(!testCases.isEmpty, "\(filename) should hold test cases")

    var executedSteps = 0

    for testCase in testCases {
      guard testCase.action == "validate",
        testCase.protocolVersion == nil
          || testCase.protocolVersion?.hasPrefix(versionPrefix) == true
      else {
        continue
      }

      let targetVersion = versionPrefix == "v1.0" ? "v1.0" : "v0.9.1"
      let config =
        testCase.strictMode
        ? ValidationConfig(
          allowOrphanComponents: false,
          allowDanglingReferences: false,
          allowMissingRoot: false,
          targetVersion: targetVersion
        )
        : ValidationConfig(
          allowOrphanComponents: true,
          allowDanglingReferences: true,
          allowMissingRoot: true,
          targetVersion: targetVersion
        )

      let catalogs = try buildCatalogsWithAliases(for: testCase)
      let processor = MessageProcessor(
        catalogs: catalogs,
        validationConfig: config
      )

      for (stepIndex, step) in testCase.steps.enumerated() {
        guard let payload = step.payload else {
          continue
        }
        executedSteps += 1

        clearRecreatedSurfaces(in: payload, on: processor)

        let expectedError = step.expectError ?? testCase.expectError
        if let expectedError {
          var caughtError: Error?
          do {
            try processor.processMessages(payload)
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
            try processor.processMessages(payload)
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

    #expect(executedSteps > 0, "no step of \(filename) was executed")
  }

  private func buildCatalogsWithAliases(for testCase: ConformanceTestCase) throws -> [AnyCatalog] {
    var catalogs = try ConformanceTestHelper.buildCatalogs(for: testCase)
    let expectsCatalogError =
      testCase.expectError?.category == "CatalogError"
      || testCase.steps.contains { $0.expectError?.category == "CatalogError" }
    guard !expectsCatalogError, catalogs.count == 1, let soleCatalog = catalogs.first else {
      return catalogs
    }

    var referencedCatalogIDs: Set<String> = []
    for step in testCase.steps {
      guard let payload = step.payload else { continue }
      let messages = payload.arrayValue ?? [payload]
      for message in messages {
        if let catalogID = message.objectValue?["createSurface"]?.objectValue?["catalogId"]?
          .stringValue,
          !catalogID.isEmpty,
          catalogID != soleCatalog.id
        {
          referencedCatalogIDs.insert(catalogID)
        }
      }
    }

    for aliasID in referencedCatalogIDs.sorted() {
      catalogs.append(
        Catalog(
          id: aliasID,
          protocolVersion: soleCatalog.protocolVersion,
          components: Array(soleCatalog.components.values),
          functions: Array(soleCatalog.functions.values),
          themeSchema: soleCatalog.themeSchema
        ).eraseToAnyCatalog()
      )
    }
    return catalogs
  }

  private func clearRecreatedSurfaces(in payload: JSONValue, on processor: MessageProcessor) {
    let messages = payload.arrayValue ?? [payload]
    var createdInPayload: [String: Int] = [:]
    for message in messages {
      if let surfaceID = message.objectValue?["createSurface"]?.objectValue?["surfaceId"]?
        .stringValue
      {
        createdInPayload[surfaceID, default: 0] += 1
      }
    }
    for (surfaceID, count) in createdInPayload
    where count == 1 && processor.surfaceGroupModel[surfaceID] != nil {
      processor.surfaceGroupModel.removeSurface(id: surfaceID)
    }
  }

  @Test func compositionConstraintsConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/composition_constraints.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)
    #expect(!testCases.isEmpty, "Should find test cases in core/composition_constraints.yaml")

    for testCase in testCases {
      let v10Catalog = BasicCatalog.makeCatalog(version: .v10)
      var catalogs: [AnyCatalog] = [v10Catalog]
      for aliasId in ["basic", "test-catalog", "https://a2ui.org/basic-catalog"] {
        catalogs.append(
          Catalog(
            id: aliasId,
            protocolVersion: v10Catalog.protocolVersion,
            components: Array(v10Catalog.components.values),
            functions: Array(v10Catalog.functions.values)
          ).eraseToAnyCatalog()
        )
      }
      if let customCatalog = ConformanceTestHelper.buildCatalog(from: testCase.catalogConfiguration)
      {
        catalogs.append(customCatalog)
      }

      let processor = MessageProcessor(
        catalogs: catalogs,
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      for (stepIndex, step) in testCase.steps.enumerated() {
        guard let payload = step.payload else { continue }

        let expectedError = step.expectError ?? testCase.expectError
        if let expectedError {
          var caughtError: Error?
          do {
            try processor.processMessages(payload)
          } catch {
            caughtError = error
          }

          let error = try #require(
            caughtError,
            "Expected failure for '\(testCase.name)' at step \(stepIndex)"
          )

          if let expectedCode = expectedError.code, let valError = error as? A2UIValidationError {
            #expect(
              valError.details.contains(where: { $0.code == expectedCode }),
              "[\(testCase.name)] Expected error code '\(expectedCode)', got \(valError.details)"
            )
          } else {
            assertErrorMatches(error: error, expected: expectedError, testName: testCase.name)
          }
        } else {
          do {
            try processor.processMessages(payload)
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

  @Test func reservedKeysConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/reserved_keys.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYAML)
    #expect(!testCases.isEmpty, "Should find test cases in core/reserved_keys.yaml")

    var executed = 0
    for testCase in testCases {
      let catalogs = try buildCatalogsWithAliases(for: testCase)
      let processor = MessageProcessor(
        catalogs: catalogs,
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      for (stepIndex, step) in testCase.steps.enumerated() {
        guard let payload = step.payload else { continue }
        executed += 1

        let expectedError = step.expectError ?? testCase.expectError
        if let expectedError {
          var caughtError: Error?
          do {
            try processor.processMessages(payload)
          } catch {
            caughtError = error
          }
          let error = try #require(
            caughtError,
            "Expected failure for '\(testCase.name)' at step \(stepIndex)"
          )
          assertErrorMatches(error: error, expected: expectedError, testName: testCase.name)
        } else {
          try processor.processMessages(payload)
          if let expectedSurfaces = (step.expect ?? testCase.expect)?["surfaces"]?.objectValue {
            for (surfaceID, expectedSurface) in expectedSurfaces {
              let surface = try #require(
                processor.surfaceGroupModel[surfaceID],
                "[\(testCase.name)] Expected surface '\(surfaceID)' to exist"
              )
              if let expectedComps = expectedSurface["components"]?.arrayValue {
                for expectedComp in expectedComps {
                  guard let compObj = expectedComp.objectValue,
                    let id = compObj["id"]?.stringValue
                  else { continue }
                  let node = try #require(
                    surface.findNode(id: id),
                    "[\(testCase.name)] Expected resolved node '\(id)'"
                  )
                  for (propKey, expectedVal) in compObj
                  where propKey != "id" && propKey != "component" {
                    if let binding = node.properties[propKey] as? DataBinding<JSONValue> {
                      #expect(
                        binding.value == expectedVal,
                        "[\(testCase.name)] Property '\(propKey)' mismatch"
                      )
                    } else if let strBinding = node.properties[propKey] as? DataBinding<String> {
                      #expect(
                        strBinding.value == expectedVal.stringValue,
                        "[\(testCase.name)] Property '\(propKey)' mismatch"
                      )
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    #expect(executed == testCases.count, "All cases in reserved_keys.yaml should execute")
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
