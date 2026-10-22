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
import Combine
import Foundation
import OrderedJSON
import Testing
import Yams

/// Runs the shared `conformance/core/node_resolution.yaml` suite against `ComponentNodeTree`.
///
/// Swift renders through `ComponentNode` view models, so each node in the suite is a view model,
/// and a destroyed node is one that was released. The runner only holds view models weakly.
@MainActor
struct NodeResolutionConformanceTests {

  /// Checks that fail because the Swift resolver drops a child whose component hasn't arrived,
  /// instead of resolving it to a pending placeholder (#2089).
  private static let knownFailures: Set<String> = [
    "pending_child_replacement initial",
    "pending_child_replacement step 1",
    "shared_definition_independent_instances step 1",
    "shared_definition_independent_instances step 2",
  ]

  private static let conformanceDirectory = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("conformance")

  @Test func nodeResolutionConformance() throws {
    let cases = try Self.loadYAML("core/node_resolution.yaml") as? [[String: Any]] ?? []
    #expect(!cases.isEmpty, "core/node_resolution.yaml should hold test cases")

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let fixture = try Self.loadYAML(testCase["fixture"] as? String ?? "") as? [String: Any]
      let runner = CaseRunner(fixture: fixture ?? [:])
      verify("\(name) initial", runner.check(testCase["expect"] as? [String: Any] ?? [:]))

      let steps = testCase["steps"] as? [[String: Any]] ?? []
      for (index, step) in steps.enumerated() {
        runner.beginStep()
        let failure = runner.apply(step)
        let mismatches = runner.check(step["expect"] as? [String: Any] ?? [:])
        verify("\(name) step \(index + 1)", (failure.map { [$0] } ?? []) + mismatches)
      }
    }
  }

  /// Records the mismatches of one checkpoint, as known issues for the checkpoints that are
  /// expected to fail.
  private func verify(_ checkpoint: String, _ mismatches: [String]) {
    guard Self.knownFailures.contains(checkpoint) else {
      for mismatch in mismatches {
        Issue.record("\(checkpoint): \(mismatch)")
      }
      return
    }
    if mismatches.isEmpty {
      Issue.record("\(checkpoint) passes now; remove it from knownFailures")
    } else {
      withKnownIssue("\(checkpoint): needs pending placeholders (#2089)") {
        for mismatch in mismatches {
          Issue.record("\(checkpoint): \(mismatch)")
        }
      }
    }
  }

  private static func loadYAML(_ path: String) throws -> Any {
    let url = conformanceDirectory.appendingPathComponent(path)
    let yaml = try String(contentsOf: url, encoding: .utf8)
    return try Yams.load(yaml: yaml) ?? [:]
  }
}

// MARK: - Case Runner

/// Builds one case's surface and view model tree, applies its operations, and compares the
/// result with its expectations.
@MainActor
private final class CaseRunner {

  private let recorder = Recorder()
  private let surface: SurfaceViewModel
  private var tree: ComponentNodeTree?

  /// The view models seen so far, held weakly, with the position each was last seen at.
  private var observed: [ObjectIdentifier: (node: WeakNode, path: String)] = [:]
  private var subscriptions: [ObjectIdentifier: AnyCancellable] = [:]
  private var emissions = Counter()
  private var mountedBefore: [String: WeakNode] = [:]

  init(fixture: [String: Any]) {
    let basic = BasicCatalog.makeCatalog(version: .v091)
    let catalog = Catalog(
      id: basic.id,
      protocolVersion: basic.protocolVersion,
      components: Array(basic.components.values),
      functions: basic.functions.values.map { [recorder] in
        RecordingFunction(api: $0.api, recorder: recorder)
      }
    )
    surface = SurfaceViewModel(surfaceID: "conformance", catalog: catalog)
    surface.actionHandler = recorder
    surface.dataModel.set("/", value: json(fixture["data"]))
    let components = (fixture["components"] as? [[String: Any]] ?? []).map {
      componentModel($0, type: $0["component"] as? String ?? "")
    }
    surface.componentsModel.applyBatch(adding: components)
    tree = ComponentNodeTree(surface: surface)
    observeMountedNodes()
  }

  /// Snapshots the mounted positions and resets the counters before an operation.
  func beginStep() {
    mountedBefore = mounted().mapValues { WeakNode(node: $0) }
    emissions = Counter()
    for (id, entry) in observed {
      subscriptions[id] = entry.node.node?.objectWillChange.sink { [emissions] in
        emissions.counts[id, default: 0] += 1
      }
    }
    recorder.events.removeAll()
    recorder.functions.removeAll()
  }

