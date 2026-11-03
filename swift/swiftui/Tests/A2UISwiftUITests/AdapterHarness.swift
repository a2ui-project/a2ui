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
import A2UIJSON
import A2UISwiftUI
import BasicCatalog
import BasicCatalogSwiftUI
import Combine
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import SwiftUI
import Testing

/// Error thrown when an adapter conformance schema or assertion check fails.
struct AdapterConformanceError: Error, CustomStringConvertible, Sendable {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}

/// Execution record written to the JSON Lines conformance manifest.
struct AdapterManifestRecord: Sendable {
  let harness: String
  let suite: String
  let caseName: String
  let status: String
  let reason: String?

  init(
    harness: String = "swiftui",
    suite: String,
    caseName: String,
    status: String,
    reason: String? = nil
  ) {
    self.harness = harness
    self.suite = suite
    self.caseName = caseName
    self.status = status
    self.reason = reason
  }
}

/// Captures actions, errors, and outbound envelopes emitted by `MessageProcessor` during a step.
final class AdapterTestActionHandler: ActionHandling, @unchecked Sendable {
  var actions: [(action: ResolvedAction, surfaceID: String)] = []
  var errors: [RendererError] = []
  var outbound: [[String: Any]] = []
  var currentOp: String?

  func handle(action: ResolvedAction, from surfaceID: String) {
    actions.append((action: action, surfaceID: surfaceID))
  }

  func handle(error: RendererError, from surfaceID: String) {
    errors.append(error)
  }

  func recordOutbound(_ message: RendererToAgentMessage) {
    if currentOp == "programmatic_invoke", case .error = message {
      return
    }
    guard
      let data = try? JSONEncoder().encode(message),
      let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
      return
    }
    outbound.append(dict)
  }

  func clearStepEvents() {
    actions.removeAll()
    errors.removeAll()
    outbound.removeAll()
  }
}

/// Local `incrementCounter` function implementation used by adapter conformance tests.
final class IncrementCounterFunction: FunctionImplementation, Sendable {
  let api: FunctionAPI

  init() throws {
    self.api = FunctionAPI(
      name: "incrementCounter",
      returnType: .number,
      schema: try Schema(instance: "{}")
    )
  }

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let path = arguments["path"]?.stringValue else { return .null }
    let step = arguments["step"]?.intValue ?? 1
    let current = context.dataModel.get(path)?.intValue ?? 0
    let updated = current + step
    context.set(path, value: .integer(updated))
    return .integer(updated)
  }
}

/// Snapshot of a rendered view node in the SwiftUI adapter tree.
struct AdapterViewNode {
  let id: String
  let instanceID: String
  let type: String?
  let state: String
  let node: A2UICore.Node?
  let children: [AdapterViewNode]

  init(
    id: String,
    instanceID: String,
    type: String? = nil,
    state: String = "resolved",
    node: A2UICore.Node? = nil,
    children: [AdapterViewNode] = []
  ) {
    self.id = id
    self.instanceID = instanceID
    self.type = type
    self.state = state
    self.node = node
    self.children = children
  }
}

/// Holds a mounted `A2UISwiftUI.Surface`, its `HostedViewDriver`, and its Combine subscriptions.
@MainActor
final class MountedSurfaceHarness {
  let surface: Surface
  let driver: HostedViewDriver
  private var subscriptions: [AnyCancellable] = []
  private(set) var isMounted = true
  private(set) var emissionCount = 0

  var activeSubscriptionCount: Int {
    isMounted ? subscriptions.count : 0
  }

  init(surface: Surface) {
    self.surface = surface
    self.driver = HostedViewDriver(surface: surface)
    surface.viewModel.objectWillChange
      .sink { [weak self] _ in self?.emissionCount += 1 }
      .store(in: &subscriptions)
    surface.viewModel.componentsModel.objectWillChange
      .sink { [weak self] _ in self?.emissionCount += 1 }
      .store(in: &subscriptions)
  }

  func unmount() {
    isMounted = false
    subscriptions.removeAll()
    driver.tearDown()
    surface.viewModel.dispose()
  }
}

/// Session state for an adapter conformance test case.
@MainActor
final class AdapterSession {
  let caseName: String
  let protocolVersion: String
  let handler: AdapterTestActionHandler
  let processor: MessageProcessor
  let uiCatalogs: [Catalog<ComponentImplementation>]
  var mountedHarness: MountedSurfaceHarness?
  var currentTree: AdapterViewNode?
  var previousTree: AdapterViewNode?

  init(
    caseName: String,
    protocolVersion: String = "1.0",
    handler: AdapterTestActionHandler,
    processor: MessageProcessor,
    uiCatalogs: [Catalog<ComponentImplementation>]
  ) {
    self.caseName = caseName
    self.protocolVersion = protocolVersion
    self.handler = handler
    self.processor = processor
    self.uiCatalogs = uiCatalogs
  }
}

/// Shared SwiftUI adapter conformance harness helpers.
@MainActor
enum AdapterHarness {
  private static let manifestLock = NSLock()

  /// Reasoned skip entries keyed by `"<case>"` or `"<case>/<op|expectKey>"`.
  static let unsupported: [String: String] = [:]

  private static var matchedUnsupportedKeys: Set<String> = []
  private static var completedCasesBySuite: [String: Set<String>] = [:]
  private static var completedSuites: Set<String> = []
  private static let allAdapterSuites: Set<String> = [
    "core/accessibility.yaml",
    "core/adapter_conformance.yaml",
  ]

  static let adapterCaseKnownKeys: Set<String> = [
    "name",
    "description",
    "features",
    "action",
    "protocolVersion",
    "strictMode",
    "catalogPaths",
    "catalogs",
    "steps",
  ]

  static let adapterCatalogKnownKeys: Set<String> = [
    "catalogId",
    "protocolVersion",
    "components",
  ]

  static let adapterStepKnownKeys: Set<String> = [
    "description",
    "op",
    "messages",
    "targetNode",
    "inputValue",
    "userActivation",
    "expectViewTree",
    "expectAccessibilityTree",
    "expectDataModel",
    "expectActions",
    "expectErrors",
    "expectOutbound",
    "expectSameViewIdentity",
    "expectNewViewIdentity",
    "expectDisposedNodes",
    "expectSurfaceRemoved",
    "expectThemeAbsent",
    "expectActiveSubscriptions",
  ]

  static let adapterStepKnownOps: Set<String> = [
    "process_messages",
    "user_input",
    "user_gesture",
    "programmatic_invoke",
    "unmount_surface",
  ]

