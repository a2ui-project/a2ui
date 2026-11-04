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
import A2UISwiftUI
import BasicCatalog
import Foundation
import Testing
import Yams

private final class AdapterIssueTracker: @unchecked Sendable {
  private let lock = NSLock()
  private var _hasRecordedIssue = false
  private var _firstFailureReason: String?

  var hasRecordedIssue: Bool {
    lock.lock()
    defer { lock.unlock() }
    return _hasRecordedIssue
  }

  var firstFailureReason: String? {
    lock.lock()
    defer { lock.unlock() }
    return _firstFailureReason
  }

  func recordIssue(_ issue: Issue) {
    lock.lock()
    defer { lock.unlock() }
    _hasRecordedIssue = true
    if _firstFailureReason == nil {
      _firstFailureReason = String(describing: issue)
    }
  }
}

/// Runs `conformance/core/accessibility.yaml` and `conformance/core/adapter_conformance.yaml`
/// against `A2UISwiftUI.Surface`, `SurfaceViewModel`, and `A2UIAccessibilityModifier`.
@MainActor
struct AdapterConformanceTests {
  /// Adapter conformance cases that depend on runtime features not yet implemented in `A2UICore` /
  /// `A2UISwiftUI`, recorded as expected failures with their root-cause reason.
  private static let expectedAdapterFailures: [String: String] = [
    "progressive_arrival_placeholder_upgrade_in_place":
      "A2UICore.NodeResolver skips unresolved child IDs instead of materializing pending "
      + "placeholder nodes.",
    "fallback_states_unknown_type_and_cyclic_diagnostics":
      "A2UICore.NodeResolver reports UNKNOWN_COMPONENT_TYPE / CYCLIC_REFERENCE but does not "
      + "expose unknown-type or cyclic placeholder nodes on SurfaceViewModel.",
  ]

  private static var conformanceDirectory: URL {
    if let envDir = ProcessInfo.processInfo.environment["A2UI_CONFORMANCE_DIR"], !envDir.isEmpty {
      let url = URL(fileURLWithPath: envDir)
      return url.lastPathComponent == "conformance"
        ? url : url.appendingPathComponent("conformance")
    }
    let repoRoot = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    return repoRoot.appendingPathComponent("conformance")
  }

  private static func loadYAMLCases(_ relativePath: String) throws -> [[String: Any]] {
    let url = conformanceDirectory.appendingPathComponent(relativePath)
    let text = try String(contentsOf: url, encoding: .utf8)
    return (try Yams.load(yaml: text) as? [[String: Any]]) ?? []
  }

