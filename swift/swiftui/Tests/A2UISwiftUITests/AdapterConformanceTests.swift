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
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import SwiftUI
import Testing
import Yams

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

/// Runs `conformance/core/accessibility.yaml` and `conformance/core/adapter_conformance.yaml`
/// against `A2UISwiftUI.Surface`, `SurfaceViewModel`, and `A2UIAccessibilityModifier`.
@MainActor
struct AdapterConformanceTests {
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
      try runAdapterCase(testCase, name: name)
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
    if let messages = testCase["messages"] {
      try processor.processMessages(toJSONValue(messages))
    }
    if let steps = testCase["steps"] as? [[String: Any]] {
      return try runAccessibilitySteps(
        steps,
        processor: processor,
        surfaceID: surfaceID,
        name: name
      )
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
        expected: expectedProps,
        context: "\(context) [\(componentID)]"
      )
      checked += 1
    }
    return checked
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
    let v10Functions = V10BasicCatalog.functions + [incrementFn]
    var coreCatalogs: [AnyCatalog] = BasicCatalog.allCatalogs.map { cat in
      Catalog(
        id: cat.id,
        protocolVersion: cat.a2uiProtocolVersion,
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
      uiImpls.append(ComponentImplementation(api: api) { _ in EmptyView() })
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
    surface: inout Surface?
  ) throws -> Surface.ViewNode? {
    let op = step["op"] as? String ?? "process_messages"
    switch op {
    case "process_messages":
      let messages = (step["messages"] as? [[String: Any]]) ?? []
      processAdapterMessages(
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
  ) {
    do {
      try processor.processMessages(toJSONValue(messages))
      if surface == nil,
        let vm = processor.surfaceGroupModel.surfacesMap["adapter_surface"]
          ?? processor.surfaceGroupModel.surfacesMap.values.first
      {
        surface = Surface(
          viewModel: vm,
          catalogs: uiCatalogs,
          defaultCatalogID: BasicCatalog.catalogURI(version: .v10)
        )
      }
    } catch {
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
      catalog: BasicCatalog.makeCatalog(version: .v10),
      actionHandler: handler,
      protocolVersion: .v10
    )
    for msg in messages {
      let comps =
        (msg["createSurface"] as? [String: Any])?["components"] as? [[String: Any]]
        ?? (msg["updateComponents"] as? [String: Any])?["components"] as? [[String: Any]]
        ?? []
      for rawComp in comps {
        addRawComponent(rawComp, to: vm)
      }
    }
    return Surface(
      viewModel: vm,
      catalogs: uiCatalogs,
      defaultCatalogID: BasicCatalog.catalogURI(version: .v10)
    )
  }

  private func addRawComponent(_ rawComp: [String: Any], to viewModel: SurfaceViewModel) {
    guard let id = rawComp["id"] as? String,
      let type = rawComp["component"] as? String
    else {
      return
    }
    let catalogID = rawComp["catalogId"] as? String
    var props: [String: JSONValue] = [:]
    for (key, value) in rawComp where key != "id" && key != "component" && key != "catalogId" {
      props[key] = toJSONValue(value)
    }
    let model = ComponentModel(id: id, type: type, catalogID: catalogID, properties: props)
    viewModel.componentsModel.addComponent(model)
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
        let actualSeverity = (actual.severity ?? .error).rawValue
        #expect(actualSeverity == expSev, "\(context): result severity mismatch")
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