  static let viewNodeKnownKeys: Set<String> = [
    "id",
    "type",
    "state",
    "text",
    "value",
    "badgeText",
    "isValid",
    "validationErrors",
    "validationResults",
    "children",
  ]

  static let validationResultKnownKeys: Set<String> = [
    "valid",
    "code",
    "message",
    "severity",
  ]

  static let expectedActionKnownKeys: Set<String> = [
    "name",
    "surfaceId",
    "sourceComponentId",
    "context",
  ]

  static let expectedErrorKnownKeys: Set<String> = [
    "code",
    "surfaceId",
    "message",
  ]

  static let accessibilityCaseKnownKeys: Set<String> = [
    "name",
    "description",
    "features",
    "action",
    "protocolVersion",
    "catalogPath",
    "surface",
    "messages",
    "assertions",
    "steps",
  ]

  static let accessibilityStepKnownKeys: Set<String> = [
    "description",
    "messages",
    "assertions",
  ]

  static let accessibilityAssertionsKnownKeys: Set<String> = [
    "accessibilityTree",
    "axeCore",
  ]

  static let accessibilityNodeKnownKeys: Set<String> = [
    "label",
    "description",
    "live",
    "hidden",
    "role",
    "checked",
  ]

  private static func assertDictionaryKeys(
    _ dict: [String: Any],
    allowed: Set<String>,
    where location: String
  ) throws {
    let unknown = dict.keys.filter { !allowed.contains($0) }.sorted()
    if !unknown.isEmpty {
      let msg = "\(location): unknown keys \(unknown)"
      Issue.record(Comment(rawValue: msg))
      throw AdapterConformanceError(msg)
    }
  }

  private static func assertKnownViewNodeKeys(
    _ node: [String: Any],
    where location: String
  ) throws {
    try assertDictionaryKeys(node, allowed: viewNodeKnownKeys, where: location)
    if let results = node["validationResults"] as? [[String: Any]] {
      for (idx, item) in results.enumerated() {
        try assertDictionaryKeys(
          item,
          allowed: validationResultKnownKeys,
          where: "\(location).validationResults[\(idx)]"
        )
      }
    }
    if let children = node["children"] as? [[String: Any]] {
      for (idx, child) in children.enumerated() {
        try assertKnownViewNodeKeys(child, where: "\(location).children[\(idx)]")
      }
    }
  }

  /// Validates that `step` (or `obj`) only uses keys in `allowed` and recursively checks
  /// nested expectation structures when `allowed == adapterStepKnownKeys`.
  static func assertKnownKeys(
    _ obj: [String: Any],
    allowed: Set<String> = adapterStepKnownKeys,
    where location: String = "step"
  ) throws {
    try assertDictionaryKeys(obj, allowed: allowed, where: location)
    guard allowed == adapterStepKnownKeys else { return }

    if let rawOp = obj["op"] {
      guard let op = rawOp as? String, adapterStepKnownOps.contains(op) else {
        let msg = "\(location).op: unsupported op \(rawOp)"
        Issue.record(Comment(rawValue: msg))
        throw AdapterConformanceError(msg)
      }
    }
    if let viewTree = obj["expectViewTree"] as? [String: Any] {
      try assertKnownViewNodeKeys(viewTree, where: "\(location).expectViewTree")
    }
    if let a11yTree = obj["expectAccessibilityTree"] as? [String: [String: Any]] {
      for (compID, nodeSpec) in a11yTree {
        try assertDictionaryKeys(
          nodeSpec,
          allowed: accessibilityNodeKnownKeys,
          where: "\(location).expectAccessibilityTree.\(compID)"
        )
      }
    }
    if let actions = obj["expectActions"] as? [[String: Any]] {
      for (idx, item) in actions.enumerated() {
        try assertDictionaryKeys(
          item,
          allowed: expectedActionKnownKeys,
          where: "\(location).expectActions[\(idx)]"
        )
      }
    }
    if let errors = obj["expectErrors"] as? [[String: Any]] {
      for (idx, item) in errors.enumerated() {
        try assertDictionaryKeys(
          item,
          allowed: expectedErrorKnownKeys,
          where: "\(location).expectErrors[\(idx)]"
        )
      }
    }
    if let rawOutbound = obj["expectOutbound"] {
      guard let outbound = rawOutbound as? [[String: Any]] else {
        let msg = "\(location).expectOutbound: expected array of objects"
        Issue.record(Comment(rawValue: msg))
        throw AdapterConformanceError(msg)
      }
      for (idx, item) in outbound.enumerated() {
        guard item["version"] is String else {
          let msg = "\(location).expectOutbound[\(idx)].version: expected string"
          Issue.record(Comment(rawValue: msg))
          throw AdapterConformanceError(msg)
        }
      }
    }
  }

