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

import Combine
import OrderedJSON

/// A persistent, observable backing store for a resolved component node.
///
/// `@unchecked Sendable` is safe because instances are initialized once in `Node.init` and
/// only ever mutated on `@MainActor` via ``updateProperties(_:)``.
package final class NodeBox: ObservableObject, @unchecked Sendable {
  let id: String
  let type: String
  let catalogID: String?
  private(set) var properties: [String: any Resolved]
  package private(set) var revision: UInt64 = 0

  init(
    id: String,
    type: String,
    catalogID: String? = nil,
    properties: [String: any Resolved]
  ) {
    self.id = id
    self.type = type
    self.catalogID = catalogID
    self.properties = properties
  }

  /// Updates the box's resolved properties in-place, publishing `objectWillChange`
  /// only when its own non-node properties or child `NodeBox` references (`===`) change.
  @MainActor
  func updateProperties(_ newProperties: [String: any Resolved]) {
    let changed = !Self.arePropertiesShallowEqual(properties, newProperties)
    if changed {
      objectWillChange.send()
    }
    properties = newProperties
    if changed {
      revision &+= 1
    }
  }

  private static func arePropertiesShallowEqual(
    _ lhs: [String: any Resolved],
    _ rhs: [String: any Resolved]
  ) -> Bool {
    guard lhs.count == rhs.count else { return false }
    for (key, lhsVal) in lhs {
      guard let rhsVal = rhs[key], areValuesShallowEqual(lhsVal, rhsVal) else { return false }
    }
    return true
  }

  private static func areValuesShallowEqual(
    _ lhs: any Resolved,
    _ rhs: any Resolved
  ) -> Bool {
    if let lhsNode = lhs as? Node, let rhsNode = rhs as? Node {
      return lhsNode.box === rhsNode.box
    }
    if let lhsNodes = lhs as? [Node], let rhsNodes = rhs as? [Node] {
      return lhsNodes.count == rhsNodes.count
        && zip(lhsNodes, rhsNodes).allSatisfy { $0.box === $1.box }
    }
    if let lhsDict = lhs as? ResolvedDictionary, let rhsDict = rhs as? ResolvedDictionary {
      return arePropertiesShallowEqual(lhsDict.storage, rhsDict.storage)
    }
    if let lhsArr = lhs as? ResolvedArray, let rhsArr = rhs as? ResolvedArray {
      return lhsArr.elements.count == rhsArr.elements.count
        && zip(lhsArr.elements, rhsArr.elements).allSatisfy { areValuesShallowEqual($0, $1) }
    }
    return lhs.isEqual(to: rhs)
  }
}

/// A resolved component representation.
public struct Node: Identifiable, Equatable, Sendable {
  package let box: NodeBox
  private let renderRevision: UInt64

  public var id: String { box.id }
  public var type: String { box.type }
  public var catalogID: String? { box.catalogID }
  public var properties: [String: any Resolved] { box.properties }

  /// Creates a new resolved component node.
  public init(
    id: String,
    type: String,
    catalogID: String? = nil,
    properties: [String: any Resolved]
  ) {
    self.box = NodeBox(id: id, type: type, catalogID: catalogID, properties: properties)
    self.renderRevision = 0
  }

  private init(box: NodeBox, renderRevision: UInt64) {
    self.box = box
    self.renderRevision = renderRevision
  }

  /// Updates the backing box's resolved properties in-place and returns a `Node` stamped with
  /// the box's resulting revision.
  @MainActor
  func updatingProperties(_ newProperties: [String: any Resolved]) -> Node {
    box.updateProperties(newProperties)
    return withCurrentRevision()
  }

  /// Returns a copy stamped with the backing box's current revision so SwiftUI diffs
  /// catalog component view structs as changed when `ComponentNodeView` re-renders.
  package func withCurrentRevision() -> Node {
    renderRevision == box.revision ? self : Node(box: box, renderRevision: box.revision)
  }

  /// Returns a copy with a neutral render revision for container child identity checks.
  package func withoutRenderRevision() -> Node {
    renderRevision == 0 ? self : Node(box: box, renderRevision: 0)
  }

