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
import Observation
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
  var errors: [(error: RendererError, surfaceID: String)] = []
  var outbound: [[String: Any]] = []
  var currentOp: String?
  var lastCallId: String?

  func handle(action: ResolvedAction, from surfaceID: String) {
    actions.append((action: action, surfaceID: surfaceID))
  }

  func handle(error: RendererError, from surfaceID: String) {
    errors.append((error: error, surfaceID: surfaceID))
  }

  func recordOutbound(_ message: RendererToAgentMessage) {
    if case .callAgentFunction(let call) = message {
      lastCallId = call.functionCallID
    }
    if currentOp == "programmatic_invoke", case .error = message {
      return
    }
    guard
      let data = try? JSONEncoder().encode(message),
      var dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
      return
    }
    if var errorDict = dict["error"] as? [String: Any] {
      errorDict.removeValue(forKey: "expression")
      dict["error"] = errorDict
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
  let occupiesLayout: Bool
  let node: A2UICore.Node?
  let children: [AdapterViewNode]

  /// The object identity of the resolved node backing this view, which stays the same while the
  /// resolver updates the node in place and changes when the node is recreated.
  var identity: ObjectIdentifier? { node?.identity }

  init(
    id: String,
    instanceID: String,
    type: String? = nil,
    state: String = "resolved",
    occupiesLayout: Bool = true,
    node: A2UICore.Node? = nil,
    children: [AdapterViewNode] = []
  ) {
    self.id = id
    self.instanceID = instanceID
    self.type = type
    self.state = state
    self.occupiesLayout = occupiesLayout
    self.node = node
    self.children = children
  }
}

/// Holds a mounted `A2UISwiftUI.Surface`, its `HostedViewDriver` when the surface is hosted in a
/// platform window, and its Combine subscriptions.
@MainActor
final class MountedSurfaceHarness {
  let surface: Surface
  /// The driver of the hosted view hierarchy, or `nil` when the harness drives the resolved
  /// nodes without hosting the surface.
  let driver: HostedViewDriver?
  private var subscriptions: [AnyCancellable] = []
  private(set) var isMounted = true
  private(set) var emissionCount = 0

  var activeSubscriptionCount: Int {
    isMounted ? subscriptions.count : 0
  }

  init(surface: Surface, hostsViews: Bool) {
    self.surface = surface
    self.driver = hostsViews ? HostedViewDriver(surface: surface) : nil
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
    driver?.tearDown()
    surface.viewModel.dispose()
  }
}

/// Session state shared across steps of an adapter conformance test case.
@MainActor
final class AdapterSession {
  let caseName: String
  let protocolVersion: String
  let handler: AdapterTestActionHandler
  let processor: MessageProcessor
  let uiCatalogs: [Catalog<ComponentImplementation>]
  /// Whether the surface is hosted in a platform window and driven through its native views.
  let hostsViews: Bool
  var mountedHarness: MountedSurfaceHarness?
  var currentTree: AdapterViewNode?
  var previousTree: AdapterViewNode?
  var selectedTabIndices: [String: Int] = [:]
  var openModalIDs: Set<String> = []

  init(
    caseName: String,
    protocolVersion: String = "1.0",
    handler: AdapterTestActionHandler,
    processor: MessageProcessor,
    uiCatalogs: [Catalog<ComponentImplementation>],
    hostsViews: Bool = true
  ) {
    self.caseName = caseName
    self.protocolVersion = protocolVersion
    self.handler = handler
    self.processor = processor
    self.uiCatalogs = uiCatalogs
    self.hostsViews = hostsViews
  }
}

// MARK: - AdapterHarness

/// Shared adapter conformance harness helpers for mounting `A2UISwiftUI.Surface`, executing
/// conformance operations, validating unknown keys, asserting view/accessibility trees, and
/// emitting JSON Lines manifest records.
@MainActor
enum AdapterHarness {
  private static let manifestLock = NSLock()

  /// Reasoned skip entries keyed by `"<case>"` or `"<case>/<op|expectKey>"`.
  static let unsupported: [String: String] = [
    "v10_theme_dropped_in_permissive_mode_renders_like_none":
      "Theme dropping in permissive mode not yet implemented in A2UICore Swift V10VersionAdapter"
  ]

  private static var matchedUnsupportedKeys: Set<String> = []
  private static var completedCasesBySuite: [String: Set<String>] = [:]
  private static var completedSuites: Set<String> = []
  private static let allAdapterSuites: Set<String> = [
    "core/accessibility.yaml",
    "core/adapter_conformance.yaml",
    "adapter/adapter_conformance_v0_9.yaml",
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
    "functions",
  ]

