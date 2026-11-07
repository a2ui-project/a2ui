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

/// Shared adapter conformance harness helpers for mounting `A2UISwiftUI.Surface`, executing
/// conformance operations, validating unknown keys, asserting view/accessibility trees, and
/// emitting JSON Lines manifest records.
enum AdapterHarness {
  /// Error thrown when an adapter conformance schema or assertion check fails.
  struct ConformanceError: Error, CustomStringConvertible, Sendable {
    let description: String

    init(_ description: String) {
      self.description = description
    }
  }

  /// Execution record written to the JSON Lines conformance manifest.
  struct ManifestRecord: Sendable {
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
  final class ActionHandler: ActionHandling, @unchecked Sendable {
    private let lock = NSLock()
    private var actionsStorage: [(action: ResolvedAction, surfaceID: String)] = []
    private var errorsStorage: [(error: RendererError, surfaceID: String)] = []
    private var outboundStorage: [[String: Any]] = []
    private var lastCallIDStorage: String?
    private var changeWaiters: [UUID: @Sendable () -> Void] = [:]

    var actions: [(action: ResolvedAction, surfaceID: String)] {
      lock.withLock { actionsStorage }
    }

    var errors: [(error: RendererError, surfaceID: String)] {
      lock.withLock { errorsStorage }
    }

    var outbound: [[String: Any]] {
      lock.withLock { outboundStorage }
    }

    var lastCallID: String? {
      lock.withLock { lastCallIDStorage }
    }

    func handle(action: ResolvedAction, from surfaceID: String) {
      let callbacks: [@Sendable () -> Void] = lock.withLock {
        actionsStorage.append((action: action, surfaceID: surfaceID))
        let pending = Array(changeWaiters.values)
        changeWaiters.removeAll()
        return pending
      }
      for callback in callbacks {
        callback()
      }
    }

    func handle(error: RendererError, from surfaceID: String) {
      let callbacks: [@Sendable () -> Void] = lock.withLock {
        errorsStorage.append((error: error, surfaceID: surfaceID))
        let pending = Array(changeWaiters.values)
        changeWaiters.removeAll()
        return pending
      }
      for callback in callbacks {
        callback()
      }
    }

    func recordOutbound(_ message: RendererToAgentMessage) {
      if case .callAgentFunction(let call) = message {
        lock.withLock {
          lastCallIDStorage = call.functionCallID
        }
      }
      do {
        let data = try JSONEncoder().encode(message)
        guard let dictionary = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
          Issue.record("Encoded outbound message was not a JSON object")
          return
        }
        let callbacks: [@Sendable () -> Void] = lock.withLock {
          outboundStorage.append(dictionary)
          let pending = Array(changeWaiters.values)
          changeWaiters.removeAll()
          return pending
        }
        for callback in callbacks {
          callback()
        }
      } catch {
        Issue.record("Failed to encode outbound message: \(error)")
      }
    }

    func clearStepEvents() {
      lock.withLock {
        actionsStorage.removeAll()
        errorsStorage.removeAll()
        outboundStorage.removeAll()
      }
    }

