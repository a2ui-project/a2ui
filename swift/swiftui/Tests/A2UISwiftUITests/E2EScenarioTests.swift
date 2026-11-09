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

/// Replays end-to-end golden-transcript scenarios under `conformance/e2e/**/*.yaml`
/// through `MessageProcessor`, `A2UISwiftUI.Surface`, `HostedViewDriver`, and `AdapterHarness`.
@Suite(.serialized)
@MainActor
struct E2EScenarioTests {
  /// Parameterized E2E scenario test case loaded from `conformance/e2e/**/*.yaml`.
  struct ScenarioCase: CustomTestStringConvertible, Sendable {
    nonisolated static let all: [ScenarioCase] = E2EScenarioTests.loadScenarios()

    let suite: String
    let name: String
    let specJSON: JSONValue

    nonisolated var testDescription: String { name }

    nonisolated func makeSpec() -> [String: Any] {
      (AdapterHarness.fromJSONValue(specJSON) as? [String: Any]) ?? [:]
    }
  }

  nonisolated static var scenarios: [ScenarioCase] { ScenarioCase.all }

  /// Reasoned expected failures keyed by scenario `name`.
  private static let expectedScenarioFailures: [String: String] = [:]

  private static let e2eScenarioKnownKeys: Set<String> = [
    "name",
    "description",
    "action",
    "protocolVersion",
    "catalogPaths",
    "formats",
    "source",
    "turns",
  ]

  private static let e2eSourceKnownKeys: Set<String> = [
    "kind",
    "from",
    "model",
    "recordedAt",
  ]

  private static let e2eTurnKnownKeys: Set<String> = [
    "userText",
    "modelChunks",
    "expectWire",
    "expectViewTree",
    "expectErrors",
    "uiOps",
    "expectDataModel",
    "expectOutbound",
  ]

  private static let e2eUiOpKnownKeys: Set<String> = [
    "op",
    "surfaceId",
    "targetNode",
    "inputValue",
    "userActivation",
  ]

  private static let e2eViewNodeKnownKeys: Set<String> = AdapterHarness.viewNodeKnownKeys.union([
    "label",
    "disabled",
  ])

