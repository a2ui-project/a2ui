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
import SwiftUI

/// The view model of one rendered component.
///
/// Holds the component's latest resolved ``Node`` and the view models of its children, and
/// publishes only when the component's own properties or child view models change, so a change
/// inside a child re-renders that child alone.
///
/// A view model's ``type`` and ``catalogID`` never change, and it looks up the implementation
/// that renders it once, when it's created. When a component's type or catalog changes, its
/// parent replaces the view model, so ``makeView()`` always matches the view model.
///
/// Given its surface, a view model also keeps itself up to date: it watches the data and component
/// definitions its node used and, when they change, resolves only its own node again with
/// ``NodeResolver/resolveNode(_:resolvingChildren:)``. Its children's nodes are resolved by their
/// own view models.
@MainActor
public final class ComponentNode: ObservableObject, Identifiable {

  /// The instance ID of the component.
  public nonisolated let id: String

  /// The component type, such as `Text`.
  public let type: String

  /// The ID of the catalog the component's type comes from.
  public let catalogID: String?

  /// The latest resolved snapshot of the component.
  ///
  /// Only reassigned when the component's own properties change.
  @Published public private(set) var node: Node

  /// The view models of the component's children, in the order the node lists them.
  public private(set) var children: [ComponentNode]

  private let catalogs: [String: Catalog<ComponentImplementation>]
  private let defaultCatalogID: String?
  private let implementation: ComponentImplementation?
  private var childrenByID: [String: ComponentNode]
  private weak var surface: SurfaceViewModel?
  private var context: NodeContext?
  private var dependencies: NodeDependencies?
  private var listLengths: [String: Int] = [:]
  private var subscriptions: [AnyCancellable] = []

  /// Creates a view model for a resolved node and its descendants.
  ///
  /// - Parameters:
  ///   - node: The resolved node.
  ///   - surface: The surface the node belongs to. With one, each child view model resolves its
  ///     own node from the child's context, so `node` only needs its own properties resolved, and
  ///     each view model keeps itself up to date.
  ///   - catalogs: The catalogs to look up the implementations that render the view models in.
  ///   - defaultCatalogID: The catalog to look in first for a node without a catalog ID.
  public init(
    node: Node,
    surface: SurfaceViewModel? = nil,
    catalogs: [String: Catalog<ComponentImplementation>] = [:],
    defaultCatalogID: String? = nil
  ) {
    self.id = node.id
    self.type = node.type
    self.catalogID = node.catalogID
    self.node = node
    self.surface = surface
    self.catalogs = catalogs
    self.defaultCatalogID = defaultCatalogID
    self.implementation = Surface.implementation(
      for: node, in: catalogs, defaultCatalogID: defaultCatalogID)
    self.children = []
    self.childrenByID = [:]
    setChildren(node.allChildNodes.map { makeChild($0) }, publishing: false)
    watchDependencies(of: node)
  }

  /// Makes the view of the component with the implementation its catalogs register for its type.
  ///
  /// The view observes this view model, so it re-renders when the view model publishes. It gets
  /// the component's `accessibility` attributes applied through ``A2UIAccessibilityModifier``.
  public func makeView() -> AnyView {
    guard let implementation else {
      print("[A2UI] Component view builder not found for type: \(type)")
      return AnyView(EmptyView())
    }
    return AnyView(
      implementation.builder(self).modifier(ComponentAccessibilityModifier(componentNode: self)))
  }

  /// Updates the component from its newly resolved node.
  ///
  /// A child keeps its view model while its instance ID, type, and catalog stay the same. That
  /// view model keeps itself up to date, so it only resolves its node again if the child moved to
  /// another context. The view model publishes once, and only if the component's own properties
  /// or its child view models changed.
  private func update(_ newNode: Node) {
    watchDependencies(of: newNode)
    let newChildren = newNode.allChildNodes.map { child in
      guard let reused = childrenByID[child.id], reused.hasIdentity(of: child) else {
        return makeChild(child)
      }
      if let childContext = child.context, childContext != reused.context {
        reused.refresh(at: childContext)
      }
      return reused
    }
    let propertiesChanged = !Self.hasSameOwnProperties(node, newNode)
    if propertiesChanged {
      node = newNode
    }
    setChildren(newChildren, publishing: !propertiesChanged)
  }

  /// Replaces the child view models, publishing first if asked and they changed.
  ///
  /// Releases the view models that are no longer children from the tree.
  private func setChildren(_ newChildren: [ComponentNode], publishing: Bool) {
    guard !newChildren.elementsEqual(children, by: ===) else { return }
    if publishing {
      objectWillChange.send()
    }
    let kept = Set(newChildren.map(ObjectIdentifier.init))
    for child in children where !kept.contains(ObjectIdentifier(child)) {
      child.detach()
    }
    children = newChildren
    childrenByID = Self.index(newChildren)
  }

  /// Returns the view model `parent` holds for a child `node`, or a new view model when there is
  /// no parent view model or it doesn't hold that child.
  public static func child(for node: Node, in parent: ComponentNode?) -> ComponentNode {
    parent?.childrenByID[node.id] ?? parent?.makeChild(node) ?? ComponentNode(node: node)
  }

  /// Creates the view model of a child, first resolving the child's own node at `context`, or the
  /// child's context, when there's a surface.
  private func makeChild(_ child: Node, at context: NodeContext? = nil) -> ComponentNode {
    let resolved = (context ?? child.context).flatMap {
      surface?.nodeResolver.resolveNode($0, resolvingChildren: false)
    }
    return ComponentNode(
      node: resolved ?? child, surface: surface, catalogs: catalogs,
      defaultCatalogID: defaultCatalogID)
  }

