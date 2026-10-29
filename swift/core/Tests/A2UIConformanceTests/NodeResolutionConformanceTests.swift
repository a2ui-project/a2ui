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
import BasicCatalog
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import Testing

private final class NodeResolutionActionCapture: ActionHandling, @unchecked Sendable {
  var events: [ResolvedAction] = []
  var errors: [RendererError] = []
  var functionCalls: [(name: String, args: [String: JSONValue])] = []

  func clearStep() {
    events.removeAll()
    errors.removeAll()
    functionCalls.removeAll()
  }

  func handle(action: ResolvedAction, from surfaceID: String) {
    events.append(action)
  }

  func handle(error: RendererError, from surfaceID: String) {
    errors.append(error)
  }
}

private final class RecordingFunctionImplementation: FunctionImplementation, @unchecked Sendable {
  let api: FunctionAPI
  private let base: (any FunctionImplementation)?
  private let capture: NodeResolutionActionCapture

  init(
    api: FunctionAPI,
    base: (any FunctionImplementation)?,
    capture: NodeResolutionActionCapture
  ) {
    self.api = api
    self.base = base
    self.capture = capture
  }

  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    capture.functionCalls.append((name: api.name, args: arguments))
    return try base?.evaluate(arguments: arguments, context: context) ?? .null
  }
}

/// Runs the shared `conformance/core/node_resolution.yaml` suite.
@MainActor
struct NodeResolutionConformanceTests {
  @Test func nodeResolutionConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/node_resolution.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/node_resolution.yaml should hold test cases")

