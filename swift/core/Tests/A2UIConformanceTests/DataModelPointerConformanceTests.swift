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
  @Test func dataModelPointersConformance() throws {
    try runPayloadDataModelSuite(filename: "core/data_model_pointers.yaml")
  }

  @Test func dataDeletionConformance() throws {
    try runPayloadDataModelSuite(filename: "core/data_deletion.yaml")
  }

  @Test func dataContextPathResolutionConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/data_context.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/data_context.yaml should hold test cases")

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let args = testCase["args"] as? [String: Any] ?? [:]
      let path = args["path"] as? String ?? ""
      let contextPath = (args["contextPath"] as? String) ?? (args["context_path"] as? String)
      let expected = testCase["expect"] as? String ?? ""
      let actual = JSONValue.absolutePath(for: path, in: contextPath)
      #expect(actual == expected, "\(name): got \(actual), expected \(expected)")
    }
  }

  private func runPayloadDataModelSuite(filename: String) throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: filename)
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "\(filename) should hold test cases")

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let steps = testCase["steps"] as? [[String: Any]] ?? []
      var models: [String: DataModel] = [:]

      for (index, step) in steps.enumerated() {
        let payload = step["payload"] as? [[String: Any]] ?? []
        let expectError = step["expectError"] as? [String: Any]
        let location = "\(name) step \(index)"

        let applyStep = {
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
              let rawValue = updateDataModel["value"]
              let value: JSONValue?
              if rawValue == nil || rawValue is NSNull {
                value = nil
              } else {
                value = ConformanceTestHelper.toJSONValue(rawValue!)
              }
              try models[surfaceID]?.setThrowing(path, value: value)
            }
          }
        }

        if let expectError {
          let expectedSubstring = expectError["message"] as? String
          do {
            try applyStep()
            Issue.record("\(location): expected DataError, but succeeded")
          } catch let error as A2UIDataError {
            if let expectedSubstring {
              #expect(
                error.message.contains(expectedSubstring),
                "\(location): expected '\(expectedSubstring)', got '\(error.message)'"
              )
            }
          }
          continue
        }

        try applyStep()
      }

      if let expect = testCase["expect"] as? [String: Any],
        let surfaces = expect["surfaces"] as? [String: Any]
      {
        for (surfaceID, rawSurfaceExp) in surfaces {
          guard let surfaceExp = rawSurfaceExp as? [String: Any],
            let expectedDataModel = surfaceExp["dataModel"]
          else { continue }
          let actual = models[surfaceID]?.get("/")
          let expectedJSON = ConformanceTestHelper.toJSONValue(expectedDataModel)
          #expect(
            actual == expectedJSON,
            "\(name) surface \(surfaceID): got \(String(describing: actual)), expected \(expectedJSON)"
          )
        }
      }
    }
  }
}