  public static func == (lhs: Node, rhs: Node) -> Bool {
    if lhs.box === rhs.box {
      return lhs.renderRevision == rhs.renderRevision
    }
    guard lhs.id == rhs.id && lhs.type == rhs.type && lhs.catalogID == rhs.catalogID,
      lhs.properties.count == rhs.properties.count
    else {
      return false
    }
    for (key, lhsVal) in lhs.properties {
      guard let rhsVal = rhs.properties[key], lhsVal.isEqual(to: rhsVal) else { return false }
    }
    return true
  }
}

extension Node {
  /// All resolved child nodes found by scanning the node's properties.
  ///
  /// The A2UI specification identifies structural links by **type**
  /// (`ComponentId` for single references, `ChildList` for arrays or
  /// templates), not by property name.  After resolution, single
  /// `ComponentId` references become `Node` values and `ChildList`
  /// arrays become `[Node]` values inside `properties`.
  ///
  /// This property traverses every resolved value, collecting `Node`s
  /// from singular properties, flat arrays, and nested structures (e.g.
  /// `ResolvedDictionary`, `ResolvedArray`), so that the engine can
  /// proactively find and resolve all descendant nodes regardless of
  /// schema nesting depth.
  public var allChildNodes: [Node] {
    var result: [Node] = []
    for value in properties.values {
      collectChildNodes(from: value, into: &result)
    }
    return result
  }

  private func collectChildNodes(from value: any Resolved, into result: inout [Node]) {
    if let node = value as? Node {
      result.append(node)
    } else if let nodes = value as? [Node] {
      result.append(contentsOf: nodes)
    } else if let dict = value as? ResolvedDictionary {
      for nestedVal in dict.values {
        collectChildNodes(from: nestedVal, into: &result)
      }
    } else if let arr = value as? ResolvedArray {
      for nestedVal in arr.elements {
        collectChildNodes(from: nestedVal, into: &result)
      }
    }
  }
}

// MARK: - Typed Property Accessors

extension Node {
  /// Returns the resolved string value for the given property key.
  ///
  /// Unwraps literal `String`, `DataBinding<String>.value`, `JSONValue.stringValue`,
  /// or `DataBinding<JSONValue>.value.stringValue`.
  public func string(for key: String) -> String? {
    if let stringValue = properties[key] as? String { return stringValue }
    if let binding = properties[key] as? DataBinding<String> { return binding.value }
    if let jsonValue = properties[key] as? JSONValue {
      if let str = jsonValue.stringValue { return str }
      if let num = jsonValue.intValue { return String(num) }
      if let dbl = jsonValue.doubleValue { return String(dbl) }
      if let b = jsonValue.boolValue { return String(b) }
      return nil
    }
    if let jsonBinding = properties[key] as? DataBinding<JSONValue> {
      if let val = jsonBinding.value {
        if let str = val.stringValue { return str }
        if let num = val.intValue { return String(num) }
        if let dbl = val.doubleValue { return String(dbl) }
        if let b = val.boolValue { return String(b) }
      }
      return nil
    }
    if let intValue = properties[key] as? Int { return String(intValue) }
    if let dblValue = properties[key] as? Double { return String(dblValue) }
    if let boolValue = properties[key] as? Bool { return String(boolValue) }
    return nil
  }

  /// Returns the resolved double value for the given property key.
  ///
  /// Unwraps literal `Double`, `DataBinding<Double>.value`, `JSONValue.doubleValue`,
  /// or `DataBinding<JSONValue>.value.doubleValue`.
  public func double(for key: String) -> Double? {
    if let doubleValue = properties[key] as? Double { return doubleValue }
    if let binding = properties[key] as? DataBinding<Double> { return binding.value }
    if let jsonValue = properties[key] as? JSONValue { return jsonValue.doubleValue }
    if let jsonBinding = properties[key] as? DataBinding<JSONValue> {
      return jsonBinding.value?.doubleValue
    }
    if let intValue = properties[key] as? Int { return Double(intValue) }
    return nil
  }