    /// Suspends until the recorded outbound, error, and action counts reach the requested minimums,
    /// or `timeout` elapses so a broken test fails fast instead of hanging.
    func waitUntil(
      outboundCount: Int,
      errorsCount: Int,
      actionsCount: Int,
      timeout: Duration = .seconds(2)
    ) async {
      let deadline = ContinuousClock.now + timeout
      while ContinuousClock.now < deadline {
        let alreadySatisfied = lock.withLock {
          outboundStorage.count >= outboundCount
            && errorsStorage.count >= errorsCount
            && actionsStorage.count >= actionsCount
        }
        if alreadySatisfied {
          return
        }
        let waiterID = UUID()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
          let onceFlag = OnceFlag()
          let resumeOnce: @Sendable () -> Void = {
            if onceFlag.tryClaim() {
              continuation.resume()
            }
          }
          let satisfiedNow = lock.withLock {
            if outboundStorage.count >= outboundCount
              && errorsStorage.count >= errorsCount
              && actionsStorage.count >= actionsCount
            {
              return true
            }
            changeWaiters[waiterID] = resumeOnce
            return false
          }
          if satisfiedNow {
            resumeOnce()
            return
          }
          let remaining = ContinuousClock.now.duration(to: deadline)
          Task {
            if remaining > .zero {
              try? await Task.sleep(for: remaining)
            }
            let expired = self.lock.withLock {
              self.changeWaiters.removeValue(forKey: waiterID)
            }
            expired?()
          }
        }
      }
    }
  }

  /// Snapshot of a rendered view node in the SwiftUI adapter tree.
  struct ViewNode {
    let id: String
    let instanceID: String
    let type: String?
    let state: String
    let occupiesLayout: Bool
    let node: A2UICore.Node?
    let children: [ViewNode]

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
      children: [ViewNode] = []
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
  final class MountedSurface {
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

    init(surface: Surface, hostsViews: Bool = true) {
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
  final class Session {
    let caseName: String
    let protocolVersion: String
    let handler: ActionHandler
    let processor: MessageProcessor
    let uiCatalogs: [Catalog<ComponentImplementation>]
    /// Whether the surface is hosted in a platform window and driven through its native views.
    let hostsViews: Bool
    var mountedHarness: MountedSurface?
    var currentTree: ViewNode?
    var previousTree: ViewNode?
    var selectedTabIndices: [String: Int] = [:]
    var openModalIDs: Set<String> = []

    init(
      caseName: String,
      protocolVersion: String = "1.0",
      handler: ActionHandler,
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

  private static let manifestLock = NSLock()

  /// Reasoned skip entries keyed by `"<case>"` or `"<case>/<op|expectKey>"`.
  @MainActor
  static let unsupported: [String: String] = [
    "v10_theme_dropped_in_permissive_mode_renders_like_none":
      "Theme dropping in permissive mode not yet implemented in A2UICore Swift V10VersionAdapter"
  ]

  @MainActor private static var matchedUnsupportedKeys: Set<String> = []
  @MainActor private static var completedCasesBySuite: [String: Set<String>] = [:]
  @MainActor private static var completedSuites: Set<String> = []
  @MainActor private static var cachedOutboundSchemas: [String: Schema] = [:]

  private static let allAdapterSuites: Set<String> = [
    "core/accessibility.yaml",
    "core/adapter_conformance.yaml",
    "adapter/adapter_conformance_v0_9.yaml",
  ]

  private static let strictErrorSchemaCodes: Set<String> = [
    "VALIDATION_FAILED",
    "UNALLOWED_PARENT",
    "UNALLOWED_CHILD",
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
    "catalogPath",
    "catalogPaths",
    "surface",
    "messages",
    "assertions",
    "steps",
  ]

  static let accessibilityStepKnownKeys: Set<String> = [
    "description",
    "messages",
    "assertions",
    "accessibilityTree",
  ]

  static let accessibilityAssertionsKnownKeys: Set<String> = [
    "accessibilityTree",
    "axeCore",
  ]

  // MARK: - Unknown-Key Validation

  @MainActor
  static func assertDictionaryKeys(
    _ dictionary: [String: Any],
    allowed: Set<String>,
    where location: String
  ) throws {
    let unknown = dictionary.keys.filter { !allowed.contains($0) }.sorted()
    if !unknown.isEmpty {
      let message = "Unknown key(s) at \(location): \(unknown.joined(separator: ", "))"
      Issue.record(Comment(rawValue: message))
      throw ConformanceError(message)
    }
  }

  @MainActor
  static func assertKnownViewNodeKeys(
    _ node: [String: Any],
    where location: String
  ) throws {
    try assertDictionaryKeys(node, allowed: viewNodeKnownKeys, where: location)
    if let results = node["validationResults"] as? [[String: Any]] {
      for (index, item) in results.enumerated() {
        try assertDictionaryKeys(
          item,
          allowed: validationResultKnownKeys,
          where: "\(location).validationResults[\(index)]"
        )
      }
    }
    if let children = node["children"] as? [[String: Any]] {
      for (index, child) in children.enumerated() {
        try assertKnownViewNodeKeys(child, where: "\(location).children[\(index)]")
      }
    }
  }

  /// Validates that `dictionary` only uses keys in `allowed` and recursively checks
  /// nested expectation structures when `allowed == adapterStepKnownKeys`.
  @MainActor
  static func assertKnownKeys(
    _ dictionary: [String: Any],
    allowed: Set<String> = adapterStepKnownKeys,
    where location: String = "step"
  ) throws {
    try assertDictionaryKeys(dictionary, allowed: allowed, where: location)
    guard allowed == adapterStepKnownKeys else { return }

    if let rawOperation = dictionary["op"] {
      guard let operation = rawOperation as? String, adapterStepKnownOps.contains(operation) else {
        let message = "\(location).op: unsupported op \(rawOperation)"
        Issue.record(Comment(rawValue: message))
        throw ConformanceError(message)
      }
    }
    if let viewTree = dictionary["expectViewTree"] as? [String: Any] {
      try assertKnownViewNodeKeys(viewTree, where: "\(location).expectViewTree")
    }
    if let accessibilityTree = dictionary["expectAccessibilityTree"] as? [String: [String: Any]] {
      for (componentID, nodeSpec) in accessibilityTree {
        try assertDictionaryKeys(
          nodeSpec,
          allowed: accessibilityNodeKnownKeys,
          where: "\(location).expectAccessibilityTree.\(componentID)"
        )
      }
    }
    if let actions = dictionary["expectActions"] as? [[String: Any]] {
      for (index, item) in actions.enumerated() {
        try assertDictionaryKeys(
          item,
          allowed: expectedActionKnownKeys,
          where: "\(location).expectActions[\(index)]"
        )
      }
    }
    if let errors = dictionary["expectErrors"] as? [[String: Any]] {
      for (index, item) in errors.enumerated() {
        try assertDictionaryKeys(
          item,
          allowed: expectedErrorKnownKeys,
          where: "\(location).expectErrors[\(index)]"
        )
      }
    }
    if let rawOutbound = dictionary["expectOutbound"] {
      guard let outbound = rawOutbound as? [[String: Any]] else {
        let message = "\(location).expectOutbound: expected array of objects"
        Issue.record(Comment(rawValue: message))
        throw ConformanceError(message)
      }
      for (index, item) in outbound.enumerated() {
        guard item["version"] is String else {
          let message = "\(location).expectOutbound[\(index)].version: expected string"
          Issue.record(Comment(rawValue: message))
          throw ConformanceError(message)
        }
      }
    }
  }

  @MainActor
  static func assertKnownAdapterCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    try assertDictionaryKeys(testCase, allowed: adapterCaseKnownKeys, where: "case(\(name))")
    if let action = testCase["action"] as? String, action != "render_surface" {
      let message = "case(\(name)): unsupported action \(action)"
      Issue.record(Comment(rawValue: message))
      throw ConformanceError(message)
    }
    if let catalogs = testCase["catalogs"] as? [[String: Any]] {
      for (index, catalog) in catalogs.enumerated() {
        try assertDictionaryKeys(
          catalog,
          allowed: adapterCatalogKnownKeys,
          where: "case(\(name)).catalogs[\(index)]"
        )
      }
    }
    let steps = (testCase["steps"] as? [[String: Any]]) ?? []
    for (index, step) in steps.enumerated() {
      try assertKnownKeys(
        step,
        allowed: adapterStepKnownKeys,
        where: "case(\(name)).steps[\(index)]"
      )
    }
  }

  @MainActor
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
      for (componentID, nodeSpec) in tree {
        try assertDictionaryKeys(
          nodeSpec,
          allowed: accessibilityNodeKnownKeys,
          where: "\(location).accessibilityTree.\(componentID)"
        )
      }
    }
  }

  @MainActor
  static func assertKnownAccessibilityCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    try assertDictionaryKeys(
      testCase,
      allowed: accessibilityCaseKnownKeys,
      where: "case(\(name))"
    )
    if let action = testCase["action"] as? String, action != "accessibility_check" {
      let message = "case(\(name)): unsupported action \(action)"
      Issue.record(Comment(rawValue: message))
      throw ConformanceError(message)
    }
    try assertKnownAccessibilityAssertions(
      testCase["assertions"] as? [String: Any],
      where: "case(\(name)).assertions"
    )
    if let steps = testCase["steps"] as? [[String: Any]] {
      for (index, step) in steps.enumerated() {
        try assertDictionaryKeys(
          step,
          allowed: accessibilityStepKnownKeys,
          where: "case(\(name)).steps[\(index)]"
        )
        try assertKnownAccessibilityAssertions(
          step["assertions"] as? [String: Any],
          where: "case(\(name)).steps[\(index)].assertions"
        )
      }
    }
  }

  private static func collectViewTreeKeys(_ node: Any?, into output: inout Set<String>) {
    guard let dictionary = node as? [String: Any] else { return }
    for key in dictionary.keys {
      output.insert(key)
    }
    if let children = dictionary["children"] as? [Any] {
      for child in children {
        collectViewTreeKeys(child, into: &output)
      }
    }
  }

  /// Returns a skip reason if `caseName` or any step in `steps` matches `unsupported`.
  @MainActor
  static func findUnsupportedReason(
    _ caseName: String,
    steps: [[String: Any]] = []
  ) -> String? {
    if let reason = unsupported[caseName] {
      matchedUnsupportedKeys.insert(caseName)
      return reason
    }
    for step in steps {
      if let operation = step["op"] as? String {
        let operationKey = "\(caseName)/\(operation)"
        if let reason = unsupported[operationKey] {
          matchedUnsupportedKeys.insert(operationKey)
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
  @MainActor
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
  @MainActor
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
  @MainActor
  static func recordCaseCompleted(suite: String, caseName: String, expectedTotal: Int) {
    completedCasesBySuite[suite, default: []].insert(caseName)
    if (completedCasesBySuite[suite]?.count ?? 0) >= expectedTotal {
      finishSuite(suite)
    }
  }

  /// Appends a manifest record to `$A2UI_CONFORMANCE_MANIFEST_DIR/<harness>-<pid>.jsonl`.
  static func writeManifestRecord(_ record: ManifestRecord) {
    guard
      let manifestDir = ProcessInfo.processInfo.environment["A2UI_CONFORMANCE_MANIFEST_DIR"],
      !manifestDir.isEmpty
    else {
      return
    }

    var entry: [String: String] = [
      "harness": record.harness,
      "suite": record.suite,
      "case": record.caseName,
      "status": record.status,
    ]
    if let reason = record.reason, !reason.isEmpty {
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

    let directoryURL = URL(fileURLWithPath: manifestDir, isDirectory: true)
    try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    let processID = ProcessInfo.processInfo.processIdentifier
    let fileURL = directoryURL.appendingPathComponent("\(record.harness)-\(processID).jsonl")

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

  /// Creates a `Session` configured for `caseSpec`.
  ///
  /// - Parameter hostsViews: Whether to host the surface in a platform window and drive it
  ///   through its native views, rather than through its resolved nodes.
  @MainActor
  static func mountSurface(
    _ caseSpec: [String: Any],
    hostsViews: Bool = true
  ) throws -> Session {
    let caseName = caseSpec["name"] as? String ?? "<unnamed>"
    let protocolVersion = (caseSpec["protocolVersion"] as? String) ?? "1.0"
    let handler = ActionHandler()
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
    return Session(
      caseName: caseName,
      protocolVersion: protocolVersion,
      handler: handler,
      processor: processor,
      uiCatalogs: uiCatalogs,
      hostsViews: hostsViews
    )
  }

  /// Extracts the current resolved view tree from `session`.
  @MainActor
  static func extractViewTree(_ session: Session) throws -> ViewNode? {
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
    if let dictionary = value as? [String: Any] {
      if dictionary["$ref"] as? String == "lastCallId", dictionary.count == 1 {
        return lastCallId
      }
      var result: [String: Any] = [:]
      for (key, nestedValue) in dictionary {
        result[key] = substituteLastCallId(nestedValue, lastCallId: lastCallId)
      }
      return result
    }
    return value
  }

  /// Returns all `Modal` component IDs in `rootNode` whose trigger subtree activates when
  /// `targetID` is pressed, stopping at nested `Modal` boundaries.
  @MainActor
  static func modalIDsTriggered(
    by targetID: String,
    in rootNode: A2UICore.Node
  ) -> Set<String> {
    var nodes: [String: A2UICore.Node] = [:]
    collectNodes(from: rootNode, into: &nodes)
    var triggeredIDs: Set<String> = []
    for candidate in nodes.values where candidate.type == "Modal" {
      if candidate.id == targetID {
        triggeredIDs.insert(candidate.id)
      } else if let triggerRoot = candidate.child(for: "trigger"),
        triggerSubtreeContains(componentID: targetID, in: triggerRoot, isTriggerRoot: true)
      {
        triggeredIDs.insert(candidate.id)
      }
    }
    return triggeredIDs
  }

  @MainActor
  private static func triggerSubtreeContains(
    componentID: String,
    in node: A2UICore.Node,
    isTriggerRoot: Bool
  ) -> Bool {
    if !isTriggerRoot && node.type == "Modal" {
      return false
    }
    if node.id == componentID {
      return true
    }
    return node.allChildNodes.contains { childNode in
      triggerSubtreeContains(
        componentID: componentID,
        in: childNode,
        isTriggerRoot: false
      )
    }
  }

  /// Executes the step operation against `session` without running assertions yet.
  @MainActor
  private static func executeStepOperation(
    _ session: Session,
    _ step: [String: Any]
  ) throws {
    try assertKnownKeys(step)
    session.handler.clearStepEvents()
    let operation = step["op"] as? String ?? "process_messages"
    switch operation {
    case "process_messages":
      let rawMessages = (step["messages"] as? [[String: Any]]) ?? []
      let messages =
        (substituteLastCallId(rawMessages, lastCallId: session.handler.lastCallID ?? "")
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
        throw ConformanceError("\(session.caseName): expected active subscriptions")
      }
      session.mountedHarness?.unmount()
      session.currentTree = nil
    default:
      Issue.record("Unsupported op \(operation)")
      throw ConformanceError("Unsupported op \(operation)")
    }
  }

  /// Yields to `@MainActor` tasks spawned during a step and awaits deterministic handler signals
  /// when asynchronous outbound, error, or action events are expected.
  @MainActor
  private static func settleAdapterStep(
    _ step: [String: Any],
    session: Session
  ) async throws {
    let expectedOutboundCount = (step["expectOutbound"] as? [[String: Any]])?.count ?? 0
    let expectedErrorsCount = (step["expectErrors"] as? [[String: Any]])?.count ?? 0
    let expectedActionsCount = (step["expectActions"] as? [[String: Any]])?.count ?? 0
    for _ in 0..<4 {
      await Task.yield()
    }
    let expectsAsyncEvents =
      expectedOutboundCount > 0 || expectedErrorsCount > 0 || expectedActionsCount > 0
    if expectsAsyncEvents {
      await session.handler.waitUntil(
        outboundCount: expectedOutboundCount,
        errorsCount: expectedErrorsCount,
        actionsCount: expectedActionsCount
      )
      for _ in 0..<2 {
        await Task.yield()
      }
      session.mountedHarness?.driver?.flush()
      session.currentTree = try extractViewTree(session)
    }
  }

  /// Executes a single adapter conformance `step` against `session` and verifies expectations.
  @MainActor
  static func runStep(
    _ session: Session,
    _ step: [String: Any],
    context: String? = nil
  ) throws {
    let stepContext = context ?? session.caseName
    try executeStepOperation(session, step)
    try verifyAdapterStep(step, session: session, context: stepContext)
    if let currentTree = session.currentTree {
      session.previousTree = currentTree
    }
  }

  /// Asynchronously executes a single adapter conformance `step` against `session`, awaiting
  /// any `@MainActor` tasks spawned by the step before verifying expectations.
  @MainActor
  static func runStepAsync(
    _ session: Session,
    _ step: [String: Any],
    context: String? = nil
  ) async throws {
    let stepContext = context ?? session.caseName
    try executeStepOperation(session, step)
    try await settleAdapterStep(step, session: session)
    try verifyAdapterStep(step, session: session, context: stepContext)
    if let currentTree = session.currentTree {
      session.previousTree = currentTree
    }
  }

  /// Verifies that `actual` matches `expected`.
  @MainActor
  static func assertViewTree(
    _ actual: ViewNode?,
    _ expected: [String: Any],
    context: String = "root"
  ) throws {
    try assertKnownViewNodeKeys(expected, where: "\(context).expectViewTree")
    guard let viewNode = actual else {
      let message = "\(context): expected ViewNode but got nil"
      Issue.record(Comment(rawValue: message))
      throw ConformanceError(message)
    }
    if let expectedID = expected["id"] as? String {
      #expect(viewNode.id == expectedID, "\(context): id mismatch")
      if viewNode.id != expectedID {
        throw ConformanceError("\(context): id mismatch")
      }
    }
    if let expectedType = expected["type"] as? String {
      #expect(viewNode.type == expectedType, "\(context): type mismatch")
      if viewNode.type != expectedType {
        throw ConformanceError("\(context): type mismatch")
      }
    }
    if let expectedState = expected["state"] as? String {
      #expect(viewNode.state == expectedState, "\(context): state mismatch")
      if viewNode.state != expectedState {
        throw ConformanceError("\(context): state mismatch")
      }
    }
    if let expectedOccupies = expected["occupiesLayout"] as? Bool {
      #expect(viewNode.occupiesLayout == expectedOccupies, "\(context): occupiesLayout mismatch")
      if viewNode.occupiesLayout != expectedOccupies {
        throw ConformanceError("\(context): occupiesLayout mismatch")
      }
    }
    try assertViewNodeProperties(viewNode, expected: expected, context: context)
    if let expectedChildren = expected["children"] as? [[String: Any]] {
      #expect(
        viewNode.children.count == expectedChildren.count,
        "\(context): children count mismatch"
      )
      if viewNode.children.count != expectedChildren.count {
        throw ConformanceError("\(context): children count mismatch")
      }
      for (index, expectedChild) in zip(viewNode.children.indices, expectedChildren) {
        try assertViewTree(
          viewNode.children[index],
          expectedChild,
          context: "\(context)/children/\(index)"
        )
      }
    }
  }

  // MARK: - Internal Helpers

  @MainActor
  private static func buildCatalogs(
    for testCase: [String: Any]
  ) throws -> ([AnyCatalog], [Catalog<ComponentImplementation>]) {
    let incrementFunction = try IncrementCounterFunction()
    let v10Functions = V10BasicCatalog.functions + [incrementFunction]
    var coreCatalogs: [AnyCatalog] = BasicCatalog.allCatalogs.map { catalog in
      Catalog(
        id: catalog.id,
        protocolVersion: catalog.protocolVersion,
        components: Array(catalog.components.values),
        functions: Array(catalog.functions.values) + [incrementFunction],
        themeSchema: catalog.themeSchema
      ).eraseToAnyCatalog()
    }
    var uiCatalogs: [Catalog<ComponentImplementation>] = BasicCatalogImplementation.allCatalogs
    let customDefinitions = (testCase["catalogs"] as? [[String: Any]]) ?? []
    for custom in customDefinitions {
      if let (coreCatalog, uiCatalog) = try buildCustomCatalog(custom, functions: v10Functions) {
        coreCatalogs.append(coreCatalog)
        uiCatalogs.append(uiCatalog)
      }
    }
    return (coreCatalogs, uiCatalogs)
  }

  @MainActor
  private static func buildCustomCatalog(
    _ custom: [String: Any],
    functions: [any FunctionImplementation]
  ) throws -> (AnyCatalog, Catalog<ComponentImplementation>)? {
    guard let catalogID = custom["catalogId"] as? String else {
      return nil
    }
    let componentDictionary = (custom["components"] as? [String: Any]) ?? [:]
    let emptySchema = try Schema(instance: "{}")
    var coreAPIs: [AnyComponentAPI] = []
    var uiImplementations: [ComponentImplementation] = []
    for componentName in componentDictionary.keys {
      let api = AnyComponentAPI(name: componentName, schema: emptySchema)
      coreAPIs.append(api)
      uiImplementations.append(
        ComponentImplementation(api: api) { node in
          Text(node.string(for: "badgeText") ?? node.string(for: "text") ?? "")
        }
      )
    }
    var catalogFunctions = functions
    if let functionDictionary = custom["functions"] as? [String: Any] {
      for functionName in functionDictionary.keys {
        let functionAPI = FunctionAPI(
          name: functionName,
          returnType: .void,
          schema: emptySchema,
          allowedCallers: .rendererOrAgent
        )
        catalogFunctions.append(SchemaOnlyFunction(api: functionAPI))
      }
    }
    let coreCatalog = Catalog(
      id: catalogID,
      protocolVersion: .v10,
      components: coreAPIs,
      functions: catalogFunctions
    ).eraseToAnyCatalog()
    let uiCatalog = Catalog(
      id: catalogID,
      protocolVersion: .v10,
      components: uiImplementations,
      functions: catalogFunctions
    )
    return (coreCatalog, uiCatalog)
  }

  @MainActor
  private static func processAdapterMessages(
    _ messages: [[String: Any]],
    session: Session
  ) throws {
    try session.processor.processMessages(toJSONValue(messages))
    if let harness = session.mountedHarness,
      session.processor.surfaceGroupModel.surfacesMap[harness.surface.surfaceID] == nil
    {
      harness.unmount()
    } else if session.mountedHarness == nil,
      let viewModel = session.processor.surfaceGroupModel.surfacesMap["adapter_surface"]
        ?? session.processor.surfaceGroupModel.surfacesMap.values.first
    {
      let defaultVersion: A2UIProtocolVersion =
        session.protocolVersion == "v0.9" || session.protocolVersion == "0.9"
        ? .v09
        : .v10
      let surface = Surface(
        viewModel: viewModel,
        catalogs: session.uiCatalogs,
        defaultCatalogID: BasicCatalog.catalogURI(version: defaultVersion)
      )
      session.mountedHarness = MountedSurface(
        surface: surface,
        hostsViews: session.hostsViews
      )
    } else {
      session.mountedHarness?.driver?.flush()
    }
  }

  @MainActor
  private static func applyUserInput(_ step: [String: Any], session: Session) throws {
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
    if targetType == "CheckBox", let booleanValue = step["inputValue"] as? Bool {
      try driver.setToggle(booleanValue, componentID: targetID)
    } else if targetType == "ChoicePicker", let arrayValue = step["inputValue"] as? [Any] {
      try driver.selectChoices(arrayValue.compactMap { $0 as? String }, componentID: targetID)
    } else if targetType == "Tabs", let integerValue = step["inputValue"] as? Int {
      try driver.selectTab(index: integerValue, componentID: targetID)
    } else if targetType == "Slider", let integerValue = step["inputValue"] as? Int {
      try driver.setSliderValue(Double(integerValue), componentID: targetID)
    } else if targetType == "Slider", let doubleValue = step["inputValue"] as? Double {
      try driver.setSliderValue(doubleValue, componentID: targetID)
    } else if targetType == "DateTimeInput", let stringValue = step["inputValue"] as? String {
      try driver.setDateTime(stringValue, componentID: targetID)
    } else if let booleanValue = step["inputValue"] as? Bool {
      try driver.setToggle(booleanValue, componentID: targetID)
    } else if let stringValue = step["inputValue"] as? String {
      try driver.enterText(stringValue, componentID: targetID)
    }
  }

  /// Writes a user input value through the binding of the resolved node's component view, for
  /// the harness that does not host the surface.
  @MainActor
  private static func writeUserInputToNode(
    _ inputValue: Any?,
    componentID: String,
    targetType: String?,
    session: Session,
    surface: Surface
  ) throws {
    guard let targetNode = findNode(componentID: componentID, in: surface) else {
      throw ConformanceError("Component '\(componentID)' not found in surface")
    }
    let effectiveType = targetType ?? targetNode.type
    if effectiveType == "CheckBox", let booleanValue = inputValue as? Bool {
      A2UICheckBox(node: targetNode).isOn.wrappedValue = booleanValue
    } else if effectiveType == "ChoicePicker", let arrayValue = inputValue as? [Any] {
      let picker = A2UIChoicePicker(node: targetNode)
      for value in arrayValue.compactMap({ $0 as? String }) {
        picker.selectionBinding(forOptionValue: value).wrappedValue = true
      }
    } else if effectiveType == "Tabs", let integerValue = inputValue as? Int {
      session.selectedTabIndices[componentID] = integerValue
    } else if effectiveType == "Slider", let integerValue = inputValue as? Int {
      targetNode.binding(for: "value", default: 0.0).wrappedValue = Double(integerValue)
    } else if effectiveType == "Slider", let doubleValue = inputValue as? Double {
      targetNode.binding(for: "value", default: 0.0).wrappedValue = doubleValue
    } else if effectiveType == "DateTimeInput", let stringValue = inputValue as? String {
      if let parsed = DateTimeInputValue(parsing: stringValue) {
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
        (targetNode.dataBinding(for: "value") as DataBinding<String>?)?.set(stringValue)
      }
    } else if let booleanValue = inputValue as? Bool {
      A2UICheckBox(node: targetNode).isOn.wrappedValue = booleanValue
    } else if let stringValue = inputValue as? String {
      A2UITextField(node: targetNode).valueBinding.wrappedValue = stringValue
    }
  }

  @MainActor
  private static func invokeUserGesture(_ step: [String: Any], session: Session) throws {
    guard let harness = session.mountedHarness,
      let targetID = step["targetNode"] as? String
    else {
      return
    }
    guard let driver = harness.driver else {
      // Without a hosted view, the gesture runs the resolved node's action as a press would.
      guard let targetNode = findNode(componentID: targetID, in: harness.surface) else {
        throw ConformanceError("Component '\(targetID)' not found in surface")
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
      if let rootNode = harness.surface.viewModel.rootNode {
        session.openModalIDs.formUnion(modalIDsTriggered(by: targetID, in: rootNode))
      }
      return
    }
    try driver.press(componentID: targetID)
  }

  @MainActor
  private static func findNode(componentID: String, in surface: Surface) -> A2UICore.Node? {
    guard let rootNode = surface.viewModel.rootNode else { return nil }
    var nodes: [String: A2UICore.Node] = [:]
    collectNodes(from: rootNode, in: surface, into: &nodes)
    return nodes[componentID]
  }

  @MainActor
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
    collectNodes(from: rootNode, in: surface, into: &nodes)
    guard let targetNode = nodes[targetID] else { return }
    let property = (step["actionProperty"] as? String) ?? "action"
    invokeAction(on: targetNode, property: property, userActivation: userActivation)
  }

  @MainActor
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

  @MainActor
  static func resolveViewTree(
    for surface: Surface,
    driver: HostedViewDriver? = nil,
    selectedTabIndices: [String: Int] = [:],
    openModalIDs: Set<String> = []
  ) throws -> ViewNode? {
    guard let rootNode = surface.viewModel.rootNode else { return nil }
    return try buildViewNode(
      in: surface,
      driver: driver,
      selectedTabIndices: selectedTabIndices,
      openModalIDs: openModalIDs,
      node: rootNode
    )
  }

  @MainActor
  private static func buildViewNode(
    in surface: Surface,
    driver: HostedViewDriver?,
    selectedTabIndices: [String: Int],
    openModalIDs: Set<String>,
    node: A2UICore.Node
  ) throws -> ViewNode {
    let rendered = Surface.render(
      node: node,
      using: surface.catalogs,
      defaultCatalogID: surface.defaultCatalogID
    )
    if node.state == .resolved {
      #expect(rendered != nil, "Expected Surface.render builder for '\(node.type)'")
      if rendered == nil {
        throw ConformanceError("Expected Surface.render builder for '\(node.type)'")
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
    return ViewNode(
      id: baseID,
      instanceID: node.id,
      type: node.type,
      state: node.state.rawValue,
      occupiesLayout: rendered != nil && node.state == .resolved,
      node: node,
      children: children
    )
  }

  @MainActor
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
    while let underscoreIndex = candidate.lastIndex(of: "_") {
      let suffix = candidate[candidate.index(after: underscoreIndex)...]
      guard !suffix.isEmpty, suffix.allSatisfy(\.isNumber) else { break }
      candidate = String(candidate[..<underscoreIndex])
      if surface.viewModel.componentsModel.get(candidate) != nil {
        return candidate
      }
    }
    return String(node.id.split(separator: ":").first ?? Substring(node.id))
  }

  @MainActor
  private static func resolveChildViewNodes(
    in surface: Surface,
    driver: HostedViewDriver?,
    selectedTabIndices: [String: Int],
    openModalIDs: Set<String>,
    node: A2UICore.Node
  ) throws -> [ViewNode] {
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
      var modalChildren: [ViewNode] = []
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
      let isOpen =
        if let driver {
          driver.isModalOpen(node.id)
        } else {
          openModalIDs.contains(node.id)
        }
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

  @MainActor
  private static func resolveTabChildren(for node: A2UICore.Node) -> [A2UICore.Node] {
    if let array = node.array(for: "tabs") {
      return array.compactMap { element in
        let dictionary = element as? ResolvedDictionary
        if let child = dictionary?["child"] as? A2UICore.Node {
          return child
        }
        let childID = dictionary?["child"] as? String ?? ""
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

  @MainActor
  private static func verifyAdapterStep(
    _ step: [String: Any],
    session: Session,
    context: String
  ) throws {
    if let expectedTree = step["expectViewTree"] as? [String: Any] {
      try assertViewTree(session.currentTree, expectedTree, context: context)
    }
    if let expectedData = step["expectDataModel"] {
      guard let surface = session.mountedHarness?.surface else {
        let message = "\(context): expected mounted surface for expectDataModel"
        Issue.record(Comment(rawValue: message))
        throw ConformanceError(message)
      }
      let expectedJSON = toJSONValue(expectedData)
      let matches = jsonValuesEqual(surface.viewModel.dataModel.data, expectedJSON)
      #expect(matches, "\(context): dataModel mismatch")
      if !matches {
        throw ConformanceError("\(context): dataModel mismatch")
      }
    }
    if let expectedSameIDs = step["expectSameViewIdentity"] as? [String] {
      try assertSameViewIdentities(
        expectedSameIDs,
        previousTree: session.previousTree,
        currentTree: session.currentTree,
        context: context
      )
    }
    if let expectedNewIDs = step["expectNewViewIdentity"] as? [String] {
      try assertNewViewIdentities(
        expectedNewIDs,
        previousTree: session.previousTree,
        currentTree: session.currentTree,
        context: context
      )
    }
    if let expectedDisposedIDs = step["expectDisposedNodes"] as? [String] {
      try assertDisposedNodes(
        expectedDisposedIDs,
        previousTree: session.previousTree,
        currentTree: session.currentTree,
        surface: session.mountedHarness?.surface,
        context: context
      )
    }
    if (step["expectSurfaceRemoved"] as? Bool) == true {
      try assertSurfaceRemoved(session: session, context: context)
    }
    if let expectedActions = step["expectActions"] as? [[String: Any]] {
      try assertActionsMatch(session.handler.actions, expected: expectedActions, context: context)
    }
    if let expectedErrors = step["expectErrors"] as? [[String: Any]] {
      try assertErrorsMatch(session.handler.errors, expected: expectedErrors, context: context)
    }
    try validateOutboundEnvelopes(
      session.handler.outbound,
      protocolVersion: session.protocolVersion,
      context: context
    )
    if let expectedOutbound = step["expectOutbound"] as? [[String: Any]] {
      try assertOutboundMatches(
        session.handler.outbound,
        expected: expectedOutbound,
        context: context
      )
    }
    if let expectedAccessibility = step["expectAccessibilityTree"] as? [String: [String: Any]] {
      guard let currentTree = session.currentTree else {
        let message = "\(context): expected resolved view tree for expectAccessibilityTree"
        Issue.record(Comment(rawValue: message))
        throw ConformanceError(message)
      }
      try assertAccessibilityTreeMatches(
        currentTree,
        driver: session.mountedHarness?.driver,
        expected: expectedAccessibility,
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
        throw ConformanceError("\(context): expectThemeAbsent failed")
      }
    }
    if let expectedSubscriptions = step["expectActiveSubscriptions"] as? Int {
      guard let harness = session.mountedHarness else {
        let message = "\(context): expected mounted harness for expectActiveSubscriptions"
        Issue.record(Comment(rawValue: message))
        throw ConformanceError(message)
      }
      try assertActiveSubscriptions(
        harness: harness,
        expected: expectedSubscriptions,
        context: context
      )
    }
  }

  @MainActor
  private static func assertActiveSubscriptions(
    harness: MountedSurface,
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
      throw ConformanceError("\(context): subscription count mismatch")
    }
  }

  @MainActor
  private static func assertViewNodeProperties(
    _ viewNode: ViewNode,
    expected: [String: Any],
    context: String
  ) throws {
    guard let node = viewNode.node else { return }
    if let expectedText = expected["text"] as? String {
      #expect(node.string(for: "text") == expectedText, "\(context): text mismatch")
      if node.string(for: "text") != expectedText {
        throw ConformanceError("\(context): text mismatch")
      }
    }
    if let expectedValue = expected["value"] {
      let actualJSON = resolvedValueJSON(for: node, key: "value")
      let expectedJSON = toJSONValue(expectedValue)
      let matches = actualJSON.map { jsonValuesEqual($0, expectedJSON) } ?? false
      #expect(matches, "\(context): value mismatch")
      if !matches {
        throw ConformanceError("\(context): value mismatch")
      }
    }
    if let expectedBadge = expected["badgeText"] as? String {
      #expect(node.string(for: "badgeText") == expectedBadge, "\(context): badgeText mismatch")
      if node.string(for: "badgeText") != expectedBadge {
        throw ConformanceError("\(context): badgeText mismatch")
      }
    }
    for key in ["url", "name", "axis"] {
      if let expectedString = expected[key] as? String {
        let actualString = node.string(for: key)
        #expect(actualString == expectedString, "\(context): \(key) mismatch")
        if actualString != expectedString {
          throw ConformanceError("\(context): \(key) mismatch")
        }
      }
    }
    try assertValidationProperties(node, expected: expected, context: context)
  }

  @MainActor
  private static func assertValidationProperties(
    _ node: A2UICore.Node,
    expected: [String: Any],
    context: String
  ) throws {
    let textField = A2UITextField(node: node)
    if let expectedValid = expected["isValid"] as? Bool {
      #expect(textField.isValid == expectedValid, "\(context): isValid mismatch")
      if textField.isValid != expectedValid {
        throw ConformanceError("\(context): isValid mismatch")
      }
    }
    if let expectedErrors = expected["validationErrors"] as? [String] {
      #expect(
        textField.validationErrors == expectedErrors,
        "\(context): validationErrors mismatch"
      )
      if textField.validationErrors != expectedErrors {
        throw ConformanceError("\(context): validationErrors mismatch")
      }
    }
    if let expectedHints = expected["hints"] as? [String] {
      let actualHints = textField.validationResults.compactMap { result -> String? in
        guard result.severity == .warning || result.severity == .info else { return nil }
        return result.message
      }
      #expect(actualHints == expectedHints, "\(context): hints mismatch")
      if actualHints != expectedHints {
        throw ConformanceError("\(context): hints mismatch")
      }
    }
    guard let expectedResults = expected["validationResults"] as? [[String: Any]] else { return }
    #expect(
      textField.validationResults.count == expectedResults.count,
      "\(context): results count"
    )
    if textField.validationResults.count != expectedResults.count {
      throw ConformanceError("\(context): results count mismatch")
    }
    for (index, expectedResult) in zip(textField.validationResults.indices, expectedResults) {
      let actual = textField.validationResults[index]
      if let expectedItemValid = expectedResult["valid"] as? Bool {
        #expect(actual.valid == expectedItemValid, "\(context): result valid mismatch")
        if actual.valid != expectedItemValid {
          throw ConformanceError("\(context): result valid mismatch")
        }
      }
      if let expectedCode = expectedResult["code"] as? String {
        #expect(actual.code == expectedCode, "\(context): result code mismatch")
        if actual.code != expectedCode {
          throw ConformanceError("\(context): result code mismatch")
        }
      }
      if let expectedMessage = expectedResult["message"] as? String {
        #expect(actual.message == expectedMessage, "\(context): result message mismatch")
        if actual.message != expectedMessage {
          throw ConformanceError("\(context): result message mismatch")
        }
      }
      if let expectedSeverity = expectedResult["severity"] as? String {
        let actualSeverity = (actual.severity ?? ValidationSeverity.error).rawValue
        #expect(actualSeverity == expectedSeverity, "\(context): result severity mismatch")
        if actualSeverity != expectedSeverity {
          throw ConformanceError("\(context): result severity mismatch")
        }
      }
    }
  }

  @MainActor
  private static func assertSameViewIdentities(
    _ paths: [String],
    previousTree: ViewNode?,
    currentTree: ViewNode?,
    context: String
  ) throws {
    for path in paths {
      let previousNode = findViewNode(atPath: path, in: previousTree)
      let currentNode = findViewNode(atPath: path, in: currentTree)
      #expect(previousNode != nil && currentNode != nil, "\(context): missing node at \(path)")
      // Compare object identity: the instance IDs are deterministic strings that match even
      // when the resolver recreates the backing node.
      let sameIdentity =
        previousNode?.instanceID == currentNode?.instanceID
        && previousNode?.identity != nil
        && previousNode?.identity == currentNode?.identity
      #expect(sameIdentity, "\(context): identity changed at \(path)")
      if previousNode == nil || currentNode == nil || !sameIdentity {
        throw ConformanceError("\(context): identity mismatch at \(path)")
      }
    }
  }

  @MainActor
  private static func assertNewViewIdentities(
    _ paths: [String],
    previousTree: ViewNode?,
    currentTree: ViewNode?,
    context: String
  ) throws {
    for path in paths {
      let previousNode = findViewNode(atPath: path, in: previousTree)
      let currentNode = findViewNode(atPath: path, in: currentTree)
      #expect(previousNode != nil && currentNode != nil, "\(context): missing node at \(path)")
      let identityChanged =
        previousNode?.instanceID != currentNode?.instanceID
        || previousNode?.identity != currentNode?.identity
      #expect(identityChanged, "\(context): expected new identity at \(path)")
      if previousNode == nil || currentNode == nil || !identityChanged {
        throw ConformanceError("\(context): expected new identity at \(path)")
      }
    }
  }

  @MainActor
  private static func assertDisposedNodes(
    _ nodeIDs: [String],
    previousTree: ViewNode?,
    currentTree: ViewNode?,
    surface: Surface?,
    context: String
  ) throws {
    for nodeID in nodeIDs {
      let previousNode = findViewNodeByID(nodeID, in: previousTree)
      let currentNode = findViewNodeByID(nodeID, in: currentTree)
      #expect(previousNode != nil, "\(context): expected previous node '\(nodeID)'")
      #expect(currentNode == nil, "\(context): expected node '\(nodeID)' to be unmounted")
      let counter = NodeChangeCounter()
      if let node = previousNode?.node {
        observeNodeChanges(node, counter: counter)
      }
      if let dataModel = surface?.viewModel.dataModel {
        let originalData = dataModel.data
        var probePaths: Set<String> = ["/old"]
        for topLevelKey in originalData.objectValue?.keys ?? [] {
          probePaths.insert("/\(topLevelKey)")
        }
        for path in probePaths.sorted() {
          let currentValue = dataModel.get(path)
          let probeValue: JSONValue =
            currentValue == .string("__disposed_probe__")
            ? .string("__disposed_probe_alt__")
            : .string("__disposed_probe__")
          dataModel.set(path, value: probeValue)
        }
        let emissions = counter.value
        dataModel.set("/", value: originalData)
        #expect(emissions == 0, "\(context): disposed node '\(nodeID)' still emitted")
        if previousNode == nil || currentNode != nil || emissions != 0 {
          throw ConformanceError("\(context): disposed node check failed for '\(nodeID)'")
        }
      } else {
        let emissions = counter.value
        #expect(emissions == 0, "\(context): disposed node '\(nodeID)' still emitted")
        if previousNode == nil || currentNode != nil || emissions != 0 {
          throw ConformanceError("\(context): disposed node check failed for '\(nodeID)'")
        }
      }
    }
  }

  @MainActor
  private static func assertSurfaceRemoved(
    session: Session,
    context: String
  ) throws {
    guard let harness = session.mountedHarness else {
      throw ConformanceError("\(context): no mounted harness")
    }
    let surfaceID = harness.surface.surfaceID
    let inGroup = session.processor.surfaceGroupModel.surfacesMap[surfaceID] != nil
    #expect(!inGroup, "\(context): surface '\(surfaceID)' still in surfaceGroupModel")
    #expect(!harness.isMounted, "\(context): surface harness still mounted")
    #expect(session.currentTree == nil, "\(context): expected nil currentTree")
    if inGroup || harness.isMounted || session.currentTree != nil {
      throw ConformanceError("\(context): expectSurfaceRemoved failed")
    }
  }

  private static func findViewNodeByID(
    _ identifier: String,
    in root: ViewNode?
  ) -> ViewNode? {
    guard let root else { return nil }
    if root.id == identifier || root.instanceID == identifier {
      return root
    }
    for child in root.children {
      if let match = findViewNodeByID(identifier, in: child) {
        return match
      }
    }
    return nil
  }

  private static func findViewNode(
    atPath path: String,
    in root: ViewNode?
  ) -> ViewNode? {
    guard let root else { return nil }
    let trimmed = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    if trimmed.isEmpty {
      return root
    }
    let segments = trimmed.split(separator: "/").map(String.init)
    var index = 0
    if segments.first == root.id || segments.first == "root" {
      index = 1
    }
    var current: ViewNode? = root
    while index < segments.count, let node = current {
      let segment = segments[index]
      if segment == "children",
        index + 1 < segments.count,
        let childIndex = Int(segments[index + 1])
      {
        guard childIndex >= 0 && childIndex < node.children.count else { return nil }
        current = node.children[childIndex]
        index += 2
      } else if let childIndex = Int(segment) {
        guard childIndex >= 0 && childIndex < node.children.count else { return nil }
        current = node.children[childIndex]
        index += 1
      } else if let match = node.children.first(where: {
        $0.id == segment || $0.instanceID == segment
      }) {
        current = match
        index += 1
      } else {
        return nil
      }
    }
    return current
  }

  @MainActor
  private static func assertActionsMatch(
    _ actual: [(action: ResolvedAction, surfaceID: String)],
    expected: [[String: Any]],
    context: String
  ) throws {
    #expect(actual.count == expected.count, "\(context): action count mismatch")
    if actual.count != expected.count {
      throw ConformanceError("\(context): action count mismatch")
    }
    for (index, expectedEntry) in zip(actual.indices, expected) {
      let entry = actual[index]
      guard case .event(let name, let actionContext, _) = entry.action.identity else {
        Issue.record("\(context): expected event action at \(index)")
        throw ConformanceError("\(context): expected event action at \(index)")
      }
      if let expectedName = expectedEntry["name"] as? String {
        #expect(name == expectedName, "\(context): action name mismatch")
        if name != expectedName {
          throw ConformanceError("\(context): action name mismatch")
        }
      }
      if let expectedSurface = expectedEntry["surfaceId"] as? String {
        #expect(entry.surfaceID == expectedSurface, "\(context): action surfaceId mismatch")
        if entry.surfaceID != expectedSurface {
          throw ConformanceError("\(context): action surfaceId mismatch")
        }
      }
      if let expectedSource = expectedEntry["sourceComponentId"] as? String {
        let sourceID = entry.action.sourceComponentID
        #expect(sourceID == expectedSource, "\(context): action sourceComponentId mismatch")
        if sourceID != expectedSource {
          throw ConformanceError("\(context): action sourceComponentId mismatch")
        }
      }
      if let expectedContextDict = expectedEntry["context"] as? [String: Any] {
        let expectedContext = expectedContextDict.mapValues { toJSONValue($0) }
        let actualContext = actionContext ?? [:]
        #expect(actualContext == expectedContext, "\(context): action context mismatch")
        if actualContext != expectedContext {
          throw ConformanceError("\(context): action context mismatch")
        }
      }
    }
  }

  @MainActor
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
      throw ConformanceError(
        "\(context): expected \(expected.count) errors, got \(actual.count)"
      )
    }
    for expectedError in expected {
      let expectedCode = expectedError["code"] as? String
      let expectedSurface = expectedError["surfaceId"] as? String
      let expectedMessage =
        (expectedError["messageContains"] ?? expectedError["message"]) as? String
      let matched = actual.contains { entry in
        let fields = rendererErrorFields(entry.error)
        let effectiveSurfaceID = fields.surfaceID ?? entry.surfaceID
        let codeMatch = expectedCode == nil || fields.code == expectedCode
        let surfaceMatch = expectedSurface == nil || effectiveSurfaceID == expectedSurface
        let messageMatch = expectedMessage == nil || fields.message.contains(expectedMessage ?? "")
        return codeMatch && surfaceMatch && messageMatch
      }
      #expect(matched, "\(context): missing expected error \(expectedError)")
      if !matched {
        throw ConformanceError("\(context): missing expected error \(expectedError)")
      }
    }
  }

  private static func rendererErrorFields(
    _ error: RendererError
  ) -> (code: String, surfaceID: String?, message: String) {
    switch error {
    case .validationFailed(let validation):
      return (validation.code.rawValue, validation.surfaceID, validation.message)
    case .generic(let generic):
      return (generic.code, generic.surfaceID, generic.message)
    }
  }

  @MainActor
  private static func loadSpecificationSchema(relativePath: String) throws -> Schema {
    if let cached = cachedOutboundSchemas[relativePath] {
      return cached
    }
    let repoRoot = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let schemaURL = repoRoot.appendingPathComponent("specification").appendingPathComponent(
      relativePath
    )
    let schemaText: String
    do {
      schemaText = try String(contentsOf: schemaURL, encoding: .utf8)
    } catch {
      throw ConformanceError(
        "Failed to read specification schema '\(relativePath)' at \(schemaURL.path): \(error)"
      )
    }
    let rawJSON: JSONValue
    do {
      rawJSON = try JSONValue.parse(schemaText)
    } catch {
      throw ConformanceError(
        "Failed to parse specification schema '\(relativePath)': \(error)"
      )
    }
    let compiledSchema: Schema
    do {
      compiledSchema = try Schema(rawSchema: rawJSON, context: A2UISchemaRegistry.makeContext())
    } catch {
      throw ConformanceError(
        "Failed to compile specification schema '\(relativePath)': \(error)"
      )
    }
    cachedOutboundSchemas[relativePath] = compiledSchema
    return compiledSchema
  }

  @MainActor
  private static func validateOutboundEnvelopes(
    _ envelopes: [[String: Any]],
    protocolVersion: String,
    context: String
  ) throws {
    let isV09 = protocolVersion.hasPrefix("v0.9") || protocolVersion.hasPrefix("0.9")
    let relativePath =
      isV09
      ? "v0_9_1/json/client_to_server.json"
      : "v1_0/json/renderer_to_agent.json"
    let schema = try loadSpecificationSchema(relativePath: relativePath)
    for (index, envelope) in envelopes.enumerated() {
      let jsonValue = toJSONValue(envelope)
      let result = schema.validate(jsonValue)
      #expect(
        result.isValid,
        "\(context): outbound[\(index)] failed protocol schema validation"
      )
      if !result.isValid {
        throw ConformanceError(
          "\(context): outbound[\(index)] failed protocol schema validation"
        )
      }
    }
  }

  private static func isMatchAny(_ value: Any) -> Bool {
    guard let dictionary = value as? [String: Any], dictionary.count == 1 else { return false }
    return (dictionary["$match"] as? String) == "any"
  }

  @MainActor
  private static func assertMatchesExpectedOutbound(
    _ actual: Any,
    expected: Any,
    where location: String
  ) throws {
    if isMatchAny(expected) {
      let isNonNull = !(actual is NSNull)
      #expect(isNonNull, "\(location): expected non-null value for {$match: \"any\"}")
      if !isNonNull {
        throw ConformanceError("\(location): expected non-null value")
      }
      return
    }
    if let expectedArray = expected as? [Any] {
      guard let actualArray = actual as? [Any], actualArray.count == expectedArray.count else {
        let message = "\(location): array length mismatch"
        Issue.record(Comment(rawValue: message))
        throw ConformanceError(message)
      }
      for (index, expectedElement) in zip(actualArray.indices, expectedArray) {
        try assertMatchesExpectedOutbound(
          actualArray[index],
          expected: expectedElement,
          where: "\(location)[\(index)]"
        )
      }
      return
    }
    if let expectedDictionary = expected as? [String: Any] {
      guard let actualDictionary = actual as? [String: Any] else {
        let message = "\(location): expected object"
        Issue.record(Comment(rawValue: message))
        throw ConformanceError(message)
      }
      let actualKeys = actualDictionary.keys.sorted()
      let expectedKeys = expectedDictionary.keys.sorted()
      let errorCode =
        (expectedDictionary["code"] as? String)
        ?? (actualDictionary["code"] as? String)
      let allowsAdditionalErrorProperties =
        location.hasSuffix(".error")
        && errorCode.map { !strictErrorSchemaCodes.contains($0) } == true
      if allowsAdditionalErrorProperties {
        let hasExpectedKeys = Set(expectedKeys).isSubset(of: Set(actualKeys))
        #expect(hasExpectedKeys, "\(location): missing expected error keys")
        if !hasExpectedKeys {
          throw ConformanceError(
            "\(location): missing expected error keys \(expectedKeys) in \(actualKeys)"
          )
        }
      } else {
        #expect(actualKeys == expectedKeys, "\(location): keys mismatch")
        if actualKeys != expectedKeys {
          throw ConformanceError("\(location): keys mismatch \(actualKeys) vs \(expectedKeys)")
        }
      }
      for key in expectedKeys {
        try assertMatchesExpectedOutbound(
          actualDictionary[key] as Any,
          expected: expectedDictionary[key] as Any,
          where: "\(location).\(key)"
        )
      }
      return
    }
    let actualJSON = toJSONValue(actual)
    let expectedJSON = toJSONValue(expected)
    #expect(actualJSON == expectedJSON, "\(location): value mismatch")
    if actualJSON != expectedJSON {
      throw ConformanceError("\(location): value mismatch \(actualJSON) vs \(expectedJSON)")
    }
  }

  @MainActor
  private static func assertOutboundMatches(
    _ actual: [[String: Any]],
    expected: [[String: Any]],
    context: String
  ) throws {
    #expect(actual.count == expected.count, "\(context): expectOutbound count mismatch")
    if actual.count != expected.count {
      throw ConformanceError(
        "\(context): expectOutbound count mismatch (\(actual.count) vs \(expected.count))"
      )
    }
    for (index, expectedEnvelope) in zip(actual.indices, expected) {
      try assertMatchesExpectedOutbound(
        actual[index],
        expected: expectedEnvelope,
        where: "\(context).expectOutbound[\(index)]"
      )
    }
  }

  @MainActor
  static func assertAccessibilityTreeMatches(
    _ root: ViewNode,
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
        throw ConformanceError("\(context): missing accessibility node '\(componentID)'")
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

  @MainActor
  static func assertModifierMatches(
    _ modifier: A2UIAccessibilityModifier,
    node: A2UICore.Node,
    hostedElement: HostedViewDriver.AccessibilityElement? = nil,
    expected: [String: Any],
    context: String
  ) throws {
    if let expectedLabel = expected["label"] as? String {
      let actual = hostedElement?.label ?? effectiveLabel(for: node, modifier: modifier)
      #expect(actual == expectedLabel, "\(context): label")
      if actual != expectedLabel {
        throw ConformanceError("\(context): label mismatch")
      }
    }
    if let expectedDescription = expected["description"] as? String {
      let actual = hostedElement?.help ?? modifier.hint
      #expect(actual == expectedDescription, "\(context): description mismatch")
      if actual != expectedDescription {
        throw ConformanceError("\(context): description mismatch")
      }
    }
    if let expectedLive = expected["live"] as? String {
      let actual = hostedElement?.live ?? node.explicitAccessibilityAttributes?.live
      #expect(actual == expectedLive, "\(context): live mismatch")
      if actual != expectedLive {
        throw ConformanceError("\(context): live mismatch")
      }
    }
    if let expectedHidden = expected["hidden"] as? Bool {
      let actual = hostedElement?.isHidden ?? modifier.isHidden
      #expect(actual == expectedHidden, "\(context): hidden mismatch")
      if actual != expectedHidden {
        throw ConformanceError("\(context): hidden mismatch")
      }
    }
    if let expectedRole = expected["role"] as? String {
      let actual = hostedElement?.role ?? semanticRole(for: node)
      #expect(actual == expectedRole, "\(context): role mismatch")
      if actual != expectedRole {
        throw ConformanceError("\(context): role mismatch")
      }
    }
    if let expectedChecked = expected["checked"] as? Bool {
      let actual = hostedElement?.isChecked ?? checkedState(for: node)
      #expect(actual == expectedChecked, "\(context): checked mismatch")
      if actual != expectedChecked {
        throw ConformanceError("\(context): checked mismatch")
      }
    }
  }

  @MainActor
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

  @MainActor
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

  @MainActor
  private static func checkedState(for node: A2UICore.Node) -> Bool? {
    guard node.type == "CheckBox" else { return nil }
    return node.bool(for: "value") ?? false
  }

  @MainActor
  static func collectNodes(
    from node: A2UICore.Node,
    in surface: Surface? = nil,
    into map: inout [String: A2UICore.Node]
  ) {
    if map[node.id] == nil {
      map[node.id] = node
    }
    let baseID =
      if let surface {
        baseComponentID(for: node, in: surface)
      } else {
        String(node.id.split(separator: ":").first ?? Substring(node.id))
      }
    if map[baseID] == nil {
      map[baseID] = node
    }
    for child in node.allChildNodes {
      collectNodes(from: child, in: surface, into: &map)
    }
  }

  @MainActor
  private static func resolvedValueJSON(for node: A2UICore.Node, key: String) -> JSONValue? {
    if let booleanBinding = node.properties[key] as? DataBinding<Bool> {
      return booleanBinding.value.map { .boolean($0) }
    }
    if let doubleBinding = node.properties[key] as? DataBinding<Double> {
      return doubleBinding.value.map { .number($0) }
    }
    if let integerBinding = node.properties[key] as? DataBinding<Int> {
      return integerBinding.value.map { .integer($0) }
    }
    if let stringBinding = node.properties[key] as? DataBinding<String> {
      return stringBinding.value.map { .string($0) }
    }
    if let arrayBinding = node.properties[key] as? DataBinding<[String]> {
      return arrayBinding.value.map { .array($0.map { .string($0) }) }
    }
    if let jsonValue = node.jsonValue(for: key) {
      return jsonValue
    }
    if let stringValue = node.string(for: key) {
      return .string(stringValue)
    }
    return nil
  }

  static func jsonValuesEqual(_ left: JSONValue, _ right: JSONValue) -> Bool {
    switch (left, right) {
    case (.integer(let leftInt), .integer(let rightInt)):
      return leftInt == rightInt
    case (.number(let leftNum), .number(let rightNum)):
      return leftNum == rightNum
    case (.integer(let leftInt), .number(let rightNum)):
      return rightNum.rounded() == rightNum
        && Double(leftInt) == rightNum
        && Int(exactly: rightNum) == leftInt
    case (.number(let leftNum), .integer(let rightInt)):
      return leftNum.rounded() == leftNum
        && Double(rightInt) == leftNum
        && Int(exactly: leftNum) == rightInt
    case (.string(let leftString), .string(let rightString)):
      return leftString == rightString
    case (.boolean(let leftBool), .boolean(let rightBool)):
      return leftBool == rightBool
    case (.null, .null):
      return true
    case (.array(let leftArray), .array(let rightArray)):
      guard leftArray.count == rightArray.count else { return false }
      return zip(leftArray, rightArray).allSatisfy { jsonValuesEqual($0, $1) }
    case (.object(let leftObject), .object(let rightObject)):
      guard Set(leftObject.keys) == Set(rightObject.keys) else { return false }
      return leftObject.keys.allSatisfy { key in
        guard let leftValue = leftObject[key], let rightValue = rightObject[key] else {
          return false
        }
        return jsonValuesEqual(leftValue, rightValue)
      }
    default:
      return false
    }
  }

  static func toJSONValue(_ value: Any) -> JSONValue {
    if value is NSNull { return .null }
    if let booleanValue = value as? Bool { return .boolean(booleanValue) }
    if let integerValue = value as? Int { return .integer(integerValue) }
    if let doubleValue = value as? Double { return .number(doubleValue) }
    if let stringValue = value as? String { return .string(stringValue) }
    if let arrayValue = value as? [Any] { return .array(arrayValue.map { toJSONValue($0) }) }
    if let dictionaryValue = value as? [String: Any] {
      var object = OrderedDictionary<String, JSONValue>()
      for key in dictionaryValue.keys.sorted() {
        object[key] = toJSONValue(dictionaryValue[key] as Any)
      }
      return .object(object)
    }
    return .null
  }

  static func fromJSONValue(_ value: JSONValue) -> Any {
    switch value {
    case .null:
      return NSNull()
    case .boolean(let booleanValue):
      return booleanValue
    case .integer(let integerValue):
      return integerValue
    case .number(let doubleValue):
      return doubleValue
    case .string(let stringValue):
      return stringValue
    case .array(let arrayValue):
      return arrayValue.map { fromJSONValue($0) }
    case .object(let objectValue):
      var dictionary: [String: Any] = [:]
      for (key, nestedValue) in objectValue {
        dictionary[key] = fromJSONValue(nestedValue)
      }
      return dictionary
    }
  }
}

/// Thread-safe one-shot flag guarding continuation resumption.
private final class OnceFlag: @unchecked Sendable {
  private let lock = NSLock()
  private var claimed = false

  func tryClaim() -> Bool {
    lock.withLock {
      if claimed {
        return false
      }
      claimed = true
      return true
    }
  }
}

/// Local `incrementCounter` function implementation used by adapter conformance tests.
private final class IncrementCounterFunction: FunctionImplementation, Sendable {
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
