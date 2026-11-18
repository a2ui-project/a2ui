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

/// Runs the shared `conformance/core/common_types.yaml` suite against `A2UICommonSchema`.
struct CommonTypesConformanceTests {
  private static let knownCaseKeys: Set<String> = [
    "action",
    "definition",
    "protocolVersion",
    "steps",
  ]

  private static let knownStepKeys: Set<String> = [
    "expectError",
    "value",
  ]

  private static let knownExpectErrorKeys: Set<String> = [
    "category",
    "code",
    "details",
    "functionCallId",
    "message",
    "path",
    "rendererError",
    "surfaceId",
  ]

  @Test(arguments: ConformanceTestHelper.cases("core/common_types.yaml"))
  func commonTypesConformance(_ conformanceCase: ConformanceCase) throws {
    let testCase = conformanceCase.rawDictionary
    let action = testCase["action"] as? String ?? ""
    let skippedReason =
      action == "common_types_schema" ? "no schema generation from models" : nil
    try ConformanceManifest.run(conformanceCase, skippedReason: skippedReason) {
      try ConformanceTestHelper.assertKnownKeys(
        testCase,
        Self.knownCaseKeys,
        "common_types.yaml case '\(conformanceCase.name)'"
      )
      guard action == "validate_common_type" else {
        throw UnknownConformanceKeyError("Unknown common_types.yaml action '\(action)'")
      }
      try runValidateCommonTypeCase(testCase, caseName: conformanceCase.name)
    }
  }

  private func runValidateCommonTypeCase(_ testCase: [String: Any], caseName: String) throws {
    guard let definition = testCase["definition"] as? String else {
      Issue.record("[\(caseName)] Missing 'definition' in validate_common_type case")
      return
    }
    guard let steps = testCase["steps"] as? [[String: Any]] else {
      Issue.record("[\(caseName)] Missing 'steps' array in validate_common_type case")
      return
    }

    let rawVersion = testCase["protocolVersion"] as? String ?? "v0.9"
    let isV10 = rawVersion == "1.0" || rawVersion == "v1.0"
    let uri =
      isV10
      ? A2UICommonSchema.v10URI(for: definition)
      : A2UICommonSchema.uri(for: definition)
    let context = Context(dialect: .draft2020_12, remoteSchema: A2UICommonSchema.allSchemas)
    let schema = try Schema(rawSchema: .object(["$ref": .string(uri)]), context: context)

    for (index, step) in steps.enumerated() {
      try ConformanceTestHelper.assertKnownKeys(
        step,
        Self.knownStepKeys,
        "common_types.yaml step[\(index)] in '\(caseName)'",
        allowMetadata: false
      )
      let rawExpectError = step["expectError"] ?? step["expect_error"]
      if let errDict = rawExpectError as? [String: Any] {
        try ConformanceTestHelper.assertKnownKeys(
          errDict,
          Self.knownExpectErrorKeys,
          "common_types.yaml step[\(index)].expectError in '\(caseName)'",
          allowMetadata: false
        )
      }
      let value = ConformanceTestHelper.toJSONValue(step["value"] as Any)
      let validation = schema.validate(value)
      if rawExpectError != nil {
        #expect(
          !validation.isValid,
          "[\(caseName)] step \(index): expected \(definition) to reject \(value)"
        )
      } else {
        #expect(
          validation.isValid,
          "[\(caseName)] step \(index): expected \(definition) to accept \(value)"
        )
      }
    }
  }
}
