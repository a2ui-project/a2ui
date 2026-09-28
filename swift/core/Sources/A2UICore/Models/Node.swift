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

import OrderedJSON

/// An immutable, thread-safe resolved component representation.
public struct Node: Identifiable, Equatable, Sendable {
  public let id: String
  public let type: String
  public let catalogID: String?
  public let properties: [String: any Resolved]

  /// Creates a new resolved component node.
  public init(
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

  public static func == (lhs: Node, rhs: Node) -> Bool {
    guard lhs.id == rhs.id && lhs.type == rhs.type && lhs.catalogID == rhs.catalogID else {
      return false
    }
    guard lhs.properties.count == rhs.properties.count else {
      return false
    }
    for (key, lhsVal) in lhs.properties {
      guard let rhsVal = rhs.properties[key] else {
        return false
      }
      guard lhsVal.isEqual(to: rhsVal) else {
        return false
      }
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
    if let jsonValue = properties[key] as? JSONValue { return jsonValue.stringValue }
    if let jsonBinding = properties[key] as? DataBinding<JSONValue> {
      return jsonBinding.value?.stringValue
    }
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

  /// Returns the resolved accessibility attributes, falling back to implicit label inference.
  public var accessibilityAttributes: AccessibilityAttributes? {
    let accessibilityDictionary =
      (properties["accessibility"] as? ResolvedDictionary)
      ?? dictionary(for: "accessibility").map { ResolvedDictionary($0) }
    let accessibilityJSON = properties["accessibility"] as? JSONValue

    let explicitLabel =
      accessibilityDictionary?.string(for: "label")
      ?? accessibilityJSON?["label"]?.stringValue
    let explicitDescription =
      accessibilityDictionary?.string(for: "description")
      ?? accessibilityJSON?["description"]?.stringValue
    let explicitLive =
      accessibilityDictionary?.string(for: "live")
      ?? accessibilityJSON?["live"]?.stringValue
    let explicitHidden =
      accessibilityDictionary?.bool(for: "hidden")
      ?? accessibilityJSON?["hidden"]?.boolValue

    let inferredLabel =
      explicitLabel
      ?? string(for: "title")
      ?? string(for: "text")
      ?? string(for: "label")

    if inferredLabel != nil
      || explicitDescription != nil
      || explicitLive != nil
      || explicitHidden != nil
    {
      return AccessibilityAttributes(
        label: inferredLabel,
        description: explicitDescription,
        live: explicitLive,
        hidden: explicitHidden
      )
    }
    return nil
  }
}

extension Node: Resolved {}
