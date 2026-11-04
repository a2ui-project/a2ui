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

/// Runs the shared `conformance/core/message_processor_scaling.yaml` suite, which times
/// `MessageProcessor.processMessages` on a payload written at two sizes and compares the median
/// times.
///
/// The cases run only when `A2UI_RUN_TIMING=1`; see ``ConformanceTiming``.
@MainActor
struct MessageProcessorScalingConformanceTests {
  private static let suite = "core/message_processor_scaling.yaml"

  /// Cases the Swift core fails, with the reason, which are skipped.
  ///
  /// `SurfaceViewModel` resolves the whole node tree again after each `updateComponents`, so the
  /// time to resolve a surface arriving in n messages grows with n squared. At the sizes of the
  /// composition case, 1000 and 4000, that dominates; making resolution incremental (#3231) is
  /// expected to remove it.
  static let knownGaps: [String: String] = [
    "test_scaling_process_single_component_messages_composition_v10":
      "the node tree is resolved again after each message (#3231)"
  ]

  private static let knownCaseKeys: Set<String> = [
    "action",
    "args",
    "catalogPaths",
    "max_ratio",
    "operation",
    "payload",
    "protocolVersion",
    "sizes",
  ]

  private static let knownArgsKeys: Set<String> = [
    "validation_config"
  ]

  @Test(.enabled(if: ConformanceTiming.isEnabled, "set A2UI_RUN_TIMING=1 to run timing cases"))
  func messageProcessorScalingConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: Self.suite)
    let rawCases = try #require(rawYAML as? [[String: Any]], "\(Self.suite) should hold a list")
    let cases = ConformanceTestHelper.parseTestCases(from: rawYAML)
    // Cases that don't parse would pair the rest with the wrong raw case.
    try #require(
      cases.count == rawCases.count,
      "\(Self.suite) parsed \(cases.count) of \(rawCases.count) cases"
    )
    #expect(!cases.isEmpty, "\(Self.suite) should hold test cases")
    var executed = 0
    for (rawCase, testCase) in zip(rawCases, cases) {
      if !ConformanceTiming.runsCase(named: testCase.name) {
        ConformanceManifest.record(
          suite: Self.suite,
          name: testCase.name,
          status: .skipped,
          reason: "filtered by A2UI_TIMING_CASE"
        )
        continue
      }
      if try runAndRecordCase(rawCase, testCase) {
        executed += 1
      }
    }
    #expect(executed > 0, "no timing case of \(Self.suite) ran")
  }

  private func runAndRecordCase(
    _ rawCase: [String: Any],
    _ testCase: ConformanceTestCase
  ) throws -> Bool {
    if let reason = Self.knownGaps[testCase.name] {
      print("[\(testCase.name)] skipped: \(reason)")
      ConformanceManifest.record(
        suite: Self.suite,
        name: testCase.name,
        status: .skipped,
        reason: reason
      )
      return false
    }
    do {
      try runCase(rawCase, testCase)
      ConformanceManifest.record(suite: Self.suite, name: testCase.name, status: .passed)
      return true
    } catch {
      ConformanceManifest.record(
        suite: Self.suite,
        name: testCase.name,
        status: .failed,
        reason: String(describing: error)
      )
      throw error
    }
  }

  /// Runs a timing case and asserts its median growth ratio stays within `max_ratio`.
  private func runCase(_ rawCase: [String: Any], _ testCase: ConformanceTestCase) throws {
    let name = testCase.name
    try ConformanceTestHelper.assertKnownKeys(
      rawCase,
      Self.knownCaseKeys,
      "\(Self.suite) case '\(name)'"
    )
    if let argsDict = rawCase["args"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        argsDict,
        Self.knownArgsKeys,
        "\(Self.suite) args in '\(name)'",
        allowMetadata: false
      )
    }
    #expect(testCase.action == "measure_growth", "[\(name)] unknown action")
    #expect(rawCase["operation"] as? String == "process_messages", "[\(name)] unknown operation")
    let template = try #require(rawCase["payload"] as? [Any], "[\(name)] has no payload")
    let sizes = try #require(rawCase["sizes"] as? [Int], "[\(name)] has no sizes")
    try #require(sizes.count == 2, "[\(name)] should name two sizes")
    let maxRatio = try #require(
      (rawCase["max_ratio"] as? Double) ?? (rawCase["max_ratio"] as? Int).map(Double.init),
      "[\(name)] has no max_ratio"
    )
    let catalogs = try ConformanceTestHelper.buildCatalogs(for: testCase)

    // The processor applies a validation config always; "none" leaves it at its default.
    let configName = testCase.args?["validation_config"]?.stringValue
    let config: ValidationConfig?
    switch configName {
    case "none": config = nil
    case "relaxed": config = .relaxed
    default: throw ConformanceTimingError("[\(name)] unknown validation config \(configName ?? "")")
    }

    func process(size: Int) throws -> () throws -> Void {
      let written = try ConformanceTiming.writePayload(template, size: size)
      let payload = try JSONValue.parse(Data(written.utf8))
      return {
        let processor =
          if let config {
            MessageProcessor(catalogs: catalogs, validationConfig: config)
          } else {
            MessageProcessor(catalogs: catalogs)
          }
        try processor.processMessages(payload)
      }
    }

    let result = try ConformanceTiming.compare(
      measured: try process(size: sizes[1]),
      baseline: try process(size: sizes[0])
    )
    let report =
      "[\(name)] median processMessages time at \(sizes[1]): \(result.measured), "
      + "at \(sizes[0]): \(result.baseline), ratio \(result.ratio) (max \(maxRatio))"
    print(report)
    #expect(result.ratio <= maxRatio, "\(report)")
    if result.ratio > maxRatio {
      throw ConformanceTimingError(report)
    }
  }
}
