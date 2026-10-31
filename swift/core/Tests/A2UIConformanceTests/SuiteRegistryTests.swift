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

import Foundation
import Testing

/// Verifies that every `conformance/core/*.yaml` suite and action is registered in
/// `ConformanceTestHelper` and records skipped manifest entries for unsupported suites.
struct SuiteRegistryTests {
  @Test func allCoreSuitesAndActionsAreRegistered() throws {
    let coreDir = ConformanceTestHelper.repoRoot
      .appendingPathComponent("conformance")
      .appendingPathComponent("core")
    let entries = try FileManager.default.contentsOfDirectory(
      at: coreDir,
      includingPropertiesForKeys: nil
    )
    let onDiskSuites = Set(
      entries
        .filter { $0.pathExtension == "yaml" }
        .map { "core/\($0.lastPathComponent)" }
    )
    #expect(!onDiskSuites.isEmpty, "conformance/core should contain YAML suites")

    let supportedSuites = Set(ConformanceTestHelper.coreSuiteActions.keys)
    let unsupportedSuites = Set(ConformanceTestHelper.unsupportedCoreSuites.keys)
    let overlap = supportedSuites.intersection(unsupportedSuites)
    #expect(overlap.isEmpty, "Suites registered as both supported and unsupported: \(overlap)")

    let registeredSuites = supportedSuites.union(unsupportedSuites)
    #expect(
      registeredSuites == onDiskSuites,
      "Registered suites \(registeredSuites.sorted()) != on-disk suites \(onDiskSuites.sorted())"
    )

    try verifySupportedSuiteActions()
    recordUnsupportedSuiteSkips()
  }

  private func verifySupportedSuiteActions() throws {
    for (suite, actionMap) in ConformanceTestHelper.coreSuiteActions.sorted(by: { $0.key < $1.key })
    {
      let cases = ConformanceTestHelper.cases(suite)
      #expect(!cases.isEmpty, "\(suite) should contain at least one test case")
      let actualActions = Set(cases.compactMap { $0.json["action"]?.stringValue })
      let expectedActions = Set(actionMap.keys)
      #expect(
        actualActions == expectedActions,
        "\(suite) actions \(actualActions.sorted()) != registered \(expectedActions.sorted())"
      )
    }
  }

  private func recordUnsupportedSuiteSkips() {
    for (suite, reason) in ConformanceTestHelper.unsupportedCoreSuites.sorted(by: {
      $0.key < $1.key
    }) {
      #expect(!reason.isEmpty, "Unsupported suite \(suite) must provide a skip reason")
      let cases = ConformanceTestHelper.cases(suite)
      #expect(!cases.isEmpty, "Unsupported suite \(suite) should contain test cases")
      for testCase in cases {
        ConformanceManifest.record(testCase, status: .skipped, reason: reason)
      }
    }
    if !ConformanceTiming.isEnabled {
      for testCase in ConformanceTestHelper.cases("core/message_processor_scaling.yaml") {
        ConformanceManifest.record(
          testCase,
          status: .skipped,
          reason: "set A2UI_RUN_TIMING=1 to run timing cases"
        )
      }
    }
  }
}
