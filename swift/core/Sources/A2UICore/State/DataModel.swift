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

    let oldValues = Dictionary(
      uniqueKeysWithValues: listeners.keys.map { ($0, get($0)) }
    )

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
    notifyListeners(changedComponents: components, oldValues: oldValues)
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
    listeners[normalized, default: []].append((id: id, callback: listener))
    return AnyCancellable { [weak self] in
      guard let self else { return }
      self.listeners[normalized]?.removeAll { $0.id == id }
      if self.listeners[normalized]?.isEmpty == true {
        self.listeners.removeValue(forKey: normalized)
      }
    }
  }

  /// Clears all path listeners.
  public func dispose() {
    listeners.removeAll()
  }

  private static func buildPointer(_ components: [String]) -> String {
    guard !components.isEmpty else { return "/" }
    let escaped = components.map {
      $0.replacingOccurrences(of: "~", with: "~0")
        .replacingOccurrences(of: "/", with: "~1")
    }
    return "/" + escaped.joined(separator: "/")
  }

  private func notifyListeners(
    changedComponents: [String],
    oldValues: [String: JSONValue?]
  ) {
    let changedPath = Self.buildPointer(changedComponents)
    let changedPrefix = changedPath == "/" ? "/" : "\(changedPath)/"
    let snapshot = listeners
    for (watchedPath, callbacks) in snapshot {
      let watchedPrefix = watchedPath == "/" ? "/" : "\(watchedPath)/"
      if changedPath == watchedPath
        || watchedPath.hasPrefix(changedPrefix)
        || changedPath.hasPrefix(watchedPrefix)
      {
        let newVal = get(watchedPath)
        let oldVal = oldValues[watchedPath] ?? nil
        if newVal != oldVal {
          let callbacksSnapshot = callbacks
          for entry in callbacksSnapshot {
            entry.callback(newVal)
          }
        }
      }
    }
  }
}
