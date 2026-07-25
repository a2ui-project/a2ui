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

import Foundation
import OrderedJSON

/// A dedicated store for application data, supporting JSON Pointer
/// path-based get and set operations.
///
/// Mirrors `DataModel` in the core blueprint and `web_core`. The path
/// subscripting logic delegates to `JSONValue`'s existing path utilities
/// in ``JSONValue+Path``.
public final class DataModel: @unchecked Sendable {

  private let lock = NSRecursiveLock()
  private var data: JSONValue = .object([:])

  /// Creates an empty data model.
  public init() {}

  /// Creates a data model with an initial value.
  ///
  /// - Parameter initial: The initial JSON value for the root.
  public init(initial: JSONValue) {
    self.data = initial
  }

  /// Resolves a JSON Pointer path to a value.
  ///
  /// - Parameter path: The path (e.g., `/user/name`).
  /// - Returns: The value at the path, or `nil` if not found.
  public func get(_ path: String) -> JSONValue? {
    lock.withLock { data[path] }
  }

  /// Sets a value at the given JSON Pointer path.
  ///
  /// If `value` is `nil`, the key at the path is removed.
  ///
  /// - Parameters:
  ///   - path: The path (e.g., `/user/name`).
  ///   - value: The value to set, or `nil` to remove.
  public func set(_ path: String, value: JSONValue?) {
    lock.withLock {
      data[path] = value
    }
  }

  /// Returns a thread-safe copy of the entire data model.
  public func snapshot() -> JSONValue {
    lock.withLock { data }
  }
}