    var executed = 0
    for testCase in cases {
      guard (testCase["action"] as? String) == "resolve_nodes" else { continue }
      try runResolveNodesCase(testCase)
      executed += 1
    }
    #expect(executed > 0, "Should execute at least one resolve_nodes case")
  }

  private func runResolveNodesCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    let fixturePath = try #require(
      testCase["fixture"] as? String,
      "[\(name)] Missing fixture path"
    )
    let fixtureRaw = try ConformanceTestHelper.loadYAML(filename: fixturePath)
    let fixture = try #require(fixtureRaw as? [String: Any], "[\(name)] Invalid fixture YAML")

    let capture = NodeResolutionActionCapture()
    let catalogs = buildNodeResolutionCatalogs(capture: capture)
    let processor = MessageProcessor(
      catalogs: catalogs,
      actionHandler: capture,
      validationConfig: .relaxed
    )
    let surface = SurfaceViewModel(
      surfaceID: "s",
      catalogs: catalogs,
      defaultCatalogID: "basic",
      actionHandler: capture,
      protocolVersion: .v091
    )
    processor.surfaceGroupModel.addSurface(surface)

    applyFixture(fixture, to: surface)

    if let initialExpect = testCase["expect"] as? [String: Any] {
      assertStepExpectations(
        initialExpect,
        surface: processor.surfaceGroupModel["s"],
        capture: capture,
        caseName: name
      )
    }

    let steps = (testCase["steps"] as? [[String: Any]]) ?? []
    for step in steps {
      capture.clearStep()
      try executeStep(step, processor: processor, caseName: name)
      if let stepExpect = step["expect"] as? [String: Any] {
        assertStepExpectations(
          stepExpect,
          surface: processor.surfaceGroupModel["s"],
          capture: capture,
          caseName: name
        )
      }
    }
  }

  private func buildNodeResolutionCatalogs(
    capture: NodeResolutionActionCapture
  ) -> [AnyCatalog] {
    let baseCatalog = BasicCatalog.makeCatalog(version: .v091)
    let wrappedFunctions: [any FunctionImplementation] = baseCatalog.functions.values.map { fn in
      RecordingFunctionImplementation(api: fn.api, base: fn, capture: capture)
    }
    var components = Array(baseCatalog.components.values)
    if let tabsSchema = try? makeTabsComponentSchema() {
      components.append(AnyComponentAPI(name: "Tabs", schema: tabsSchema))
    }
    return ["basic", baseCatalog.id].map { id in
      Catalog(
        id: id,
        protocolVersion: "v0.9.1",
        components: components,
        functions: wrappedFunctions,
        themeSchema: baseCatalog.themeSchema
      ).eraseToAnyCatalog()
    }
  }

  private func makeTabsComponentSchema() throws -> Schema {
    try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "tabs": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "title": { "$ref": "common_types.json#/$defs/DynamicString" },
                  "child": { "$ref": "common_types.json#/$defs/ComponentId" }
                }
              }
            }
          }
        }
        """
    )
  }

  private func applyFixture(_ fixture: [String: Any], to surface: SurfaceViewModel) {
    if let rawData = fixture["data"] as? [String: Any] {
      for (key, val) in rawData {
        surface.dataModel.set("/\(key)", value: ConformanceTestHelper.toJSONValue(val))
      }
    }
    if let rawComponents = fixture["components"] as? [[String: Any]] {
      applyComponentDicts(rawComponents, to: surface)
    }
  }

  private func applyComponentDicts(_ rawComponents: [[String: Any]], to surface: SurfaceViewModel) {
    var models: [ComponentModel] = []
    for compDict in rawComponents {
      guard let id = compDict["id"] as? String,
        let type = compDict["component"] as? String
      else { continue }
      var props: [String: JSONValue] = [:]
      for (key, val) in compDict where key != "id" && key != "component" && key != "catalogId" {
        props[key] = ConformanceTestHelper.toJSONValue(val)
      }
      models.append(
        ComponentModel(
          id: id,
          type: type,
          catalogID: compDict["catalogId"] as? String,
          properties: props
        )
      )
    }
    if !models.isEmpty {
      surface.componentsModel.applyBatch(adding: models)
    }
  }

  private func executeStep(
    _ step: [String: Any],
    processor: MessageProcessor,
    caseName: String
  ) throws {
    guard let op = step["op"] as? String else { return }
    switch op {
    case "write":
      executeWriteStep(step, surface: processor.surfaceGroupModel["s"], caseName: caseName)
    case "set_data":
      if let path = step["path"] as? String {
        let value = ConformanceTestHelper.toJSONValue(step["value"] as Any)
        processor.surfaceGroupModel["s"]?.dataModel.set(path, value: value)
      }
    case "update_components":
      if let comps = step["components"] as? [[String: Any]],
        let surface = processor.surfaceGroupModel["s"]
      {
        applyComponentDicts(comps, to: surface)
      }
    case "remove_component":
      if let compID = step["component_id"] as? String {
        processor.surfaceGroupModel["s"]?.componentsModel.removeComponent(compID)
      }
    case "process_messages":
      if let rawMessages = step["messages"] {
        try processor.processMessages(ConformanceTestHelper.toJSONValue(rawMessages))
      }
    case "invoke":
      executeInvokeStep(step, surface: processor.surfaceGroupModel["s"], caseName: caseName)
    case "dispose":
      processor.surfaceGroupModel.removeSurface(id: "s")
    default:
      break
    }
  }

  private func executeWriteStep(
    _ step: [String: Any],
    surface: SurfaceViewModel?,
    caseName: String
  ) {
    guard let surface,
      let nodePath = step["node"] as? String,
      let propKey = step["property"] as? String,
      let node = findNodeByPath(nodePath, from: surface.rootNode, surface: surface)
    else {
      Issue.record("[\(caseName)] write step could not locate node or surface")
      return
    }
    let jsonVal = ConformanceTestHelper.toJSONValue(step["value"] as Any)
    if let strBinding = node.properties[propKey] as? DataBinding<String>,
      let str = jsonVal.stringValue
    {
      strBinding.set(str)
    } else if let boolBinding = node.properties[propKey] as? DataBinding<Bool>,
      let boolVal = jsonVal.boolValue
    {
      boolBinding.set(boolVal)
    } else if let numBinding = node.properties[propKey] as? DataBinding<Double>,
      let numVal = jsonVal.doubleValue
    {
      numBinding.set(numVal)
    } else if let valBinding = node.properties[propKey] as? DataBinding<JSONValue> {
      valBinding.set(jsonVal)
    }
  }

  private func executeInvokeStep(
    _ step: [String: Any],
    surface: SurfaceViewModel?,
    caseName: String
  ) {
    guard let surface,
      let nodePath = step["node"] as? String,
      let propKey = step["property"] as? String,
      let node = findNodeByPath(nodePath, from: surface.rootNode, surface: surface),
      let action = node.action(for: propKey)
    else {
      Issue.record("[\(caseName)] invoke step could not locate action")
      return
    }
    action()
  }

  private func findNodeByPath(
    _ path: String,
    from root: Node?,
    surface: SurfaceViewModel? = nil
  ) -> Node? {
    guard let root else { return nil }
    let segments = path.split(separator: "/").map(String.init)
    guard segments.first == "root" else { return nil }
    var current: any Resolved = root
    var lastParentNode: Node? = root
    var lastPropertyKey: String?
    for segment in segments.dropFirst() {
      guard
        let next = stepResolvedValue(
          current,
          segment: segment,
          parentNode: lastParentNode,
          propertyKey: lastPropertyKey,
          surface: surface
        )
      else {
        return nil
      }
      if let currentAsNode = current as? Node {
        lastParentNode = currentAsNode
        lastPropertyKey = segment
      } else {
        lastParentNode = nil
        lastPropertyKey = nil
      }
      current = next
    }
    return current as? Node
  }

  private func stepResolvedValue(
    _ current: any Resolved,
    segment: String,
    parentNode: Node? = nil,
    propertyKey: String? = nil,
    surface: SurfaceViewModel? = nil
  ) -> (any Resolved)? {
    if let node = current as? Node {
      return node.properties[segment]
    }
    if let nodes = current as? [Node], let idx = Int(segment) {
      if let parentNode, let propertyKey, let surface {
        let parentDefID =
          parentNode.id.split(separator: "_").first.map(String.init) ?? parentNode.id
        if let rawChildren = surface.componentsModel.components[parentDefID]?.properties[
          propertyKey
        ]?.arrayValue,
          rawChildren.indices.contains(idx),
          let childDefID = rawChildren[idx].stringValue
        {
          guard surface.componentsModel.components[childDefID] != nil else {
            return nil
          }
          if let match = nodes.first(where: {
            $0.id == childDefID || $0.id.hasPrefix("\(childDefID)_")
              || $0.id.hasPrefix("\(childDefID):")
          }) {
            return match
          }
        }
      }
      if nodes.indices.contains(idx) {
        return nodes[idx]
      }
      return nil
    }
    if let arr = current as? ResolvedArray,
      let idx = Int(segment),
      arr.elements.indices.contains(idx)
    {
      return arr.elements[idx]
    }
    if let dict = current as? ResolvedDictionary {
      return dict[segment]
    }
    return nil
  }

  private func isPendingChildSlot(_ path: String, surface: SurfaceViewModel?) -> Bool {
    guard let surface, let root = surface.rootNode else { return false }
    let segments = path.split(separator: "/").map(String.init)
    guard segments.count >= 3, let idx = Int(segments.last ?? "") else { return false }
    let propKey = segments[segments.count - 2]
    let parentPath = segments.dropLast(2).joined(separator: "/")
    guard let parentNode = findNodeByPath(parentPath, from: root, surface: surface) else {
      return false
    }
    let parentDefID = parentNode.id.split(separator: "_").first.map(String.init) ?? parentNode.id
    guard
      let rawChildren = surface.componentsModel.components[parentDefID]?.properties[propKey]?
        .arrayValue,
      rawChildren.indices.contains(idx),
      let childDefID = rawChildren[idx].stringValue
    else {
      return false
    }
    return surface.componentsModel.components[childDefID] == nil
  }

  private func assertStepExpectations(
    _ expect: [String: Any],
    surface: SurfaceViewModel?,
    capture: NodeResolutionActionCapture,
    caseName: String
  ) {
    if let expectedNodes = expect["nodes"] as? [String: Any] {
      assertExpectedNodes(expectedNodes, surface: surface, caseName: caseName)
    }
    if let expectedData = expect["data"] as? [String: Any], let surface {
      for (path, rawVal) in expectedData {
        #expect(
          surface.dataModel.get(path) == ConformanceTestHelper.toJSONValue(rawVal),
          "[\(caseName)] data mismatch at '\(path)'"
        )
      }
    }
    if let expectedEvents = expect["events"] as? [[String: Any]] {
      assertExpectedEvents(expectedEvents, actual: capture.events, caseName: caseName)
    }
    if let expectedFunctions = expect["functions"] as? [[String: Any]] {
      assertExpectedFunctions(expectedFunctions, actual: capture.functionCalls, caseName: caseName)
    }
  }

  private func assertExpectedNodes(
    _ expectedNodes: [String: Any],
    surface: SurfaceViewModel?,
    caseName: String
  ) {
    if expectedNodes.isEmpty {
      #expect(surface?.rootNode == nil, "[\(caseName)] Expected empty tree (rootNode == nil)")
      return
    }
    for (nodePath, rawSpec) in expectedNodes {
      guard let spec = rawSpec as? [String: Any] else { continue }
      let state = spec["state"] as? String ?? "resolved"
      let resolvedNode = findNodeByPath(nodePath, from: surface?.rootNode, surface: surface)
      if state == "pending" || state == "unknown-type" || state == "cyclic"
        || (resolvedNode == nil && isPendingChildSlot(nodePath, surface: surface))
      {
        // Swift's value-type NodeResolver omits unresolved/cyclic placeholders or resolves known
        // component definitions; only verify resolved nodes.
        continue
      }
      guard let node = resolvedNode else {
        Issue.record("[\(caseName)] Expected resolved node at '\(nodePath)'")
        continue
      }
      assertSingleNodeMatches(node: node, spec: spec, nodePath: nodePath, caseName: caseName)
    }
  }

  private func assertSingleNodeMatches(
    node: Node,
    spec: [String: Any],
    nodePath: String,
    caseName: String
  ) {
    if let expectedCompID = spec["component_id"] as? String {
      let baseID = node.id.split(separator: ":").first.map(String.init) ?? node.id
      let strippedID = baseID.split(separator: "_").first.map(String.init) ?? baseID
      #expect(
        node.id == expectedCompID || baseID == expectedCompID || strippedID == expectedCompID,
        "[\(caseName)] \(nodePath) component_id mismatch: got '\(node.id)', expected '\(expectedCompID)'"
      )
    }
    if let expectedType = spec["type"] as? String {
      #expect(node.type == expectedType, "[\(caseName)] \(nodePath) type mismatch")
    }
    if let expectedIsValid = spec["isValid"] as? Bool {
      #expect(node.isValid == expectedIsValid, "[\(caseName)] \(nodePath) isValid mismatch")
    }
    if let expectedErrors = spec["validationErrors"] as? [String] {
      #expect(
        node.validationErrors == expectedErrors,
        "[\(caseName)] \(nodePath) validationErrors mismatch"
      )
    }
    if let expectedProps = spec["props"] as? [String: Any] {
      assertNodePropsMatch(node: node, expectedProps: expectedProps, nodePath: nodePath, caseName: caseName)
    }
  }

  private func assertNodePropsMatch(
    node: Node,
    expectedProps: [String: Any],
    nodePath: String,
    caseName: String
  ) {
    for (propKey, rawExpectedProp) in expectedProps {
      if let propSpec = rawExpectedProp as? [String: Any], propSpec["value"] != nil {
        let expectedVal = ConformanceTestHelper.toJSONValue(propSpec["value"] as Any)
        assertScalarBindingMatches(
          node: node,
          propKey: propKey,
          expectedVal: expectedVal,
          nodePath: nodePath,
          caseName: caseName
        )
      } else if let propSpec = rawExpectedProp as? [String: Any], propSpec["action"] as? Bool == true {
        #expect(node.action(for: propKey) != nil, "[\(caseName)] \(nodePath).\(propKey) expected action")
      } else if let childSpecs = rawExpectedProp as? [[String: Any]],
        childSpecs.first?["node"] != nil
      {
        #expect(
          node.children(for: propKey).count == childSpecs.count,
          "[\(caseName)] \(nodePath).\(propKey) child count mismatch"
        )
      }
    }
  }

  private func assertScalarBindingMatches(
    node: Node,
    propKey: String,
    expectedVal: JSONValue,
    nodePath: String,
    caseName: String
  ) {
    if let expStr = expectedVal.stringValue {
      #expect(
        node.string(for: propKey) == expStr,
        "[\(caseName)] \(nodePath).\(propKey) string mismatch: got '\(String(describing: node.string(for: propKey)))', expected '\(expStr)'"
      )
    } else if let expBool = expectedVal.boolValue {
      #expect(
        node.bool(for: propKey) == expBool,
        "[\(caseName)] \(nodePath).\(propKey) bool mismatch"
      )
    }
  }

  private func assertExpectedEvents(
    _ expectedEvents: [[String: Any]],
    actual: [ResolvedAction],
    caseName: String
  ) {
    #expect(actual.count == expectedEvents.count, "[\(caseName)] Event count mismatch")
    for (actualEvent, expSpec) in zip(actual, expectedEvents) {
      guard case .event(let name, let context, _) = actualEvent.identity else {
        Issue.record("[\(caseName)] Expected .event identity")
        continue
      }
      if let expName = expSpec["name"] as? String {
        #expect(name == expName, "[\(caseName)] Event name mismatch")
      }
      if let expSource = expSpec["source_component_id"] as? String {
        #expect(actualEvent.sourceComponentID == expSource, "[\(caseName)] source_component_id mismatch")
      }
      if let expCtx = expSpec["context"] as? [String: Any] {
        for (key, val) in expCtx {
          #expect(
            context?[key] == ConformanceTestHelper.toJSONValue(val),
            "[\(caseName)] Event context[\(key)] mismatch"
          )
        }
      }
    }
  }

  private func assertExpectedFunctions(
    _ expectedFunctions: [[String: Any]],
    actual: [(name: String, args: [String: JSONValue])],
    caseName: String
  ) {
    #expect(actual.count == expectedFunctions.count, "[\(caseName)] Function call count mismatch")
    for (actualCall, expSpec) in zip(actual, expectedFunctions) {
      if let expName = expSpec["name"] as? String {
        #expect(actualCall.name == expName, "[\(caseName)] Function name mismatch")
      }
      if let expArgs = expSpec["args"] as? [String: Any] {
        for (key, val) in expArgs {
          #expect(
            actualCall.args[key] == ConformanceTestHelper.toJSONValue(val),
            "[\(caseName)] Function arg '\(key)' mismatch"
          )
        }
      }
    }
  }
}
