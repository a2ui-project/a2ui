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

/// Manages a flat collection of ``ComponentModel`` instances by ID.
///
/// Mirrors `SurfaceComponentsModel` in the core blueprint and
/// `web_core`. This is a pure data container with no schema awareness
/// or validation logic — the `MessageProcessor` handles validation
/// before adding components here.
public final class SurfaceComponentsModel: @unchecked Sendable {

  private let lock = NSRecursiveLock()

  private var components: [String: ComponentModel] = [:]

  /// Creates an empty components model.
  public init() {}

  /// Retrieves the component with the given ID.
  ///
  /// - Parameter id: The component ID to look up.
  /// - Returns: The `ComponentModel` if found, otherwise `nil`.
  public func get(_ id: String) -> ComponentModel? {
    lock.withLock { components[id] }
  }

  /// Adds or replaces a component in the collection.
  ///
  /// - Parameter component: The component model to add.
  public func addComponent(_ component: ComponentModel) {
    lock.withLock {
      components[component.id] = component
    }
  }

  /// Removes the component with the given ID.
  ///
  /// - Parameter id: The component ID to remove.
  public func removeComponent(_ id: String) {
    _ = lock.withLock {
      components.removeValue(forKey: id)
    }
  }

  /// Returns all component IDs currently stored.
  public var allIDs: [String] {
    lock.withLock { Array(components.keys) }
  }

  /// Returns the number of components stored.
  public var count: Int {
    lock.withLock { components.count }
  }

  /// Returns whether the collection is empty.
  public var isEmpty: Bool {
    lock.withLock { components.isEmpty }
  }

  /// Returns a thread-safe snapshot of all components as a dictionary.
  public func snapshot() -> [String: ComponentModel] {
    lock.withLock { components }
  }
}
