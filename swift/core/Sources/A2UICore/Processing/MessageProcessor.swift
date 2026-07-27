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
import JSONSchema
import OrderedCollections
import OrderedJSON

/// The central processor for A2UI messages.
///
/// Mirrors `MessageProcessor` in the core blueprint and `web_core`.
/// Accepts strongly-typed ``ServerToClientMessage`` values, validates
/// component declarations against the catalog's schemas, and mutates
/// the corresponding ``SurfaceViewModel`` state.
///
/// This is the natural extension point for multi-version support:
/// version-specific parsing and validation logic lives here, keeping
/// the state models (`SurfaceViewModel`, `SurfaceComponentsModel`,
/// `DataModel`) clean and version-agnostic.
public final class MessageProcessor: @unchecked Sendable {

  private let lock = NSRecursiveLock()
  private var surfaces: [String: SurfaceViewModel] = [:]
  private let catalogs: [Catalog]
  private let actionHandler: (any ActionHandling)?

  /// Creates a new message processor.
  ///
  /// - Parameters:
  ///   - catalogs: The available catalogs for component validation.
  ///   - actionHandler: An optional global handler for actions from all surfaces.
  public init(
    catalogs: [Catalog],
    actionHandler: (any ActionHandling)? = nil
  ) {
    self.catalogs = catalogs
    self.actionHandler = actionHandler
  }

  // MARK: - Surface Management

  /// Returns the surface model for the given ID, if it exists.
  public func getSurface(_ id: String) -> SurfaceViewModel? {
    lock.withLock { surfaces[id] }
  }

  /// Creates a new surface with the given ID and catalog.
  ///
  /// - Parameters:
  ///   - surfaceID: The unique surface identifier.
  ///   - catalog: The catalog to use for this surface.
  /// - Returns: The newly created `SurfaceViewModel`.
  public func createSurface(
    surfaceID: String,
    catalog: Catalog
  ) -> SurfaceViewModel {
    lock.withLock {
      let surface = SurfaceViewModel(
        surfaceID: surfaceID,
        catalog: catalog,
        actionHandler: actionHandler
      )
      surfaces[surfaceID] = surface
      return surface
    }
  }

  /// Creates a surface using a catalog ID lookup.
  ///
  /// - Parameters:
  ///   - surfaceID: The unique surface identifier.
  ///   - catalogID: The ID of the catalog to use.
  /// - Returns: The newly created `SurfaceViewModel`, or `nil` if the catalog
  ///   is not found.
  public func createSurface(
    surfaceID: String,
    catalogID: String
  ) -> SurfaceViewModel? {
    guard let catalog = catalogs.first(where: { $0.id == catalogID }) else {
      return nil
    }
    return createSurface(surfaceID: surfaceID, catalog: catalog)
  }

  /// Deletes the surface with the given ID.
  public func deleteSurface(_ surfaceID: String) {
    _ = lock.withLock {
      surfaces.removeValue(forKey: surfaceID)
    }
  }

  // MARK: - Message Processing

  /// Processes a single server-to-client message.
  ///
  /// - Parameter message: The message to process.
  public func processMessage(_ message: ServerToClientMessage) {
    switch message {
    case .createSurface(let msg):
      processCreateSurface(msg)
    case .updateComponents(let msg):
      processUpdateComponents(msg)
    case .updateDataModel(let msg):
      processUpdateDataModel(msg)
    case .deleteSurface(let msg):
      processDeleteSurface(msg)
    }
  }

  /// Processes an array of server-to-client messages.
  ///
  /// - Parameter messages: The messages to process.
  public func processMessages(_ messages: [ServerToClientMessage]) {
    for message in messages {
      processMessage(message)
    }
  }

  // MARK: - Direct Mutation API

