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

@MainActor
private final class ConformanceMockFunctionHandler: FunctionHandler {
  private let functionsMap: [String: any FunctionImplementation] = Dictionary(
    uniqueKeysWithValues: BasicFunctions.allFunctions.map { ($0.api.name, $0) }
  )

  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    functionsMap[named]
  }
}

@MainActor
struct BasicCatalogConformanceTests {
  private let functionHandler = ConformanceMockFunctionHandler()

  @Test func formatStringAndExpressionParser() throws {
    let dataModel = DataModel(
      initial: .object([
        "user": .object([
          "firstName": .string("Alice"),
          "age": .integer(30),
        ])
      ])
    )

    let parsed = try ExpressionParser().parse("Hello ${/user/firstName}, age is ${/user/age}!")
    #expect(parsed.count == 5)

    let formatStringFunction = FormatStringFunction()
    let context = DataContext(dataModel: dataModel, path: "", functionHandler: functionHandler)

    let result = try formatStringFunction.evaluate(
      arguments: [
        "value": .string("Welcome ${/user/firstName}, you are ${/user/age} years old.")
      ],
      context: context
    )

    #expect(result == .string("Welcome Alice, you are 30 years old."))
  }

  @Test func evaluateFunctionConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/functions.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/functions.yaml should hold test cases")

    let functionsMap: [String: any FunctionImplementation] = Dictionary(
      uniqueKeysWithValues: BasicFunctions.allFunctions.map { ($0.api.name, $0) }
    )

    for testCase in cases {
      guard let action = testCase["action"] as? String, action == "evaluate_function" else {
        continue
      }

      // The Swift basic catalog implements v0.9, whose validators return
      // booleans. Cases pinned to a later protocol version exercise v1.0
      // behaviour (ValidationResult operands) that this catalog does not have.
      let catalogVersion = (testCase["catalog"] as? [String: Any])?["protocolVersion"] as? String
      let protocolVersion = (testCase["protocolVersion"] as? String) ?? catalogVersion
      if let protocolVersion, !protocolVersion.hasPrefix("v0.9") {
        continue
      }

      guard let name = testCase["name"] as? String,
        let funcName = testCase["function"] as? String
      else {
        continue
      }

      guard let fn = functionsMap[funcName] else {
        Issue.record("\(name): function '\(funcName)' not found in BasicFunctions")
        continue
      }

      let dataModelDict: JSONValue =
        (testCase["dataModel"] ?? testCase["data_model"]).map {
          ConformanceTestHelper.toJSONValue($0)
        } ?? .object([:])
      let model = DataModel(initial: dataModelDict)
      let context = DataContext(dataModel: model, path: "/", functionHandler: functionHandler)

      let rawArgs = (testCase["args"] as? [String: Any]) ?? [:]
      var swiftArgs: [String: JSONValue] = [:]
      for (k, v) in rawArgs {
        swiftArgs[k] = ConformanceTestHelper.toJSONValue(v)
      }

      if let expectError = (testCase["expectError"] ?? testCase["expect_error"]) as? [String: Any] {
        do {
          _ = try fn.evaluate(arguments: swiftArgs, context: context)
          Issue.record("\(name): expected error but succeeded")
        } catch is FunctionError {
          if let expectedCategory = expectError["category"] as? String {
            #expect(
              expectedCategory == "ExpressionError" || expectedCategory == "ValidationError",
              "\(name): unexpected expectedCategory \(expectedCategory)"
            )
          }
        } catch {
          Issue.record("\(name): threw unexpected non-function error: \(error)")
        }
      } else {
        do {
          let actual = try fn.evaluate(arguments: swiftArgs, context: context)
          if let expectedRaw = testCase["expect"] {
            let expected = ConformanceTestHelper.toJSONValue(expectedRaw)
            #expect(actual == expected, "\(name): got \(actual), expected \(expected)")
          }
        } catch {
          Issue.record("\(name): threw unexpected error \(error)")
        }
      }
    }
  }

  @Test func indexFunctionConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/index_function.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should load test cases from index_function.yaml")

    for testCase in testCases {
      let processor = MessageProcessor(
        catalogs: BasicCatalog.allCatalogs,
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      for step in testCase.steps {
        guard let payload = step.payload else { continue }

        if let expectedError = step.expectError {
          var caughtError: Error?
          do {
            let messages = try ConformanceTestHelper.parsePayload(payload)
            processor.process(messages: messages)
          } catch {
            caughtError = error
          }

          if let caughtError {
            if let expectedMessage = expectedError.message {
              #expect(
                caughtError.localizedDescription.contains(expectedMessage)
                  || "\(caughtError)".contains(expectedMessage)
              )
            }
          }
        } else {
          let messages = try ConformanceTestHelper.parsePayload(payload)
          processor.process(messages: messages)

          if let expectSurfaces = testCase.expect?["surfaces"]?.objectValue {
            for (surfaceID, expectedSurface) in expectSurfaces {
              guard let surface = processor.surfaceGroupModel[surfaceID] else {
                Issue.record("Expected surface '\(surfaceID)' to exist")
                continue
              }

              if let expectedComponents = expectedSurface["components"]?.objectValue {
                for (compID, compExpected) in expectedComponents {
                  let node = surface.findNode(id: compID)
                  if let expectedText = compExpected["text"]?.stringValue {
                    #expect(
                      node?.string(for: "text") == expectedText,
                      "[\(testCase.name)] Expected node \(compID).text == '\(expectedText)', got '\(node?.string(for: "text") ?? "nil")'"
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

  @Test func validationResultConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/validation_result.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should load test cases from validation_result.yaml")

    for testCase in testCases {
      let processor = MessageProcessor(
        catalogs: BasicCatalog.allCatalogs,
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      for step in testCase.steps {
        guard let payload = step.payload else { continue }
        let messages = try ConformanceTestHelper.parsePayload(payload)
        processor.process(messages: messages)
      }

      if let expectSurfaces = testCase.expect?["surfaces"]?.objectValue {
        for (surfaceID, expectedSurface) in expectSurfaces {
          guard let surface = processor.surfaceGroupModel[surfaceID] else {
            Issue.record("Expected surface '\(surfaceID)' to exist")
            continue
          }

          if let expectedVR = expectedSurface["validationResult"]?.objectValue {
            for (nodeID, expectedCheck) in expectedVR {
              let node = surface.findNode(id: nodeID)
              let expectedValid = expectedCheck["valid"]?.boolValue ?? true
              #expect(
                node?.isValid == expectedValid,
                "[\(testCase.name)] Expected node \(nodeID).isValid == \(expectedValid)"
              )

              if let expectedMsg = expectedCheck["message"]?.stringValue {
                #expect(
                  node?.validationErrors.contains(expectedMsg) == true,
                  "[\(testCase.name)] Expected validation errors to contain '\(expectedMsg)'"
                )
              }
            }
          }
        }
      }
    }
  }
}
