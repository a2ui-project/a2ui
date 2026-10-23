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
import SwiftUI

/// The root SwiftUI view for a single A2UI surface.
///
/// `Surface` observes a ``SurfaceViewModel`` and renders the resolved
/// component tree using registered component view builders from the provided
/// SwiftUI component catalogs. The active theme and catalogs are propagated through
/// the SwiftUI environment.
public struct Surface: View {
  @ObservedObject public var viewModel: SurfaceViewModel

  public let catalogs: [String: Catalog<ComponentImplementation>]
  public let defaultCatalogID: String?
  public let surfaceID: String
  private let lifecycleState = LifecycleState()

  public init(
    viewModel: SurfaceViewModel,
    catalogs: [Catalog<ComponentImplementation>] = [],
    defaultCatalogID: String? = nil
  ) {
    self.viewModel = viewModel
    let dict = Dictionary(catalogs.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    self.catalogs = dict
    self.defaultCatalogID = defaultCatalogID ?? catalogs.first?.id
    self.surfaceID = viewModel.surfaceID
  }

  public init(
    viewModel: SurfaceViewModel,
    catalogs: [String: Catalog<ComponentImplementation>],
    defaultCatalogID: String? = nil
  ) {
    self.viewModel = viewModel
    self.catalogs = catalogs
    self.defaultCatalogID = defaultCatalogID ?? catalogs.keys.sorted().first
    self.surfaceID = viewModel.surfaceID
  }

  public init(
    viewModel: SurfaceViewModel,
    catalog: Catalog<ComponentImplementation>
  ) {
    self.init(viewModel: viewModel, catalogs: [catalog], defaultCatalogID: catalog.id)
  }

  /// Whether this surface view is currently mounted and observing model state.
  public var isMounted: Bool {
    lifecycleState.isMounted
  }

  /// The number of active reactive subscriptions held by this mounted surface.
  public var activeSubscriptionCount: Int {
    guard lifecycleState.isMounted else { return 0 }
    let count = viewModel.componentsModel.allComponents.count
    return viewModel.rootNode != nil ? max(1, count) : count
  }

  /// Unmounts the surface, disposing its data model subscriptions and resolver state.
  public func unmount() {
    lifecycleState.isMounted = false
    viewModel.dataModel.dispose()
    viewModel.nodeResolver.clearReportedExpressionErrors()
  }

  public var body: some View {
    if let rootNode = viewModel.rootNode {
      ComponentNodeView(node: rootNode)
        .environment(\.a2uiTheme, viewModel.theme)
        .environment(\.a2uiCatalogs, catalogs)
        .environment(\.a2uiDefaultCatalogID, defaultCatalogID)
    } else {
      ProgressView()
    }
  }
}

extension Surface {
  fileprivate final class LifecycleState: @unchecked Sendable {
    var isMounted = true
  }

  /// Represents a resolved or fallback node in the surface's view hierarchy.
  public struct ViewNode {
    public let id: String
    public let instanceID: String
    public let type: String?
    public let state: String
    public let node: Node?
    public let children: [ViewNode]

    public init(
      id: String,
      instanceID: String,
      type: String? = nil,
      state: String = "resolved",
      node: Node? = nil,
      children: [ViewNode] = []
    ) {
      self.id = id
      self.instanceID = instanceID
      self.type = type
      self.state = state
      self.node = node
      self.children = children
    }
  }

  /// Returns whether any registered UI catalog has a builder for the component type.
  public func hasBuilder(forComponentType type: String, catalogID: String? = nil) -> Bool {
    if let catalogID, let catalog = catalogs[catalogID] {
      return catalog.components[type] != nil
    }
    let targetID = catalogID ?? defaultCatalogID
    if let targetID, let catalog = catalogs[targetID], catalog.components[type] != nil {
      return true
    }
    return catalogs.values.contains { $0.components[type] != nil }
  }

  /// Invokes an action on `node`, enforcing `requiresUserActivation` for local function calls.
  public func invokeAction(
    on node: Node,
    property: String = "action",
    userActivated: Bool = true
  ) {
    guard node.isValid else { return }
    if !userActivated, let fnName = extractFunctionCallName(on: node, property: property),
      viewModel.function(named: fnName, catalogID: node.catalogID)?.api.requiresUserActivation
        == true
    {
      let error = FunctionError.executionFailed(
        function: fnName,
        reason: "Function '\(fnName)' requires user activation."
      )
      viewModel.handleFunctionError(error, functionName: fnName)
      return
    }
    node.action(for: property)?()
  }

  private func extractFunctionCallName(on node: Node, property: String) -> String? {
    guard let actionDict = node.properties[property] as? [String: Any],
      let fnCallDict = actionDict["functionCall"] as? [String: Any]
    else {
      return nil
    }
    return (fnCallDict["@call"] as? String) ?? (fnCallDict["call"] as? String)
  }

