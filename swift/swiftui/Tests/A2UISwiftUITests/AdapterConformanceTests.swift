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
import Yams

/// Runs `conformance/core/accessibility.yaml` and `conformance/core/adapter_conformance.yaml`
/// against `A2UISwiftUI.Surface`, `SurfaceViewModel`, and `A2UIAccessibilityModifier`.
@MainActor
struct AdapterConformanceTests {
  private typealias Node = A2UICore.Node

  private final class AdapterTestActionHandler: ActionHandling, @unchecked Sendable {
    var actions: [(action: ResolvedAction, surfaceID: String)] = []
    var errors: [RendererError] = []

    func handle(action: ResolvedAction, from surfaceID: String) {
      actions.append((action: action, surfaceID: surfaceID))
    }

    func handle(error: RendererError, from surfaceID: String) {
      errors.append(error)
    }

    func clearStepEvents() {
      actions.removeAll()
      errors.removeAll()
    }
  }

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

  private struct ViewNode {
    let id: String
    let instanceID: String
    let type: String?
    let state: String
    let node: Node?
    let children: [ViewNode]

    init(
      id: String,
      instanceID: String,
      type: String? = nil,
      state: String = "resolved",
      node: Node? = nil,
      children: [ViewNode] = []
    ) {
      self.id = id
      self.instanceID = instanceID
      self.type = type
      self.state = state
      self.node = node
      self.children = children
    }
  }

  @MainActor
  private final class MountedSurfaceHarness {
    let surface: Surface
    private var subscriptions: [AnyCancellable] = []
    private(set) var isMounted = true
    private(set) var emissionCount = 0

    var activeSubscriptionCount: Int {
      isMounted ? subscriptions.count : 0
    }

    init(surface: Surface) {
      self.surface = surface
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
      surface.viewModel.dispose()
    }
  }

