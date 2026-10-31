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
import Combine
import Foundation
import OrderedCollections
import OrderedJSON
import Testing

@MainActor
struct DataModelPointerConformanceTests {
  private static let knownPayloadCaseKeys: Set<String> = [
    "action",
    "catalog",
    "expect",
    "steps",
  ]

  private static let knownPayloadStepKeys: Set<String> = [
    "expectError",
    "payload",
  ]

  private static let knownExpectErrorKeys: Set<String> = [
    "category",
    "message",
  ]

  private static let knownDataContextCaseKeys: Set<String> = [
    "action",
    "args",
    "catalog",
    "expect",
  ]

  private static let knownDataContextArgsKeys: Set<String> = [
    "contextPath",
    "path",
  ]

  @Test func dataModelPointersConformance() throws {
    try runPayloadDataModelSuite(filename: "core/data_model_pointers.yaml")
  }

  @Test func dataDeletionConformance() throws {
    try runPayloadDataModelSuite(filename: "core/data_deletion.yaml")
  }

  @Test func dataContextPathResolutionConformance() throws {
    let cases = ConformanceTestHelper.cases("core/data_context.yaml")
    #expect(!cases.isEmpty, "core/data_context.yaml should hold test cases")

    for conformanceCase in cases {
      try ConformanceManifest.run(conformanceCase) {
        try runDataContextCase(conformanceCase.rawDictionary, name: conformanceCase.name)
      }
    }
  }

  private func runDataContextCase(_ testCase: [String: Any], name: String) throws {
    try ConformanceTestHelper.assertKnownKeys(
      testCase,
      Self.knownDataContextCaseKeys,
      "data_context.yaml case '\(name)'"
    )
    let action = testCase["action"] as? String ?? ""
    guard action == "resolve_path" else {
      throw UnknownConformanceKeyError("[\(name)] Unknown data_context.yaml action '\(action)'")
    }
    let args = testCase["args"] as? [String: Any] ?? [:]
    try ConformanceTestHelper.assertKnownKeys(
      args,
      Self.knownDataContextArgsKeys,
      "data_context.yaml args in '\(name)'",
      allowMetadata: false
    )
    let path = args["path"] as? String ?? ""
    let contextPath = (args["contextPath"] as? String) ?? (args["context_path"] as? String)
    let expected = testCase["expect"] as? String ?? ""
    let actual = JSONValue.absolutePath(for: path, in: contextPath)
    #expect(actual == expected, "\(name): got \(actual), expected \(expected)")
  }

  private func runPayloadDataModelSuite(filename: String) throws {
    let cases = ConformanceTestHelper.cases(filename)
    #expect(!cases.isEmpty, "\(filename) should hold test cases")

    for conformanceCase in cases {
      try ConformanceManifest.run(conformanceCase) {
        try runPayloadDataModelCase(
          conformanceCase.rawDictionary,
          name: conformanceCase.name,
          suite: filename
        )
      }
    }
  }

  private func runPayloadDataModelCase(
    _ testCase: [String: Any],
    name: String,
    suite: String
  ) throws {
    try ConformanceTestHelper.assertKnownKeys(
      testCase,
      Self.knownPayloadCaseKeys,
      "\(suite) case '\(name)'"
    )
    let action = testCase["action"] as? String ?? ""
    guard action == "validate" else {
      throw UnknownConformanceKeyError("[\(name)] Unknown \(suite) action '\(action)'")
    }
    let steps = testCase["steps"] as? [[String: Any]] ?? []
    var models: [String: DataModel] = [:]

    for (index, step) in steps.enumerated() {
      try runPayloadStep(step, index: index, models: &models, name: name, suite: suite)
    }

    if let expect = testCase["expect"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expect,
        ["surfaces"],
        "\(suite) expect in '\(name)'",
        allowMetadata: false
      )
      if let surfaces = expect["surfaces"] as? [String: Any] {
        try assertExpectedSurfaceModels(surfaces, models: models, name: name, suite: suite)
      }
    }
  }

  private func runPayloadStep(
    _ step: [String: Any],
    index: Int,
    models: inout [String: DataModel],
    name: String,
    suite: String
  ) throws {
    try ConformanceTestHelper.assertKnownKeys(
      step,
      Self.knownPayloadStepKeys,
      "\(suite) step \(index) in '\(name)'",
      allowMetadata: false
    )
    let payload = step["payload"] as? [[String: Any]] ?? []
    let location = "\(name) step \(index)"

    if let expectError = step["expectError"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expectError,
        Self.knownExpectErrorKeys,
        "\(suite) expectError at \(location)",
        allowMetadata: false
      )
      let expectedSubstring = expectError["message"] as? String
      do {
        try applyPayloadMessages(payload, to: &models)
        Issue.record("\(location): expected DataError, but succeeded")
      } catch let error as A2UIDataError {
        if let expectedSubstring {
          #expect(
            error.message.contains(expectedSubstring),
            "\(location): expected '\(expectedSubstring)', got '\(error.message)'"
          )
        }
      }
      return
    }

    try applyPayloadMessages(payload, to: &models)
  }

  private func applyPayloadMessages(
    _ payload: [[String: Any]],
    to models: inout [String: DataModel]
  ) throws {
    for msg in payload {
      if let createSurface = msg["createSurface"] as? [String: Any] {
        let surfaceID = createSurface["surfaceId"] as? String ?? "s1"
        let initial =
          createSurface["dataModel"].map { ConformanceTestHelper.toJSONValue($0) }
          ?? .object([:])
        models[surfaceID] = DataModel(initial: initial)
      } else if let updateDataModel = msg["updateDataModel"] as? [String: Any] {
        let surfaceID = updateDataModel["surfaceId"] as? String ?? "s1"
        let path = updateDataModel["path"] as? String ?? "/"
        let value = updateDataModel["value"].flatMap { rawValue -> JSONValue? in
          rawValue is NSNull ? nil : ConformanceTestHelper.toJSONValue(rawValue)
        }
        try models[surfaceID]?.setThrowing(path, value: value)
      }
    }
  }

  private func assertExpectedSurfaceModels(
    _ surfaces: [String: Any],
    models: [String: DataModel],
    name: String,
    suite: String
  ) throws {
    for (surfaceID, rawSurfaceExp) in surfaces {
      guard let surfaceExp = rawSurfaceExp as? [String: Any] else { continue }
      try ConformanceTestHelper.assertKnownKeys(
        surfaceExp,
        ["dataModel"],
        "\(suite) expect.surfaces.\(surfaceID) in '\(name)'",
        allowMetadata: false
      )
      guard let expectedDataModel = surfaceExp["dataModel"] else { continue }
      let actual = models[surfaceID]?.get("/")
      let expectedJSON = ConformanceTestHelper.toJSONValue(expectedDataModel)
      #expect(
        actual == expectedJSON,
        "\(name) surface \(surfaceID): got \(String(describing: actual)), expected \(expectedJSON)"
      )
    }
  }
}