  /// Resolves the surface view hierarchy, emitting fallback placeholders for pending,
  /// unknown-type, or cyclic components and reporting diagnostics to `handler`.
  public func resolveViewTree(
    reportingDiagnosticsTo handler: (any ActionHandling)? = nil
  ) -> ViewNode? {
    guard viewModel.componentsModel.get("root") != nil else { return nil }
    return buildViewNode(
      componentID: "root",
      resolvedNode: viewModel.rootNode,
      visited: [],
      handler: handler
    )
  }

  private func buildViewNode(
    componentID: String,
    resolvedNode: Node?,
    visited: Set<String>,
    handler: (any ActionHandling)?
  ) -> ViewNode {
    if visited.contains(componentID) {
      reportDiagnostic(
        code: "CYCLIC_REFERENCE",
        message: "Cyclic component reference to '\(componentID)'",
        componentID: componentID,
        to: handler
      )
      return ViewNode(id: componentID, instanceID: componentID, state: "cyclic")
    }
    guard let rawComponent = viewModel.componentsModel.get(componentID) else {
      return ViewNode(id: componentID, instanceID: componentID, state: "pending")
    }
    let explicitCatalogID = rawComponent.properties["catalogId"]?.stringValue
    if !catalogs.isEmpty,
      !hasBuilder(forComponentType: rawComponent.type, catalogID: explicitCatalogID)
    {
      reportDiagnostic(
        code: "UNKNOWN_COMPONENT_TYPE",
        message: "Unknown component type '\(rawComponent.type)'",
        componentID: componentID,
        to: handler
      )
      return ViewNode(id: componentID, instanceID: componentID, state: "unknown-type")
    }
    var nextVisited = visited
    nextVisited.insert(componentID)
    let children = resolveChildViewNodes(
      rawComponent: rawComponent,
      resolvedNode: resolvedNode,
      visited: nextVisited,
      handler: handler
    )
    return ViewNode(
      id: componentID,
      instanceID: resolvedNode?.instanceID ?? componentID,
      type: rawComponent.type,
      state: "resolved",
      node: resolvedNode,
      children: children
    )
  }

  private func resolveChildViewNodes(
    rawComponent: ComponentModel,
    resolvedNode: Node?,
    visited: Set<String>,
    handler: (any ActionHandling)?
  ) -> [ViewNode] {
    if let childID = rawComponent.properties["child"]?.stringValue {
      let matching = findResolvedChild(id: childID, in: resolvedNode)
      return [
        buildViewNode(
          componentID: childID,
          resolvedNode: matching,
          visited: visited,
          handler: handler
        )
      ]
    }
    guard let childrenVal = rawComponent.properties["children"] else { return [] }
    if case .array(let items) = childrenVal {
      let ids = items.compactMap(\.stringValue)
      return ids.map { childID in
        let matching = findResolvedChild(id: childID, in: resolvedNode)
        return buildViewNode(
          componentID: childID,
          resolvedNode: matching,
          visited: visited,
          handler: handler
        )
      }
    }
    return (resolvedNode?.children ?? []).map { childNode in
      ViewNode(
        id: childNode.baseComponentID,
        instanceID: childNode.instanceID,
        type: childNode.type,
        state: "resolved",
        node: childNode
      )
    }
  }

  private func findResolvedChild(id: String, in parentNode: Node?) -> Node? {
    if let direct = parentNode?.properties["child"] as? Node, direct.baseComponentID == id {
      return direct
    }
    return parentNode?.children.first { $0.baseComponentID == id }
  }

  private func reportDiagnostic(
    code: String,
    message: String,
    componentID: String,
    to handler: (any ActionHandling)?
  ) {
    let error = RendererError.generic(
      GenericError(
        code: code,
        surfaceID: surfaceID,
        message: message,
        path: componentID,
        version: viewModel.protocolVersion
      )
    )
    handler?.handleError(error)
  }
}

extension Surface {
  /// Resolves the view builder for a node from available component catalogs and renders it.
  ///
  /// - Parameters:
  ///   - node: The resolved engine node to render.
  ///   - catalogs: The dictionary of available component catalogs.
  ///   - defaultCatalogID: The fallback default catalog ID if the node has no catalog ID.
  /// - Returns: The rendered `AnyView`, or `nil` if no corresponding view builder was found.
  public static func render(
    node: Node,
    using catalogs: [String: Catalog<ComponentImplementation>],
    defaultCatalogID: String? = nil
  ) -> AnyView? {
    if let catalogID = node.catalogID, let catalog = catalogs[catalogID],
      let component = catalog.components[node.type]
    {
      return component.builder(node)
    }
    let targetCatalogID = node.catalogID ?? defaultCatalogID
    if let targetCatalogID, let catalog = catalogs[targetCatalogID],
      let component = catalog.components[node.type]
    {
      return component.builder(node)
    }
    for catalog in catalogs.values {
      if let component = catalog.components[node.type] {
        return component.builder(node)
      }
    }
    return nil
  }
}
