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
import BasicCatalogUI
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import SwiftUI
import Testing
import Yams

@MainActor
private final class AdapterTestActionHandler: ActionHandling {
  var actions: [RendererAction] = []
  var errors: [RendererError] = []

  func handleAction(_ action: RendererAction) {
    actions.append(action)
  }

  func handleError(_ error: RendererError) {
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
    let step = arguments["step"]?.integerValue ?? 1
    let current = context.dataModel.get(path)?.integerValue ?? 0
    let updated = current + step
    context.set(path, value: .integer(updated))
    return .integer(updated)
  }
}

/// Runs `conformance/core/accessibility.yaml` and `conformance/core/adapter_conformance.yaml`
/// against `A2UISwiftUI.Surface`, `SurfaceViewModel`, and `A2UIAccessibilityModifier`.
@MainActor
struct AdapterConformanceTests {
  private static var repoRootURL: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private static func loadYAMLCases(_ relativePath: String) throws -> [[String: Any]] {
    let url = repoRootURL.appendingPathComponent("conformance").appendingPathComponent(relativePath)
    let text = try String(contentsOf: url, encoding: .utf8)
    return (try Yams.load(yaml: text) as? [[String: Any]]) ?? []
  }

  @Test func accessibilityConformanceThroughModifier() throws {
    let cases = try Self.loadYAMLCases("core/accessibility.yaml")
    #expect(!cases.isEmpty, "core/accessibility.yaml should contain test cases")

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      try runAccessibilityCase(testCase, name: name)
    }
  }

  @Test func adapterConformanceSuite() throws {
    let cases = try Self.loadYAMLCases("core/adapter_conformance.yaml")
    #expect(cases.count == 13, "core/adapter_conformance.yaml should contain 13 test cases")

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      try runAdapterCase(testCase, name: name)
    }
  }

  // MARK: - Accessibility Suite Runner

  private func runAccessibilityCase(_ testCase: [String: Any], name: String) throws {
    let handler = AdapterTestActionHandler()
    let processor = MessageProcessor(
      catalogs: BasicCatalog.allCatalogs,
      actionHandler: handler,
      validationConfig: .relaxed
    )
    let surfaceID = testCase["surfaceId"] as? String ?? "a11y_surface"
    if let messages = testCase["messages"] as? [[String: Any]] {
      try processor.processMessages(messages)
    }
    if let steps = testCase["steps"] as? [[String: Any]] {
      try runAccessibilitySteps(
        steps,
        processor: processor,
        surfaceID: surfaceID,
        name: name
      )
      return
    }
    guard let expected = testCase["expectAccessibility"] as? [String: [String: Any]] else {
      return
    }
    assertAccessibilityNodes(
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
  ) throws {
    for (idx, step) in steps.enumerated() {
      if let stepMessages = step["messages"] as? [[String: Any]] {
        try processor.processMessages(stepMessages)
      }
      if let expected = step["expectAccessibility"] as? [String: [String: Any]] {
        assertAccessibilityNodes(
          expected,
          processor: processor,
          surfaceID: surfaceID,
          context: "\(name) [step \(idx)]"
        )
      }
    }
  }

  private func assertAccessibilityNodes(
    _ expected: [String: [String: Any]],
    processor: MessageProcessor,
    surfaceID: String,
    context: String
  ) {
    guard let viewModel = processor.getSurface(for: surfaceID),
      let rootNode = viewModel.rootNode
    else {
      Issue.record("\(context): missing resolved root node for \(surfaceID)")
      return
    }
    var nodesByID: [String: Node] = [:]
    collectNodes(from: rootNode, into: &nodesByID)

    for (componentID, expectedProps) in expected {
      guard let node = nodesByID[componentID] else {
        Issue.record("\(context): node '\(componentID)' not found")
        continue
      }
      let modifier = A2UIAccessibilityModifier(node: node)
      assertModifierMatches(
        modifier,
        expected: expectedProps,
        context: "\(context) [\(componentID)]"
      )
    }
  }

  private func assertModifierMatches(
    _ modifier: A2UIAccessibilityModifier,
    expected: [String: Any],
    context: String
  ) {
    if let expLabel = expected["label"] as? String {
      #expect(modifier.effectiveLabel == expLabel, "\(context): label mismatch")
    }
    if let expDesc = expected["description"] as? String {
      #expect(modifier.hint == expDesc, "\(context): description mismatch")
    }
    if let expLive = expected["live"] as? String {
      #expect(modifier.live == expLive, "\(context): live mismatch")
    }
    if let expHidden = expected["hidden"] as? Bool {
      #expect(modifier.isHidden == expHidden, "\(context): hidden mismatch")
    }
    if let expRole = expected["role"] as? String {
      #expect(modifier.role == expRole, "\(context): role mismatch")
    }
    if let expChecked = expected["checked"] as? Bool {
      #expect(modifier.isChecked == expChecked, "\(context): checked mismatch")
    }
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
    var surface: Surface?
    var previousTree: Surface.ViewNode?

    for (idx, step) in steps.enumerated() {
      let stepCtx = "\(name) [step \(idx)]"
      handler.clearStepEvents()
      let currentTree = try executeAdapterStep(
        step,
        processor: processor,
        uiCatalogs: uiCatalogs,
        handler: handler,
        surface: &surface
      )
      verifyAdapterStep(
        step,
        surface: surface,
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
    let functions = BasicFunctions.allFunctions + [incrementFn]
    var coreCatalogs = BasicCatalog.allCatalogs.map { cat in
      Catalog(id: cat.id, components: Array(cat.components.values), functions: functions)
    }
    var uiCatalogs: [Catalog<ComponentImplementation>] = [
      BasicCatalogImplementation.catalog,
      Catalog(
        id: BasicCatalog.idV10,
        components: Array(BasicCatalogImplementation.catalog.components.values),
        functions: functions
      ),
    ]
    let customDefs = (testCase["catalogs"] as? [[String: Any]]) ?? []
    for custom in customDefs {
      if let (coreCat, uiCat) = try buildCustomCatalog(custom, functions: functions) {
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
      uiImpls.append(ComponentImplementation(api: api) { _ in EmptyView() })
    }
    return (
      Catalog(id: catalogID, components: coreApis, functions: functions),
      Catalog(id: catalogID, components: uiImpls, functions: functions)
    )
  }

  private func executeAdapterStep(
    _ step: [String: Any],
    processor: MessageProcessor,
    uiCatalogs: [Catalog<ComponentImplementation>],
    handler: AdapterTestActionHandler,
    surface: inout Surface?
  ) throws -> Surface.ViewNode? {
    let op = step["op"] as? String ?? "process_messages"
    switch op {
    case "process_messages":
      let messages = (step["messages"] as? [[String: Any]]) ?? []
      try processAdapterMessages(
        messages,
        processor: processor,
        uiCatalogs: uiCatalogs,
        handler: handler,
        surface: &surface
      )
    case "user_input":
      applyUserInput(step, surface: surface)
    case "user_gesture", "programmatic_invoke":
      invokeStepAction(step, op: op, surface: surface)
    case "unmount_surface":
      surface?.unmount()
    default:
      break
    }
    return surface?.resolveViewTree(reportingDiagnosticsTo: handler)
  }

  private func processAdapterMessages(
    _ messages: [[String: Any]],
    processor: MessageProcessor,
    uiCatalogs: [Catalog<ComponentImplementation>],
    handler: AdapterTestActionHandler,
    surface: inout Surface?
  ) throws {
    do {
      try processor.processMessages(messages)
      if surface == nil, let vm = processor.getSurface(for: "adapter_surface") {
        surface = Surface(
          viewModel: vm,
          catalogs: uiCatalogs,
          defaultCatalogID: BasicCatalog.idV10
        )
      }
    } catch is A2UIRecursionError {
      surface = applyFallbackMessages(
        messages,
        uiCatalogs: uiCatalogs,
        handler: handler
      )
    }
  }

  private func applyFallbackMessages(
    _ messages: [[String: Any]],
    uiCatalogs: [Catalog<ComponentImplementation>],
    handler: AdapterTestActionHandler
  ) -> Surface {
    let vm = SurfaceViewModel(
      surfaceID: "adapter_surface",
      catalog: BasicCatalog.catalogV10,
      actionHandler: handler,
      protocolVersion: .v10
    )
    for msg in messages {
      guard let create = msg["createSurface"] as? [String: Any],
        let comps = create["components"] as? [[String: Any]]
      else {
        continue
      }
      for rawComp in comps {
        addRawComponent(rawComp, to: vm)
      }
    }
    return Surface(
      viewModel: vm,
      catalogs: uiCatalogs,
      defaultCatalogID: BasicCatalog.idV10
    )
  }

  private func addRawComponent(_ rawComp: [String: Any], to viewModel: SurfaceViewModel) {
    guard let id = rawComp["id"] as? String,
      let type = rawComp["component"] as? String
    else {
      return
    }
    var props: [String: ComponentPropertyValue] = [:]
    for (key, value) in rawComp where key != "id" && key != "component" {
      if let str = value as? String {
        props[key] = .string(str)
      } else if let arr = value as? [String] {
        props[key] = .array(arr.map { .string($0) })
      }
    }
    let model = ComponentModel(id: id, type: type, properties: props)
    try? viewModel.componentsModel.addComponent(model)
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

  private func invokeStepAction(_ step: [String: Any], op: String, surface: Surface?) {
    guard let surface,
      let targetID = step["targetNode"] as? String,
      let rootNode = surface.viewModel.rootNode
    else {
      return
    }
    var nodes: [String: Node] = [:]
    collectNodes(from: rootNode, into: &nodes)
    guard let targetNode = nodes[targetID] else { return }
    let userActivated = step["userActivation"] as? Bool ?? (op == "user_gesture")
    surface.invokeAction(on: targetNode, userActivated: userActivated)
  }

  // MARK: - Step Verification Helpers

  private func verifyAdapterStep(
    _ step: [String: Any],
    surface: Surface?,
    currentTree: Surface.ViewNode?,
    previousTree: Surface.ViewNode?,
    handler: AdapterTestActionHandler,
    context: String
  ) {
    if let expTree = step["expectViewTree"] as? [String: Any] {
      assertViewNodeMatches(currentTree, expected: expTree, context: context)
    }
    if let expData = step["expectDataModel"], let surface {
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
    if let expSubs = step["expectActiveSubscriptions"] as? Int, let surface {
      #expect(surface.activeSubscriptionCount == expSubs, "\(context): subscription count mismatch")
    }
  }

  private func assertViewNodeMatches(
    _ viewNode: Surface.ViewNode?,
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
    _ viewNode: Surface.ViewNode,
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
        #expect(actual.severity.rawValue == expSev, "\(context): result severity mismatch")
      }
    }
  }

  private func assertSameViewIdentities(
    _ paths: [String],
    previousTree: Surface.ViewNode?,
    currentTree: Surface.ViewNode?,
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

  private func findViewNode(atPath path: String, in root: Surface.ViewNode?) -> Surface.ViewNode? {
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
    _ actual: [RendererAction],
    expected: [[String: Any]],
    context: String
  ) {
    #expect(actual.count == expected.count, "\(context): action count mismatch")
    for (idx, exp) in expected.enumerated() where idx < actual.count {
      let act = actual[idx]
      if let name = exp["name"] as? String {
        #expect(act.name == name, "\(context): action name mismatch")
      }
      if let sid = exp["surfaceId"] as? String {
        #expect(act.surfaceID == sid, "\(context): action surfaceId mismatch")
      }
      if let src = exp["sourceComponentId"] as? String {
        #expect(act.sourceComponentID == src, "\(context): sourceComponentId mismatch")
      }
      if let expCtx = exp["context"] as? [String: Any] {
        for (k, v) in expCtx {
          #expect(act.context[k] == toJSONValue(v), "\(context): action context[\(k)] mismatch")
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
      let expMessage = exp["message"] as? String
      let matched = actual.contains { err in
        let codeMatch = expCode == nil || err.code == expCode
        let surfMatch = expSurface == nil || err.surfaceID == expSurface
        let msgMatch = expMessage == nil || err.message.contains(expMessage ?? "")
        return codeMatch && surfMatch && msgMatch
      }
      #expect(matched, "\(context): expected error matching \(exp) in \(actual)")
    }
  }

  private func assertAccessibilityTreeMatches(
    _ root: Surface.ViewNode,
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
        expected: expectedProps,
        context: "\(context) [\(componentID)]"
      )
    }
  }

  private func collectNodes(from node: Node, into map: inout [String: Node]) {
    map[node.id] = node
    map[node.baseComponentID] = node
    if let singleChild = node.properties["child"] as? Node {
      collectNodes(from: singleChild, into: &map)
    }
    for child in node.children {
      collectNodes(from: child, into: &map)
    }
  }

  private func toJSONValue(_ value: Any) -> JSONValue {
    if value is NSNull { return .null }
    if let boolVal = value as? Bool { return .bool(boolVal) }
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
