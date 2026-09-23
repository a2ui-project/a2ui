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
#if canImport(Combine)
import Combine
#endif
import Foundation
import OrderedJSON
import Testing

/// Runs the shared `conformance/core/data_model.yaml` and `conformance/core/data_deletion.yaml` suites.
@MainActor
struct DataModelConformanceTests {
  @MainActor
  private final class Observer {
    let path: String
    var changeCount = 0
    var currentValue: JSONValue?
    #if canImport(Combine)
    private var cancellable: AnyCancellable?
    #endif

    init(model: DataModel, path: String) throws {
      self.path = path
      self.currentValue = model.get(path)
      #if canImport(Combine)
      self.cancellable = try model.watch(path) { [weak self] newValue in
        self?.changeCount += 1
        self?.currentValue = newValue
      }
      #endif
    }
  }

  @Test func dataModelConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/data_model.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/data_model.yaml should hold test cases")

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let steps = testCase["steps"] as? [[String: Any]] ?? []

      let initial =
        testCase["initial"].map { ConformanceTestHelper.toJSONValue($0) } ?? .object([:])
      let model = DataModel(initial: initial)

      var observers: [Observer] = []
      if let watchPaths = testCase["watch"] as? [String] {
        for watchPath in watchPaths {
          observers.append(try Observer(model: model, path: watchPath))
        }
      }

      for (index, step) in steps.enumerated() {
        for observer in observers {
          observer.changeCount = 0
        }

        let operation = step["op"] as? String ?? ""
        let path = step["path"] as? String ?? "/"
        let location = "\(name) step \(index) (\(operation) \(path))"

        if let expectError = step["expect_error"] as? [String: Any] {
          let expectedSubstring = expectError["message"] as? String
          do {
            try applyOp(model: model, step: step, location: location)
            Issue.record("\(location): expected DataError, but succeeded")
          } catch let error as A2UIDataError {
            if let expectedSubstring {
              #expect(
                error.message.contains(expectedSubstring),
                "\(location): expected error containing '\(expectedSubstring)', got '\(error.message)'"
              )
            }
          } catch {
            Issue.record("\(location): expected A2UIDataError, got \(error)")
          }
          continue
        }

        try applyOp(model: model, step: step, location: location)

        if let expectedNotified = step["expect_notified"] as? [String] {
          var actualNotified: [String] = []
          for observer in observers where observer.changeCount > 0 {
            for _ in 0..<observer.changeCount {
              actualNotified.append(observer.path)
            }
          }
          #expect(
            actualNotified.sorted() == expectedNotified.sorted(),
            "\(location): notified \(actualNotified), expected \(expectedNotified)"
          )
        }

        if let expectedValues = step["expect_values"] as? [String: Any] {
          for (watchedPath, rawExpected) in expectedValues {
            guard let observer = observers.first(where: { $0.path == watchedPath }) else {
              Issue.record("\(location): \(watchedPath) is not watched")
              continue
            }
            let expectedVal = ConformanceTestHelper.toJSONValue(rawExpected)
            #expect(
              observer.currentValue == expectedVal,
              "\(location) (\(watchedPath)): got \(String(describing: observer.currentValue)), expected \(expectedVal)"
            )
          }
        }
      }
    }
  }

  private func applyOp(
    model: DataModel,
    step: [String: Any],
    location: String
  ) throws {
    let operation = step["op"] as? String ?? ""
    let path = step["path"] as? String ?? "/"

    switch operation {
    case "get":
      let actual = try model.getThrowing(path)
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
      let val =
        step.keys.contains("value")
        ? step["value"].map { ConformanceTestHelper.toJSONValue($0) }
        : nil
      try model.setThrowing(path, value: val)
    case "delete":
      try model.setThrowing(path, value: nil)
    case "dispose":
      model.dispose()
    default:
      Issue.record("\(location): unknown op")
    }
  }

  @Test func dataDeletionConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/data_deletion.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should load test cases from data_deletion.yaml")

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
          if let expectedDataModel = expectedSurface["dataModel"] {
            let actualDataModel = processor.getRendererDataModel(surfaceID: surfaceID)
            #expect(
              actualDataModel == expectedDataModel,
              "[\(testCase.name)] Data model for \(surfaceID) did not match expected"
            )
          }
        }
      }
    }
  }
}
