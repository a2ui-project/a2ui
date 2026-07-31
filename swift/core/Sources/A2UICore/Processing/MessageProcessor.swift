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

import Combine
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON

/// The central processor for A2UI server-to-client messages.
///
/// Mirrors `MessageProcessor` in the core blueprint and `web_core`.
/// Accepts strongly-typed ``ServerToClientMessage`` values or raw JSON lines,
/// validates component declarations against catalog schemas, and mutates
/// the corresponding ``SurfaceViewModel`` state via ``SurfaceGroupModel``.
public final class MessageProcessor: @unchecked Sendable, ObservableObject {
  /// The surface group model owning all active surfaces.
  public let surfaceGroupModel: SurfaceGroupModel

  private let catalogs: [String: Catalog]
  private weak var actionHandler: (any ActionHandling)?
  private let parser = MessageParser()
  private let errorMapper = MessageErrorMapper()

  /// Creates a new message processor with an array of catalogs.
  public init(
    catalogs: [Catalog],
    actionHandler: (any ActionHandling)? = nil
  ) {
    self.catalogs = Dictionary(
      catalogs.map { ($0.id, $0) },
      uniquingKeysWith: { _, last in last }
    )
    self.actionHandler = actionHandler
    self.surfaceGroupModel = SurfaceGroupModel()
  }

  /// Creates a new message processor with a dictionary of catalogs.
  public init(
    catalogs: [String: Catalog],
    actionHandler: (any ActionHandling)? = nil
  ) {
    self.catalogs = catalogs
    self.actionHandler = actionHandler
    self.surfaceGroupModel = SurfaceGroupModel()
  }

  /// Returns the aggregated data model for surfaces with `sendDataModel` enabled.
  public func getClientDataModel() -> JSONValue? {
    var result: OrderedDictionary<String, JSONValue> = [:]
    for (surfaceID, vm) in surfaceGroupModel.surfaces {
      if vm.sendDataModel {
        result[surfaceID] = vm.dataModel.data
      }
    }
    guard !result.isEmpty else { return nil }
    return .object(result)
  }

  // MARK: - Message Processing (JSONL Line)

  /// Processes a single JSONL line containing an incoming message envelope.
  ///
  /// Throws on any failure (decoding error, missing surface, missing catalog).
  /// Thrown parsing errors are also routed to `ActionHandling` via `MessageErrorMapper`.
  public func process(line: String) throws {
    let message: ServerToClientMessage

    do {
      message = try parser.parse(jsonString: line)
    } catch {
      let surfaceID = (error as? MessageParseError)?.surfaceID ?? "unknown"
      let clientError = errorMapper.map(error, surfaceID: surfaceID)
      actionHandler?.handle(error: clientError, from: surfaceID)
      throw error
    }

    try validateAndProcess(message)
  }

  // MARK: - Message Processing (Strongly-Typed)

  /// Processes a single server-to-client message, throwing validation or missing surface errors.
  public func process(message: ServerToClientMessage) throws {
    try validateAndProcess(message)
  }

  /// Processes a single server-to-client message without throwing.
  public func processMessage(_ message: ServerToClientMessage) {
    try? validateAndProcess(message)
  }

  /// Processes an array of server-to-client messages.
  public func processMessages(_ messages: [ServerToClientMessage]) {
    for message in messages {
      processMessage(message)
    }
  }

  // MARK: - Private Surface Mutations & Validation

  private func createSurface(
    surfaceID: String,
    catalogID: String,
    theme: [String: JSONValue]? = nil,
    sendDataModel: Bool = false
  ) -> SurfaceViewModel? {
    guard let catalog = catalogs[catalogID] else { return nil }
    return createSurface(
      surfaceID: surfaceID,
      catalog: catalog,
      theme: theme,
      sendDataModel: sendDataModel
    )
  }

  @discardableResult
  private func createSurface(
    surfaceID: String,
    catalog: Catalog,
    theme: [String: JSONValue]? = nil,
    sendDataModel: Bool = false
  ) -> SurfaceViewModel {
    let vm = SurfaceViewModel(
      surfaceID: surfaceID,
      catalog: catalog,
      theme: theme,
      actionHandler: actionHandler,
      sendDataModel: sendDataModel
    )
    surfaceGroupModel.addSurface(vm)
    return vm
  }

  private func deleteSurface(_ surfaceID: String) {
    surfaceGroupModel.removeSurface(id: surfaceID)
  }

  private func updateComponents(
    surfaceID: String,
    components: [[String: JSONValue]]
  ) {
    guard let surface = surfaceGroupModel.surfaces[surfaceID] else {
      let error = ClientServerError.generic(
        GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: surfaceID,
          message: "Surface not found: \(surfaceID)"
        )
      )
      actionHandler?.handle(error: error, from: surfaceID)
      return
    }

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
        var props: [String: JSONValue] = [:]
        for (key, val) in componentDict where key != "id" && key != "component" {
          props[key] = val
        }

        let existing = surface.componentsModel.get(id)
        if let existing, existing.type != type {
          surface.componentsModel.removeComponent(id)
        }
        surface.componentsModel.addComponent(
          ComponentModel(id: id, type: type, properties: props)
        )
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
  }

  private func updateDataModel(
    surfaceID: String,
    path: String,
    value: JSONValue?
  ) {
    guard let surface = surfaceGroupModel.surfaces[surfaceID] else {
      let error = ClientServerError.generic(
        GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: surfaceID,
          message: "Surface not found: \(surfaceID)"
        )
      )
      actionHandler?.handle(error: error, from: surfaceID)
      return
    }
    surface.dataModel.set(path, value: value)
  }

  // MARK: - Private Validation & Processing

  private func validateAndProcess(_ message: ServerToClientMessage) throws {
    switch message {
    case .createSurface(let msg):
      guard surfaceGroupModel.surfaces[msg.surfaceID] == nil else {
        let error = GenericError(
          code: "SURFACE_EXISTS",
          surfaceID: msg.surfaceID,
          message: "Surface \(msg.surfaceID) already exists."
        )
        throw error
      }
      guard let catalog = catalogs[msg.catalogID] else {
        let error = GenericError(
          code: "CATALOG_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Catalog not found: \(msg.catalogID)"
        )
        throw error
      }
      let vm = SurfaceViewModel(
        surfaceID: msg.surfaceID,
        catalog: catalog,
        theme: msg.theme,
        actionHandler: actionHandler,
        sendDataModel: msg.shouldSendDataModel
      )
      surfaceGroupModel.addSurface(vm)

    case .updateComponents(let msg):
      guard surfaceGroupModel.surfaces[msg.surfaceID] != nil else {
        let error = GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Surface not found: \(msg.surfaceID)"
        )
        throw error
      }
      updateComponents(surfaceID: msg.surfaceID, components: msg.components)

    case .updateDataModel(let msg):
      guard surfaceGroupModel.surfaces[msg.surfaceID] != nil else {
        let error = GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Surface not found: \(msg.surfaceID)"
        )
        throw error
      }
      updateDataModel(surfaceID: msg.surfaceID, path: msg.path, value: msg.value)

    case .deleteSurface(let msg):
      guard surfaceGroupModel.surfaces[msg.surfaceID] != nil else {
        let error = GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Surface not found: \(msg.surfaceID)"
        )
        throw error
      }
      surfaceGroupModel.removeSurface(id: msg.surfaceID)
    }
  }
}