  static func assertKnownAdapterCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    try assertDictionaryKeys(testCase, allowed: adapterCaseKnownKeys, where: "case(\(name))")
    if let action = testCase["action"] as? String, action != "render_surface" {
      let msg = "case(\(name)): unsupported action \(action)"
      Issue.record(Comment(rawValue: msg))
      throw AdapterConformanceError(msg)
    }
    if let catalogs = testCase["catalogs"] as? [[String: Any]] {
      for (idx, cat) in catalogs.enumerated() {
        try assertDictionaryKeys(
          cat,
          allowed: adapterCatalogKnownKeys,
          where: "case(\(name)).catalogs[\(idx)]"
        )
      }
    }
    let steps = (testCase["steps"] as? [[String: Any]]) ?? []
    for (idx, step) in steps.enumerated() {
      try assertKnownKeys(
        step,
        allowed: adapterStepKnownKeys,
        where: "case(\(name)).steps[\(idx)]"
      )
    }
  }

  static func assertKnownAccessibilityAssertions(
    _ assertions: [String: Any]?,
    where location: String
  ) throws {
    guard let assertions else { return }
    try assertDictionaryKeys(
      assertions,
      allowed: accessibilityAssertionsKnownKeys,
      where: location
    )
    if let tree = assertions["accessibilityTree"] as? [String: [String: Any]] {
      for (compID, nodeSpec) in tree {
        try assertDictionaryKeys(
          nodeSpec,
          allowed: accessibilityNodeKnownKeys,
          where: "\(location).accessibilityTree.\(compID)"
        )
      }
    }
  }

  static func assertKnownAccessibilityCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    try assertDictionaryKeys(
      testCase,
      allowed: accessibilityCaseKnownKeys,
      where: "case(\(name))"
    )
    if let action = testCase["action"] as? String, action != "accessibility_check" {
      let msg = "case(\(name)): unsupported action \(action)"
      Issue.record(Comment(rawValue: msg))
      throw AdapterConformanceError(msg)
    }
    try assertKnownAccessibilityAssertions(
      testCase["assertions"] as? [String: Any],
      where: "case(\(name)).assertions"
    )
    if let steps = testCase["steps"] as? [[String: Any]] {
      for (idx, step) in steps.enumerated() {
        try assertDictionaryKeys(
          step,
          allowed: accessibilityStepKnownKeys,
          where: "case(\(name)).steps[\(idx)]"
        )
        try assertKnownAccessibilityAssertions(
          step["assertions"] as? [String: Any],
          where: "case(\(name)).steps[\(idx)].assertions"
        )
      }
    }
  }

  /// Returns a skip reason if `caseName` or any step in `steps` matches `unsupported`.
  static func findUnsupportedReason(
    _ caseName: String,
    steps: [[String: Any]] = []
  ) -> String? {
    if let reason = unsupported[caseName] {
      matchedUnsupportedKeys.insert(caseName)
      return reason
    }
    for step in steps {
      if let op = step["op"] as? String {
        let opKey = "\(caseName)/\(op)"
        if let reason = unsupported[opKey] {
          matchedUnsupportedKeys.insert(opKey)
          return reason
        }
      }
      for key in step.keys.sorted() {
        let stepKey = "\(caseName)/\(key)"
        if let reason = unsupported[stepKey] {
          matchedUnsupportedKeys.insert(stepKey)
          return reason
        }
      }
      if let assertions = step["assertions"] as? [String: Any] {
        for key in assertions.keys.sorted() {
          let assertionKey = "\(caseName)/\(key)"
          if let reason = unsupported[assertionKey] {
            matchedUnsupportedKeys.insert(assertionKey)
            return reason
          }
        }
      }
    }
    return nil
  }

  /// Verifies that every entry in `unsupported` matched at least one executed case.
  static func assertAllUnsupportedMatched() {
    let unused = unsupported.keys
      .filter { !matchedUnsupportedKeys.contains($0) }
      .sorted()
    #expect(
      unused.isEmpty,
      "Unused unsupported entries did not match any case: \(unused)"
    )
  }

  /// Marks `suite` complete and checks `assertAllUnsupportedMatched()` once all suites finish.
  static func finishSuite(_ suite: String) {
    completedSuites.insert(suite)
    if completedSuites.isSuperset(of: allAdapterSuites) {
      assertAllUnsupportedMatched()
    }
  }

  /// Records completion of a single parameterized case in `suite`, finishing the suite once all
  /// `expectedTotal` cases have run.
  static func recordCaseCompleted(suite: String, caseName: String, expectedTotal: Int) {
    completedCasesBySuite[suite, default: []].insert(caseName)
    if (completedCasesBySuite[suite]?.count ?? 0) >= expectedTotal {
      finishSuite(suite)
    }
  }

  /// Appends a manifest record to `$A2UI_CONFORMANCE_MANIFEST_DIR/<harness>-<pid>.jsonl`.
  static func writeManifestRecord(_ rec: AdapterManifestRecord) {
    guard
      let manifestDir = ProcessInfo.processInfo.environment["A2UI_CONFORMANCE_MANIFEST_DIR"],
      !manifestDir.isEmpty
    else {
      return
    }

    var entry: [String: String] = [
      "harness": rec.harness,
      "suite": rec.suite,
      "case": rec.caseName,
      "status": rec.status,
    ]
    if let reason = rec.reason, !reason.isEmpty {
      entry["reason"] = reason
    }

    guard
      var lineData = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys])
    else {
      return
    }
    lineData.append(0x0A)

    manifestLock.lock()
    defer { manifestLock.unlock() }

    let dirURL = URL(fileURLWithPath: manifestDir, isDirectory: true)
    try? FileManager.default.createDirectory(at: dirURL, withIntermediateDirectories: true)
    let pid = ProcessInfo.processInfo.processIdentifier
    let fileURL = dirURL.appendingPathComponent("\(rec.harness)-\(pid).jsonl")

    if FileManager.default.fileExists(atPath: fileURL.path) {
      if let handle = try? FileHandle(forWritingTo: fileURL) {
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: lineData)
      }
    } else {
      try? lineData.write(to: fileURL, options: .atomic)
    }
  }

  /// Creates an `AdapterSession` configured for `caseSpec`.
  static func mountSurface(_ caseSpec: [String: Any]) throws -> AdapterSession {
    let caseName = caseSpec["name"] as? String ?? "<unnamed>"
    let protocolVersion = (caseSpec["protocolVersion"] as? String) ?? "1.0"
    let handler = AdapterTestActionHandler()
    let (coreCatalogs, uiCatalogs) = try buildCatalogs(for: caseSpec)
    let validationConfig: ValidationConfig =
      (caseSpec["strictMode"] as? Bool) == true ? .strict : .relaxed
    let processor = MessageProcessor(
      catalogs: coreCatalogs,
      actionHandler: handler,
      validationConfig: validationConfig
    )
    processor.outboundListener = { message in
      handler.recordOutbound(message)
    }
    return AdapterSession(
      caseName: caseName,
      protocolVersion: protocolVersion,
      handler: handler,
      processor: processor,
      uiCatalogs: uiCatalogs
    )
  }

  /// Extracts the current resolved view tree from `session`.
  static func extractViewTree(_ session: AdapterSession) -> AdapterViewNode? {
    guard let harness = session.mountedHarness, harness.isMounted else { return nil }
    return resolveViewTree(for: harness.surface)
  }

  /// Executes a single adapter conformance `step` against `session` and verifies expectations.
  static func runStep(
    _ session: AdapterSession,
    _ step: [String: Any],
    context: String? = nil
  ) throws {
    try assertKnownKeys(step)
    let stepCtx = context ?? session.caseName
    session.handler.clearStepEvents()
    let op = step["op"] as? String ?? "process_messages"
    session.handler.currentOp = op
    switch op {
    case "process_messages":
      let messages = (step["messages"] as? [[String: Any]]) ?? []
      try processAdapterMessages(messages, session: session)
      session.currentTree = extractViewTree(session)
    case "user_input":
      try applyUserInput(step, session: session)
      session.currentTree = extractViewTree(session)
    case "user_gesture":
      try invokeUserGesture(step, session: session)
      session.currentTree = extractViewTree(session)
    case "programmatic_invoke":
      invokeProgrammaticAction(step, surface: session.mountedHarness?.surface)
      session.mountedHarness?.driver.flush()
      session.currentTree = extractViewTree(session)
    case "unmount_surface":
      #expect(
        (session.mountedHarness?.activeSubscriptionCount ?? 0) > 0,
        "Expected active subscriptions"
      )
      session.mountedHarness?.unmount()
      session.currentTree = nil
    default:
      Issue.record("Unsupported op \(op)")
      throw AdapterConformanceError("Unsupported op \(op)")
    }

    try verifyAdapterStep(step, session: session, context: stepCtx)
    if let currentTree = session.currentTree {
      session.previousTree = currentTree
    }
  }

  /// Verifies that `actual` matches `expected`.
  static func assertViewTree(
    _ actual: AdapterViewNode?,
    _ expected: [String: Any],
    context: String = "root"
  ) throws {
    try assertKnownViewNodeKeys(expected, where: "\(context).expectViewTree")
    guard let viewNode = actual else {
      let msg = "\(context): expected ViewNode but got nil"
      Issue.record(Comment(rawValue: msg))
      throw AdapterConformanceError(msg)
    }
    if let expID = expected["id"] as? String {
      #expect(viewNode.id == expID, "\(context): id mismatch")
      if viewNode.id != expID {
        throw AdapterConformanceError("\(context): id mismatch")
      }
    }
    if let expType = expected["type"] as? String {
      #expect(viewNode.type == expType, "\(context): type mismatch")
      if viewNode.type != expType {
        throw AdapterConformanceError("\(context): type mismatch")
      }
    }
    if let expState = expected["state"] as? String {
      #expect(viewNode.state == expState, "\(context): state mismatch")
      if viewNode.state != expState {
        throw AdapterConformanceError("\(context): state mismatch")
      }
    }
    try assertViewNodeProperties(viewNode, expected: expected, context: context)
    if let expChildren = expected["children"] as? [[String: Any]] {
      #expect(viewNode.children.count == expChildren.count, "\(context): children count mismatch")
      if viewNode.children.count != expChildren.count {
        throw AdapterConformanceError("\(context): children count mismatch")
      }
      for (idx, expChild) in expChildren.enumerated() where idx < viewNode.children.count {
        try assertViewTree(
          viewNode.children[idx],
          expChild,
          context: "\(context)/children/\(idx)"
        )
      }
    }
  }

  // MARK: - Internal Helpers

  private static func buildCatalogs(
    for testCase: [String: Any]
  ) throws -> ([AnyCatalog], [Catalog<ComponentImplementation>]) {
    let incrementFn = try IncrementCounterFunction()
    let v10Functions = V10BasicCatalog.functions + [incrementFn]
    var coreCatalogs: [AnyCatalog] = BasicCatalog.allCatalogs.map { cat in
      Catalog(
        id: cat.id,
        protocolVersion: cat.protocolVersion,
        components: Array(cat.components.values),
        functions: Array(cat.functions.values) + [incrementFn],
        themeSchema: cat.themeSchema
      ).eraseToAnyCatalog()
    }
    var uiCatalogs: [Catalog<ComponentImplementation>] = BasicCatalogImplementation.allCatalogs
    let customDefs = (testCase["catalogs"] as? [[String: Any]]) ?? []
    for custom in customDefs {
      if let (coreCat, uiCat) = try buildCustomCatalog(custom, functions: v10Functions) {
        coreCatalogs.append(coreCat)
        uiCatalogs.append(uiCat)
      }
    }
    return (coreCatalogs, uiCatalogs)
  }

  private static func buildCustomCatalog(
    _ custom: [String: Any],
    functions: [any FunctionImplementation]
  ) throws -> (AnyCatalog, Catalog<ComponentImplementation>)? {
    guard let catalogID = custom["catalogId"] as? String,
      let compDict = custom["components"] as? [String: Any]
    else {
      return nil
    }
    let emptySchema = try Schema(instance: "{}")
    var coreApis: [AnyComponentAPI] = []
    var uiImpls: [ComponentImplementation] = []
    for compName in compDict.keys {
      let api = AnyComponentAPI(name: compName, schema: emptySchema)
      coreApis.append(api)
      uiImpls.append(
        ComponentImplementation(api: api) { node in
          Text(node.string(for: "badgeText") ?? node.string(for: "text") ?? "")
        }
      )
    }
    let coreCat = Catalog(
      id: catalogID,
      protocolVersion: .v10,
      components: coreApis,
      functions: functions
    ).eraseToAnyCatalog()
    let uiCat = Catalog(
      id: catalogID,
      protocolVersion: .v10,
      components: uiImpls,
      functions: functions
    )
    return (coreCat, uiCat)
  }

  private static func processAdapterMessages(
    _ messages: [[String: Any]],
    session: AdapterSession
  ) throws {
    try session.processor.processMessages(toJSONValue(messages))
    if let harness = session.mountedHarness,
      session.processor.surfaceGroupModel.surfacesMap[harness.surface.surfaceID] == nil
    {
      harness.unmount()
    } else if session.mountedHarness == nil,
      let vm = session.processor.surfaceGroupModel.surfacesMap["adapter_surface"]
        ?? session.processor.surfaceGroupModel.surfacesMap.values.first
    {
      let surface = Surface(
        viewModel: vm,
        catalogs: session.uiCatalogs,
        defaultCatalogID: BasicCatalog.catalogURI(version: .v10)
      )
      session.mountedHarness = MountedSurfaceHarness(surface: surface)
    } else {
      session.mountedHarness?.driver.flush()
    }
  }

  private static func applyUserInput(_ step: [String: Any], session: AdapterSession) throws {
    guard let driver = session.mountedHarness?.driver,
      let targetID = step["targetNode"] as? String
    else {
      return
    }
    if let boolValue = step["inputValue"] as? Bool {
      try driver.setToggle(boolValue, componentID: targetID)
    } else if let strValue = step["inputValue"] as? String {
      try driver.enterText(strValue, componentID: targetID)
    }
  }

  private static func invokeUserGesture(_ step: [String: Any], session: AdapterSession) throws {
    guard let driver = session.mountedHarness?.driver,
      let targetID = step["targetNode"] as? String
    else {
      return
    }
    try driver.press(componentID: targetID)
  }

  private static func invokeProgrammaticAction(_ step: [String: Any], surface: Surface?) {
    guard let surface,
      let targetID = step["targetNode"] as? String,
      let rootNode = surface.viewModel.rootNode
    else {
      return
    }
    var nodes: [String: A2UICore.Node] = [:]
    collectNodes(from: rootNode, into: &nodes)
    guard let targetNode = nodes[targetID] else { return }
    let userActivation = (step["userActivation"] as? Bool) ?? false
    if targetNode.type == "Button" {
      let button = A2UIButton(node: targetNode)
      guard !button.isDisabled else { return }
    } else {
      guard targetNode.isValid else { return }
    }
    targetNode.action(for: "action", userActivation: userActivation)?()
  }

  static func resolveViewTree(for surface: Surface) -> AdapterViewNode? {
    guard let rootNode = surface.viewModel.rootNode else { return nil }
    return buildViewNode(in: surface, node: rootNode)
  }

  private static func buildViewNode(
    in surface: Surface,
    node: A2UICore.Node
  ) -> AdapterViewNode {
    let rendered = Surface.render(
      node: node,
      using: surface.catalogs,
      defaultCatalogID: surface.defaultCatalogID
    )
    #expect(rendered != nil, "Expected Surface.render builder for '\(node.type)'")
    let children = resolveChildViewNodes(in: surface, node: node)
    let baseID = baseComponentID(for: node, in: surface)
    return AdapterViewNode(
      id: baseID,
      instanceID: node.id,
      type: node.type,
      state: "resolved",
      node: node,
      children: children
    )
  }

  private static func baseComponentID(for node: A2UICore.Node, in surface: Surface) -> String {
    if surface.viewModel.componentsModel.get(node.id) != nil {
      return node.id
    }
    if let colonPrefix = node.id.split(separator: ":").first.map(String.init),
      surface.viewModel.componentsModel.get(colonPrefix) != nil
    {
      return colonPrefix
    }
    var candidate = node.id
    while let underscoreIdx = candidate.lastIndex(of: "_") {
      let suffix = candidate[candidate.index(after: underscoreIdx)...]
      guard !suffix.isEmpty, suffix.allSatisfy(\.isNumber) else { break }
      candidate = String(candidate[..<underscoreIdx])
      if surface.viewModel.componentsModel.get(candidate) != nil {
        return candidate
      }
    }
    return String(node.id.split(separator: ":").first ?? Substring(node.id))
  }

  private static func resolveChildViewNodes(
    in surface: Surface,
    node: A2UICore.Node
  ) -> [AdapterViewNode] {
    if let singleChild = node.child(for: "child") {
      return [buildViewNode(in: surface, node: singleChild)]
    }
    return node.children(for: "children").map { childNode in
      buildViewNode(in: surface, node: childNode)
    }
  }

  private static func verifyAdapterStep(
    _ step: [String: Any],
    session: AdapterSession,
    context: String
  ) throws {
    if let expTree = step["expectViewTree"] as? [String: Any] {
      try assertViewTree(session.currentTree, expTree, context: context)
    }
    if let expData = step["expectDataModel"], let surface = session.mountedHarness?.surface {
      let expectedJSON = toJSONValue(expData)
      #expect(surface.viewModel.dataModel.data == expectedJSON, "\(context): dataModel mismatch")
      if surface.viewModel.dataModel.data != expectedJSON {
        throw AdapterConformanceError("\(context): dataModel mismatch")
      }
    }
    if let expSameIDs = step["expectSameViewIdentity"] as? [String] {
      try assertSameViewIdentities(
        expSameIDs,
        previousTree: session.previousTree,
        currentTree: session.currentTree,
        context: context
      )
    }
    if let expNewIDs = step["expectNewViewIdentity"] as? [String] {
      try assertNewViewIdentities(
        expNewIDs,
        previousTree: session.previousTree,
        currentTree: session.currentTree,
        context: context
      )
    }
    if let expDisposedIDs = step["expectDisposedNodes"] as? [String] {
      try assertDisposedNodes(
        expDisposedIDs,
        previousTree: session.previousTree,
        currentTree: session.currentTree,
        surface: session.mountedHarness?.surface,
        context: context
      )
    }
    if (step["expectSurfaceRemoved"] as? Bool) == true {
      try assertSurfaceRemoved(session: session, context: context)
    }
    if let expActions = step["expectActions"] as? [[String: Any]] {
      try assertActionsMatch(session.handler.actions, expected: expActions, context: context)
    }
    if let expErrors = step["expectErrors"] as? [[String: Any]] {
      try assertErrorsMatch(session.handler.errors, expected: expErrors, context: context)
    }
    try validateOutboundEnvelopes(
      session.handler.outbound,
      protocolVersion: session.protocolVersion,
      context: context
    )
    if let expOutbound = step["expectOutbound"] as? [[String: Any]] {
      try assertOutboundMatches(
        session.handler.outbound,
        expected: expOutbound,
        context: context
      )
    }
    if let expA11y = step["expectAccessibilityTree"] as? [String: [String: Any]],
      let currentTree = session.currentTree
    {
      try assertAccessibilityTreeMatches(
        currentTree,
        driver: session.mountedHarness?.driver,
        expected: expA11y,
        context: context
      )
    }
    if (step["expectThemeAbsent"] as? Bool) == true,
      let surface = session.mountedHarness?.surface
    {
      let theme = surface.viewModel.theme
      let isThemeEmpty = (theme == nil || theme?.isEmpty == true)
      #expect(isThemeEmpty, "\(context): expected empty theme")
      let resolvedColor = Color.a2uiPrimary(from: theme)
      #expect(resolvedColor == Color.accentColor, "\(context): expected default accentColor")
      if !isThemeEmpty || resolvedColor != Color.accentColor {
        throw AdapterConformanceError("\(context): expectThemeAbsent failed")
      }
    }
    if let expSubs = step["expectActiveSubscriptions"] as? Int,
      let harness = session.mountedHarness
    {
      try assertActiveSubscriptions(harness: harness, expected: expSubs, context: context)
    }
  }

  private static func assertActiveSubscriptions(
    harness: MountedSurfaceHarness,
    expected: Int,
    context: String
  ) throws {
    let emissionsBefore = harness.emissionCount
    var nodeBoxEmissions = 0
    var boxCancellables: [AnyCancellable] = []
    if let rootNode = harness.surface.viewModel.rootNode {
      var nodes: [String: A2UICore.Node] = [:]
      collectNodes(from: rootNode, into: &nodes)
      for node in nodes.values {
        node.box.objectWillChange
          .sink { _ in nodeBoxEmissions += 1 }
          .store(in: &boxCancellables)
      }
    }
    harness.surface.viewModel.dataModel.set("/status", value: .string("Unmounted"))
    let postWriteEmissions = (harness.emissionCount - emissionsBefore) + nodeBoxEmissions
    withExtendedLifetime(boxCancellables) {}
    let total = harness.activeSubscriptionCount + postWriteEmissions
    #expect(total == expected, "\(context): subscription count mismatch")
    if total != expected {
      throw AdapterConformanceError("\(context): subscription count mismatch")
    }
  }

  private static func assertViewNodeProperties(
    _ viewNode: AdapterViewNode,
    expected: [String: Any],
    context: String
  ) throws {
    guard let node = viewNode.node else { return }
    if let expText = expected["text"] as? String {
      #expect(node.string(for: "text") == expText, "\(context): text mismatch")
      if node.string(for: "text") != expText {
        throw AdapterConformanceError("\(context): text mismatch")
      }
    }
    if let expValue = expected["value"] as? String {
      #expect(node.string(for: "value") == expValue, "\(context): value mismatch")
      if node.string(for: "value") != expValue {
        throw AdapterConformanceError("\(context): value mismatch")
      }
    }
    if let expBadge = expected["badgeText"] as? String {
      #expect(node.string(for: "badgeText") == expBadge, "\(context): badgeText mismatch")
      if node.string(for: "badgeText") != expBadge {
        throw AdapterConformanceError("\(context): badgeText mismatch")
      }
    }
    try assertValidationProperties(node, expected: expected, context: context)
  }

  private static func assertValidationProperties(
    _ node: A2UICore.Node,
    expected: [String: Any],
    context: String
  ) throws {
    let textField = A2UITextField(node: node)
    if let expValid = expected["isValid"] as? Bool {
      #expect(textField.isValid == expValid, "\(context): isValid mismatch")
      if textField.isValid != expValid {
        throw AdapterConformanceError("\(context): isValid mismatch")
      }
    }
    if let expErrors = expected["validationErrors"] as? [String] {
      #expect(textField.validationErrors == expErrors, "\(context): validationErrors mismatch")
      if textField.validationErrors != expErrors {
        throw AdapterConformanceError("\(context): validationErrors mismatch")
      }
    }
    guard let expResults = expected["validationResults"] as? [[String: Any]] else { return }
    #expect(textField.validationResults.count == expResults.count, "\(context): results count")
    if textField.validationResults.count != expResults.count {
      throw AdapterConformanceError("\(context): results count mismatch")
    }
    for (idx, expRes) in expResults.enumerated() where idx < textField.validationResults.count {
      let actual = textField.validationResults[idx]
      if let expCode = expRes["code"] as? String {
        #expect(actual.code == expCode, "\(context): result code mismatch")
        if actual.code != expCode {
          throw AdapterConformanceError("\(context): result code mismatch")
        }
      }
      if let expMsg = expRes["message"] as? String {
        #expect(actual.message == expMsg, "\(context): result message mismatch")
        if actual.message != expMsg {
          throw AdapterConformanceError("\(context): result message mismatch")
        }
      }
      if let expSev = expRes["severity"] as? String {
        let actualSeverity = (actual.severity ?? ValidationSeverity.error).rawValue
        #expect(actualSeverity == expSev, "\(context): result severity mismatch")
        if actualSeverity != expSev {
          throw AdapterConformanceError("\(context): result severity mismatch")
        }
      }
    }
  }

  private static func assertSameViewIdentities(
    _ paths: [String],
    previousTree: AdapterViewNode?,
    currentTree: AdapterViewNode?,
    context: String
  ) throws {
    for path in paths {
      let prevNode = findViewNode(atPath: path, in: previousTree)
      let currNode = findViewNode(atPath: path, in: currentTree)
      #expect(prevNode != nil && currNode != nil, "\(context): missing node at \(path)")
      let sameIdentity =
        prevNode?.instanceID == currNode?.instanceID
        && prevNode?.node?.box === currNode?.node?.box
      #expect(sameIdentity, "\(context): identity changed at \(path)")
      if prevNode == nil || currNode == nil || !sameIdentity {
        throw AdapterConformanceError("\(context): identity mismatch at \(path)")
      }
    }
  }

  private static func assertNewViewIdentities(
    _ paths: [String],
    previousTree: AdapterViewNode?,
    currentTree: AdapterViewNode?,
    context: String
  ) throws {
    for path in paths {
      let prevNode = findViewNode(atPath: path, in: previousTree)
      let currNode = findViewNode(atPath: path, in: currentTree)
      #expect(prevNode != nil && currNode != nil, "\(context): missing node at \(path)")
      let identityChanged =
        prevNode?.instanceID != currNode?.instanceID
        || prevNode?.node?.box !== currNode?.node?.box
      #expect(identityChanged, "\(context): expected new identity at \(path)")
      if prevNode == nil || currNode == nil || !identityChanged {
        throw AdapterConformanceError("\(context): expected new identity at \(path)")
      }
    }
  }

  private static func assertDisposedNodes(
    _ nodeIDs: [String],
    previousTree: AdapterViewNode?,
    currentTree: AdapterViewNode?,
    surface: Surface?,
    context: String
  ) throws {
    for nodeID in nodeIDs {
      let prevNode = findViewNodeByID(nodeID, in: previousTree)
      let currNode = findViewNodeByID(nodeID, in: currentTree)
      #expect(prevNode != nil, "\(context): expected previous node '\(nodeID)'")
      #expect(currNode == nil, "\(context): expected node '\(nodeID)' to be unmounted")
      var emissions = 0
      var cancellable: AnyCancellable?
      if let box = prevNode?.node?.box {
        cancellable = box.objectWillChange.sink { _ in emissions += 1 }
      }
      if let dm = surface?.viewModel.dataModel,
        let currentVal = dm.get("/removedText")
      {
        dm.set("/removedText", value: currentVal)
      }
      withExtendedLifetime(cancellable) {}
      #expect(emissions == 0, "\(context): disposed node '\(nodeID)' still emitted")
      if prevNode == nil || currNode != nil || emissions != 0 {
        throw AdapterConformanceError("\(context): disposed node check failed for '\(nodeID)'")
      }
    }
  }

  private static func assertSurfaceRemoved(
    session: AdapterSession,
    context: String
  ) throws {
    guard let harness = session.mountedHarness else {
      throw AdapterConformanceError("\(context): no mounted harness")
    }
    let sid = harness.surface.surfaceID
    let inGroup = session.processor.surfaceGroupModel.surfacesMap[sid] != nil
    #expect(!inGroup, "\(context): surface '\(sid)' still in surfaceGroupModel")
    #expect(!harness.isMounted, "\(context): surface harness still mounted")
    #expect(session.currentTree == nil, "\(context): expected nil currentTree")
    if inGroup || harness.isMounted || session.currentTree != nil {
      throw AdapterConformanceError("\(context): expectSurfaceRemoved failed")
    }
  }

  private static func findViewNodeByID(
    _ id: String,
    in root: AdapterViewNode?
  ) -> AdapterViewNode? {
    guard let root else { return nil }
    if root.id == id || root.instanceID == id {
      return root
    }
    for child in root.children {
      if let match = findViewNodeByID(id, in: child) {
        return match
      }
    }
    return nil
  }

  private static func findViewNode(
    atPath path: String,
    in root: AdapterViewNode?
  ) -> AdapterViewNode? {
    guard let root else { return nil }
    if path == "root" || path == root.id {
      return root
    }
    let parts = path.split(separator: "/").map(String.init)
    if parts.count == 3, parts[0] == "root", parts[1] == "children", let idx = Int(parts[2]),
      idx < root.children.count
    {
      return root.children[idx]
    }
    return nil
  }

  private static func assertActionsMatch(
    _ actual: [(action: ResolvedAction, surfaceID: String)],
    expected: [[String: Any]],
    context: String
  ) throws {
    #expect(actual.count == expected.count, "\(context): action count mismatch")
    if actual.count != expected.count {
      throw AdapterConformanceError("\(context): action count mismatch")
    }
    for (idx, exp) in expected.enumerated() where idx < actual.count {
      let entry = actual[idx]
      if let sid = exp["surfaceId"] as? String {
        #expect(entry.surfaceID == sid, "\(context): action surfaceId mismatch")
        if entry.surfaceID != sid {
          throw AdapterConformanceError("\(context): action surfaceId mismatch")
        }
      }
      if let src = exp["sourceComponentId"] as? String {
        #expect(entry.action.sourceComponentID == src, "\(context): sourceComponentId mismatch")
        if entry.action.sourceComponentID != src {
          throw AdapterConformanceError("\(context): sourceComponentId mismatch")
        }
      }
      guard case .event(let actName, let actCtx, _) = entry.action.identity else {
        Issue.record("\(context): expected .event action identity")
        throw AdapterConformanceError("\(context): expected .event action identity")
      }
      if let name = exp["name"] as? String {
        #expect(actName == name, "\(context): action name mismatch")
        if actName != name {
          throw AdapterConformanceError("\(context): action name mismatch")
        }
      }
      if let expCtx = exp["context"] as? [String: Any] {
        for (k, v) in expCtx {
          #expect(actCtx?[k] == toJSONValue(v), "\(context): action context[\(k)] mismatch")
          if actCtx?[k] != toJSONValue(v) {
            throw AdapterConformanceError("\(context): action context[\(k)] mismatch")
          }
        }
      }
    }
  }

  private static func assertErrorsMatch(
    _ actual: [RendererError],
    expected: [[String: Any]],
    context: String
  ) throws {
    #expect(actual.count >= expected.count, "\(context): expected \(expected.count) errors")
    if actual.count < expected.count {
      throw AdapterConformanceError("\(context): expected \(expected.count) errors")
    }
    for exp in expected {
      let expCode = exp["code"] as? String
      let expSurface = exp["surfaceId"] as? String
      let expMessage = (exp["messageContains"] ?? exp["message"]) as? String
      let matched = actual.contains { err in
        let fields = rendererErrorFields(err)
        let codeMatch = expCode == nil || fields.code == expCode
        let surfMatch = expSurface == nil || fields.surfaceID == expSurface
        let msgMatch = expMessage == nil || fields.message.contains(expMessage ?? "")
        return codeMatch && surfMatch && msgMatch
      }
      #expect(matched, "\(context): expected error matching \(exp) in \(actual)")
      if !matched {
        throw AdapterConformanceError("\(context): expected error matching \(exp)")
      }
    }
  }

  private static func rendererErrorFields(
    _ error: RendererError
  ) -> (code: String, surfaceID: String?, message: String) {
    switch error {
    case .validationFailed(let valError):
      return (valError.code.rawValue, valError.surfaceID, valError.message)
    case .generic(let genError):
      return (genError.code, genError.surfaceID, genError.message)
    }
  }

  private static let v10OutboundSchema: Schema = loadSpecificationSchema(
    relativePath: "v1_0/json/renderer_to_agent.json"
  )

  private static let v09OutboundSchema: Schema = loadSpecificationSchema(
    relativePath: "v0_9_1/json/client_to_server.json"
  )

  private static func loadSpecificationSchema(relativePath: String) -> Schema {
    let repoRoot = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let schemaURL = repoRoot.appendingPathComponent("specification").appendingPathComponent(
      relativePath
    )
    let text = (try? String(contentsOf: schemaURL, encoding: .utf8)) ?? "{}"
    let rawJSON = (try? JSONValue.parse(text)) ?? .object([:])
    return try! Schema(rawSchema: rawJSON, context: A2UISchemaRegistry.makeContext())
  }

  private static func validateOutboundEnvelopes(
    _ envelopes: [[String: Any]],
    protocolVersion: String,
    context: String
  ) throws {
    let isV09 = protocolVersion.hasPrefix("v0.9") || protocolVersion.hasPrefix("0.9")
    let schema = isV09 ? v09OutboundSchema : v10OutboundSchema
    for (idx, envelope) in envelopes.enumerated() {
      let jsonValue = toJSONValue(envelope)
      let result = schema.validate(jsonValue)
      #expect(
        result.isValid,
        "\(context): outbound[\(idx)] failed protocol schema validation"
      )
      if !result.isValid {
        throw AdapterConformanceError(
          "\(context): outbound[\(idx)] failed protocol schema validation"
        )
      }
    }
  }

  private static func isMatchAny(_ value: Any) -> Bool {
    guard let dict = value as? [String: Any], dict.count == 1 else { return false }
    return (dict["$match"] as? String) == "any"
  }

  private static func assertMatchesExpectedOutbound(
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
        try assertMatchesExpectedOutbound(
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
        try assertMatchesExpectedOutbound(
          actDict[key] as Any,
          expected: expDict[key] as Any,
          where: "\(location).\(key)"
        )
      }
      return
    }
    let actJSON = toJSONValue(actual)
    let expJSON = toJSONValue(expected)
    #expect(actJSON == expJSON, "\(location): value mismatch")
    if actJSON != expJSON {
      throw AdapterConformanceError("\(location): value mismatch \(actJSON) vs \(expJSON)")
    }
  }

  private static func assertOutboundMatches(
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
      try assertMatchesExpectedOutbound(
        actual[idx],
        expected: exp,
        where: "\(context).expectOutbound[\(idx)]"
      )
    }
  }

  static func assertAccessibilityTreeMatches(
    _ root: AdapterViewNode,
    driver: HostedViewDriver? = nil,
    expected: [String: [String: Any]],
    context: String
  ) throws {
    var nodesByID: [String: A2UICore.Node] = [:]
    if let rootNode = root.node {
      collectNodes(from: rootNode, into: &nodesByID)
    }
    for (componentID, expectedProps) in expected {
      guard let node = nodesByID[componentID] else {
        Issue.record("\(context): missing accessibility node '\(componentID)'")
        throw AdapterConformanceError("\(context): missing accessibility node '\(componentID)'")
      }
      let hostedElement = driver?.accessibilityNode(componentID: componentID)
      let modifier = A2UIAccessibilityModifier(node: node)
      try assertModifierMatches(
        modifier,
        node: node,
        hostedElement: hostedElement,
        expected: expectedProps,
        context: "\(context) [\(componentID)]"
      )
    }
  }

  static func assertModifierMatches(
    _ modifier: A2UIAccessibilityModifier,
    node: A2UICore.Node,
    hostedElement: HostedViewDriver.AccessibilityElement? = nil,
    expected: [String: Any],
    context: String
  ) throws {
    if let expLabel = expected["label"] as? String {
      let actual = hostedElement?.label ?? effectiveLabel(for: node, modifier: modifier)
      #expect(actual == expLabel, "\(context): label")
      if actual != expLabel {
        throw AdapterConformanceError("\(context): label mismatch")
      }
    }
    if let expDesc = expected["description"] as? String {
      let actual = hostedElement?.help ?? modifier.hint
      #expect(actual == expDesc, "\(context): description mismatch")
      if actual != expDesc {
        throw AdapterConformanceError("\(context): description mismatch")
      }
    }
    if let expLive = expected["live"] as? String {
      let actual = hostedElement?.live ?? node.explicitAccessibilityAttributes?.live
      #expect(actual == expLive, "\(context): live mismatch")
      if actual != expLive {
        throw AdapterConformanceError("\(context): live mismatch")
      }
    }
    if let expHidden = expected["hidden"] as? Bool {
      let actual = hostedElement?.isHidden ?? modifier.isHidden
      #expect(actual == expHidden, "\(context): hidden mismatch")
      if actual != expHidden {
        throw AdapterConformanceError("\(context): hidden mismatch")
      }
    }
    if let expRole = expected["role"] as? String {
      let actual = hostedElement?.role ?? semanticRole(for: node)
      #expect(actual == expRole, "\(context): role mismatch")
      if actual != expRole {
        throw AdapterConformanceError("\(context): role mismatch")
      }
    }
    if let expChecked = expected["checked"] as? Bool {
      let actual = hostedElement?.isChecked ?? checkedState(for: node)
      #expect(actual == expChecked, "\(context): checked mismatch")
      if actual != expChecked {
        throw AdapterConformanceError("\(context): checked mismatch")
      }
    }
  }

  private static func effectiveLabel(
    for node: A2UICore.Node,
    modifier: A2UIAccessibilityModifier
  ) -> String? {
    if let explicit = modifier.label {
      return explicit
    }
    if let inferred = node.accessibilityAttributes?.label, !inferred.isEmpty {
      return inferred
    }
    if let child = node.child(for: "child") {
      return child.accessibilityAttributes?.label ?? child.string(for: "text")
    }
    return nil
  }

  private static func semanticRole(for node: A2UICore.Node) -> String {
    switch node.type {
    case "Button":
      return "button"
    case "TextField":
      return "textbox"
    case "CheckBox":
      return "checkbox"
    case "ChoicePicker":
      let variant = node.string(for: "variant") ?? "mutuallyExclusive"
      return variant == "mutuallyExclusive" ? "radiogroup" : "group"
    default:
      return node.type.lowercased()
    }
  }

  private static func checkedState(for node: A2UICore.Node) -> Bool? {
    guard node.type == "CheckBox" else { return nil }
    return node.bool(for: "value") ?? false
  }

  static func collectNodes(from node: A2UICore.Node, into map: inout [String: A2UICore.Node]) {
    map[node.id] = node
    let baseID = String(node.id.split(separator: ":").first ?? Substring(node.id))
    map[baseID] = node
    for child in node.allChildNodes {
      collectNodes(from: child, into: &map)
    }
  }

  nonisolated static func toJSONValue(_ value: Any) -> JSONValue {
    if value is NSNull { return .null }
    if let boolVal = value as? Bool { return .boolean(boolVal) }
    if let intVal = value as? Int { return .integer(intVal) }
    if let doubleVal = value as? Double { return .number(doubleVal) }
    if let strVal = value as? String { return .string(strVal) }
    if let arrVal = value as? [Any] { return .array(arrVal.map { toJSONValue($0) }) }
    if let dictVal = value as? [String: Any] {
      var obj = OrderedDictionary<String, JSONValue>()
      for key in dictVal.keys.sorted() {
        obj[key] = toJSONValue(dictVal[key] as Any)
      }
      return .object(obj)
    }
    return .null
  }

  nonisolated static func fromJSONValue(_ value: JSONValue) -> Any {
    switch value {
    case .null:
      return NSNull()
    case .boolean(let boolVal):
      return boolVal
    case .integer(let intVal):
      return intVal
    case .number(let doubleVal):
      return doubleVal
    case .string(let strVal):
      return strVal
    case .array(let arrVal):
      return arrVal.map { fromJSONValue($0) }
    case .object(let objVal):
      var dict: [String: Any] = [:]
      for (key, val) in objVal {
        dict[key] = fromJSONValue(val)
      }
      return dict
    }
  }
}

