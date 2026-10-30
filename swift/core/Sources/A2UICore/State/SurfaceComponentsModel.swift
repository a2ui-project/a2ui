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
  let changedIDsSubject = PassthroughSubject<Set<String>, Never>()
  let metadataChangedSubject = PassthroughSubject<(String, [String: JSONValue]?), Never>()

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
    objectWillChange.send()
    var current = componentsSubject.value
    let old = current[component.id]
    let oldMetadata = old?.metadata
    let propsChanged =
      old == nil || old?.type != component.type || old?.catalogID != component.catalogID
      || old?.properties != component.properties
    current[component.id] = component
    if propsChanged {
      changedIDsSubject.send([component.id])
    }
    if !MetadataValidator.areEqual(oldMetadata, component.metadata) {
      metadataChangedSubject.send((component.id, component.metadata))
    }
    componentsSubject.send(current)
  }

  /// Removes the component with the given ID.
  ///
  /// - Parameter id: The component ID to remove.
  public func removeComponent(_ id: String) {
    objectWillChange.send()
    var current = componentsSubject.value
    let hadMetadata = current[id]?.metadata != nil
    current.removeValue(forKey: id)
    changedIDsSubject.send([id])
    if hadMetadata {
      metadataChangedSubject.send((id, nil))
    }
    componentsSubject.send(current)
  }

  /// Applies a batch of removals and additions in a single publication.
  ///
  /// - Parameters:
  ///   - removedIDs: Component IDs to remove before inserting new components.
  ///   - added: Component models to insert or replace.
  public func applyBatch(removing removedIDs: [String] = [], adding added: [ComponentModel]) {
    objectWillChange.send()
    var current = componentsSubject.value
    var metadataUpdates: [(String, [String: JSONValue]?)] = []
    var changedIDs = Set(removedIDs)
    for id in removedIDs {
      let wasAddedAgain = added.contains { $0.id == id }
      if !wasAddedAgain, current[id]?.metadata != nil {
        metadataUpdates.append((id, nil))
      }
      current.removeValue(forKey: id)
    }
    for component in added {
      let old = current[component.id]
      let oldMetadata = old?.metadata
      let propsChanged =
        old == nil || old?.type != component.type || old?.catalogID != component.catalogID
        || old?.properties != component.properties
      current[component.id] = component
      if propsChanged {
        changedIDs.insert(component.id)
      }
      if !MetadataValidator.areEqual(oldMetadata, component.metadata) {
        metadataUpdates.append((component.id, component.metadata))
      }
    }
    if !changedIDs.isEmpty {
      changedIDsSubject.send(changedIDs)
    }
    for update in metadataUpdates {
      metadataChangedSubject.send(update)
    }
    componentsSubject.send(current)
  }

  /// Replaces the metadata dictionary of the component with `id` after validating UAX #31 keys.
  ///
  /// - Parameters:
  ///   - metadata: Replacement metadata dictionary (`["extensions": .object(...)]`), or `nil`.
  ///   - id: The component ID to update.
  /// - Throws: ``A2UIValidationError`` when any extension key violates UAX #31.
  public func setMetadata(
    _ metadata: [String: JSONValue]?,
    forComponentID id: String
  ) throws {
    var current = componentsSubject.value
    guard var component = current[id] else { return }
    let oldMetadata = component.metadata
    try component.setMetadata(metadata)
    guard !MetadataValidator.areEqual(component.metadata, oldMetadata) else { return }
    objectWillChange.send()
    current[id] = component
    metadataChangedSubject.send((id, component.metadata))
    componentsSubject.send(current)
  }

  /// Sets a single extension key on the metadata envelope of the component with `id`.
  public func setExtension(
    _ key: String,
    value: JSONValue,
    forComponentID id: String
  ) throws {
    var current = componentsSubject.value
    guard var component = current[id] else { return }
    let oldMetadata = component.metadata
    try component.setExtension(key, value: value)
    guard !MetadataValidator.areEqual(component.metadata, oldMetadata) else { return }
    objectWillChange.send()
    current[id] = component
    metadataChangedSubject.send((id, component.metadata))
    componentsSubject.send(current)
  }

  /// Removes a single extension key from the metadata envelope of the component with `id`.
  public func removeExtension(_ key: String, forComponentID id: String) {
    var current = componentsSubject.value
    guard var component = current[id] else { return }
    let oldMetadata = component.metadata
    component.removeExtension(key)
    guard !MetadataValidator.areEqual(component.metadata, oldMetadata) else { return }
    objectWillChange.send()
    current[id] = component
    metadataChangedSubject.send((id, component.metadata))
    componentsSubject.send(current)
  }

  /// Returns a publisher that emits whenever the metadata of the component with `id` changes.
  public func metadataPublisher(
    forComponentID id: String
  ) -> AnyPublisher<[String: JSONValue]?, Never> {
    metadataChangedSubject
      .filter { $0.0 == id }
      .map(\.1)
      .eraseToAnyPublisher()
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