  /// Applies one operation, returning a description of why it couldn't be applied.
  func apply(_ step: [String: Any]) -> String? {
    switch step["op"] as? String {
    case "set_data":
      surface.dataModel.set(step["path"] as? String ?? "", value: json(step["value"]))
    case "update_components":
      let components = (step["components"] as? [[String: Any]] ?? []).map { definition in
        let id = definition["id"] as? String ?? ""
        let type = surface.componentsModel.get(id)?.type ?? definition["component"] as? String
        return componentModel(definition, type: type ?? "")
      }
      surface.componentsModel.applyBatch(adding: components)
    case "remove_component":
      surface.componentsModel.removeComponent(step["component_id"] as? String ?? "")
    case "write":
      guard
        let node = mounted()[step["node"] as? String ?? ""]?.node,
        let binding = node.properties[step["property"] as? String ?? ""]
      else {
        return "write: no binding at \(step["node"] ?? "")"
      }
      write(json(step["value"]), to: binding)
    case "invoke":
      guard
        let node = mounted()[step["node"] as? String ?? ""]?.node,
        let action = node.properties[step["property"] as? String ?? ""] as? ResolvedAction
      else {
        return "invoke: no action at \(step["node"] ?? "")"
      }
      action()
    case "dispose":
      tree = nil
    case let op:
      return "unknown op \(op ?? "nil")"
    }
    return nil
  }

  /// Compares the current state with `expected`, returning each mismatch.
  func check(_ expected: [String: Any]) -> [String] {
    var mismatches: [String] = []
    func expectEqual(_ actual: JSONValue, _ expected: JSONValue, _ what: String) {
      if actual != expected {
        mismatches.append("\(what): expected \(expected), got \(actual)")
      }
    }

    // Destruction is checked before anything else is observed.
    var destroyed: [String: Int] = [:]
    for (id, entry) in observed where entry.node.node == nil {
      destroyed[entry.path, default: 0] += 1
      observed.removeValue(forKey: id)
      subscriptions.removeValue(forKey: id)
    }

    let current = mounted()
    let expectedNodes = expected["nodes"] as? [String: Any] ?? [:]
    if Set(current.keys) != Set(expectedNodes.keys) {
      mismatches.append(
        "mounted paths: expected \(expectedNodes.keys.sorted()), got \(current.keys.sorted())")
    }
    for (path, assertions) in expectedNodes {
      guard let node = current[path]?.node else { continue }
      let actual: [String: JSONValue] = [
        "component_id": node.context.map { JSONValue.string($0.componentID) } ?? .null,
        "type": .string(node.type),
        "state": .string("resolved"),
        "data_path": .string(node.context?.dataPath ?? "/"),
      ]
      for (field, value) in assertions as? [String: Any] ?? [:] {
        if field == "props" {
          for (key, expectedProp) in value as? [String: Any] ?? [:] {
            let actualProp = node.properties[key].map { normalize($0, at: "\(path)/\(key)") }
            expectEqual(actualProp ?? .null, json(expectedProp), "\(path).\(key)")
          }
        } else {
          expectEqual(actual[field] ?? .null, json(value), "\(path).\(field)")
        }
      }
    }

    var retainedEmissions: [String: Int] = [:]
    for (id, count) in emissions.counts {
      if let entry = observed[id], let node = entry.node.node, current[entry.path] === node {
        retainedEmissions[entry.path] = count
      }
    }
    expectEqual(counts(retainedEmissions), json(expected["emissions"] ?? [:]), "emissions")
    expectEqual(counts(destroyed), json(expected["destroyed"] ?? [:]), "destroyed")
    expectEqual(.array(recorder.events), json(expected["events"] ?? []), "events")
    expectEqual(.array(recorder.functions), json(expected["functions"] ?? []), "functions")

    for (field, isSame) in [("same_nodes", true), ("replaced_nodes", false)] {
      for path in expected[field] as? [String] ?? [] {
        guard let before = mountedBefore[path]?.node, let after = current[path] else {
          mismatches.append("\(field) \(path): not mounted before and after")
          continue
        }
        if (before === after) != isSame {
          mismatches.append("\(field) \(path): identity \(isSame ? "changed" : "kept")")
        }
      }
    }
    for (path, value) in expected["data"] as? [String: Any] ?? [:] {
      expectEqual(surface.dataModel.get(path) ?? .null, json(value), "data \(path)")
    }

    observeMountedNodes()
    return mismatches
  }

  // MARK: - Tree Inspection

  /// The mounted view models by position, such as `root/children/0`.
  private func mounted() -> [String: ComponentNode] {
    var result: [String: ComponentNode] = [:]
    func visit(_ componentNode: ComponentNode, at path: String) {
      result[path] = componentNode
      for (key, value) in componentNode.node.properties {
        for (suffix, child) in childNodes(in: value) {
          if let childNode = componentNode.children.first(where: { $0.id == child.id }) {
            visit(childNode, at: "\(path)/\(key)\(suffix)")
          }
        }
      }
    }
    if let root = tree?.root {
      visit(root, at: "root")
    }
    return result
  }

  /// The child nodes a property holds, with the path suffix of each.
  private func childNodes(in value: any Resolved) -> [(String, A2UICore.Node)] {
    if let node = value as? A2UICore.Node {
      return [("", node)]
    }
    if let nodes = value as? [A2UICore.Node], !nodes.isEmpty {
      return nodes.enumerated().map { ("/\($0.offset)", $0.element) }
    }
    return []
  }