/// Top-level helper creating an `AdapterSession` for a conformance test case.
@MainActor
func mountSurface(_ caseSpec: [String: Any]) throws -> AdapterSession {
  try AdapterHarness.mountSurface(caseSpec)
}

/// Top-level helper executing a single adapter conformance step.
@MainActor
func runStep(_ session: AdapterSession, _ step: [String: Any]) throws {
  try AdapterHarness.runStep(session, step)
}

/// Top-level helper extracting the current view tree from an `AdapterSession`.
@MainActor
func extractViewTree(_ session: AdapterSession) -> AdapterViewNode? {
  AdapterHarness.extractViewTree(session)
}

/// Top-level helper asserting an `AdapterViewNode` matches an expected view tree dictionary.
@MainActor
func assertViewTree(_ actual: AdapterViewNode?, _ expected: [String: Any]) throws {
  try AdapterHarness.assertViewTree(actual, expected)
}

/// Top-level helper validating that `step` only uses known adapter step and expectation keys.
@MainActor
func assertKnownKeys(_ step: [String: Any]) throws {
  try AdapterHarness.assertKnownKeys(step)
}

/// Top-level helper appending a conformance manifest record when `A2UI_CONFORMANCE_MANIFEST_DIR`
/// is set.
@MainActor
func writeManifestRecord(_ rec: AdapterManifestRecord) {
  AdapterHarness.writeManifestRecord(rec)
}