  @Test func accessibilityConformanceThroughModifier() throws {
    let suite = "core/accessibility.yaml"
    let cases = try Self.loadYAMLCases(suite)
    #expect(!cases.isEmpty, "core/accessibility.yaml should contain test cases")

    var checkedCount = 0
    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let steps: [[String: Any]]
      if let rawSteps = testCase["steps"] as? [[String: Any]] {
        steps = rawSteps
      } else if let assertions = testCase["assertions"] as? [String: Any] {
        steps = [["assertions": assertions]]
      } else {
        steps = []
      }
      if let skipReason = AdapterHarness.findUnsupportedReason(name, steps: steps) {
        writeManifestRecord(
          AdapterManifestRecord(
            suite: suite,
            caseName: name,
            status: "skipped",
            reason: skipReason
          )
        )
        continue
      }
      let tracker = AdapterIssueTracker()
      withKnownIssue(isIntermittent: true) {
        do {
          try AdapterHarness.assertKnownAccessibilityCase(testCase)
          checkedCount += try runAccessibilityCase(testCase, name: name)
        } catch {
          Issue.record(Comment(rawValue: "\(name): \(error)"))
        }
      } matching: { issue in
        tracker.recordIssue(issue)
        return false
      }
      if let failureReason = tracker.firstFailureReason {
        writeManifestRecord(
          AdapterManifestRecord(
            suite: suite,
            caseName: name,
            status: "failed",
            reason: failureReason
          )
        )
      } else {
        writeManifestRecord(
          AdapterManifestRecord(suite: suite, caseName: name, status: "passed")
        )
      }
    }
    #expect(checkedCount > 0, "accessibility.yaml should verify at least one component")
    AdapterHarness.finishSuite(suite, cases: cases)
  }

  @Test func adapterConformanceSuite() throws {
    let suite = "core/adapter_conformance.yaml"
    let cases = try Self.loadYAMLCases(suite)
    #expect(cases.count == 13, "core/adapter_conformance.yaml should contain 13 test cases")

    var matchedExpectedFailures: Set<String> = []
    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let steps = (testCase["steps"] as? [[String: Any]]) ?? []
      if let skipReason = AdapterHarness.findUnsupportedReason(name, steps: steps) {
        writeManifestRecord(
          AdapterManifestRecord(
            suite: suite,
            caseName: name,
            status: "skipped",
            reason: skipReason
          )
        )
        continue
      }

      do {
        try AdapterHarness.assertKnownAdapterCase(testCase)
      } catch {
        Issue.record(Comment(rawValue: "\(name): \(error)"))
        writeManifestRecord(
          AdapterManifestRecord(
            suite: suite,
            caseName: name,
            status: "failed",
            reason: String(describing: error)
          )
        )
        continue
      }

      if let reason = Self.expectedAdapterFailures[name] {
        matchedExpectedFailures.insert(name)
        let tracker = AdapterIssueTracker()
        withKnownIssue("\(name): \(reason)", isIntermittent: true) {
          do {
            try runAdapterCase(testCase, name: name)
          } catch {
            Issue.record(error)
          }
        } matching: { issue in
          tracker.recordIssue(issue)
          return true
        }
        if tracker.hasRecordedIssue {
          writeManifestRecord(
            AdapterManifestRecord(
              suite: suite,
              caseName: name,
              status: "xfailed",
              reason: reason
            )
          )
        } else {
          let message = "Known issue was not recorded: \(reason)"
          Issue.record(Comment(rawValue: message))
          writeManifestRecord(
            AdapterManifestRecord(
              suite: suite,
              caseName: name,
              status: "failed",
              reason: message
            )
          )
        }
      } else {
        let tracker = AdapterIssueTracker()
        withKnownIssue(isIntermittent: true) {
          do {
            try runAdapterCase(testCase, name: name)
          } catch {
            Issue.record(Comment(rawValue: "\(name): \(error)"))
          }
        } matching: { issue in
          tracker.recordIssue(issue)
          return false
        }
        if let failureReason = tracker.firstFailureReason {
          writeManifestRecord(
            AdapterManifestRecord(
              suite: suite,
              caseName: name,
              status: "failed",
              reason: failureReason
            )
          )
        } else {
          writeManifestRecord(
            AdapterManifestRecord(suite: suite, caseName: name, status: "passed")
          )
        }
      }
    }

    let unusedExpectedFailures = Self.expectedAdapterFailures.keys
      .filter { !matchedExpectedFailures.contains($0) }
      .sorted()
    #expect(
      unusedExpectedFailures.isEmpty,
      "Unused expectedAdapterFailures entries: \(unusedExpectedFailures)"
    )
    AdapterHarness.finishSuite(suite, cases: cases)
  }

  // MARK: - Accessibility Suite Runner

  private func runAccessibilityCase(_ testCase: [String: Any], name: String) throws -> Int {
    let handler = AdapterTestActionHandler()
    let processor = MessageProcessor(
      catalogs: BasicCatalog.allCatalogs,
      actionHandler: handler,
      validationConfig: .relaxed
    )
    let surfaceID = "a11y_surface"
    if let steps = testCase["steps"] as? [[String: Any]] {
      return try runAccessibilitySteps(
        steps,
        processor: processor,
        surfaceID: surfaceID,
        name: name
      )
    }
    if let messages = testCase["messages"] {
      try processor.processMessages(AdapterHarness.toJSONValue(messages))
    }
    let assertions = (testCase["assertions"] as? [String: Any]) ?? testCase
    guard let expected = assertions["accessibilityTree"] as? [String: [String: Any]] else {
      return 0
    }
    return try assertAccessibilityNodes(
      expected,
      processor: processor,
      surfaceID: surfaceID,
      context: name
    )
  }

  private func runAccessibilitySteps(
    _ steps: [[String: Any]],
    processor: MessageProcessor,
    surfaceID: String,
    name: String
  ) throws -> Int {
    var checked = 0
    for (idx, step) in steps.enumerated() {
      if let stepMessages = step["messages"] {
        try processor.processMessages(AdapterHarness.toJSONValue(stepMessages))
      }
      let assertions = (step["assertions"] as? [String: Any]) ?? step
      if let expected = assertions["accessibilityTree"] as? [String: [String: Any]] {
        checked += try assertAccessibilityNodes(
          expected,
          processor: processor,
          surfaceID: surfaceID,
          context: "\(name) [step \(idx)]"
        )
      }
    }
    return checked
  }

  private func assertAccessibilityNodes(
    _ expected: [String: [String: Any]],
    processor: MessageProcessor,
    surfaceID: String,
    context: String
  ) throws -> Int {
    guard
      let viewModel = processor.surfaceGroupModel.surfacesMap[surfaceID]
        ?? processor.surfaceGroupModel.surfacesMap.values.first,
      let rootNode = viewModel.rootNode
    else {
      Issue.record("\(context): missing resolved root node for \(surfaceID)")
      throw AdapterConformanceError("\(context): missing resolved root node for \(surfaceID)")
    }
    var nodesByID: [String: A2UICore.Node] = [:]
    AdapterHarness.collectNodes(from: rootNode, into: &nodesByID)

    var checked = 0
    for (componentID, expectedProps) in expected {
      guard let node = nodesByID[componentID] else {
        Issue.record("\(context): node '\(componentID)' not found")
        throw AdapterConformanceError("\(context): node '\(componentID)' not found")
      }
      let modifier = A2UIAccessibilityModifier(node: node)
      try AdapterHarness.assertModifierMatches(
        modifier,
        node: node,
        expected: expectedProps,
        context: "\(context) [\(componentID)]"
      )
      checked += 1
    }
    return checked
  }

  // MARK: - Adapter Conformance Suite Runner

  private func runAdapterCase(_ testCase: [String: Any], name: String) throws {
    let session = try mountSurface(testCase)
    let steps = (testCase["steps"] as? [[String: Any]]) ?? []
    for (idx, step) in steps.enumerated() {
      let stepCtx = "\(name) [step \(idx)]"
      try AdapterHarness.runStep(session, step, context: stepCtx)
    }
  }
}
