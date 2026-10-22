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
@MainActor
public final class SurfaceComponentsModel: ObservableObject {

  private let componentsSubject: CurrentValueSubject<[String: ComponentModel], Never>
  private var listeners:
    [String: [(id: UUID, identityOnly: Bool, callback: (ComponentModel?) -> Void)]] = [:]

  /// The current components map.
  public var components: [String: ComponentModel] {
    componentsSubject.value
  }

  /// Emits the components map after each update is stored, and replays the
  /// current value on subscription.
  public var componentsPublisher: AnyPublisher<[String: ComponentModel], Never> {
    componentsSubject.eraseToAnyPublisher()
  }

  /// Creates a components model, optionally seeded with initial components.
  public init(components: [String: ComponentModel] = [:]) {
    self.componentsSubject = CurrentValueSubject(components)
  }

  /// Retrieves the component with the given ID.
  ///
  /// - Parameter id: The component ID to look up.
  /// - Returns: The `ComponentModel` if found, otherwise `nil`.
  public func get(_ id: String) -> ComponentModel? {
    componentsSubject.value[id]
  }

  /// Adds or replaces a component in the collection.
  ///
  /// - Parameter component: The component model to add.
  public func addComponent(_ component: ComponentModel) {
    update(ids: [component.id]) { current in
      current[component.id] = component
    }
  }

  /// Removes the component with the given ID.
  ///
  /// - Parameter id: The component ID to remove.
  public func removeComponent(_ id: String) {
    update(ids: [id]) { current in
      current.removeValue(forKey: id)
    }
  }

  /// Applies a batch of removals and additions in a single publication.
  ///
  /// - Parameters:
  ///   - removedIDs: Component IDs to remove before inserting new components.
  ///   - added: Component models to insert or replace.
  public func applyBatch(removing removedIDs: [String] = [], adding added: [ComponentModel]) {
    update(ids: removedIDs + added.map(\.id)) { current in
      for id in removedIDs {
        current.removeValue(forKey: id)
      }
      for component in added {
        current[component.id] = component
      }
    }
  }

  /// Subscribes a listener to changes to the component with the given ID, including its addition
  /// and removal.
  ///
  /// - Returns: An `AnyCancellable` token that unsubscribes the listener when cancelled.
  public func watch(_ id: String, _ listener: @escaping (ComponentModel?) -> Void)
    -> AnyCancellable
  {
    addListener(for: id, identityOnly: false, listener)
  }

  /// Subscribes a listener to changes to the identity of the component with the given ID: its
  /// addition and removal, and changes to its type or catalog ID.
  ///
  /// - Returns: An `AnyCancellable` token that unsubscribes the listener when cancelled.
  public func watchIdentity(_ id: String, _ listener: @escaping (ComponentModel?) -> Void)
    -> AnyCancellable
  {
    addListener(for: id, identityOnly: true, listener)
  }

  private func addListener(
    for id: String, identityOnly: Bool, _ listener: @escaping (ComponentModel?) -> Void
  ) -> AnyCancellable {
    let token = UUID()
    listeners[id, default: []].append((id: token, identityOnly: identityOnly, callback: listener))
    return AnyCancellable { [weak self] in
      guard let self else { return }
      self.listeners[id]?.removeAll { $0.id == token }
      if self.listeners[id]?.isEmpty == true {
        self.listeners.removeValue(forKey: id)
      }
    }
  }

  /// Applies a change that touches the components with the given IDs, publishes the new map, and
  /// notifies the listeners of the components whose definitions changed.
  ///
  /// Listeners added while notifying, which already see the change, aren't notified of it.
  private func update(ids: [String], _ change: (inout [String: ComponentModel]) -> Void) {
    objectWillChange.send()
    let previous = componentsSubject.value
    var current = previous
    change(&current)
    componentsSubject.send(current)
    let notifications = Set(ids).filter { previous[$0] != current[$0] }.flatMap { id in
      let identityChanged =
        previous[id]?.type != current[id]?.type || previous[id]?.catalogID != current[id]?.catalogID
      return (listeners[id] ?? []).filter { identityChanged || !$0.identityOnly }.map { listener in
        { listener.callback(current[id]) }
      }
    }
    for notify in notifications {
      notify()
    }
  }

  /// Validates references across the component graph
  /// (root presence id='root', dangling references, orphan nodes).
  ///
  /// - Parameter config: The validation configuration.
  /// - Throws: `A2UIIntegrityError` if graph topology validation fails.
  public func validateReferences(config: ValidationConfig = .strict) throws {
    let rawComponents: [[String: JSONValue]] = componentsSubject.value.values.map { component in
      var dictionary: [String: JSONValue] = [
        "id": .string(component.id),
        "component": .string(component.type),
      ]
      for (key, value) in component.properties {
        dictionary[key] = value
      }
      return dictionary
    }
    try GraphTopologyValidator.validate(
      components: rawComponents,
      rootID: "root",
      config: config
    )
  }
}
