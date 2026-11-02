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
import BasicCatalogSwiftUI
import Foundation
import OrderedJSON
import Testing
import Yams

/// Parameterized test case loaded from `conformance/core/adapter_conformance.yaml`.
struct AdapterCase: CustomTestStringConvertible, Sendable {
  static let suite = "core/adapter_conformance.yaml"
  static let all: [AdapterCase] = AdapterConformanceTests.loadCases(
    from: suite,
    make: AdapterCase.init
  )

  let name: String
  let specJSON: JSONValue

  var testDescription: String { name }

  func makeSpec() -> [String: Any] {
    (AdapterHarness.fromJSONValue(specJSON) as? [String: Any]) ?? [:]
  }
}

/// Parameterized test case loaded from `conformance/core/accessibility.yaml`.
struct AccessibilityCase: CustomTestStringConvertible, Sendable {
  static let suite = "core/accessibility.yaml"
  static let all: [AccessibilityCase] = AdapterConformanceTests.loadCases(
    from: suite,
    make: AccessibilityCase.init
  )

  let name: String
  let specJSON: JSONValue

  var testDescription: String { name }

  func makeSpec() -> [String: Any] {
    (AdapterHarness.fromJSONValue(specJSON) as? [String: Any]) ?? [:]
  }
}

/// Runs `conformance/core/accessibility.yaml` and `conformance/core/adapter_conformance.yaml`
/// against `A2UISwiftUI.Surface`, `SurfaceViewModel`, `HostedViewDriver`, and
/// `A2UIAccessibilityModifier`.
@Suite(.serialized)
@MainActor
struct AdapterConformanceTests {
  /// Adapter conformance cases that depend on runtime features not yet implemented in `A2UICore` /
  /// `A2UISwiftUI`, recorded as expected failures with their root-cause reason.
  private static let expectedAdapterFailures: [String: String] = [
    "progressive_arrival_placeholder_upgrade_in_place":
      "A2UICore.NodeResolver skips unresolved child IDs instead of materializing pending "
      + "placeholder nodes.",
    "fallback_states_unknown_type_and_cyclic_diagnostics":
      "A2UICore.NodeResolver does not expose unknown-type or cyclic placeholder nodes or emit "
      + "UNKNOWN_COMPONENT_TYPE / CYCLIC_REFERENCE diagnostics on SurfaceViewModel.",
  ]

  nonisolated private static var conformanceDirectory: URL {
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

  nonisolated static func loadCases<CaseType>(
    from relativePath: String,
    make: (String, JSONValue) -> CaseType
  ) -> [CaseType] {
    let url = conformanceDirectory.appendingPathComponent(relativePath)
    guard
      let text = try? String(contentsOf: url, encoding: .utf8),
      let rawCases = try? Yams.load(yaml: text) as? [[String: Any]]
    else {
      return []
    }
    return rawCases.map { rawCase in
      let name = rawCase["name"] as? String ?? "<unnamed>"
      return make(name, AdapterHarness.toJSONValue(rawCase))
    }
  }

  @Test(arguments: AccessibilityCase.all)
  func accessibilityCase(_ c: AccessibilityCase) throws {
    let suite = AccessibilityCase.suite
    let name = c.name
    let testCase = c.makeSpec()
    defer {
      AdapterHarness.recordCaseCompleted(
        suite: suite,
        caseName: name,
        expectedTotal: AccessibilityCase.all.count
      )
    }

    do {
      try AdapterHarness.assertKnownAccessibilityCase(testCase)
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
        return
      }
      let checkedCount = try runAccessibilityCase(testCase, name: name)
      #expect(checkedCount > 0, "\(name): should verify at least one accessibility node")
      writeManifestRecord(
        AdapterManifestRecord(suite: suite, caseName: name, status: "passed")
      )
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
      throw error
    }
  }

  @Test(arguments: AdapterCase.all)
  func adapterCase(_ c: AdapterCase) throws {
    let suite = AdapterCase.suite
    let name = c.name
    let testCase = c.makeSpec()
    defer {
      AdapterHarness.recordCaseCompleted(
        suite: suite,
        caseName: name,
        expectedTotal: AdapterCase.all.count
      )
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
      throw error
    }

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
      return
    }

    if let reason = Self.expectedAdapterFailures[name] {
      withKnownIssue("\(name): \(reason)") {
        try runAdapterCase(testCase, name: name)
      }
      writeManifestRecord(
        AdapterManifestRecord(
          suite: suite,
          caseName: name,
          status: "xfailed",
          reason: reason
        )
      )
      return
    }

    do {
      try runAdapterCase(testCase, name: name)
      writeManifestRecord(
        AdapterManifestRecord(suite: suite, caseName: name, status: "passed")
      )
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
      throw error
    }
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
    let driver = HostedViewDriver(
      viewModel: viewModel,
      catalogs: BasicCatalogImplementation.allCatalogs,
      defaultCatalogID: BasicCatalog.catalogURI(version: .v10)
    )
    defer { driver.tearDown() }

    var nodesByID: [String: A2UICore.Node] = [:]
    AdapterHarness.collectNodes(from: rootNode, into: &nodesByID)

    var checked = 0
    for (componentID, expectedProps) in expected {
      guard let node = nodesByID[componentID] else {
        Issue.record("\(context): node '\(componentID)' not found")
        throw AdapterConformanceError("\(context): node '\(componentID)' not found")
      }
      let hostedElement = driver.accessibilityNode(componentID: componentID)
      let modifier = A2UIAccessibilityModifier(node: node)
      try AdapterHarness.assertModifierMatches(
        modifier,
        node: node,
        hostedElement: hostedElement,
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
    defer {
      if session.mountedHarness?.isMounted == true {
        session.mountedHarness?.driver.tearDown()
      }
    }
    let steps = (testCase["steps"] as? [[String: Any]]) ?? []
    for (idx, step) in steps.enumerated() {
      let stepCtx = "\(name) [step \(idx)]"
      try AdapterHarness.runStep(session, step, context: stepCtx)
    }
  }
}
