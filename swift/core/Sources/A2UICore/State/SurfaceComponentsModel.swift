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
import OrderedJSON

/// Manages a flat collection of ``ComponentModel`` instances by ID.
///
/// Mirrors `SurfaceComponentsModel` in the core blueprint and
/// `web_core`.
public final class SurfaceComponentsModel: @unchecked Sendable, ObservableObject {

  private let lock = NSRecursiveLock()
  private let componentsSubject: CurrentValueSubject<[String: ComponentModel], Never>

  /// The current components map.
  public var components: [String: ComponentModel] {
    lock.withLock { componentsSubject.value }
  }

  /// Emits the components map after each update is stored, and replays the
  /// current value on subscription.
  public var componentsPublisher: AnyPublisher<[String: ComponentModel], Never> {
    componentsSubject.eraseToAnyPublisher()
  }

  /// Creates an empty components model.
  public init() {
    self.componentsSubject = CurrentValueSubject([:])
  }

  /// Retrieves the component with the given ID.
  ///
  /// - Parameter id: The component ID to look up.
  /// - Returns: The `ComponentModel` if found, otherwise `nil`.
  public func get(_ id: String) -> ComponentModel? {
    lock.withLock { componentsSubject.value[id] }
  }

  /// Adds or replaces a component in the collection.
  ///
  /// - Parameter component: The component model to add.
  public func addComponent(_ component: ComponentModel) {
    lock.withLock {
      objectWillChange.send()
      var current = componentsSubject.value
      current[component.id] = component
      componentsSubject.send(current)
    }
  }

  /// Removes the component with the given ID.
  ///
  /// - Parameter id: The component ID to remove.
  public func removeComponent(_ id: String) {
    lock.withLock {
      objectWillChange.send()
      var current = componentsSubject.value
      current.removeValue(forKey: id)
      componentsSubject.send(current)
    }
  }

  /// Validates references across the component graph
  /// (root presence id='root', dangling references, orphan nodes).
  ///
  /// - Parameter config: The validation configuration.
  /// - Throws: `A2UIIntegrityError` if graph topology validation fails.
  public func validateReferences(config: ValidationConfig = .strict) throws {
    let rawComponents: [[String: JSONValue]] = lock.withLock {
      componentsSubject.value.values.map { component in
        var dictionary: [String: JSONValue] = [
          "id": .string(component.id),
          "component": .string(component.type),
        ]
        for (key, value) in component.properties {
          dictionary[key] = value
        }
        return dictionary
      }
    }
    try GraphTopologyValidator.validate(
      components: rawComponents,
      rootID: "root",
      config: config
    )
  }
}
