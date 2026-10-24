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

/// What a check found about a surface's component graph, which had no self-reference and no
/// cycle: the references each component holds, and an upper bound on the longest chain of
/// references below each.
///
/// The bound lets ``MessageProcessor`` check an `updateComponents` batch against what it changes
/// instead of the whole surface. A cycle the batch makes passes through one of its components,
/// and only the chains through its components grow, so only those components and the ones above
/// them are revisited. A composition constraint holds or fails for one parent and child, so only
/// the references from and to the batch components are checked again.
///
/// It follows `ComponentGraphBound` of the Dart core.
@MainActor
final class ComponentGraphBound {
  /// The surface whose graph the bound describes.
  private(set) weak var surface: SurfaceViewModel?

  /// The ids each held component references, held or not, in order.
  private var children: [String: [String]] = [:]

  /// The components that reference each id, held or not.
  private var parents: [String: Set<String>] = [:]

  /// For each held component, at least the number of references in the longest chain below it.
  private var heights: [String: Int] = [:]

  /// At least the largest of `heights`.
  private var maxHeight = 0

  /// The ``SurfaceComponentsModel/revision`` of the surface components the bound describes, or
  /// nil while it describes a graph the surface has not stored yet.
  var revision: Int?

  /// Creates the bound of a graph that ``GraphTopologyValidator`` passed.
  ///
  /// - Parameters:
  ///   - surface: The surface whose graph `graph` is.
  ///   - graph: The ids each component of the graph references, by component id.
  init(surface: SurfaceViewModel, graph: [String: [String]]) {
    self.surface = surface
    for (id, references) in graph {
      setChildren(id, references)
    }
    // Children before parents, which ends since the graph has no cycle. A component waits on
    // the stack until its children have their heights.
    for start in graph.keys where heights[start] == nil {
      var stack: [(id: String, childIndex: Int, height: Int)] = [(start, 0, 0)]
      while let frame = stack.last {
        let frameChildren = children[frame.id] ?? []
        var childIndex = frame.childIndex
        var height = frame.height
        var ready = true
        while childIndex < frameChildren.count {
          let child = frameChildren[childIndex]
          childIndex += 1
          guard graph[child] != nil else { continue }
          guard let below = heights[child] else {
            stack[stack.count - 1] = (frame.id, childIndex - 1, height)
            stack.append((child, 0, 0))
            ready = false
            break
          }
          if below >= height { height = below + 1 }
        }
        guard ready else { continue }
        heights[frame.id] = height
        maxHeight = max(maxHeight, height)
        stack.removeLast()
      }
    }
  }

  /// The ids `id` references, held or not.
  func childrenOf(_ id: String) -> [String] {
    children[id] ?? []
  }

  /// The components that reference `id`, held or not.
  func parentsOf(_ id: String) -> Set<String> {
    parents[id] ?? []
  }

  private func setChildren(_ id: String, _ references: [String]) {
    for child in children[id] ?? [] {
      parents[child]?.remove(id)
    }
    for child in references {
      parents[child, default: []].insert(id)
    }
    children[id] = references
  }

  /// Whether the graph with `batch` applied has no self-reference, no cycle and no chain of more
  /// than `limit` references, which holds if this bound shows it, updating the bound to that
  /// graph.
  ///
  /// False means the bound cannot show it, not that the graph fails, and leaves the bound
  /// unusable.
  ///
  /// - Parameters:
  ///   - batch: The ids each component of the batch references, by component id.
  ///   - limit: The largest number of references a chain may hold.
  ///   - held: Whether the graph holds an id before the batch.
  func admits(batch: [String: [String]], limit: Int, held: (String) -> Bool) -> Bool {
    guard maxHeight <= limit else { return false }
    for (id, references) in batch {
      if references.contains(id) { return false }
      setChildren(id, references)
    }
    // Raises the bound of each component above one whose bound rose, until none rises. A cycle
    // would raise its bounds past any limit.
    var rising: [String] = []
    for id in batch.keys {
      var height = 0
      for child in children[id] ?? [] where batch[child] != nil || held(child) {
        let below = heights[child] ?? 0
        if below >= height { height = below + 1 }
      }
      heights[id] = height
      rising.append(id)
    }
    var next = 0
    while next < rising.count {
      let id = rising[next]
      next += 1
      let height = heights[id] ?? 0
      if height > limit { return false }
      maxHeight = max(maxHeight, height)
      for parent in parents[id] ?? [] where (heights[parent] ?? 0) <= height {
        heights[parent] = height + 1
        rising.append(parent)
      }
    }
    return true
  }

  /// Whether the composition constraints of `catalogs` hold for every reference from or to a
  /// component of `batch`, and for `rootID` when the batch holds it, in the graph this bound
  /// describes, which has the batch applied.
  ///
  /// The graph before the batch passed the constraints, and a constraint holds or fails for one
  /// parent and child, so the other references still pass.
  ///
  /// - Parameters:
  ///   - batch: The ids of the batch components.
  ///   - rootID: The id of the root component, whose parent is the surface.
  ///   - catalogs: The catalogs of the surface.
  ///   - defaultCatalogID: The surface default catalog.
  ///   - typeOf: The type and catalog of a held component, or nil when the graph doesn't hold it.
  func compositionHolds(
    batch: some Collection<String>,
    rootID: String,
    catalogs: [String: AnyCatalog],
    defaultCatalogID: String?,
    typeOf: (String) -> (type: String, catalogID: String?)?
  ) -> Bool {
    func api(_ info: (type: String, catalogID: String?)) -> (any ComponentAPI)? {
      GraphTopologyValidator.lookupComponentAPI(
        type: info.type,
        catalogID: info.catalogID,
        catalogs: catalogs,
        defaultCatalogID: defaultCatalogID
      )
    }
    func edgeHolds(parent parentID: String, child childID: String) -> Bool {
      guard let parentInfo = typeOf(parentID), let childInfo = typeOf(childID) else {
        return true
      }
      if let allowedChildren = api(parentInfo)?.allowedChildren,
        !allowedChildren.contains(childInfo.type)
      {
        return false
      }
      if let allowedParents = api(childInfo)?.allowedParents,
        !allowedParents.contains(parentInfo.type)
      {
        return false
      }
      return true
    }

    let batchIDs = Set(batch)
    for id in batchIDs {
      if id == rootID, let rootInfo = typeOf(id),
        let allowedParents = api(rootInfo)?.allowedParents, !allowedParents.contains("Surface")
      {
        return false
      }
      for child in childrenOf(id) where !edgeHolds(parent: id, child: child) {
        return false
      }
      for parent in parentsOf(id) where !batchIDs.contains(parent) {
        if !edgeHolds(parent: parent, child: id) { return false }
      }
    }
    return true
  }
}