  /// Whether `node` has this view model's instance ID, type, and catalog.
  private func hasIdentity(of node: Node) -> Bool {
    node.id == id && node.type == type && node.catalogID == catalogID
  }

  // MARK: - Watching Dependencies

  /// Watches the data and component definitions `node` used, replacing the previous
  /// subscriptions when they changed.
  ///
  /// A template array only matters by its length; its items' contents are watched by the items'
  /// own view models. The subscriptions end when the view model is released.
  private func watchDependencies(of node: Node) {
    context = node.context
    guard let surface else { return }
    let dataModel = surface.dataModel
    for path in node.dependencies.lists {
      listLengths[path] = dataModel.get(path)?.arrayValue?.count
    }
    guard node.dependencies != dependencies else { return }
    dependencies = node.dependencies
    let valueSubscriptions = node.dependencies.values.compactMap { path in
      try? dataModel.watch(path) { [weak self] _ in
        self?.refresh()
      }
    }
    let listSubscriptions = node.dependencies.lists.compactMap { path in
      try? dataModel.watch(path) { [weak self] value in
        guard let self, value?.arrayValue?.count != self.listLengths[path] else { return }
        self.refresh()
      }
    }
    let componentsModel = surface.componentsModel
    let ownID = context?.componentID
    let ownSubscription = ownID.map { id in
      componentsModel.watch(id) { [weak self] definition in
        self?.componentChanged(id, to: definition)
      }
    }
    let childSubscriptions = node.dependencies.components.filter { $0 != ownID }.map { id in
      componentsModel.watchIdentity(id) { [weak self] definition in
        self?.componentChanged(id, to: definition)
      }
    }
    let componentSubscriptions = [ownSubscription].compactMap { $0 } + childSubscriptions
    subscriptions = valueSubscriptions + listSubscriptions + componentSubscriptions
  }

  /// Responds to a change to a component definition the node uses.
  ///
  /// - Its own definition: resolves the node again, unless its type or catalog changed, in which
  ///   case the parent replaces this view model.
  /// - A child's definition that appeared or disappeared: resolves the node again, since its list
  ///   of children changed.
  /// - A child's definition whose type or catalog changed: replaces that child's view models
  ///   without resolving the node again.
  ///
  /// It only watches the identity of its children's definitions, since a child's own view model
  /// handles any other change to them.
  private func componentChanged(_ componentID: String, to definition: ComponentModel?) {
    let definitionCatalogID = definition?.catalogID ?? surface?.nodeResolver.defaultCatalogID
    func matchesDefinition(_ viewModel: ComponentNode) -> Bool {
      viewModel.type == definition?.type && viewModel.catalogID == definitionCatalogID
    }
    guard componentID != context?.componentID else {
      if matchesDefinition(self) {
        refresh()
      }
      return
    }
    let affected = children.filter { $0.context?.componentID == componentID }
    if affected.isEmpty && definition == nil {
      return
    }
    if affected.isEmpty || definition == nil {
      // A child appeared or disappeared, so the node's own list of children changed.
      refresh()
      return
    }
    let replaced = Set(affected.filter { !matchesDefinition($0) }.map(ObjectIdentifier.init))
    guard !replaced.isEmpty else { return }
    setChildren(
      children.map {
        replaced.contains(ObjectIdentifier($0)) ? makeChild($0.node, at: $0.context) : $0
      },
      publishing: true)
  }

  /// Stops keeping the view model and its descendants up to date, once it's no longer in the tree.
  ///
  /// Its views may still hold it until they're removed.
  func detach() {
    surface = nil
    subscriptions = []
    for child in children {
      child.detach()
    }
  }

  /// Resolves the node again, at `newContext` if given.
  ///
  /// If the component's definition is gone or changed type or catalog, the parent replaces this
  /// view model instead.
  private func refresh(at newContext: NodeContext? = nil) {
    guard let context = newContext ?? context,
      let newNode = surface?.nodeResolver.resolveNode(context, resolvingChildren: false),
      hasIdentity(of: newNode)
    else { return }
    update(newNode)
  }

  /// Compares two nodes, treating child nodes as equal when their instance IDs match.
  ///
  /// A change inside a child is published by the child's own view model, and a child whose type
  /// or catalog changed gets a new view model, which ``setChildren(_:publishing:)`` publishes. So
  /// neither makes the parent's own properties differ.
  private static func hasSameOwnProperties(_ lhs: Node, _ rhs: Node) -> Bool {
    lhs.id == rhs.id && lhs.type == rhs.type && lhs.catalogID == rhs.catalogID
      && isSameOwnValue(ResolvedDictionary(lhs.properties), ResolvedDictionary(rhs.properties))
  }

  private static func isSameOwnValue(_ lhs: any Resolved, _ rhs: any Resolved) -> Bool {
    if let left = lhs as? Node, let right = rhs as? Node {
      return left.id == right.id
    }
    // An empty array of another element type also casts to `[Node]`.
    if let left = lhs as? [Node], let right = rhs as? [Node], !(left.isEmpty && right.isEmpty) {
      return left.map(\.id) == right.map(\.id)
    }
    if let left = lhs as? ResolvedDictionary, let right = rhs as? ResolvedDictionary {
      return left.storage.count == right.storage.count
        && left.storage.allSatisfy { key, value in
          right.storage[key].map { isSameOwnValue(value, $0) } ?? false
        }
    }
    if let left = lhs as? ResolvedArray, let right = rhs as? ResolvedArray {
      return left.elements.count == right.elements.count
        && zip(left.elements, right.elements).allSatisfy { isSameOwnValue($0, $1) }
    }
    return lhs.isEqual(to: rhs)
  }

  private static func index(_ children: [ComponentNode]) -> [String: ComponentNode] {
    Dictionary(children.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
  }
}
