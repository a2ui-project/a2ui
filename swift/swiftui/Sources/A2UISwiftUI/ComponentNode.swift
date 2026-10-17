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
import Combine

/// The view model of one rendered component.
///
/// Holds the component's latest resolved ``Node`` and the view models of its children. A
/// ``Surface`` keeps one tree of view models across updates and passes each newly resolved node
/// down it with ``update(_:)``, so every component view observes a view model that outlives the
/// update.
@MainActor
public final class ComponentNode: ObservableObject, Identifiable {

  /// The instance ID of the component.
  public nonisolated let id: String

  /// The latest resolved snapshot of the component.
  @Published public private(set) var node: Node

  /// The view models of the component's children, in the order the node lists them.
  @Published public private(set) var children: [ComponentNode]

  private var childrenByID: [String: ComponentNode]

  /// Creates a view model for a resolved node and its descendants.
  public init(node: Node) {
    self.id = node.id
    self.node = node
    let children = node.allChildNodes.map { ComponentNode(node: $0) }
    self.children = children
    self.childrenByID = Self.index(children)
  }

  /// Updates the component and its children from a newly resolved node.
  ///
  /// A child keeps its view model while its instance ID stays the same, and that view model is
  /// updated in turn. A property is only reassigned, and so only publishes, when it changes.
  func update(_ newNode: Node) {
    let newChildren = newNode.allChildNodes.map { child in
      guard let reused = childrenByID[child.id] else {
        return ComponentNode(node: child)
      }
      reused.update(child)
      return reused
    }
    if !newChildren.elementsEqual(children, by: ===) {
      children = newChildren
      childrenByID = Self.index(newChildren)
    }
    if node != newNode {
      node = newNode
    }
  }

  /// Returns the view model `parent` holds for a child `node`, or a new view model when there is
  /// no parent view model or it doesn't hold that child.
  public static func child(for node: Node, in parent: ComponentNode?) -> ComponentNode {
    parent?.childrenByID[node.id] ?? ComponentNode(node: node)
  }

  private static func index(_ children: [ComponentNode]) -> [String: ComponentNode] {
    Dictionary(children.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
  }
}
