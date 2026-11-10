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

/// Runs `conformance/core/accessibility.yaml`, `conformance/core/adapter_conformance.yaml`, and
/// `conformance/adapter/adapter_conformance_v0_9.yaml` against `A2UISwiftUI.Surface`,
/// `SurfaceViewModel`, `HostedViewDriver`, and `A2UIAccessibilityModifier`, once for each
/// ``DriverKind``.
@Suite(.serialized)
@MainActor
struct AdapterConformanceTests {
  /// Parameterized test case loaded from `conformance/core/adapter_conformance.yaml`.
  struct AdapterCase: CustomTestStringConvertible, Sendable {
    nonisolated static let suite = "core/adapter_conformance.yaml"
    nonisolated static let loadedResult: Result<[AdapterCase], Error> = Result {
      try AdapterConformanceTests.loadCases(from: suite, make: AdapterCase.init)
    }
    nonisolated static var all: [AdapterCase] {
      (try? loadedResult.get()) ?? []
    }

    let name: String
    let specJSON: JSONValue

    nonisolated var testDescription: String { name }

    nonisolated func makeSpec() -> [String: Any] {
      (AdapterHarness.fromJSONValue(specJSON) as? [String: Any]) ?? [:]
    }
  }

  /// Parameterized test case loaded from `conformance/adapter/adapter_conformance_v0_9.yaml`.
  struct AdapterCaseV09: CustomTestStringConvertible, Sendable {
    nonisolated static let suite = "adapter/adapter_conformance_v0_9.yaml"
    nonisolated static let loadedResult: Result<[AdapterCaseV09], Error> = Result {
      try AdapterConformanceTests.loadCases(from: suite, make: AdapterCaseV09.init)
    }
    nonisolated static var all: [AdapterCaseV09] {
      (try? loadedResult.get()) ?? []
    }

    let name: String
    let specJSON: JSONValue

    nonisolated var testDescription: String { name }

    nonisolated func makeSpec() -> [String: Any] {
      (AdapterHarness.fromJSONValue(specJSON) as? [String: Any]) ?? [:]
    }
  }

  /// Parameterized test case loaded from `conformance/core/accessibility.yaml`.
  struct AccessibilityCase: CustomTestStringConvertible, Sendable {
    nonisolated static let suite = "core/accessibility.yaml"
    nonisolated static let loadedResult: Result<[AccessibilityCase], Error> = Result {
      try AdapterConformanceTests.loadCases(from: suite, make: AccessibilityCase.init)
    }
    nonisolated static var all: [AccessibilityCase] {
      (try? loadedResult.get()) ?? []
    }

    let name: String
    let specJSON: JSONValue

    nonisolated var testDescription: String { name }

    nonisolated func makeSpec() -> [String: Any] {
      (AdapterHarness.fromJSONValue(specJSON) as? [String: Any]) ?? [:]
    }
  }

  /// How a test drives the surface under test.
  enum DriverKind: CaseIterable {
    /// Drives the resolved nodes of the surface: interactions write through the component
    /// views' bindings and run node actions, and accessibility is read from
    /// `A2UIAccessibilityModifier`.
    case nodeHarness
    /// Hosts the surface in a platform window and drives it through `HostedViewDriver`:
    /// interactions go through the native controls, and accessibility is read from the native
    /// accessibility elements.
    case hostedView

    /// Whether the surface is hosted in a platform window.
    var hostsViews: Bool { self == .hostedView }
  }