  /// Returns the resolved integer value for the given property key.
  ///
  /// Unwraps literal `Int`, `DataBinding<Int>.value`, `JSONValue.intValue`,
  /// or `DataBinding<JSONValue>.value.intValue`.
  public func int(for key: String) -> Int? {
    if let intValue = properties[key] as? Int { return intValue }
    if let binding = properties[key] as? DataBinding<Int> { return binding.value }
    if let jsonValue = properties[key] as? JSONValue { return jsonValue.intValue }
    if let jsonBinding = properties[key] as? DataBinding<JSONValue> {
      return jsonBinding.value?.intValue
    }
    return nil
  }

  /// Returns the resolved boolean value for the given property key.
  ///
  /// Unwraps literal `Bool`, `DataBinding<Bool>.value`, `JSONValue.boolValue`,
  /// or `DataBinding<JSONValue>.value.boolValue`.
  public func bool(for key: String) -> Bool? {
    if let booleanValue = properties[key] as? Bool { return booleanValue }
    if let binding = properties[key] as? DataBinding<Bool> { return binding.value }
    if let jsonValue = properties[key] as? JSONValue { return jsonValue.boolValue }
    if let jsonBinding = properties[key] as? DataBinding<JSONValue> {
      return jsonBinding.value?.boolValue
    }
    return nil
  }

  /// Returns the resolved `DataBinding` for the given property key.
  public func dataBinding<T: Sendable & Equatable>(for key: String) -> DataBinding<T>? {
    properties[key] as? DataBinding<T>
  }

  /// Returns the resolved action for the given property key.
  public func action(for key: String) -> ResolvedAction? {
    properties[key] as? ResolvedAction
  }

  /// Returns the single child `Node` for the given property key.
  public func child(for key: String) -> Node? {
    properties[key] as? Node
  }

  /// Returns the array of child `Node`s for the given property key.
  public func children(for key: String) -> [Node] {
    (properties[key] as? [Node]) ?? []
  }

  /// Returns the resolved array for the given property key.
  public func array(for key: String) -> [any Resolved]? {
    (properties[key] as? ResolvedArray)?.elements
  }

  /// Returns the resolved dictionary for the given property key.
  public func dictionary(for key: String) -> [String: any Resolved]? {
    (properties[key] as? ResolvedDictionary)?.storage
  }

  /// Returns the raw `JSONValue` for the given property key.
  public func jsonValue(for key: String) -> JSONValue? {
    if let json = properties[key] as? JSONValue {
      return json
    }
    if let binding = properties[key] as? DataBinding<JSONValue> {
      return binding.value
    }
    return nil
  }

  /// Returns only the accessibility attributes the agent set in the component's `accessibility`
  /// property, without inferring a label from visible text.
  ///
  /// Renderers apply these on top of the label their platform already infers from visible
  /// content, so that an explicit value overrides the inferred one.
  public var explicitAccessibilityAttributes: AccessibilityAttributes? {
    let accessibilityDictionary = properties["accessibility"] as? ResolvedDictionary
    let accessibilityJSON = properties["accessibility"] as? JSONValue

    let label =
      accessibilityDictionary?.string(for: "label")
      ?? accessibilityJSON?["label"]?.stringValue
    let description =
      accessibilityDictionary?.string(for: "description")
      ?? accessibilityJSON?["description"]?.stringValue
    let live =
      accessibilityDictionary?.string(for: "live")
      ?? accessibilityJSON?["live"]?.stringValue
    let hidden =
      accessibilityDictionary?.bool(for: "hidden")
      ?? accessibilityJSON?["hidden"]?.boolValue

    if label == nil && description == nil && live == nil && hidden == nil {
      return nil
    }
    return AccessibilityAttributes(
      label: label,
      description: description,
      live: live,
      hidden: hidden
    )
  }

  /// Returns the resolved accessibility attributes, falling back to implicit label inference.
  public var accessibilityAttributes: AccessibilityAttributes? {
    let explicit = explicitAccessibilityAttributes

    let inferredLabel =
      explicit?.label
      ?? string(for: "title")
      ?? string(for: "text")
      ?? string(for: "label")

    if inferredLabel == nil && explicit == nil {
      return nil
    }
    return AccessibilityAttributes(
      label: inferredLabel,
      description: explicit?.description,
      live: explicit?.live,
      hidden: explicit?.hidden
    )
  }
}

extension Node: Resolved {}