  /// Starts observing the mounted view models not observed yet, and records where each is now.
  private func observeMountedNodes() {
    for (path, componentNode) in mounted() {
      observed[ObjectIdentifier(componentNode)] = (WeakNode(node: componentNode), path)
    }
  }

  /// Converts a resolved property to the suite's representation.
  private func normalize(_ value: any Resolved, at path: String) -> JSONValue {
    if value is ResolvedAction {
      return ["action": true]
    }
    if let binding = bindingInfo(value) {
      return ["value": binding.value, "writable": .boolean(binding.writable)]
    }
    let children = childNodes(in: value)
    if value is A2UICore.Node, let child = children.first {
      return ["node": .string(path + child.0)]
    }
    if !children.isEmpty {
      return .array(children.map { ["node": .string(path + $0.0)] })
    }
    switch value {
    case let string as String: return .string(string)
    case let bool as Bool: return .boolean(bool)
    case let int as Int: return .integer(int)
    case let double as Double: return .number(double)
    case let json as JSONValue: return json
    default: return .string(String(describing: value))
    }
  }

  private func bindingInfo(_ value: any Resolved) -> (value: JSONValue, writable: Bool)? {
    switch value {
    case let binding as DataBinding<String>:
      return (binding.value.map { .string($0) } ?? .null, isWritable(binding))
    case let binding as DataBinding<Bool>:
      return (binding.value.map { .boolean($0) } ?? .null, isWritable(binding))
    case let binding as DataBinding<Double>:
      return (binding.value.map { .number($0) } ?? .null, isWritable(binding))
    case let binding as DataBinding<JSONValue>:
      return (binding.value ?? .null, isWritable(binding))
    default:
      return nil
    }
  }

  private func isWritable<Value: Sendable>(_ binding: DataBinding<Value>) -> Bool {
    if case .path = binding.identity {
      return true
    }
    return false
  }

  private func write(_ value: JSONValue, to binding: any Resolved) {
    switch binding {
    case let binding as DataBinding<String>:
      if let string = value.stringValue { binding.set(string) }
    case let binding as DataBinding<Bool>:
      if let bool = value.boolValue { binding.set(bool) }
    case let binding as DataBinding<Double>:
      if let double = value.doubleValue { binding.set(double) }
    case let binding as DataBinding<JSONValue>:
      binding.set(value)
    default:
      break
    }
  }

  private func componentModel(_ definition: [String: Any], type: String) -> ComponentModel {
    var properties: [String: JSONValue] = [:]
    for (key, value) in definition where key != "id" && key != "component" {
      properties[key] = json(value)
    }
    return ComponentModel(
      id: definition["id"] as? String ?? "", type: type, properties: properties)
  }

  private func counts(_ counts: [String: Int]) -> JSONValue {
    .object(
      .init(
        uniqueKeysWithValues: counts.sorted { $0.key < $1.key }
          .map { ($0.key, JSONValue.integer($0.value)) }))
  }
}

// MARK: - Helpers

/// Converts a YAML value to a `JSONValue` with sorted object keys.
private func json(_ value: Any?) -> JSONValue {
  switch value {
  case let value as JSONValue:
    if let object = value.objectValue {
      return json(Dictionary(uniqueKeysWithValues: object.map { ($0.key, $0.value as Any) }))
    }
    return value.arrayValue.map { .array($0.map(json)) } ?? value
  case let bool as Bool: return .boolean(bool)
  case let int as Int: return .integer(int)
  case let double as Double: return .number(double)
  case let string as String: return .string(string)
  case let array as [Any]: return .array(array.map(json))
  case let object as [String: Any]:
    return .object(
      .init(
        uniqueKeysWithValues: object.sorted { $0.key < $1.key }
          .map { ($0.key, json($0.value)) }))
  default: return .null
  }
}

private struct WeakNode {
  weak var node: ComponentNode?
}

/// Counts the emissions of each view model during one step.
@MainActor
private final class Counter {
  var counts: [ObjectIdentifier: Int] = [:]
}

/// Records the action events and function calls of a case.
private final class Recorder: ActionHandling, @unchecked Sendable {
  var events: [JSONValue] = []
  var functions: [JSONValue] = []

  func handle(action: ResolvedAction, from surfaceID: String) {
    guard case .event(let name, let context, _) = action.identity else { return }
    events.append([
      "context": json(context.map { $0.mapValues { $0 as Any } }),
      "name": .string(name),
      "source_component_id": .string(action.sourceComponentID ?? ""),
    ])
  }

  func handle(error: RendererError, from surfaceID: String) {}
}

/// A catalog function that records its calls and returns null.
private struct RecordingFunction: FunctionImplementation {
  let api: FunctionAPI
  let recorder: Recorder

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    recorder.functions.append([
      "args": json(arguments.mapValues { $0 as Any }),
      "name": .string(api.name),
    ])
    return .null
  }
}