  static let adapterStepKnownKeys: Set<String> = [
    "op",
    "messages",
    "targetNode",
    "inputValue",
    "gesture",
    "actionProperty",
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
    "occupiesLayout",
    "text",
    "value",
    "url",
    "name",
    "axis",
    "badgeText",
    "isValid",
    "validationErrors",
    "validationResults",
    "hints",
    "children",
  ]

  static let validationResultKnownKeys: Set<String> = [
    "valid",
    "code",
    "message",
    "severity",
  ]

  static let accessibilityNodeKnownKeys: Set<String> = [
    "label",
    "description",
    "live",
    "hidden",
    "role",
    "checked",
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
    "messageContains",
  ]

  static let accessibilityCaseKnownKeys: Set<String> = [
    "name",
    "description",
    "features",
    "action",
    "protocolVersion",
    "catalogPaths",
    "messages",
    "assertions",
    "steps",
  ]

  static let accessibilityStepKnownKeys: Set<String> = [
    "messages",
    "assertions",
    "accessibilityTree",
  ]

  static let accessibilityAssertionsKnownKeys: Set<String> = [
    "accessibilityTree"
  ]

  // MARK: - Unknown-Key Validation

  static func assertDictionaryKeys(
    _ obj: [String: Any],
    allowed: Set<String>,
    where location: String
  ) throws {
    let unknown = obj.keys.filter { !allowed.contains($0) }.sorted()
    if !unknown.isEmpty {
      let msg = "Unknown key(s) at \(location): \(unknown.joined(separator: ", "))"
      Issue.record(Comment(rawValue: msg))
      throw AdapterConformanceError(msg)
    }
  }

