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
import Foundation
import OrderedJSON
import Testing

/// Runs the shared `conformance/core/data_model.yaml` suite.
@MainActor
struct DataModelConformanceTests {
  @Test func dataModelConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/data_model.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/data_model.yaml should hold test cases")

    var executed = 0

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let steps = testCase["steps"] as? [[String: Any]] ?? []

      // `DataModel` can't express these cases yet:
      // https://github.com/a2ui-project/a2ui/issues/2625
      guard testCase["watch"] == nil else { continue }
      guard !steps.contains(where: { $0["expect_error"] != nil }) else { continue }
      executed += 1

      let initial =
        testCase["initial"].map { ConformanceTestHelper.toJSONValue($0) } ?? .object([:])
      let model = DataModel(initial: initial)

      for (index, step) in steps.enumerated() {
        let operation = step["op"] as? String ?? ""
        let path = step["path"] as? String ?? "/"
        let location = "\(name) step \(index) (\(operation) \(path))"

        switch operation {
        case "get":
          let actual = model.get(path)
          if let expected = step["expect"] {
            #expect(
              actual == ConformanceTestHelper.toJSONValue(expected),
              "\(location): got \(actual.map { "\($0)" } ?? "nil")"
            )
          }
          if (step["expect_absent"] as? Bool) == true {
            #expect(
              actual == nil || actual == .null,
              "\(location): expected nothing, got \(actual.map { "\($0)" } ?? "nil")"
            )
          }
          if let expectedType = step["expect_type"] as? String {
            let matches =
              (expectedType == "list" && actual?.arrayValue != nil)
              || (expectedType == "object" && actual?.objectValue != nil)
            #expect(
              matches,
              "\(location): expected a \(expectedType), got \(actual.map { "\($0)" } ?? "nil")"
            )
          }
        case "set":
          model.set(path, value: step["value"].map { ConformanceTestHelper.toJSONValue($0) })
        case "delete":
          model.set(path, value: nil)
        case "dispose":
          break
        default:
          Issue.record("\(location): unknown op")
        }
      }
    }

    #expect(executed > 0, "no case of the suite could be executed")
  }
}
