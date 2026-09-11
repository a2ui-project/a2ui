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

  /// Resolves a JSON Pointer path to a value.
  ///
  /// - Parameter path: The path (e.g., `/user/name`).
  /// - Returns: The value at the path, or `nil` if not found.
  public func get(_ path: String) -> JSONValue? {
    if path.isEmpty || path == "/" {
      return dataSubject.value
    }
    return dataSubject.value[path]
  }

  /// Sets a value at the given JSON Pointer path.
  ///
  /// If `value` is `nil`, the key at the path is removed.
  ///
  /// - Parameters:
  ///   - path: The path (e.g., `/user/name`).
  ///   - value: The value to set, or `nil` to remove.
  public func set(_ path: String, value: JSONValue?) {
    objectWillChange.send()
    var current = dataSubject.value
    if path.isEmpty || path == "/" {
      current = value ?? .object([:])
    } else {
      current[path] = value
    }
    dataSubject.send(current)
  }
}
