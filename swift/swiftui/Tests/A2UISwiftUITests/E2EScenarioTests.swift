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

/// Parameterized E2E scenario test case loaded from `conformance/e2e/**/*.yaml`.
struct E2EScenarioCase: CustomTestStringConvertible, Sendable {
  let suite: String
  let name: String
  let specJSON: JSONValue

  var testDescription: String { name }

  func makeSpec() -> [String: Any] {
    (AdapterHarness.fromJSONValue(specJSON) as? [String: Any]) ?? [:]
  }
}

/// Replays end-to-end golden-transcript scenarios under `conformance/e2e/**/*.yaml`
/// through `MessageProcessor`, `A2UISwiftUI.Surface`, `HostedViewDriver`, and `AdapterHarness`.
@Suite(.serialized)
@MainActor
struct E2EScenarioTests {
  static let scenarios: [E2EScenarioCase] = loadScenarios()

  /// Reasoned expected failures keyed by scenario `name`.
  private static let expectedScenarioFailures: [String: String] = [:]

  private static let e2eScenarioKnownKeys: Set<String> = [
    "name",
    "description",
    "features",
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

  nonisolated private static func loadScenarios() -> [E2EScenarioCase] {
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
    var loaded: [E2EScenarioCase] = []
    for fileURL in yamlURLs {
      let fullPath = fileURL.standardizedFileURL.path
      let relSuite = String(fullPath.dropFirst(basePath.count + 1))
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
          E2EScenarioCase(
            suite: relSuite,
            name: name,
            specJSON: AdapterHarness.toJSONValue(rawCase)
          )
        )
      }
    }
    return loaded
  }

  @Test(arguments: E2EScenarioTests.scenarios)
  func e2eScenario(_ c: E2EScenarioCase) throws {
    let suite = c.suite
    let name = c.name
    let scenario = c.makeSpec()
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
      writeManifestRecord(
        AdapterManifestRecord(
          harness: "swiftui",
          suite: suite,
          caseName: name,
          status: "failed",
          reason: String(describing: error)
        )
      )
      throw error
    }

    if let skipReason = AdapterHarness.findUnsupportedReason(name) {
      writeManifestRecord(
        AdapterManifestRecord(
          harness: "swiftui",
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
      writeManifestRecord(
        AdapterManifestRecord(
          harness: "swiftui",
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
      writeManifestRecord(
        AdapterManifestRecord(
          harness: "swiftui",
          suite: suite,
          caseName: name,
          status: "passed"
        )
      )
    } catch {
      Issue.record(Comment(rawValue: "\(name): \(error)"))
      writeManifestRecord(
        AdapterManifestRecord(
          harness: "swiftui",
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
      for (idx, item) in results.enumerated() {
        try AdapterHarness.assertKnownKeys(
          item,
          allowed: AdapterHarness.validationResultKnownKeys,
          where: "\(location).validationResults[\(idx)]"
        )
      }
    }
    if let children = node["children"] as? [[String: Any]] {
      for (idx, child) in children.enumerated() {
        try assertKnownE2EViewNode(child, where: "\(location).children[\(idx)]")
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
      let msg = "scenario(\(name)): unsupported action \(String(describing: scenario["action"]))"
      Issue.record(Comment(rawValue: msg))
      throw AdapterConformanceError(msg)
    }
    if let source = scenario["source"] as? [String: Any] {
      try AdapterHarness.assertKnownKeys(
        source,
        allowed: e2eSourceKnownKeys,
        where: "scenario(\(name)).source"
      )
    }
    guard let turns = scenario["turns"] as? [[String: Any]], !turns.isEmpty else {
      let msg = "scenario(\(name)): turns must be a non-empty array"
      Issue.record(Comment(rawValue: msg))
      throw AdapterConformanceError(msg)
    }
    for (turnIdx, turn) in turns.enumerated() {
      try AdapterHarness.assertKnownKeys(
        turn,
        allowed: e2eTurnKnownKeys,
        where: "scenario(\(name)).turns[\(turnIdx)]"
      )
      if let viewTrees = turn["expectViewTree"] as? [String: Any] {
        for (surfaceID, rawTree) in viewTrees {
          if let tree = rawTree as? [String: Any] {
            try assertKnownE2EViewNode(
              tree,
              where: "scenario(\(name)).turns[\(turnIdx)].expectViewTree.\(surfaceID)"
            )
          }
        }
      }
      if let uiOps = turn["uiOps"] as? [[String: Any]] {
        for (opIdx, uiOp) in uiOps.enumerated() {
          try AdapterHarness.assertKnownKeys(
            uiOp,
            allowed: e2eUiOpKnownKeys,
            where: "scenario(\(name)).turns[\(turnIdx)].uiOps[\(opIdx)]"
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
    _ actual: AdapterViewNode?,
    expected: [String: Any],
    context: String
  ) throws {
    guard let viewNode = actual, let node = viewNode.node else { return }
    if let expLabel = expected["label"] as? String {
      let actualLabel = node.string(for: "label")
      #expect(actualLabel == expLabel, "\(context): label mismatch")
      if actualLabel != expLabel {
        throw AdapterConformanceError("\(context): label mismatch")
      }
    }
    if let expDisabled = expected["disabled"] as? Bool {
      let actualDisabled = node.bool(for: "disabled") ?? false
      #expect(actualDisabled == expDisabled, "\(context): disabled mismatch")
      if actualDisabled != expDisabled {
        throw AdapterConformanceError("\(context): disabled mismatch")
      }
    }
    if let expChildren = expected["children"] as? [[String: Any]] {
      for (idx, expChild) in expChildren.enumerated() where idx < viewNode.children.count {
        try assertExtendedViewNodeProps(
          viewNode.children[idx],
          expected: expChild,
          context: "\(context)/children/\(idx)"
        )
      }
    }
  }

  private static func captureOutbound(_ session: AdapterSession) -> [[String: Any]] {
    session.handler.outbound
  }

  private static func isMatchAny(_ value: Any) -> Bool {
    guard let dict = value as? [String: Any], dict.count == 1 else { return false }
    return (dict["$match"] as? String) == "any"
  }

  private static func assertMatchesOutbound(
    _ actual: Any,
    expected: Any,
    where location: String
  ) throws {
    if isMatchAny(expected) {
      let isNonNull = !(actual is NSNull)
      #expect(isNonNull, "\(location): expected non-null value for {$match: \"any\"}")
      if !isNonNull {
        throw AdapterConformanceError("\(location): expected non-null value")
      }
      return
    }
    if let expArray = expected as? [Any] {
      guard let actArray = actual as? [Any], actArray.count == expArray.count else {
        let msg = "\(location): array length mismatch"
        Issue.record(Comment(rawValue: msg))
        throw AdapterConformanceError(msg)
      }
      for idx in 0..<expArray.count {
        try assertMatchesOutbound(
          actArray[idx],
          expected: expArray[idx],
          where: "\(location)[\(idx)]"
        )
      }
      return
    }
    if let expDict = expected as? [String: Any] {
      guard let actDict = actual as? [String: Any] else {
        let msg = "\(location): expected object"
        Issue.record(Comment(rawValue: msg))
        throw AdapterConformanceError(msg)
      }
      let actKeys = actDict.keys.sorted()
      let expKeys = expDict.keys.sorted()
      #expect(actKeys == expKeys, "\(location): keys mismatch")
      if actKeys != expKeys {
        throw AdapterConformanceError("\(location): keys mismatch \(actKeys) vs \(expKeys)")
      }
      for key in expKeys {
        try assertMatchesOutbound(
          actDict[key] as Any,
          expected: expDict[key] as Any,
          where: "\(location).\(key)"
        )
      }
      return
    }
    let actJSON = AdapterHarness.toJSONValue(actual)
    let expJSON = AdapterHarness.toJSONValue(expected)
    #expect(actJSON == expJSON, "\(location): value mismatch")
    if actJSON != expJSON {
      throw AdapterConformanceError("\(location): value mismatch \(actJSON) vs \(expJSON)")
    }
  }

  private static func assertOutbound(
    _ actual: [[String: Any]],
    expected: [[String: Any]],
    context: String
  ) throws {
    #expect(actual.count == expected.count, "\(context): expectOutbound count mismatch")
    if actual.count != expected.count {
      throw AdapterConformanceError(
        "\(context): expectOutbound count mismatch (\(actual.count) vs \(expected.count))"
      )
    }
    for (idx, exp) in expected.enumerated() where idx < actual.count {
      try assertMatchesOutbound(
        actual[idx],
        expected: exp,
        where: "\(context).expectOutbound[\(idx)]"
      )
    }
  }

  private func selectSurface(
    _ surfaceID: String,
    session: AdapterSession,
    mountedBySurfaceID: inout [String: MountedSurfaceHarness],
    context: String
  ) throws {
    guard let vm = session.processor.surfaceGroupModel.surfacesMap[surfaceID] else {
      let msg = "\(context): missing surface '\(surfaceID)'"
      Issue.record(Comment(rawValue: msg))
      throw AdapterConformanceError(msg)
    }
    if let existing = mountedBySurfaceID[surfaceID], existing.surface.viewModel === vm {
      session.mountedHarness = existing
      existing.driver.flush()
      session.currentTree = extractViewTree(session)
      return
    }
    let isV09 =
      session.protocolVersion.hasPrefix("v0.9") || session.protocolVersion.hasPrefix("0.9")
    let defaultCatalogID = BasicCatalog.catalogURI(version: isV09 ? .v09 : .v10)
    let surface = Surface(
      viewModel: vm,
      catalogs: session.uiCatalogs,
      defaultCatalogID: defaultCatalogID
    )
    let harness = MountedSurfaceHarness(surface: surface)
    mountedBySurfaceID[surfaceID] = harness
    session.mountedHarness = harness
    session.currentTree = extractViewTree(session)
  }

  private func runScenario(_ scenario: [String: Any], name: String) throws {
    let session = try mountSurface(scenario)
    var mountedBySurfaceID: [String: MountedSurfaceHarness] = [:]
    defer {
      var tornDown: Set<ObjectIdentifier> = []
      if let active = session.mountedHarness {
        tornDown.insert(ObjectIdentifier(active))
        active.driver.tearDown()
      }
      for harness in mountedBySurfaceID.values {
        if tornDown.insert(ObjectIdentifier(harness)).inserted {
          harness.driver.tearDown()
        }
      }
    }

    let turns = (scenario["turns"] as? [[String: Any]]) ?? []
    for (turnIdx, turn) in turns.enumerated() {
      let turnCtx = "\(name) [turn \(turnIdx)]"
      var turnOutbound: [[String: Any]] = []

      let expectWire = (turn["expectWire"] as? [[String: Any]]) ?? []
      for (partIdx, part) in expectWire.enumerated() {
        guard let messages = part["a2ui"] as? [[String: Any]] else { continue }
        try AdapterHarness.runStep(
          session,
          ["op": "process_messages", "messages": messages],
          context: "\(turnCtx) [wire \(partIdx)]"
        )
        if let mounted = session.mountedHarness {
          for (sid, vm) in session.processor.surfaceGroupModel.surfacesMap where
            mounted.surface.viewModel === vm
          {
            mountedBySurfaceID[sid] = mounted
          }
        }
        turnOutbound.append(contentsOf: Self.captureOutbound(session))
      }

      if let viewTrees = turn["expectViewTree"] as? [String: Any] {
        for (surfaceID, rawTree) in viewTrees {
          if rawTree is NSNull {
            let exists = session.processor.surfaceGroupModel.surfacesMap[surfaceID] != nil
            #expect(!exists, "\(turnCtx): expected surface '\(surfaceID)' to be absent")
            if exists {
              throw AdapterConformanceError(
                "\(turnCtx): expected surface '\(surfaceID)' to be absent"
              )
            }
          } else if let expectedTree = rawTree as? [String: Any] {
            try selectSurface(
              surfaceID,
              session: session,
              mountedBySurfaceID: &mountedBySurfaceID,
              context: turnCtx
            )
            let actualTree = extractViewTree(session)
            try AdapterHarness.assertViewTree(
              actualTree,
              Self.stripExtendedViewNodeKeys(expectedTree),
              context: "\(turnCtx) [\(surfaceID)]"
            )
            try Self.assertExtendedViewNodeProps(
              actualTree,
              expected: expectedTree,
              context: "\(turnCtx) [\(surfaceID)]"
            )
          }
        }
      }

      if let uiOps = turn["uiOps"] as? [[String: Any]] {
        for (opIdx, uiOp) in uiOps.enumerated() {
          guard let surfaceID = uiOp["surfaceId"] as? String else {
            throw AdapterConformanceError("\(turnCtx) [uiOp \(opIdx)]: missing surfaceId")
          }
          try selectSurface(
            surfaceID,
            session: session,
            mountedBySurfaceID: &mountedBySurfaceID,
            context: "\(turnCtx) [uiOp \(opIdx)]"
          )
          var step = uiOp
          step.removeValue(forKey: "surfaceId")
          try AdapterHarness.runStep(
            session,
            step,
            context: "\(turnCtx) [uiOp \(opIdx)]"
          )
          turnOutbound.append(contentsOf: Self.captureOutbound(session))
        }
      }

      if let expDataModels = turn["expectDataModel"] as? [String: Any] {
        for (surfaceID, expData) in expDataModels {
          guard let vm = session.processor.surfaceGroupModel.surfacesMap[surfaceID] else {
            throw AdapterConformanceError("\(turnCtx): missing surface '\(surfaceID)'")
          }
          let expectedJSON = AdapterHarness.toJSONValue(expData)
          #expect(vm.dataModel.data == expectedJSON, "\(turnCtx) [\(surfaceID)]: dataModel")
          if vm.dataModel.data != expectedJSON {
            throw AdapterConformanceError("\(turnCtx) [\(surfaceID)]: dataModel mismatch")
          }
        }
      }

      if let expOutbound = turn["expectOutbound"] as? [[String: Any]] {
        try Self.assertOutbound(turnOutbound, expected: expOutbound, context: turnCtx)
      }
    }
  }
}