  /// Adapter conformance cases that depend on runtime features not yet implemented in `A2UICore` /
  /// `A2UISwiftUI`, recorded as expected failures with their root-cause reason.
  private static let expectedAdapterFailures: [String: String] = [:]

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
  ) throws -> [CaseType] {
    let fileURL = conformanceDirectory.appendingPathComponent(relativePath)
    let yamlText: String
    do {
      yamlText = try String(contentsOf: fileURL, encoding: .utf8)
    } catch {
      throw AdapterHarness.ConformanceError(
        "Failed to read '\(relativePath)' at \(fileURL.path): \(error)"
      )
    }
    let loadedObject: Any?
    do {
      loadedObject = try Yams.load(yaml: yamlText)
    } catch {
      throw AdapterHarness.ConformanceError(
        "Failed to parse YAML in '\(relativePath)': \(error)"
      )
    }
    guard let rawCases = loadedObject as? [[String: Any]], !rawCases.isEmpty else {
      throw AdapterHarness.ConformanceError(
        "Expected non-empty top-level YAML sequence of mappings in '\(relativePath)'"
      )
    }
    return rawCases.map { rawCase in
      let name = rawCase["name"] as? String ?? "<unnamed>"
      return make(name, AdapterHarness.toJSONValue(rawCase))
    }
  }

  @Test func suitesLoadedCleanly() throws {
    let accessibilityCases = try AccessibilityCase.loadedResult.get()
    #expect(!accessibilityCases.isEmpty)
    let adapterCases = try AdapterCase.loadedResult.get()
    #expect(!adapterCases.isEmpty)
    let adapterCasesV09 = try AdapterCaseV09.loadedResult.get()
    #expect(!adapterCasesV09.isEmpty)
  }

  @Test func expectedAdapterFailuresMatchKnownCases() throws {
    let adapterCases = try AdapterCase.loadedResult.get()
    let knownCaseNames = Set(adapterCases.map(\.name))
    let unusedExpectedFailures = Self.expectedAdapterFailures.keys
      .filter { !knownCaseNames.contains($0) }
      .sorted()
    #expect(
      unusedExpectedFailures.isEmpty,
      "Unused expectedAdapterFailures entries: \(unusedExpectedFailures)"
    )
  }

  @Test(arguments: AccessibilityCase.all)
  func accessibilityCase(_ testCase: AccessibilityCase) throws {
    let suite = AccessibilityCase.suite
    let name = testCase.name
    let caseSpec = testCase.makeSpec()
    defer {
      AdapterHarness.recordCaseCompleted(
        suite: suite,
        caseName: name,
        expectedTotal: AccessibilityCase.all.count
      )
    }

    do {
      try AdapterHarness.assertKnownAccessibilityCase(caseSpec)
      let steps: [[String: Any]]
      if let rawSteps = caseSpec["steps"] as? [[String: Any]] {
        steps = rawSteps
      } else if let assertions = caseSpec["assertions"] as? [String: Any] {
        steps = [["assertions": assertions]]
      } else {
        steps = []
      }
      if let skipReason = AdapterHarness.findUnsupportedReason(name, steps: steps) {
        AdapterHarness.writeManifestRecord(
          AdapterHarness.ManifestRecord(
            suite: suite,
            caseName: name,
            status: "skipped",
            reason: skipReason
          )
        )
        return
      }
      for driverKind in DriverKind.allCases {
        let checkedCount = try runAccessibilityCase(
          caseSpec,
          name: name,
          driverKind: driverKind
        )
        #expect(checkedCount > 0, "\(name) [\(driverKind)]: should verify at least one node")
      }
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(suite: suite, caseName: name, status: "passed")
      )
    } catch {
      Issue.record(Comment(rawValue: "\(name): \(error)"))
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(
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
  func adapterCase(_ testCase: AdapterCase) async throws {
    let suite = AdapterCase.suite
    let name = testCase.name
    let caseSpec = testCase.makeSpec()
    defer {
      AdapterHarness.recordCaseCompleted(
        suite: suite,
        caseName: name,
        expectedTotal: AdapterCase.all.count
      )
    }

    do {
      try AdapterHarness.assertKnownAdapterCase(caseSpec)
    } catch {
      Issue.record(Comment(rawValue: "\(name): \(error)"))
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(
          suite: suite,
          caseName: name,
          status: "failed",
          reason: String(describing: error)
        )
      )
      throw error
    }

    let steps = (caseSpec["steps"] as? [[String: Any]]) ?? []
    if let skipReason = AdapterHarness.findUnsupportedReason(name, steps: steps) {
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(
          suite: suite,
          caseName: name,
          status: "skipped",
          reason: skipReason
        )
      )
      return
    }

    if let reason = Self.expectedAdapterFailures[name] {
      for driverKind in DriverKind.allCases {
        await withKnownIssue("\(name) [\(driverKind)]: \(reason)") {
          try await runAdapterCase(caseSpec, name: name, driverKind: driverKind)
        }
      }
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(
          suite: suite,
          caseName: name,
          status: "xfailed",
          reason: reason
        )
      )
      return
    }

    do {
      for driverKind in DriverKind.allCases {
        try await runAdapterCase(caseSpec, name: name, driverKind: driverKind)
      }
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(suite: suite, caseName: name, status: "passed")
      )
    } catch {
      Issue.record(Comment(rawValue: "\(name): \(error)"))
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(
          suite: suite,
          caseName: name,
          status: "failed",
          reason: String(describing: error)
        )
      )
      throw error
    }
  }

  @Test(arguments: AdapterCaseV09.all)
  func adapterCaseV09(_ testCase: AdapterCaseV09) async throws {
    let suite = AdapterCaseV09.suite
    let name = testCase.name
    let caseSpec = testCase.makeSpec()
    defer {
      AdapterHarness.recordCaseCompleted(
        suite: suite,
        caseName: name,
        expectedTotal: AdapterCaseV09.all.count
      )
    }

    do {
      try AdapterHarness.assertKnownAdapterCase(caseSpec)
      let steps: [[String: Any]] = (caseSpec["steps"] as? [[String: Any]]) ?? []
      if let skipReason = AdapterHarness.findUnsupportedReason(name, steps: steps) {
        AdapterHarness.writeManifestRecord(
          AdapterHarness.ManifestRecord(
            suite: suite,
            caseName: name,
            status: "skipped",
            reason: skipReason
          )
        )
        return
      }
      for driverKind in DriverKind.allCases {
        try await runAdapterCase(caseSpec, name: name, driverKind: driverKind)
      }
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(suite: suite, caseName: name, status: "passed")
      )
    } catch {
      Issue.record(Comment(rawValue: "\(name): \(error)"))
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(
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

  private func runAccessibilityCase(
    _ caseSpec: [String: Any],
    name: String,
    driverKind: DriverKind
  ) throws -> Int {
    let handler = AdapterHarness.ActionHandler()
    let processor = MessageProcessor(
      catalogs: BasicCatalog.allCatalogs,
      actionHandler: handler,
      validationConfig: .relaxed
    )
    let surfaceID = "a11y_surface"
    if let steps = caseSpec["steps"] as? [[String: Any]] {
      return try runAccessibilitySteps(
        steps,
        processor: processor,
        surfaceID: surfaceID,
        name: name,
        driverKind: driverKind
      )
    }
    if let messages = caseSpec["messages"] {
      try processor.processMessages(AdapterHarness.toJSONValue(messages))
    }
    let assertions = (caseSpec["assertions"] as? [String: Any]) ?? caseSpec
    guard let expected = assertions["accessibilityTree"] as? [String: [String: Any]] else {
      return 0
    }
    return try assertAccessibilityNodes(
      expected,
      processor: processor,
      surfaceID: surfaceID,
      context: name,
      driverKind: driverKind
    )
  }

  private func runAccessibilitySteps(
    _ steps: [[String: Any]],
    processor: MessageProcessor,
    surfaceID: String,
    name: String,
    driverKind: DriverKind
  ) throws -> Int {
    var checked = 0
    for (stepIndex, step) in steps.enumerated() {
      if let stepMessages = step["messages"] {
        try processor.processMessages(AdapterHarness.toJSONValue(stepMessages))
      }
      let assertions = (step["assertions"] as? [String: Any]) ?? step
      if let expected = assertions["accessibilityTree"] as? [String: [String: Any]] {
        checked += try assertAccessibilityNodes(
          expected,
          processor: processor,
          surfaceID: surfaceID,
          context: "\(name) [step \(stepIndex)]",
          driverKind: driverKind
        )
      }
    }
    return checked
  }

  private func assertAccessibilityNodes(
    _ expected: [String: [String: Any]],
    processor: MessageProcessor,
    surfaceID: String,
    context: String,
    driverKind: DriverKind
  ) throws -> Int {
    guard
      let viewModel = processor.surfaceGroupModel.surfacesMap[surfaceID]
        ?? processor.surfaceGroupModel.surfacesMap.values.first,
      let rootNode = viewModel.rootNode
    else {
      Issue.record("\(context): missing resolved root node for \(surfaceID)")
      throw AdapterHarness.ConformanceError(
        "\(context): missing resolved root node for \(surfaceID)"
      )
    }
    let driver =
      driverKind.hostsViews
      ? HostedViewDriver(
        viewModel: viewModel,
        catalogs: BasicCatalogImplementation.allCatalogs,
        defaultCatalogID: BasicCatalog.catalogURI(version: .v10)
      ) : nil
    defer { driver?.tearDown() }

    var nodesByID: [String: A2UICore.Node] = [:]
    AdapterHarness.collectNodes(from: rootNode, into: &nodesByID)

    var checked = 0
    for (componentID, expectedProps) in expected {
      guard let node = nodesByID[componentID] else {
        Issue.record("\(context): node '\(componentID)' not found")
        throw AdapterHarness.ConformanceError("\(context): node '\(componentID)' not found")
      }
      let hostedElement = driver?.accessibilityNode(componentID: componentID)
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

  private func runAdapterCase(
    _ caseSpec: [String: Any],
    name: String,
    driverKind: DriverKind
  ) async throws {
    let session = try AdapterHarness.mountSurface(caseSpec, hostsViews: driverKind.hostsViews)
    defer {
      if session.mountedHarness?.isMounted == true {
        session.mountedHarness?.driver?.tearDown()
      }
    }
    let steps = (caseSpec["steps"] as? [[String: Any]]) ?? []
    for (stepIndex, step) in steps.enumerated() {
      let stepContext = "\(name) [\(driverKind), step \(stepIndex)]"
      try await AdapterHarness.runStepAsync(session, step, context: stepContext)
    }
  }
}
