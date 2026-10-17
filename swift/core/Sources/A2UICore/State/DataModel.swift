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
import Foundation
import OrderedCollections
import OrderedJSON

/// A dedicated store for application data, supporting JSON Pointer
/// path-based get and set operations.
///
/// Mirrors `DataModel` in the core blueprint and `web_core`. The path
/// subscripting logic delegates to `JSONValue`'s existing path utilities
/// in ``JSONValue+Path``.
@MainActor
public final class DataModel: ObservableObject {

  private let dataSubject: CurrentValueSubject<JSONValue, Never>
  private var listeners: [String: [(id: UUID, callback: (JSONValue?) -> Void)]] = [:]

  /// For each path, the watched paths below it, so a write only visits the listeners it affects.
  private var watchedPathsByAncestor: [String: Set<String>] = [:]

  /// The parsed components of each watched path.
  private var watchedComponents: [String: [String]] = [:]

  /// Called with the normalized path of each read through ``getThrowing(_:)``. ``NodeResolver``
  /// sets it while resolving to record the data each node depends on.
  var readObserver: ((String) -> Void)?

  /// The current data tree.
  public var data: JSONValue {
    dataSubject.value
  }

  /// Emits the data tree after each update is stored, and replays the
  /// current value on subscription. Deliberately not `@Published`, which
  /// emits during `willSet`: subscribers reading back through the model
  /// would get the previous tree.
  public var dataPublisher: AnyPublisher<JSONValue, Never> {
    dataSubject.eraseToAnyPublisher()
  }

  /// Creates a data model.
  ///
  /// - Parameter initial: The initial JSON value for the root, defaulting to
  ///   an empty object.
  public init(initial: JSONValue = .object([:])) {
    self.dataSubject = CurrentValueSubject(initial)
  }

  /// Resolves a JSON Pointer path to a value, throwing `A2UIDataError` if the path contains forbidden segments.
  public func getThrowing(_ path: String) throws -> JSONValue? {
    let components = try JSONValue.parsePathThrowing(path)
    readObserver?(Self.buildPointer(components))
    if components.isEmpty {
      return dataSubject.value
    }
    return dataSubject.value[components]
  }

  /// Resolves a JSON Pointer path to a value.
  ///
  /// - Parameter path: The path (e.g., `/user/name`).
  /// - Returns: The value at the path, or `nil` if not found.
  public func get(_ path: String) -> JSONValue? {
    try? getThrowing(path)
  }

  /// Sets a value at the given JSON Pointer path, throwing `A2UIDataError` on invalid paths or mutations.
  public func setThrowing(_ path: String, value: JSONValue?) throws {
    let effectiveValue = (value == .null) ? nil : value
    let components = try JSONValue.parsePathThrowing(path)
    if !components.isEmpty && effectiveValue == nil
      && !JSONValue.hasPath(node: dataSubject.value, components: components)
    {
      return
    }

    let affectedPaths = watchedPaths(affectedByChangeAt: components)
    let oldData = dataSubject.value

    var current = dataSubject.value
    if components.isEmpty {
      current = effectiveValue ?? .object([:])
    } else {
      if current != .null && current.objectValue == nil && current.arrayValue == nil {
        throw A2UIDataError(
          "Cannot set path '\(path)': the data model root is a primitive value."
        )
      }
      if let updated = try JSONValue.updateThrowing(
        node: current,
        components: components[...],
        newValue: effectiveValue,
        fullPath: path
      ) {
        current = updated
      } else {
        current = .object([:])
      }
    }

    objectWillChange.send()
    dataSubject.send(current)
    notifyListeners(of: affectedPaths, oldData: oldData)
  }

  /// Sets a value at the given JSON Pointer path.
  ///
  /// If `value` is `nil`, the key at the path is removed.
  ///
  /// - Parameters:
  ///   - path: The path (e.g., `/user/name`).
  ///   - value: The value to set, or `nil` to remove.
  public func set(_ path: String, value: JSONValue?) {
    try? setThrowing(path, value: value)
  }

  /// Subscribes a listener to changes at a specific JSON Pointer path.
  ///
  /// - Returns: An `AnyCancellable` token that unsubscribes the listener when cancelled.
  public func watch(_ path: String, _ listener: @escaping (JSONValue?) -> Void) throws
    -> AnyCancellable
  {
    let components = try JSONValue.parsePathThrowing(path)
    let normalized = Self.buildPointer(components)
    let id = UUID()
    if listeners[normalized] == nil {
      watchedComponents[normalized] = components
      for ancestor in Self.ancestorPointers(of: components) {
        watchedPathsByAncestor[ancestor, default: []].insert(normalized)
      }
    }
    listeners[normalized, default: []].append((id: id, callback: listener))
    return AnyCancellable { [weak self] in
      guard let self else { return }
      self.listeners[normalized]?.removeAll { $0.id == id }
      if self.listeners[normalized]?.isEmpty == true {
        self.listeners.removeValue(forKey: normalized)
        self.watchedComponents.removeValue(forKey: normalized)
        for ancestor in Self.ancestorPointers(of: components) {
          self.watchedPathsByAncestor[ancestor]?.remove(normalized)
          if self.watchedPathsByAncestor[ancestor]?.isEmpty == true {
            self.watchedPathsByAncestor.removeValue(forKey: ancestor)
          }
        }
      }
    }
  }

  /// Clears all path listeners.
  public func dispose() {
    listeners.removeAll()
    watchedPathsByAncestor.removeAll()
    watchedComponents.removeAll()
  }

  /// Returns `path` in the form ``watch(_:_:)`` keys listeners by, or `nil` if it's invalid.
  static func normalizedPath(_ path: String) -> String? {
    (try? JSONValue.parsePathThrowing(path)).map(buildPointer)
  }

  private static func buildPointer(_ components: [String]) -> String {
    guard !components.isEmpty else { return "/" }
    let escaped = components.map {
      $0.replacingOccurrences(of: "~", with: "~0")
        .replacingOccurrences(of: "/", with: "~1")
    }
    return "/" + escaped.joined(separator: "/")
  }

  /// Returns the watched paths a change at `components` affects: the changed path, its
  /// ancestors, and the paths below it.
  ///
  /// Ancestors come first, so listeners on a path hear about a change before the listeners below
  /// it.
  private func watchedPaths(affectedByChangeAt components: [String]) -> [String] {
    var paths = watchedPathsByAncestor[Self.buildPointer(components)] ?? []
    for length in 0...components.count {
      let path = Self.buildPointer(Array(components.prefix(length)))
      if listeners[path] != nil {
        paths.insert(path)
      }
    }
    return paths.sorted { $0.utf8.count < $1.utf8.count }
  }

  /// The pointers of the paths above `components`, from the root down.
  private static func ancestorPointers(of components: [String]) -> [String] {
    components.indices.map { buildPointer(Array(components.prefix($0))) }
  }

  /// Notifies the listeners of each of `paths` whose value differs from its value in `oldData`.
  private func notifyListeners(of paths: [String], oldData: JSONValue) {
    let newData = dataSubject.value
    let snapshot = paths.compactMap { path in listeners[path].map { (path, $0) } }
    for (watchedPath, callbacks) in snapshot {
      let components = watchedComponents[watchedPath] ?? []
      let newVal = components.isEmpty ? newData : newData[components]
      let oldVal = components.isEmpty ? oldData : oldData[components]
      if newVal != oldVal {
        for entry in callbacks {
          entry.callback(newVal)
        }
      }
    }
  }
}
