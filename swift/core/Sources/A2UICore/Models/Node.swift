// Copyright 2026 Google LLC
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

/// An immutable, thread-safe resolved component representation.
public struct Node: Identifiable, Equatable, Sendable {
  public let id: String
  public let type: String
  public let properties: [String: any Resolved]

  /// Creates a new resolved component node.
  public init(id: String, type: String, properties: [String: any Resolved]) {
    self.id = id
    self.type = type
    self.properties = properties
  }

  public static func == (lhs: Node, rhs: Node) -> Bool {
    guard lhs.id == rhs.id && lhs.type == rhs.type else {
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
  /// from both singular and array properties, so that the engine can
  /// proactively find and resolve all descendant nodes regardless of
  /// what the catalog author named the property.
  public var allChildNodes: [Node] {
    var result: [Node] = []
    for value in properties.values {
      if let node = value as? Node {
        result.append(node)
      } else if let nodes = value as? [Node] {
        result.append(contentsOf: nodes)
      }
    }
    return result
  }
}

extension Node: Resolved {}