  static func assertKnownViewNodeKeys(
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

  private static func collectViewTreeKeys(_ node: Any?, into out: inout Set<String>) {
    guard let dict = node as? [String: Any] else { return }
    for key in dict.keys {
      out.insert(key)
    }
    if let children = dict["children"] as? [Any] {
      for child in children {
        collectViewTreeKeys(child, into: &out)
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
      var viewKeys: Set<String> = []
      collectViewTreeKeys(step["expectViewTree"], into: &viewKeys)
      for key in viewKeys.sorted() {
        let viewKey = "\(caseName)/\(key)"
        if let reason = unsupported[viewKey] {
          matchedUnsupportedKeys.insert(viewKey)
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
  static func finishSuite(_ suite: String, cases: [[String: Any]] = []) {
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
      _ = findUnsupportedReason(name, steps: steps)
    }
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
  ///
  /// - Parameter hostsViews: Whether to host the surface in a platform window and drive it
  ///   through its native views, rather than through its resolved nodes.
  static func mountSurface(
    _ caseSpec: [String: Any],
    hostsViews: Bool = true
  ) throws -> AdapterSession {
    let caseName = caseSpec["name"] as? String ?? "<unnamed>"
    let protocolVersion = (caseSpec["protocolVersion"] as? String) ?? "1.0"
    let handler = AdapterTestActionHandler()
    let (coreCatalogs, uiCatalogs) = try buildCatalogs(for: caseSpec)
    let isStrict = (caseSpec["strictMode"] as? Bool) == true
    var validationConfig: ValidationConfig = isStrict ? .strict : .relaxed
    if !isStrict {
      // A rendered surface shows a cycle as a `cyclic` placeholder rather than rejecting the
      // message, as the adapters of the other SDKs do.
      validationConfig.allowCyclicReferences = true
    }
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
      uiCatalogs: uiCatalogs,
      hostsViews: hostsViews
    )
  }

  /// Extracts the current resolved view tree from `session`.
  static func extractViewTree(_ session: AdapterSession) throws -> AdapterViewNode? {
    guard let harness = session.mountedHarness, harness.isMounted else { return nil }
    return try resolveViewTree(
      for: harness.surface,
      driver: harness.driver,
      selectedTabIndices: session.selectedTabIndices,
      openModalIDs: session.openModalIDs
    )
  }

  static func substituteLastCallId(_ value: Any, lastCallId: String) -> Any {
    if let list = value as? [Any] {
      return list.map { substituteLastCallId($0, lastCallId: lastCallId) }
    }
    if let dict = value as? [String: Any] {
      if dict["$ref"] as? String == "lastCallId", dict.count == 1 {
        return lastCallId
      }
      var result: [String: Any] = [:]
      for (k, v) in dict {
        result[k] = substituteLastCallId(v, lastCallId: lastCallId)
      }
      return result
    }
    return value
  }

  /// Executes the step operation against `session` without running assertions yet.
  private static func executeStepOperation(
    _ session: AdapterSession,
    _ step: [String: Any]
  ) throws {
    try assertKnownKeys(step)
    session.handler.clearStepEvents()
    let op = step["op"] as? String ?? "process_messages"
    session.handler.currentOp = op
    switch op {
    case "process_messages":
      let rawMessages = (step["messages"] as? [[String: Any]]) ?? []
      let messages =
        (substituteLastCallId(rawMessages, lastCallId: session.handler.lastCallId ?? "")
          as? [[String: Any]]) ?? []
      try processAdapterMessages(messages, session: session)
      session.currentTree = try extractViewTree(session)
    case "user_input":
      try applyUserInput(step, session: session)
      session.currentTree = try extractViewTree(session)
    case "user_gesture":
      try invokeUserGesture(step, session: session)
      session.currentTree = try extractViewTree(session)
    case "programmatic_invoke":
      invokeStepAction(
        step,
        surface: session.mountedHarness?.surface,
        userActivation: (step["userActivation"] as? Bool) ?? false
      )
      session.mountedHarness?.driver?.flush()
      session.currentTree = try extractViewTree(session)
    case "unmount_surface":
      let activeCount = session.mountedHarness?.activeSubscriptionCount ?? 0
      #expect(activeCount > 0, "Expected active subscriptions")
      if activeCount <= 0 {
        throw AdapterConformanceError("\(session.caseName): expected active subscriptions")
      }
      session.mountedHarness?.unmount()
      session.currentTree = nil
    default:
      Issue.record("Unsupported op \(op)")
      throw AdapterConformanceError("Unsupported op \(op)")
    }
  }

  /// Yields to `@MainActor` tasks spawned during a step (such as async `callAgentFunction`
  /// routing and settlement) before verifying step assertions.
  private static func settleAdapterStep(
    _ step: [String: Any],
    session: AdapterSession
  ) async {
    let expectedOutboundCount = (step["expectOutbound"] as? [[String: Any]])?.count ?? 0
    let expectedErrorsCount = (step["expectErrors"] as? [[String: Any]])?.count ?? 0
    let expectedActionsCount = (step["expectActions"] as? [[String: Any]])?.count ?? 0
    for _ in 0..<400 {
      let satisfied =
        session.handler.outbound.count >= expectedOutboundCount
        && session.handler.errors.count >= expectedErrorsCount
        && session.handler.actions.count >= expectedActionsCount
      if satisfied { break }
      try? await Task.sleep(nanoseconds: 5_000_000)
    }
    if expectedOutboundCount > 0 || expectedErrorsCount > 0 || expectedActionsCount > 0 {
      for _ in 0..<6 {
        try? await Task.sleep(nanoseconds: 5_000_000)
      }
      session.mountedHarness?.driver?.flush()
      // A tree that fails to resolve here is reported by the step's assertions.
      session.currentTree = try? extractViewTree(session)
    }
  }

  /// Executes a single adapter conformance `step` against `session` and verifies expectations.
  static func runStep(
    _ session: AdapterSession,
    _ step: [String: Any],
    context: String? = nil
  ) throws {
    let stepCtx = context ?? session.caseName
    try executeStepOperation(session, step)
    try verifyAdapterStep(step, session: session, context: stepCtx)
    if let currentTree = session.currentTree {
      session.previousTree = currentTree
    }
  }

  /// Asynchronously executes a single adapter conformance `step` against `session`, awaiting
  /// any `@MainActor` tasks spawned by the step before verifying expectations.
  static func runStepAsync(
    _ session: AdapterSession,
    _ step: [String: Any],
    context: String? = nil
  ) async throws {
    let stepCtx = context ?? session.caseName
    try executeStepOperation(session, step)
    await settleAdapterStep(step, session: session)
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
    if let expOccupies = expected["occupiesLayout"] as? Bool {
      #expect(viewNode.occupiesLayout == expOccupies, "\(context): occupiesLayout mismatch")
      if viewNode.occupiesLayout != expOccupies {
        throw AdapterConformanceError("\(context): occupiesLayout mismatch")
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
    guard let catalogID = custom["catalogId"] as? String else {
      return nil
    }
    let compDict = (custom["components"] as? [String: Any]) ?? [:]
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
    var catalogFunctions = functions
    if let fnDict = custom["functions"] as? [String: Any] {
      for fnName in fnDict.keys {
        let fnAPI = FunctionAPI(
          name: fnName,
          returnType: .void,
          schema: emptySchema,
          allowedCallers: .rendererOrAgent
        )
        catalogFunctions.append(SchemaOnlyFunction(api: fnAPI))
      }
    }
    let coreCat = Catalog(
      id: catalogID,
      protocolVersion: .v10,
      components: coreApis,
      functions: catalogFunctions
    ).eraseToAnyCatalog()
    let uiCat = Catalog(
      id: catalogID,
      protocolVersion: .v10,
      components: uiImpls,
      functions: catalogFunctions
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
      let defaultVersion: A2UIProtocolVersion =
        session.protocolVersion == "v0.9" || session.protocolVersion == "0.9"
        ? .v09
        : .v10
      let surface = Surface(
        viewModel: vm,
        catalogs: session.uiCatalogs,
        defaultCatalogID: BasicCatalog.catalogURI(version: defaultVersion)
      )
      session.mountedHarness = MountedSurfaceHarness(
        surface: surface,
        hostsViews: session.hostsViews
      )
    } else {
      session.mountedHarness?.driver?.flush()
    }
  }

  private static func applyUserInput(_ step: [String: Any], session: AdapterSession) throws {
    guard let harness = session.mountedHarness,
      let targetID = step["targetNode"] as? String
    else {
      return
    }
    let targetType = findViewNodeByID(targetID, in: session.currentTree)?.type
    guard let driver = harness.driver else {
      try writeUserInputToNode(
        step["inputValue"],
        componentID: targetID,
        targetType: targetType,
        session: session,
        surface: harness.surface
      )
      return
    }
    if targetType == "CheckBox", let boolValue = step["inputValue"] as? Bool {
      try driver.setToggle(boolValue, componentID: targetID)
    } else if targetType == "ChoicePicker", let arrValue = step["inputValue"] as? [Any] {
      try driver.selectChoices(arrValue.compactMap { $0 as? String }, componentID: targetID)
    } else if targetType == "Tabs", let intValue = step["inputValue"] as? Int {
      try driver.selectTab(index: intValue, componentID: targetID)
    } else if targetType == "Slider", let intValue = step["inputValue"] as? Int {
      try driver.setSliderValue(Double(intValue), componentID: targetID)
    } else if targetType == "Slider", let dblValue = step["inputValue"] as? Double {
      try driver.setSliderValue(dblValue, componentID: targetID)
    } else if targetType == "DateTimeInput", let strValue = step["inputValue"] as? String {
      try driver.setDateTime(strValue, componentID: targetID)
    } else if let boolValue = step["inputValue"] as? Bool {
      try driver.setToggle(boolValue, componentID: targetID)
    } else if let strValue = step["inputValue"] as? String {
      try driver.enterText(strValue, componentID: targetID)
    }
  }

  /// Writes a user input value through the binding of the resolved node's component view, for
  /// the harness that does not host the surface.
  private static func writeUserInputToNode(
    _ inputValue: Any?,
    componentID: String,
    targetType: String?,
    session: AdapterSession,
    surface: Surface
  ) throws {
    guard let targetNode = findNode(componentID: componentID, in: surface) else {
      throw AdapterConformanceError("Component '\(componentID)' not found in surface")
    }
    let effectiveType = targetType ?? targetNode.type
    if effectiveType == "CheckBox", let boolValue = inputValue as? Bool {
      A2UICheckBox(node: targetNode).isOn.wrappedValue = boolValue
    } else if effectiveType == "ChoicePicker", let arrValue = inputValue as? [Any] {
      let picker = A2UIChoicePicker(node: targetNode)
      for value in arrValue.compactMap({ $0 as? String }) {
        picker.selectionBinding(forOptionValue: value).wrappedValue = true
      }
    } else if effectiveType == "Tabs", let intValue = inputValue as? Int {
      session.selectedTabIndices[componentID] = intValue
    } else if effectiveType == "Slider", let intValue = inputValue as? Int {
      targetNode.binding(for: "value", default: 0.0).wrappedValue = Double(intValue)
    } else if effectiveType == "Slider", let dblValue = inputValue as? Double {
      targetNode.binding(for: "value", default: 0.0).wrappedValue = dblValue
    } else if effectiveType == "DateTimeInput", let strValue = inputValue as? String {
      if let parsed = DateTimeInputValue(parsing: strValue) {
        let enableDate = targetNode.bool(for: "enableDate") ?? false
        let enableTime = targetNode.bool(for: "enableTime") ?? false
        let formatted = DateTimeInputValue.format(
          parsed.date,
          enableDate: enableDate,
          enableTime: enableTime,
          like: targetNode.string(for: "value")
        )
        (targetNode.dataBinding(for: "value") as DataBinding<String>?)?.set(formatted)
      } else {
        (targetNode.dataBinding(for: "value") as DataBinding<String>?)?.set(strValue)
      }
    } else if let boolValue = inputValue as? Bool {
      A2UICheckBox(node: targetNode).isOn.wrappedValue = boolValue
    } else if let strValue = inputValue as? String {
      A2UITextField(node: targetNode).valueBinding.wrappedValue = strValue
    }
  }

  private static func invokeUserGesture(_ step: [String: Any], session: AdapterSession) throws {
    guard let harness = session.mountedHarness,
      let targetID = step["targetNode"] as? String
    else {
      return
    }
    guard let driver = harness.driver else {
      // Without a hosted view, the gesture runs the resolved node's action as a press would.
      guard let targetNode = findNode(componentID: targetID, in: harness.surface) else {
        throw AdapterConformanceError("Component '\(targetID)' not found in surface")
      }
      if targetNode.type == "Button" {
        guard !A2UIButton(node: targetNode).isDisabled else { return }
      } else if targetNode.type == "CheckBox" {
        A2UICheckBox(node: targetNode).isOn.wrappedValue.toggle()
        return
      } else {
        guard targetNode.isValid else { return }
      }
      targetNode.action(for: "action", userActivation: true)?()
      if targetNode.type == "Modal" {
        session.openModalIDs.insert(targetNode.id)
      }
      if let rootNode = harness.surface.viewModel.rootNode {
        var nodes: [String: A2UICore.Node] = [:]
        collectNodes(from: rootNode, into: &nodes)
        for candidate in nodes.values where candidate.type == "Modal" {
          if candidate.child(for: "trigger")?.id == targetID {
            session.openModalIDs.insert(candidate.id)
          }
        }
      }
      return
    }
    try driver.press(componentID: targetID)
  }

  private static func findNode(componentID: String, in surface: Surface) -> A2UICore.Node? {
    guard let rootNode = surface.viewModel.rootNode else { return nil }
    var nodes: [String: A2UICore.Node] = [:]
    collectNodes(from: rootNode, into: &nodes)
    return nodes[componentID]
  }

  private static func invokeStepAction(
    _ step: [String: Any],
    surface: Surface?,
    userActivation: Bool = true
  ) {
    guard let surface,
      let targetID = step["targetNode"] as? String,
      let rootNode = surface.viewModel.rootNode
    else {
      return
    }
    var nodes: [String: A2UICore.Node] = [:]
    collectNodes(from: rootNode, into: &nodes)
    guard let targetNode = nodes[targetID] else { return }
    let property = (step["actionProperty"] as? String) ?? "action"
    invokeAction(on: targetNode, property: property, userActivation: userActivation)
  }

  private static func invokeAction(
    on node: A2UICore.Node,
    property: String = "action",
    userActivation: Bool = true
  ) {
    if node.type == "Button" {
      let button = A2UIButton(node: node)
      guard !button.isDisabled else { return }
    } else {
      guard node.isValid else { return }
    }
    node.action(for: property, userActivation: userActivation)?()
  }

  static func resolveViewTree(
    for surface: Surface,
    driver: HostedViewDriver? = nil,
    selectedTabIndices: [String: Int] = [:],
    openModalIDs: Set<String> = []
  ) throws -> AdapterViewNode? {
    guard let rootNode = surface.viewModel.rootNode else { return nil }
    return try buildViewNode(
      in: surface,
      driver: driver,
      selectedTabIndices: selectedTabIndices,
      openModalIDs: openModalIDs,
      node: rootNode
    )
  }

  private static func buildViewNode(
    in surface: Surface,
    driver: HostedViewDriver?,
    selectedTabIndices: [String: Int],
    openModalIDs: Set<String>,
    node: A2UICore.Node
  ) throws -> AdapterViewNode {
    let rendered = Surface.render(
      node: node,
      using: surface.catalogs,
      defaultCatalogID: surface.defaultCatalogID
    )
    if node.state == .resolved {
      #expect(rendered != nil, "Expected Surface.render builder for '\(node.type)'")
      if rendered == nil {
        throw AdapterConformanceError("Expected Surface.render builder for '\(node.type)'")
      }
    } else {
      #expect(rendered == nil, "Expected no Surface.render view for a \(node.state) placeholder")
    }
    let children = try resolveChildViewNodes(
      in: surface,
      driver: driver,
      selectedTabIndices: selectedTabIndices,
      openModalIDs: openModalIDs,
      node: node
    )
    let baseID = baseComponentID(for: node, in: surface)
    return AdapterViewNode(
      id: baseID,
      instanceID: node.id,
      type: node.type,
      state: node.state.rawValue,
      occupiesLayout: rendered != nil && node.state == .resolved,
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
    driver: HostedViewDriver?,
    selectedTabIndices: [String: Int],
    openModalIDs: Set<String>,
    node: A2UICore.Node
  ) throws -> [AdapterViewNode] {
    guard node.state == .resolved else { return [] }
    if let singleChild = node.child(for: "child") {
      return [
        try buildViewNode(
          in: surface,
          driver: driver,
          selectedTabIndices: selectedTabIndices,
          openModalIDs: openModalIDs,
          node: singleChild
        )
      ]
    }
    if node.type == "Tabs" {
      let tabChildren = resolveTabChildren(for: node)
      let selectedIndex = driver?.selectedTabIndex(for: node.id) ?? selectedTabIndices[node.id] ?? 0
      if selectedIndex >= 0 && selectedIndex < tabChildren.count {
        return [
          try buildViewNode(
            in: surface,
            driver: driver,
            selectedTabIndices: selectedTabIndices,
            openModalIDs: openModalIDs,
            node: tabChildren[selectedIndex]
          )
        ]
      }
      return []
    }
    if node.type == "Modal" {
      var modalChildren: [AdapterViewNode] = []
      if let trigger = node.child(for: "trigger") {
        modalChildren.append(
          try buildViewNode(
            in: surface,
            driver: driver,
            selectedTabIndices: selectedTabIndices,
            openModalIDs: openModalIDs,
            node: trigger
          )
        )
      }
      let isOpen = (driver?.isModalOpen(node.id) == true) || openModalIDs.contains(node.id)
      if isOpen, let content = node.child(for: "content") {
        modalChildren.append(
          try buildViewNode(
            in: surface,
            driver: driver,
            selectedTabIndices: selectedTabIndices,
            openModalIDs: openModalIDs,
            node: content
          )
        )
      }
      return modalChildren
    }
    return try node.children(for: "children").map { childNode in
      try buildViewNode(
        in: surface,
        driver: driver,
        selectedTabIndices: selectedTabIndices,
        openModalIDs: openModalIDs,
        node: childNode
      )
    }
  }

  private static func resolveTabChildren(for node: A2UICore.Node) -> [A2UICore.Node] {
    if let array = node.array(for: "tabs") {
      return array.compactMap { element in
        let dict = element as? ResolvedDictionary
        if let child = dict?["child"] as? A2UICore.Node {
          return child
        }
        let childID = dict?["child"] as? String ?? ""
        return node.allChildNodes.first { $0.id == childID }
      }
    }
    if let json = node.jsonValue(for: "tabs"), let array = json.arrayValue {
      return array.compactMap { item in
        let childID = item["child"]?.stringValue ?? ""
        return node.allChildNodes.first { $0.id == childID }
      }
    }
    return []
  }

  private static func verifyAdapterStep(
    _ step: [String: Any],
    session: AdapterSession,
    context: String
  ) throws {
    if let expTree = step["expectViewTree"] as? [String: Any] {
      try assertViewTree(session.currentTree, expTree, context: context)
    }
    if let expData = step["expectDataModel"] {
      guard let surface = session.mountedHarness?.surface else {
        let msg = "\(context): expected mounted surface for expectDataModel"
        Issue.record(Comment(rawValue: msg))
        throw AdapterConformanceError(msg)
      }
      let expectedJSON = toJSONValue(expData)
      let matches = jsonValuesEqual(surface.viewModel.dataModel.data, expectedJSON)
      #expect(matches, "\(context): dataModel mismatch")
      if !matches {
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
    if let expA11y = step["expectAccessibilityTree"] as? [String: [String: Any]] {
      guard let currentTree = session.currentTree else {
        let msg = "\(context): expected resolved view tree for expectAccessibilityTree"
        Issue.record(Comment(rawValue: msg))
        throw AdapterConformanceError(msg)
      }
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
    if let expSubs = step["expectActiveSubscriptions"] as? Int {
      guard let harness = session.mountedHarness else {
        let msg = "\(context): expected mounted harness for expectActiveSubscriptions"
        Issue.record(Comment(rawValue: msg))
        throw AdapterConformanceError(msg)
      }
      try assertActiveSubscriptions(harness: harness, expected: expSubs, context: context)
    }
  }

  private static func assertActiveSubscriptions(
    harness: MountedSurfaceHarness,
    expected: Int,
    context: String
  ) throws {
    let emissionsBefore = harness.emissionCount
    let nodeBoxEmissions = NodeChangeCounter()
    if let rootNode = harness.surface.viewModel.rootNode {
      var nodes: [String: A2UICore.Node] = [:]
      collectNodes(from: rootNode, into: &nodes)
      for node in nodes.values {
        observeNodeChanges(node, counter: nodeBoxEmissions)
      }
    }
    harness.surface.viewModel.dataModel.set("/status", value: .string("Unmounted"))
    let postWriteEmissions =
      (harness.emissionCount - emissionsBefore) + nodeBoxEmissions.value
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
    if let expValue = expected["value"] {
      let actualJSON = resolvedValueJSON(for: node, key: "value")
      let expectedJSON = toJSONValue(expValue)
      let matches = actualJSON.map { jsonValuesEqual($0, expectedJSON) } ?? false
      #expect(matches, "\(context): value mismatch")
      if !matches {
        throw AdapterConformanceError("\(context): value mismatch")
      }
    }
    if let expBadge = expected["badgeText"] as? String {
      #expect(node.string(for: "badgeText") == expBadge, "\(context): badgeText mismatch")
      if node.string(for: "badgeText") != expBadge {
        throw AdapterConformanceError("\(context): badgeText mismatch")
      }
    }
    for key in ["url", "name", "axis"] {
      if let expStr = expected[key] as? String {
        let actualStr = node.string(for: key)
        #expect(actualStr == expStr, "\(context): \(key) mismatch")
        if actualStr != expStr {
          throw AdapterConformanceError("\(context): \(key) mismatch")
        }
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
    if let expHints = expected["hints"] as? [String] {
      let actualHints = textField.validationResults.compactMap { res -> String? in
        guard res.severity == .warning || res.severity == .info else { return nil }
        return res.message
      }
      #expect(actualHints == expHints, "\(context): hints mismatch")
      if actualHints != expHints {
        throw AdapterConformanceError("\(context): hints mismatch")
      }
    }
    guard let expResults = expected["validationResults"] as? [[String: Any]] else { return }
    #expect(textField.validationResults.count == expResults.count, "\(context): results count")
    if textField.validationResults.count != expResults.count {
      throw AdapterConformanceError("\(context): results count mismatch")
    }
    for (idx, expRes) in expResults.enumerated() where idx < textField.validationResults.count {
      let actual = textField.validationResults[idx]
      if let expItemValid = expRes["valid"] as? Bool {
        #expect(actual.valid == expItemValid, "\(context): result valid mismatch")
        if actual.valid != expItemValid {
          throw AdapterConformanceError("\(context): result valid mismatch")
        }
      }
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
      // Compare object identity: the instance IDs are deterministic strings that match even
      // when the resolver recreates the backing node.
      let sameIdentity =
        prevNode?.instanceID == currNode?.instanceID
        && prevNode?.identity != nil
        && prevNode?.identity == currNode?.identity
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
        || prevNode?.identity != currNode?.identity
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
      let counter = NodeChangeCounter()
      if let node = prevNode?.node {
        observeNodeChanges(node, counter: counter)
      }
      if let dm = surface?.viewModel.dataModel,
        let currentVal = dm.get("/removedText")
      {
        dm.set("/removedText", value: currentVal)
      }
      let emissions = counter.value
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
    let trimmed = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    if trimmed.isEmpty {
      return root
    }
    let segments = trimmed.split(separator: "/").map(String.init)
    var idx = 0
    if segments.first == root.id || segments.first == "root" {
      idx = 1
    }
    var current: AdapterViewNode? = root
    while idx < segments.count, let node = current {
      let seg = segments[idx]
      if seg == "children", idx + 1 < segments.count, let childIdx = Int(segments[idx + 1]) {
        guard childIdx >= 0 && childIdx < node.children.count else { return nil }
        current = node.children[childIdx]
        idx += 2
      } else if let childIdx = Int(seg) {
        guard childIdx >= 0 && childIdx < node.children.count else { return nil }
        current = node.children[childIdx]
        idx += 1
      } else if let match = node.children.first(where: { $0.id == seg || $0.instanceID == seg }) {
        current = match
        idx += 1
      } else {
        return nil
      }
    }
    return current
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
      guard case .event(let name, let actCtx, let sourceID) = entry.action.identity else {
        Issue.record("\(context): expected event action at \(idx)")
        throw AdapterConformanceError("\(context): expected event action at \(idx)")
      }
      if let expName = exp["name"] as? String {
        #expect(name == expName, "\(context): action name mismatch")
        if name != expName {
          throw AdapterConformanceError("\(context): action name mismatch")
        }
      }
      if let expSurface = exp["surfaceId"] as? String {
        #expect(entry.surfaceID == expSurface, "\(context): action surfaceId mismatch")
        if entry.surfaceID != expSurface {
          throw AdapterConformanceError("\(context): action surfaceId mismatch")
        }
      }
      if let expSource = exp["sourceComponentId"] as? String {
        #expect(sourceID == expSource, "\(context): action sourceComponentId mismatch")
        if sourceID != expSource {
          throw AdapterConformanceError("\(context): action sourceComponentId mismatch")
        }
      }
      if let expCtx = exp["context"] as? [String: Any] {
        let expectedContext = expCtx.mapValues { toJSONValue($0) }
        let actualContext = actCtx ?? [:]
        #expect(actualContext == expectedContext, "\(context): action context mismatch")
        if actualContext != expectedContext {
          throw AdapterConformanceError("\(context): action context mismatch")
        }
      }
    }
  }

  private static func assertErrorsMatch(
    _ actual: [(error: RendererError, surfaceID: String)],
    expected: [[String: Any]],
    context: String
  ) throws {
    #expect(
      actual.count == expected.count,
      "\(context): expected \(expected.count) errors, got \(actual.count)"
    )
    if actual.count != expected.count {
      throw AdapterConformanceError(
        "\(context): expected \(expected.count) errors, got \(actual.count)"
      )
    }
    for exp in expected {
      let expCode = exp["code"] as? String
      let expSurface = exp["surfaceId"] as? String
      let expMessage = (exp["messageContains"] ?? exp["message"]) as? String
      let matched = actual.contains { entry in
        let fields = rendererErrorFields(entry.error)
        let effectiveSurfaceID = fields.surfaceID ?? entry.surfaceID
        let codeMatch = expCode == nil || fields.code == expCode
        let surfMatch = expSurface == nil || effectiveSurfaceID == expSurface
        let msgMatch = expMessage == nil || fields.message.contains(expMessage ?? "")
        return codeMatch && surfMatch && msgMatch
      }
      #expect(matched, "\(context): missing expected error \(exp)")
      if !matched {
        throw AdapterConformanceError("\(context): missing expected error \(exp)")
      }
    }
  }

  private static func rendererErrorFields(
    _ err: RendererError
  ) -> (code: String, surfaceID: String?, message: String) {
    switch err {
    case .validationFailed(let validation):
      return (validation.code.rawValue, validation.surfaceID, validation.message)
    case .generic(let generic):
      return (generic.code, generic.surfaceID, generic.message)
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

  private static func resolvedValueJSON(for node: A2UICore.Node, key: String) -> JSONValue? {
    if let boolBinding = node.properties[key] as? DataBinding<Bool> {
      return boolBinding.value.map { .boolean($0) }
    }
    if let dblBinding = node.properties[key] as? DataBinding<Double> {
      return dblBinding.value.map { .number($0) }
    }
    if let intBinding = node.properties[key] as? DataBinding<Int> {
      return intBinding.value.map { .integer($0) }
    }
    if let strBinding = node.properties[key] as? DataBinding<String> {
      return strBinding.value.map { .string($0) }
    }
    if let arrBinding = node.properties[key] as? DataBinding<[String]> {
      return arrBinding.value.map { .array($0.map { .string($0) }) }
    }
    if let jsonVal = node.jsonValue(for: key) {
      return jsonVal
    }
    if let strVal = node.string(for: key) {
      return .string(strVal)
    }
    return nil
  }

  nonisolated static func jsonValuesEqual(_ lhs: JSONValue, _ rhs: JSONValue) -> Bool {
    switch (lhs, rhs) {
    case (.integer(let a), .integer(let b)):
      return a == b
    case (.number(let a), .number(let b)):
      return a == b
    case (.integer(let a), .number(let b)):
      return b.rounded() == b && Double(a) == b && Int(exactly: b) == a
    case (.number(let a), .integer(let b)):
      return a.rounded() == a && Double(b) == a && Int(exactly: a) == b
    case (.string(let a), .string(let b)):
      return a == b
    case (.boolean(let a), .boolean(let b)):
      return a == b
    case (.null, .null):
      return true
    case (.array(let a), .array(let b)):
      guard a.count == b.count else { return false }
      return zip(a, b).allSatisfy { jsonValuesEqual($0, $1) }
    case (.object(let a), .object(let b)):
      guard Set(a.keys) == Set(b.keys) else { return false }
      return a.keys.allSatisfy { key in
        guard let lv = a[key], let rv = b[key] else { return false }
        return jsonValuesEqual(lv, rv)
      }
    default:
      return false
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
func mountSurface(_ caseSpec: [String: Any], hostsViews: Bool = true) throws -> AdapterSession {
  try AdapterHarness.mountSurface(caseSpec, hostsViews: hostsViews)
}

/// Top-level helper executing a single adapter conformance step.
@MainActor
func runStep(_ session: AdapterSession, _ step: [String: Any]) throws {
  try AdapterHarness.runStep(session, step)
}

/// Top-level helper extracting the current view tree from an `AdapterSession`.
@MainActor
func extractViewTree(_ session: AdapterSession) throws -> AdapterViewNode? {
  try AdapterHarness.extractViewTree(session)
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

/// Counts change notifications delivered by `observeNodeChanges(_:counter:)`.
private final class NodeChangeCounter: @unchecked Sendable {
  var value = 0
}

/// Registers a one-shot `Observation` tracker on the node's observable storage
/// (`properties` and `metadata`), incrementing `counter` when either changes.
@MainActor
private func observeNodeChanges(_ node: A2UICore.Node, counter: NodeChangeCounter) {
  withObservationTracking {
    _ = node.properties
    _ = node.metadata
  } onChange: {
    counter.value += 1
  }
}
