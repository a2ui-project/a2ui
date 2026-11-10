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

import Observation
import OrderedJSON

/// The resolution state of a component ``Node``.
public enum NodeState: String, Sendable, Equatable {
  case resolved = "resolved"
  case pending = "pending"
  case unknownType = "unknown-type"
  case cyclic = "cyclic"
}

/// A persistent, observable backing store for a resolved component node.
@MainActor
package final class NodeBox: Observable {
  private let registrar = ObservationRegistrar()

  nonisolated let id: String
  nonisolated let type: String
  nonisolated let catalogID: String?
  nonisolated let state: NodeState
  nonisolated let scopeKey: String?
  nonisolated let dataContextPath: String
  private var _properties: [String: any Resolved]
  private var _metadata: [String: JSONValue]?
  package private(set) var revision: UInt64 = 0
  package private(set) var propsRevision: UInt64 = 0

  var properties: [String: any Resolved] {
    registrar.access(self, keyPath: \.properties)
    return _properties
  }

  var metadata: [String: JSONValue]? {
    registrar.access(self, keyPath: \.metadata)
    return _metadata
  }

  nonisolated init(
    id: String,
    type: String,
    catalogID: String? = nil,
    state: NodeState = .resolved,
    scopeKey: String? = nil,
    dataContextPath: String = "/",
    properties: [String: any Resolved],
    metadata: [String: JSONValue]? = nil
  ) {
    self.id = id
    self.type = type
    self.catalogID = catalogID
    self.state = state
    self.scopeKey = scopeKey
    self.dataContextPath = dataContextPath
    self._properties = properties
    self._metadata = metadata
  }

  /// Updates the box's resolved properties and metadata in-place, notifying `Observation`
  /// observers only for the storage (`properties` or `metadata`) that changed.
  func updateProperties(
    _ newProperties: [String: any Resolved],
    metadata newMetadata: [String: JSONValue]? = nil
  ) {
    let propsChanged = !Self.arePropertiesShallowEqual(_properties, newProperties)
    let metaChanged = !MetadataValidator.areEqual(_metadata, newMetadata)
    if propsChanged {
      registrar.withMutation(of: self, keyPath: \.properties) {
        _properties = newProperties
      }
      propsRevision &+= 1
    } else {
      _properties = newProperties
    }
    if metaChanged {
      registrar.withMutation(of: self, keyPath: \.metadata) {
        _metadata = newMetadata
      }
    } else {
      _metadata = newMetadata
    }
    if propsChanged || metaChanged {
      revision &+= 1
    }
  }

  enum SlotStep: Sendable, Equatable {
    case nodeListIndex(Int)
    case arrayIndex(Int)
    case key(String)
  }

  enum ChildSlot: Sendable, Equatable {
    case direct(property: String)
    case listElement(property: String, index: Int)
    case nested(property: String, steps: [SlotStep])
  }

  struct ChildSlotReplacement {
    let slots: [ChildSlot]
    let oldBox: NodeBox
    let newNode: Node
  }

  /// Updates the box's metadata in-place without re-resolving properties or child subtrees.
  func updateMetadata(_ newMetadata: [String: JSONValue]?) {
    guard !MetadataValidator.areEqual(_metadata, newMetadata) else { return }
    registrar.withMutation(of: self, keyPath: \.metadata) {
      _metadata = newMetadata
    }
    revision &+= 1
  }

  /// Replaces references to replaced child boxes in-place without re-resolving sibling children.
  func replaceChildSlots(_ replacements: [ChildSlotReplacement]) {
    guard
      replacements.contains(where: {
        $0.oldBox !== $0.newNode.box && slotsHold($0.oldBox, in: $0.slots)
      })
    else {
      return
    }
    registrar.withMutation(of: self, keyPath: \.properties) {
      for replacement in replacements where replacement.oldBox !== replacement.newNode.box {
        for slot in replacement.slots {
          applySlotReplacement(slot, from: replacement.oldBox, to: replacement.newNode)
        }
      }
    }
    propsRevision &+= 1
    revision &+= 1
  }

  private func applySlotReplacement(_ slot: ChildSlot, from oldBox: NodeBox, to newNode: Node) {
    switch slot {
    case .direct(let property):
      if let existing = _properties[property] as? Node, existing.box === oldBox {
        _properties[property] = newNode
      }
    case .listElement(let property, let index):
      guard _properties[property] is [Node],
        var nodes = _properties.removeValue(forKey: property) as? [Node]
      else {
        return
      }
      if nodes.indices.contains(index), nodes[index].box === oldBox {
        nodes[index] = newNode
      }
      _properties[property] = nodes
    case .nested(let property, let steps):
      guard var rootValue = _properties.removeValue(forKey: property) else { return }
      Self.updateSlot(in: &rootValue, steps: steps[...], from: oldBox, to: newNode)
      _properties[property] = rootValue
    }
  }

  private func slotsHold(_ target: NodeBox, in slots: [ChildSlot]) -> Bool {
    slots.contains { slot in
      switch slot {
      case .direct(let property):
        return (_properties[property] as? Node)?.box === target
      case .listElement(let property, let index):
        guard let nodes = _properties[property] as? [Node], nodes.indices.contains(index) else {
          return false
        }
        return nodes[index].box === target
      case .nested(let property, let steps):
        guard let existing = _properties[property] else { return false }
        return Self.slotHolds(target, in: existing, steps: steps[...])
      }
    }
  }

  private static func slotHolds(
    _ target: NodeBox,
    in value: any Resolved,
    steps: ArraySlice<SlotStep>
  ) -> Bool {
    guard let step = steps.first else {
      return (value as? Node)?.box === target
    }
    let rest = steps.dropFirst()
    switch step {
    case .nodeListIndex(let index):
      guard rest.isEmpty, let nodes = value as? [Node], nodes.indices.contains(index) else {
        return false
      }
      return nodes[index].box === target
    case .arrayIndex(let index):
      guard let arr = value as? ResolvedArray, arr.elements.indices.contains(index) else {
        return false
      }
      return slotHolds(target, in: arr.elements[index], steps: rest)
    case .key(let key):
      guard let dict = value as? ResolvedDictionary, let child = dict.storage[key] else {
        return false
      }
      return slotHolds(target, in: child, steps: rest)
    }
  }

  /// Replaces a nested child slot in `O(depth)`, moving each container out of its existential
  /// before mutating so `[Node]`, `ResolvedArray`, and `ResolvedDictionary` buffers stay uniquely
  /// referenced and avoid Copy-on-Write clones.
  private static func updateSlot(
    in value: inout any Resolved,
    steps: ArraySlice<SlotStep>,
    from oldBox: NodeBox,
    to newNode: Node
  ) {
    guard let step = steps.first else {
      if let node = value as? Node, node.box === oldBox {
        value = newNode
      }
      return
    }
    let rest = steps.dropFirst()
    var taken: any Resolved = false
    swap(&value, &taken)
    switch step {
    case .nodeListIndex(let index):
      guard var nodes = taken as? [Node] else {
        value = taken
        return
      }
      taken = false
      if rest.isEmpty, nodes.indices.contains(index), nodes[index].box === oldBox {
        nodes[index] = newNode
      }
      value = nodes
    case .arrayIndex(let index):
      guard var arr = taken as? ResolvedArray, arr.elements.indices.contains(index) else {
        value = taken
        return
      }
      taken = false
      var child: any Resolved = false
      swap(&arr.elements[index], &child)
      updateSlot(in: &child, steps: rest, from: oldBox, to: newNode)
      swap(&arr.elements[index], &child)
      value = arr
    case .key(let key):
      guard var dict = taken as? ResolvedDictionary else {
        value = taken
        return
      }
      taken = false
      guard var child = dict.storage.removeValue(forKey: key) else {
        value = dict
        return
      }
      updateSlot(in: &child, steps: rest, from: oldBox, to: newNode)
      dict.storage[key] = child
      value = dict
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
public struct Node: Identifiable, @preconcurrency Equatable, Sendable {
  package let box: NodeBox

  public var id: String { box.id }
  public var type: String { box.type }
  public var catalogID: String? { box.catalogID }
  public var state: NodeState { box.state }
  public var scopeKey: String? { box.scopeKey }
  public var dataContextPath: String { box.dataContextPath }
  @MainActor
  public var properties: [String: any Resolved] { box.properties }
  @MainActor
  public var metadata: [String: JSONValue]? { box.metadata }
  @MainActor
  public var extensions: [String: JSONValue]? { MetadataValidator.extensions(from: box.metadata) }

  /// The identity of the node's backing store.
  ///
  /// The resolver updates a node in place while its component keeps its type and state, so two
  /// nodes with the same identity are the same node instance at different points in time.
  public var identity: ObjectIdentifier { ObjectIdentifier(box) }

  /// Creates a new resolved component node.
  public init(
    id: String,
    type: String,
    catalogID: String? = nil,
    state: NodeState = .resolved,
    scopeKey: String? = nil,
    dataContextPath: String = "/",
    properties: [String: any Resolved],
    metadata: [String: JSONValue]? = nil
  ) {
    self.box = NodeBox(
      id: id,
      type: type,
      catalogID: catalogID,
      state: state,
      scopeKey: scopeKey,
      dataContextPath: dataContextPath,
      properties: properties,
      metadata: metadata
    )
  }

  /// Creates a placeholder node for a referenced component ID that has not arrived yet.
  public static func pending(
    id: String,
    scopeKey: String? = nil,
    dataContextPath: String = "/"
  ) -> Node {
    Node(
      id: id,
      type: "Placeholder",
      state: .pending,
      scopeKey: scopeKey,
      dataContextPath: dataContextPath,
      properties: [:]
    )
  }

  /// Creates a placeholder node for a component reference that closes a cycle.
  public static func cyclic(
    id: String,
    scopeKey: String? = nil,
    dataContextPath: String = "/"
  ) -> Node {
    Node(
      id: id,
      type: "Placeholder",
      state: .cyclic,
      scopeKey: scopeKey,
      dataContextPath: dataContextPath,
      properties: [:]
    )
  }

  /// Updates the backing box's resolved properties and metadata in-place.
  @MainActor
  func updateProperties(
    _ newProperties: [String: any Resolved],
    metadata newMetadata: [String: JSONValue]? = nil
  ) {
    box.updateProperties(newProperties, metadata: newMetadata)
  }

  /// Updates the backing box's metadata in-place.
  @MainActor
  func updateMetadata(_ newMetadata: [String: JSONValue]?) {
    box.updateMetadata(newMetadata)
  }

  @MainActor
  public static func == (lhs: Node, rhs: Node) -> Bool {
    if lhs.box === rhs.box {
      return true
    }
    guard
      lhs.id == rhs.id,
      lhs.type == rhs.type,
      lhs.catalogID == rhs.catalogID,
      lhs.state == rhs.state,
      lhs.scopeKey == rhs.scopeKey,
      lhs.dataContextPath == rhs.dataContextPath,
      MetadataValidator.areEqual(lhs.metadata, rhs.metadata),
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

@MainActor
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

@MainActor
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
  @available(*, deprecated, renamed: "action(for:userActivation:)")
  public func action(for key: String) -> ResolvedAction? {
    properties[key] as? ResolvedAction
  }

  /// Returns the resolved action for the given property key, gated on `userActivation`
  /// when the action invokes a local function that requires user activation.
  public func action(for key: String, userActivation: Bool) -> ResolvedAction? {
    (properties[key] as? ResolvedAction)?.withUserActivation(userActivation)
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

extension Node: @preconcurrency Resolved {
  @MainActor
  public func isEqual(to other: any Resolved) -> Bool {
    guard let otherNode = other as? Node else { return false }
    return self == otherNode
  }
}