  nonisolated private static var conformanceDirectory: URL {
    if let environmentDirectory = ProcessInfo.processInfo.environment["A2UI_CONFORMANCE_DIR"],
      !environmentDirectory.isEmpty
    {
      let url = URL(fileURLWithPath: environmentDirectory)
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

  nonisolated static func loadScenarios() -> [ScenarioCase] {
    let e2eURL = conformanceDirectory.appendingPathComponent("e2e")
    guard
      let enumerator = FileManager.default.enumerator(
        at: e2eURL,
        includingPropertiesForKeys: [.isRegularFileKey],
        options: [.skipsHiddenFiles]
      )
    else {
      return []
    }
    var yamlURLs: [URL] = []
    for case let fileURL as URL in enumerator where fileURL.pathExtension == "yaml" {
      yamlURLs.append(fileURL)
    }
    yamlURLs.sort { $0.path < $1.path }

    let basePath = conformanceDirectory.standardizedFileURL.path
    var loaded: [ScenarioCase] = []
    for fileURL in yamlURLs {
      let fullPath = fileURL.standardizedFileURL.path
      let relativeSuite = String(fullPath.dropFirst(basePath.count + 1))
        .replacingOccurrences(of: "\\", with: "/")
      guard
        let text = try? String(contentsOf: fileURL, encoding: .utf8),
        let rawCases = try? Yams.load(yaml: text) as? [[String: Any]]
      else {
        continue
      }
      for rawCase in rawCases {
        let name = rawCase["name"] as? String ?? "<unnamed>"
        loaded.append(
          ScenarioCase(
            suite: relativeSuite,
            name: name,
            specJSON: AdapterHarness.toJSONValue(rawCase)
          )
        )
      }
    }
    return loaded
  }

  @Test(arguments: ScenarioCase.all)
  func e2eScenario(_ scenarioCase: ScenarioCase) throws {
    let suite = scenarioCase.suite
    let name = scenarioCase.name
    let scenario = scenarioCase.makeSpec()
    let knownScenarioNames = Set(Self.scenarios.map(\.name))
    let unusedExpectedFailures = Self.expectedScenarioFailures.keys
      .filter { !knownScenarioNames.contains($0) }
      .sorted()
    #expect(
      unusedExpectedFailures.isEmpty,
      "Unused expectedScenarioFailures entries: \(unusedExpectedFailures)"
    )

    do {
      try Self.assertKnownScenario(scenario)
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

    if let skipReason = AdapterHarness.findUnsupportedReason(name) {
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

    if let reason = Self.expectedScenarioFailures[name] {
      withKnownIssue("\(name): \(reason)") {
        try runScenario(scenario, name: name)
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
      try runScenario(scenario, name: name)
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(
          suite: suite,
          caseName: name,
          status: "passed"
        )
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

  // MARK: - Scenario Validation & Execution

  private static func assertKnownE2EViewNode(
    _ node: [String: Any],
    where location: String
  ) throws {
    try AdapterHarness.assertKnownKeys(
      node,
      allowed: e2eViewNodeKnownKeys,
      where: location
    )
    if let results = node["validationResults"] as? [[String: Any]] {
      for (index, item) in results.enumerated() {
        try AdapterHarness.assertKnownKeys(
          item,
          allowed: AdapterHarness.validationResultKnownKeys,
          where: "\(location).validationResults[\(index)]"
        )
      }
    }
    if let children = node["children"] as? [[String: Any]] {
      for (index, child) in children.enumerated() {
        try assertKnownE2EViewNode(child, where: "\(location).children[\(index)]")
      }
    }
  }

  private static func assertKnownScenario(_ scenario: [String: Any]) throws {
    let name = scenario["name"] as? String ?? "<unnamed>"
    try AdapterHarness.assertKnownKeys(
      scenario,
      allowed: e2eScenarioKnownKeys,
      where: "scenario(\(name))"
    )
    guard (scenario["action"] as? String) == "e2e_scenario" else {
      let message =
        "scenario(\(name)): unsupported action \(String(describing: scenario["action"]))"
      Issue.record(Comment(rawValue: message))
      throw AdapterHarness.ConformanceError(message)
    }
    if let source = scenario["source"] as? [String: Any] {
      try AdapterHarness.assertKnownKeys(
        source,
        allowed: e2eSourceKnownKeys,
        where: "scenario(\(name)).source"
      )
    }
    guard let turns = scenario["turns"] as? [[String: Any]], !turns.isEmpty else {
      let message = "scenario(\(name)): turns must be a non-empty array"
      Issue.record(Comment(rawValue: message))
      throw AdapterHarness.ConformanceError(message)
    }
    for (turnIndex, turn) in turns.enumerated() {
      try AdapterHarness.assertKnownKeys(
        turn,
        allowed: e2eTurnKnownKeys,
        where: "scenario(\(name)).turns[\(turnIndex)]"
      )
      if let viewTrees = turn["expectViewTree"] as? [String: Any] {
        for (surfaceID, rawTree) in viewTrees {
          if let tree = rawTree as? [String: Any] {
            try assertKnownE2EViewNode(
              tree,
              where: "scenario(\(name)).turns[\(turnIndex)].expectViewTree.\(surfaceID)"
            )
          }
        }
      }
      if let expectedErrors = turn["expectErrors"] as? [[String: Any]] {
        for (errorIndex, expectedError) in expectedErrors.enumerated() {
          try AdapterHarness.assertKnownKeys(
            expectedError,
            allowed: AdapterHarness.expectedErrorKnownKeys,
            where: "scenario(\(name)).turns[\(turnIndex)].expectErrors[\(errorIndex)]"
          )
        }
      }
      if let uiOps = turn["uiOps"] as? [[String: Any]] {
        for (operationIndex, uiOp) in uiOps.enumerated() {
          try AdapterHarness.assertKnownKeys(
            uiOp,
            allowed: e2eUiOpKnownKeys,
            where: "scenario(\(name)).turns[\(turnIndex)].uiOps[\(operationIndex)]"
          )
        }
      }
    }
  }

  private static func stripExtendedViewNodeKeys(_ expected: [String: Any]) -> [String: Any] {
    var result: [String: Any] = [:]
    for (key, value) in expected {
      if key == "children", let children = value as? [[String: Any]] {
        result["children"] = children.map { stripExtendedViewNodeKeys($0) }
      } else if AdapterHarness.viewNodeKnownKeys.contains(key) {
        result[key] = value
      }
    }
    return result
  }

  private static func assertExtendedViewNodeProps(
    _ actual: AdapterHarness.ViewNode?,
    expected: [String: Any],
    context: String
  ) throws {
    guard let viewNode = actual, let node = viewNode.node else { return }
    if let expectedLabel = expected["label"] as? String {
      let actualLabel = node.string(for: "label")
      #expect(actualLabel == expectedLabel, "\(context): label mismatch")
      if actualLabel != expectedLabel {
        throw AdapterHarness.ConformanceError("\(context): label mismatch")
      }
    }
    if let expectedDisabled = expected["disabled"] as? Bool {
      let actualDisabled = node.bool(for: "disabled") ?? false
      #expect(actualDisabled == expectedDisabled, "\(context): disabled mismatch")
      if actualDisabled != expectedDisabled {
        throw AdapterHarness.ConformanceError("\(context): disabled mismatch")
      }
    }
    if let expectedChildren = expected["children"] as? [[String: Any]] {
      for (index, expectedChild) in zip(viewNode.children.indices, expectedChildren) {
        try assertExtendedViewNodeProps(
          viewNode.children[index],
          expected: expectedChild,
          context: "\(context)/children/\(index)"
        )
      }
    }
  }

  private func selectSurface(
    _ surfaceID: String,
    session: AdapterHarness.Session,
    mountedBySurfaceID: inout [String: AdapterHarness.MountedSurface],
    context: String
  ) throws {
    guard let viewModel = session.processor.surfaceGroupModel.surfacesMap[surfaceID] else {
      let message = "\(context): missing surface '\(surfaceID)'"
      Issue.record(Comment(rawValue: message))
      throw AdapterHarness.ConformanceError(message)
    }
    if let existing = mountedBySurfaceID[surfaceID], existing.surface.viewModel === viewModel {
      session.mountedHarness = existing
      existing.driver?.flush()
      session.currentTree = try AdapterHarness.extractViewTree(session)
      return
    }
    let isV09 =
      session.protocolVersion.hasPrefix("v0.9") || session.protocolVersion.hasPrefix("0.9")
    let defaultCatalogID = BasicCatalog.catalogURI(version: isV09 ? .v09 : .v10)
    let surface = Surface(
      viewModel: viewModel,
      catalogs: session.uiCatalogs,
      defaultCatalogID: defaultCatalogID
    )
    let harness = AdapterHarness.MountedSurface(surface: surface, hostsViews: session.hostsViews)
    mountedBySurfaceID[surfaceID] = harness
    session.mountedHarness = harness
    session.currentTree = try AdapterHarness.extractViewTree(session)
  }

  private func runScenario(_ scenario: [String: Any], name: String) throws {
    let session = try AdapterHarness.mountSurface(scenario)
    var mountedBySurfaceID: [String: AdapterHarness.MountedSurface] = [:]
    defer {
      var tornDown: Set<ObjectIdentifier> = []
      if let active = session.mountedHarness {
        tornDown.insert(ObjectIdentifier(active))
        active.driver?.tearDown()
      }
      for harness in mountedBySurfaceID.values {
        if tornDown.insert(ObjectIdentifier(harness)).inserted {
          harness.driver?.tearDown()
        }
      }
    }

    let turns = (scenario["turns"] as? [[String: Any]]) ?? []
    for (turnIndex, turn) in turns.enumerated() {
      let turnContext = "\(name) [turn \(turnIndex)]"
      var turnOutbound: [[String: Any]] = []
      var turnErrors: [(error: RendererError, surfaceID: String)] = []

      let expectedWire = (turn["expectWire"] as? [[String: Any]]) ?? []
      for (partIndex, part) in expectedWire.enumerated() {
        guard let messages = part["a2ui"] as? [[String: Any]] else { continue }
        do {
          try AdapterHarness.runStep(
            session,
            ["op": "process_messages", "messages": messages],
            context: "\(turnContext) [wire \(partIndex)]"
          )
        } catch is A2UIError {
          // Rejected messages emit an outbound error envelope checked below.
        }
        if let mounted = session.mountedHarness {
          for (surfaceID, viewModel) in session.processor.surfaceGroupModel.surfacesMap
          where mounted.surface.viewModel === viewModel {
            mountedBySurfaceID[surfaceID] = mounted
          }
        }
        turnOutbound.append(contentsOf: session.handler.outbound)
        turnErrors.append(contentsOf: session.handler.errors)
      }

      if let viewTrees = turn["expectViewTree"] as? [String: Any] {
        for (surfaceID, rawTree) in viewTrees {
          if rawTree is NSNull {
            let exists = session.processor.surfaceGroupModel.surfacesMap[surfaceID] != nil
            #expect(!exists, "\(turnContext): expected surface '\(surfaceID)' to be absent")
            if exists {
              throw AdapterHarness.ConformanceError(
                "\(turnContext): expected surface '\(surfaceID)' to be absent"
              )
            }
          } else if let expectedTree = rawTree as? [String: Any] {
            try selectSurface(
              surfaceID,
              session: session,
              mountedBySurfaceID: &mountedBySurfaceID,
              context: turnContext
            )
            let actualTree = try AdapterHarness.extractViewTree(session)
            try AdapterHarness.assertViewTree(
              actualTree,
              Self.stripExtendedViewNodeKeys(expectedTree),
              context: "\(turnContext) [\(surfaceID)]"
            )
            try Self.assertExtendedViewNodeProps(
              actualTree,
              expected: expectedTree,
              context: "\(turnContext) [\(surfaceID)]"
            )
          }
        }
      }

      if let uiOps = turn["uiOps"] as? [[String: Any]] {
        for (operationIndex, uiOp) in uiOps.enumerated() {
          guard let surfaceID = uiOp["surfaceId"] as? String else {
            throw AdapterHarness.ConformanceError(
              "\(turnContext) [uiOp \(operationIndex)]: missing surfaceId"
            )
          }
          try selectSurface(
            surfaceID,
            session: session,
            mountedBySurfaceID: &mountedBySurfaceID,
            context: "\(turnContext) [uiOp \(operationIndex)]"
          )
          var step = uiOp
          step.removeValue(forKey: "surfaceId")
          try AdapterHarness.runStep(
            session,
            step,
            context: "\(turnContext) [uiOp \(operationIndex)]"
          )
          turnOutbound.append(contentsOf: session.handler.outbound)
          turnErrors.append(contentsOf: session.handler.errors)
        }
      }

      if let expectedDataModels = turn["expectDataModel"] as? [String: Any] {
        for (surfaceID, expectedData) in expectedDataModels {
          guard let viewModel = session.processor.surfaceGroupModel.surfacesMap[surfaceID] else {
            throw AdapterHarness.ConformanceError("\(turnContext): missing surface '\(surfaceID)'")
          }
          let expectedJSON = AdapterHarness.toJSONValue(expectedData)
          #expect(
            viewModel.dataModel.data == expectedJSON,
            "\(turnContext) [\(surfaceID)]: dataModel"
          )
          if viewModel.dataModel.data != expectedJSON {
            throw AdapterHarness.ConformanceError(
              "\(turnContext) [\(surfaceID)]: dataModel mismatch"
            )
          }
        }
      }

      if let expectedErrors = turn["expectErrors"] as? [[String: Any]] {
        try AdapterHarness.assertErrorsMatch(
          turnErrors,
          expected: expectedErrors,
          context: turnContext
        )
      }
      try AdapterHarness.validateOutboundEnvelopes(
        turnOutbound,
        protocolVersion: session.protocolVersion,
        context: turnContext
      )
      if let expectedOutbound = turn["expectOutbound"] as? [[String: Any]] {
        try AdapterHarness.assertOutboundMatches(
          turnOutbound,
          expected: expectedOutbound,
          context: turnContext
        )
      }
    }
  }
}