  /// Updates components on a surface, validating each against the
  /// catalog's schema.
  ///
  /// Valid components are stored in the surface's `SurfaceComponentsModel`
  /// as ``ComponentModel`` instances. Validation errors are reported to
  /// the surface's action handler.
  ///
  /// - Parameters:
  ///   - surfaceID: The surface to update.
  ///   - components: The raw component dictionaries to validate and store.
  public func updateComponents(
    surfaceID: String,
    components: [[String: JSONValue]]
  ) {
    guard let surface = getSurface(surfaceID) else { return }

    for componentDict in components {
      guard let type = componentDict["component"]?.stringValue else {
        let error = ClientServerError.validationFailed(
          ValidationFailedError(
            surfaceID: surfaceID,
            path: "/component",
            message: "Missing required key 'component'"
          )
        )
        actionHandler?.handle(error: error, from: surfaceID)
        continue
      }

      guard let id = componentDict["id"]?.stringValue else {
        let error = ClientServerError.validationFailed(
          ValidationFailedError(
            surfaceID: surfaceID,
            path: "/id",
            message: "Missing required key 'id'"
          )
        )
        actionHandler?.handle(error: error, from: surfaceID)
        continue
      }

      guard let schema = surface.catalog.components[type]?.schema else {
        let error = ClientServerError.validationFailed(
          ValidationFailedError(
            surfaceID: surfaceID,
            path: "/component",
            message: "Unknown component type '\(type)' not registered in catalog"
          )
        )
        actionHandler?.handle(error: error, from: surfaceID)
        continue
      }

      let instance: JSONValue = .object(
        OrderedDictionary(
          uniqueKeysWithValues: componentDict.map { ($0.key, $0.value) }
        )
      )
      let result = schema.validate(instance)

      if result.isValid {
        // Extract properties (excluding id and component)
        var props: [String: JSONValue] = [:]
        for (key, val) in componentDict where key != "id" && key != "component" {
          props[key] = val
        }

        let existing = surface.componentsModel.get(id)
        if existing != nil && existing?.type != type {
          // Type changed: recreate the component
          surface.componentsModel.removeComponent(id)
          surface.componentsModel.addComponent(
            ComponentModel(id: id, type: type, properties: props)
          )
        } else if existing != nil {
          // Update properties in place
          surface.componentsModel.addComponent(
            ComponentModel(id: id, type: type, properties: props)
          )
        } else {
          surface.componentsModel.addComponent(
            ComponentModel(id: id, type: type, properties: props)
          )
        }
      } else {
        let errorMessage = result.errors?.first?.message ?? "Validation failed"
        let errorPath = result.errors?.first?.instanceLocation.jsonPointerString ?? "/"
        let error = ClientServerError.validationFailed(
          ValidationFailedError(
            surfaceID: surfaceID,
            path: errorPath,
            message: errorMessage
          )
        )
        actionHandler?.handle(error: error, from: surfaceID)
      }
    }

    surface.rebuildTree()
  }

  /// Updates a path in a surface's data model.
  ///
  /// - Parameters:
  ///   - surfaceID: The surface to update.
  ///   - path: The JSON Pointer path.
  ///   - value: The value to set, or `nil` to remove.
  public func updateDataModel(
    surfaceID: String,
    path: String,
    value: JSONValue?
  ) {
    guard let surface = getSurface(surfaceID) else { return }
    surface.dataModel.set(path, value: value)
    surface.rebuildTree()
  }

  // MARK: - Private Message Handlers

  private func processCreateSurface(_ msg: CreateSurfaceMessage) {
    guard surfaces[msg.surfaceID] == nil else {
      let error = ClientServerError.generic(
        GenericError(
          code: "SURFACE_EXISTS",
          surfaceID: msg.surfaceID,
          message: "Surface \(msg.surfaceID) already exists."
        )
      )
      actionHandler?.handle(error: error, from: msg.surfaceID)
      return
    }

    guard let catalog = catalogs.first(where: { $0.id == msg.catalogID }) else {
      let error = ClientServerError.generic(
        GenericError(
          code: "CATALOG_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Catalog not found: \(msg.catalogID)"
        )
      )
      actionHandler?.handle(error: error, from: msg.surfaceID)
      return
    }

    _ = createSurface(surfaceID: msg.surfaceID, catalog: catalog)
  }

  private func processUpdateComponents(_ msg: UpdateComponentsMessage) {
    updateComponents(
      surfaceID: msg.surfaceID,
      components: msg.components
    )
  }

  private func processUpdateDataModel(_ msg: UpdateDataModelMessage) {
    updateDataModel(
      surfaceID: msg.surfaceID,
      path: msg.path,
      value: msg.value
    )
  }

  private func processDeleteSurface(_ msg: DeleteSurfaceMessage) {
    deleteSurface(msg.surfaceID)
  }
}
