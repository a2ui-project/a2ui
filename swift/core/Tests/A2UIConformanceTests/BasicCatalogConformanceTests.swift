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
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    nil
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

      let expectError = (testCase["expectError"] ?? testCase["expect_error"]) as? [String: Any]
      if expectError != nil {
        do {
          _ = try fn.evaluate(arguments: swiftArgs, context: context)
          Issue.record("\(name): expected error but succeeded")
        } catch {
          // Expected error
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
}