  /// Adapter conformance cases that depend on runtime features not yet implemented in `A2UICore` /
  /// `A2UISwiftUI`, recorded as expected failures with their root-cause reason.
  private static let expectedAdapterFailures: [String: String] = [
    "progressive_arrival_placeholder_upgrade_in_place":
      "A2UICore.NodeResolver skips unresolved child IDs instead of materializing pending "
      + "placeholder nodes.",
    "fallback_states_unknown_type_and_cyclic_diagnostics":
      "A2UICore.NodeResolver does not expose unknown-type or cyclic placeholder nodes or emit "
      + "UNKNOWN_COMPONENT_TYPE / CYCLIC_REFERENCE diagnostics on SurfaceViewModel.",
    "user_activation_gated_function_gesture_vs_programmatic":
      "A2UICore.DataContext does not gate local functionCall action evaluation on "
      + "FunctionAPI.requiresUserActivation.",
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
    let cases = try Self.loadYAMLCases("core/accessibility.yaml")
    #expect(!cases.isEmpty, "core/accessibility.yaml should contain test cases")

    var checkedCount = 0
    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      checkedCount += try runAccessibilityCase(testCase, name: name)
    }
    #expect(checkedCount > 0, "accessibility.yaml should verify at least one component")
  }

  @Test func adapterConformanceSuite() throws {
    let cases = try Self.loadYAMLCases("core/adapter_conformance.yaml")
    #expect(cases.count == 13, "core/adapter_conformance.yaml should contain 13 test cases")

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      if let reason = Self.expectedAdapterFailures[name] {
        withKnownIssue("\(name): \(reason)") {
          try runAdapterCase(testCase, name: name)
        }
      } else {
        try runAdapterCase(testCase, name: name)
      }
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
    let surfaceID = testCase["surfaceId"] as? String ?? "a11y_surface"
    if let steps = testCase["steps"] as? [[String: Any]] {
      return try runAccessibilitySteps(
        steps,
        processor: processor,
        surfaceID: surfaceID,
        name: name
      )
    }
    if let messages = testCase["messages"] {
      try processor.processMessages(toJSONValue(messages))
    }
    let assertions = (testCase["assertions"] as? [String: Any]) ?? testCase
    guard let expected = assertions["accessibilityTree"] as? [String: [String: Any]] else {
      return 0
    }
    return assertAccessibilityNodes(
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
        try processor.processMessages(toJSONValue(stepMessages))
      }
      let assertions = (step["assertions"] as? [String: Any]) ?? step
      if let expected = assertions["accessibilityTree"] as? [String: [String: Any]] {
        checked += assertAccessibilityNodes(
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
  ) -> Int {
    guard
      let viewModel = processor.surfaceGroupModel.surfacesMap[surfaceID]
        ?? processor.surfaceGroupModel.surfacesMap.values.first,
      let rootNode = viewModel.rootNode
    else {
      Issue.record("\(context): missing resolved root node for \(surfaceID)")
      return 0
    }
    var nodesByID: [String: Node] = [:]
    collectNodes(from: rootNode, into: &nodesByID)

    var checked = 0
    for (componentID, expectedProps) in expected {
      guard let node = nodesByID[componentID] else {
        Issue.record("\(context): node '\(componentID)' not found")
        continue
      }
      let modifier = A2UIAccessibilityModifier(node: node)
      assertModifierMatches(
        modifier,
        node: node,
        expected: expectedProps,
        context: "\(context) [\(componentID)]"
      )
      checked += 1
    }
    return checked
  }

  private func assertModifierMatches(
    _ modifier: A2UIAccessibilityModifier,
    node: Node,
    expected: [String: Any],
    context: String
  ) {
    if let expLabel = expected["label"] as? String {
      #expect(effectiveLabel(for: node, modifier: modifier) == expLabel, "\(context): label")
    }
    if let expDesc = expected["description"] as? String {
      #expect(modifier.hint == expDesc, "\(context): description mismatch")
    }
    if let expLive = expected["live"] as? String {
      #expect(node.explicitAccessibilityAttributes?.live == expLive, "\(context): live mismatch")
    }
    if let expHidden = expected["hidden"] as? Bool {
      #expect(modifier.isHidden == expHidden, "\(context): hidden mismatch")
    }
    if let expRole = expected["role"] as? String {
      #expect(semanticRole(for: node) == expRole, "\(context): role mismatch")
    }
    if let expChecked = expected["checked"] as? Bool {
      #expect(checkedState(for: node) == expChecked, "\(context): checked mismatch")
    }
  }

  private func effectiveLabel(for node: Node, modifier: A2UIAccessibilityModifier) -> String? {
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

  private func semanticRole(for node: Node) -> String {
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

  private func checkedState(for node: Node) -> Bool? {
    guard node.type == "CheckBox" else { return nil }
    return node.bool(for: "value") ?? false
  }

  // MARK: - Adapter Conformance Suite Runner

  private func runAdapterCase(_ testCase: [String: Any], name: String) throws {
    let handler = AdapterTestActionHandler()
    let (coreCatalogs, uiCatalogs) = try buildCatalogs(for: testCase)
    let processor = MessageProcessor(
      catalogs: coreCatalogs,
      actionHandler: handler,
      validationConfig: .relaxed
    )
    let steps = (testCase["steps"] as? [[String: Any]]) ?? []
    var harness: MountedSurfaceHarness?
    var previousTree: ViewNode?

    for (idx, step) in steps.enumerated() {
      let stepCtx = "\(name) [step \(idx)]"
      handler.clearStepEvents()
      let currentTree = try executeAdapterStep(
        step,
        processor: processor,
        uiCatalogs: uiCatalogs,
        handler: handler,
        harness: &harness
      )
      verifyAdapterStep(
        step,
        harness: harness,
        currentTree: currentTree,
        previousTree: previousTree,
        handler: handler,
        context: stepCtx
      )
      if let currentTree {
        previousTree = currentTree
      }
    }
  }

  private func buildCatalogs(
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

  private func buildCustomCatalog(
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

  private func executeAdapterStep(
    _ step: [String: Any],
    processor: MessageProcessor,
    uiCatalogs: [Catalog<ComponentImplementation>],
    handler: AdapterTestActionHandler,
    harness: inout MountedSurfaceHarness?
  ) throws -> ViewNode? {
    let op = step["op"] as? String ?? "process_messages"
    switch op {
    case "process_messages":
      let messages = (step["messages"] as? [[String: Any]]) ?? []
      try processAdapterMessages(
        messages,
        processor: processor,
        uiCatalogs: uiCatalogs,
        harness: &harness
      )
    case "user_input":
      applyUserInput(step, surface: harness?.surface)
    case "user_gesture", "programmatic_invoke":
      invokeStepAction(step, surface: harness?.surface)
    case "unmount_surface":
      #expect((harness?.activeSubscriptionCount ?? 0) > 0, "Expected active subscriptions")
      harness?.unmount()
      return nil
    default:
      break
    }
    guard let surface = harness?.surface else { return nil }
    return resolveViewTree(for: surface)
  }

  private func processAdapterMessages(
    _ messages: [[String: Any]],
    processor: MessageProcessor,
    uiCatalogs: [Catalog<ComponentImplementation>],
    harness: inout MountedSurfaceHarness?
  ) throws {
    try processor.processMessages(toJSONValue(messages))
    if harness == nil,
      let vm = processor.surfaceGroupModel.surfacesMap["adapter_surface"]
        ?? processor.surfaceGroupModel.surfacesMap.values.first
    {
      let surface = Surface(
        viewModel: vm,
        catalogs: uiCatalogs,
        defaultCatalogID: BasicCatalog.catalogURI(version: .v10)
      )
      harness = MountedSurfaceHarness(surface: surface)
    }
  }

  private func applyUserInput(_ step: [String: Any], surface: Surface?) {
    guard let surface,
      let targetID = step["targetNode"] as? String,
      let inputValue = step["inputValue"] as? String,
      let rootNode = surface.viewModel.rootNode
    else {
      return
    }
    var nodes: [String: Node] = [:]
    collectNodes(from: rootNode, into: &nodes)
    guard let targetNode = nodes[targetID] else { return }
    let textField = A2UITextField(node: targetNode)
    textField.valueBinding.wrappedValue = inputValue
  }

  private func invokeStepAction(_ step: [String: Any], surface: Surface?) {
    guard let surface,
      let targetID = step["targetNode"] as? String,
      let rootNode = surface.viewModel.rootNode
    else {
      return
    }
    var nodes: [String: Node] = [:]
    collectNodes(from: rootNode, into: &nodes)
    guard let targetNode = nodes[targetID] else { return }
    invokeAction(on: targetNode)
  }

  private func invokeAction(
    on node: Node,
    property: String = "action"
  ) {
    if node.type == "Button" {
      let button = A2UIButton(node: node)
      guard !button.isDisabled else { return }
    } else {
      guard node.isValid else { return }
    }
    node.action(for: property)?()
  }

  // MARK: - View Tree Resolution Helpers

  private func resolveViewTree(for surface: Surface) -> ViewNode? {
    guard let rootNode = surface.viewModel.rootNode else { return nil }
    return buildViewNode(in: surface, node: rootNode)
  }

  private func buildViewNode(in surface: Surface, node: Node) -> ViewNode {
    let rendered = Surface.render(
      node: node,
      using: surface.catalogs,
      defaultCatalogID: surface.defaultCatalogID
    )
    #expect(rendered != nil, "Expected Surface.render builder for '\(node.type)'")
    let children = resolveChildViewNodes(in: surface, node: node)
    let baseID = String(node.id.split(separator: ":").first ?? Substring(node.id))
    return ViewNode(
      id: baseID,
      instanceID: node.id,
      type: node.type,
      state: "resolved",
      node: node,
      children: children
    )
  }

  private func resolveChildViewNodes(in surface: Surface, node: Node) -> [ViewNode] {
    if let singleChild = node.child(for: "child") {
      return [buildViewNode(in: surface, node: singleChild)]
    }
    return node.children(for: "children").map { childNode in
      buildViewNode(in: surface, node: childNode)
    }
  }

  // MARK: - Step Verification Helpers

  private func verifyAdapterStep(
    _ step: [String: Any],
    harness: MountedSurfaceHarness?,
    currentTree: ViewNode?,
    previousTree: ViewNode?,
    handler: AdapterTestActionHandler,
    context: String
  ) {
    if let expTree = step["expectViewTree"] as? [String: Any] {
      assertViewNodeMatches(currentTree, expected: expTree, context: context)
    }
    if let expData = step["expectDataModel"], let surface = harness?.surface {
      let expectedJSON = toJSONValue(expData)
      #expect(surface.viewModel.dataModel.data == expectedJSON, "\(context): dataModel mismatch")
    }
    if let expSameIDs = step["expectSameViewIdentity"] as? [String] {
      assertSameViewIdentities(
        expSameIDs,
        previousTree: previousTree,
        currentTree: currentTree,
        context: context
      )
    }
    if let expActions = step["expectActions"] as? [[String: Any]] {
      assertActionsMatch(handler.actions, expected: expActions, context: context)
    }
    if let expErrors = step["expectErrors"] as? [[String: Any]] {
      assertErrorsMatch(handler.errors, expected: expErrors, context: context)
    }
    if let expA11y = step["expectAccessibilityTree"] as? [String: [String: Any]], let currentTree {
      assertAccessibilityTreeMatches(currentTree, expected: expA11y, context: context)
    }
    if let expSubs = step["expectActiveSubscriptions"] as? Int, let harness {
      assertActiveSubscriptions(harness: harness, expected: expSubs, context: context)
    }
  }

  private func assertActiveSubscriptions(
    harness: MountedSurfaceHarness,
    expected: Int,
    context: String
  ) {
    let emissionsBefore = harness.emissionCount
    var nodeBoxEmissions = 0
    var boxCancellables: [AnyCancellable] = []
    if let rootNode = harness.surface.viewModel.rootNode {
      var nodes: [String: Node] = [:]
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
    #expect(
      harness.activeSubscriptionCount + postWriteEmissions == expected,
      "\(context): subscription count mismatch"
    )
  }

  private func assertViewNodeMatches(
    _ viewNode: ViewNode?,
    expected: [String: Any],
    context: String
  ) {
    guard let viewNode else {
      Issue.record("\(context): expected ViewNode but got nil")
      return
    }
    if let expID = expected["id"] as? String {
      #expect(viewNode.id == expID, "\(context): id mismatch")
    }
    if let expType = expected["type"] as? String {
      #expect(viewNode.type == expType, "\(context): type mismatch")
    }
    if let expState = expected["state"] as? String {
      #expect(viewNode.state == expState, "\(context): state mismatch")
    }
    assertViewNodeProperties(viewNode, expected: expected, context: context)
    if let expChildren = expected["children"] as? [[String: Any]] {
      #expect(viewNode.children.count == expChildren.count, "\(context): children count mismatch")
      for (idx, expChild) in expChildren.enumerated() where idx < viewNode.children.count {
        assertViewNodeMatches(
          viewNode.children[idx],
          expected: expChild,
          context: "\(context)/children/\(idx)"
        )
      }
    }
  }

  private func assertViewNodeProperties(
    _ viewNode: ViewNode,
    expected: [String: Any],
    context: String
  ) {
    guard let node = viewNode.node else { return }
    if let expText = expected["text"] as? String {
      #expect(node.string(for: "text") == expText, "\(context): text mismatch")
    }
    if let expValue = expected["value"] as? String {
      #expect(node.string(for: "value") == expValue, "\(context): value mismatch")
    }
    if let expBadge = expected["badgeText"] as? String {
      #expect(node.string(for: "badgeText") == expBadge, "\(context): badgeText mismatch")
    }
    assertValidationProperties(node, expected: expected, context: context)
  }

  private func assertValidationProperties(
    _ node: Node,
    expected: [String: Any],
    context: String
  ) {
    let textField = A2UITextField(node: node)
    if let expValid = expected["isValid"] as? Bool {
      #expect(textField.isValid == expValid, "\(context): isValid mismatch")
    }
    if let expErrors = expected["validationErrors"] as? [String] {
      #expect(textField.validationErrors == expErrors, "\(context): validationErrors mismatch")
    }
    guard let expResults = expected["validationResults"] as? [[String: Any]] else { return }
    #expect(textField.validationResults.count == expResults.count, "\(context): results count")
    for (idx, expRes) in expResults.enumerated() where idx < textField.validationResults.count {
      let actual = textField.validationResults[idx]
      if let expCode = expRes["code"] as? String {
        #expect(actual.code == expCode, "\(context): result code mismatch")
      }
      if let expMsg = expRes["message"] as? String {
        #expect(actual.message == expMsg, "\(context): result message mismatch")
      }
      if let expSev = expRes["severity"] as? String {
        let actualSeverity = (actual.severity ?? ValidationSeverity.error).rawValue
        #expect(actualSeverity == expSev, "\(context): result severity mismatch")
      }
    }
  }

  private func assertSameViewIdentities(
    _ paths: [String],
    previousTree: ViewNode?,
    currentTree: ViewNode?,
    context: String
  ) {
    for path in paths {
      let prevNode = findViewNode(atPath: path, in: previousTree)
      let currNode = findViewNode(atPath: path, in: currentTree)
      #expect(prevNode != nil && currNode != nil, "\(context): missing node at \(path)")
      #expect(
        prevNode?.instanceID == currNode?.instanceID,
        "\(context): identity changed at \(path)"
      )
    }
  }

  private func findViewNode(atPath path: String, in root: ViewNode?) -> ViewNode? {
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

  private func assertActionsMatch(
    _ actual: [(action: ResolvedAction, surfaceID: String)],
    expected: [[String: Any]],
    context: String
  ) {
    #expect(actual.count == expected.count, "\(context): action count mismatch")
    for (idx, exp) in expected.enumerated() where idx < actual.count {
      let entry = actual[idx]
      if let sid = exp["surfaceId"] as? String {
        #expect(entry.surfaceID == sid, "\(context): action surfaceId mismatch")
      }
      if let src = exp["sourceComponentId"] as? String {
        #expect(entry.action.sourceComponentID == src, "\(context): sourceComponentId mismatch")
      }
      guard case .event(let actName, let actCtx, _) = entry.action.identity else {
        Issue.record("\(context): expected .event action identity")
        continue
      }
      if let name = exp["name"] as? String {
        #expect(actName == name, "\(context): action name mismatch")
      }
      if let expCtx = exp["context"] as? [String: Any] {
        for (k, v) in expCtx {
          #expect(actCtx?[k] == toJSONValue(v), "\(context): action context[\(k)] mismatch")
        }
      }
    }
  }

  private func assertErrorsMatch(
    _ actual: [RendererError],
    expected: [[String: Any]],
    context: String
  ) {
    #expect(actual.count >= expected.count, "\(context): expected \(expected.count) errors")
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
    }
  }

  private func rendererErrorFields(
    _ error: RendererError
  ) -> (code: String, surfaceID: String?, message: String) {
    switch error {
    case .validationFailed(let valError):
      return (valError.code.rawValue, valError.surfaceID, valError.message)
    case .generic(let genError):
      return (genError.code, genError.surfaceID, genError.message)
    }
  }

  private func assertAccessibilityTreeMatches(
    _ root: ViewNode,
    expected: [String: [String: Any]],
    context: String
  ) {
    var nodesByID: [String: Node] = [:]
    if let rootNode = root.node {
      collectNodes(from: rootNode, into: &nodesByID)
    }
    for (componentID, expectedProps) in expected {
      guard let node = nodesByID[componentID] else {
        Issue.record("\(context): missing accessibility node '\(componentID)'")
        continue
      }
      let modifier = A2UIAccessibilityModifier(node: node)
      assertModifierMatches(
        modifier,
        node: node,
        expected: expectedProps,
        context: "\(context) [\(componentID)]"
      )
    }
  }

  private func collectNodes(from node: Node, into map: inout [String: Node]) {
    map[node.id] = node
    let baseID = String(node.id.split(separator: ":").first ?? Substring(node.id))
    map[baseID] = node
    for child in node.allChildNodes {
      collectNodes(from: child, into: &map)
    }
  }

  private func toJSONValue(_ value: Any) -> JSONValue {
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
}
