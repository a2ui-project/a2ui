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

import OrderedCollections
import OrderedJSON

/// Protocol version adapter for A2UI specification v0.9 and v0.9.1.
public final class V09VersionAdapter: BaseVersionAdapter, @unchecked Sendable {
  private static let supportedActions: Set<String> = [
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
  ]

  private static let supportedCatalogVersions: Set<String> = [
    "0.9",
    "0.9.1",
  ]

  public override init(version: A2UIProtocolVersion = .v09) {
    super.init(version: version)
  }

  public override var validActions: Set<String> {
    Self.supportedActions
  }

  public override var compatibleCatalogVersions: Set<String> {
    Self.supportedCatalogVersions
  }

  public override func adaptMessage(
    _ message: AgentToRendererMessage
  ) throws -> [InternalOperation] {
    switch message {
    case .createSurface(let msg):
      return [
        .createSurface(
          InternalCreateSurfaceOp(
            surfaceID: msg.surfaceID,
            catalogID: msg.catalogID,
            theme: msg.theme,
            sendDataModel: msg.shouldSendDataModel,
            components: msg.components,
            dataModel: msg.dataModel,
            version: version
          )
        )
      ]
    case .updateComponents(let msg):
      return [
        .updateComponents(
          InternalUpdateComponentsOp(
            surfaceID: msg.surfaceID,
            components: msg.components
          )
        )
      ]
    case .updateDataModel(let msg):
      return [
        .updateDataModel(
          InternalUpdateDataModelOp(
            surfaceID: msg.surfaceID,
            path: msg.path,
            value: msg.value
          )
        )
      ]
    case .deleteSurface(let msg):
      return [
        .deleteSurface(
          InternalDeleteSurfaceOp(surfaceID: msg.surfaceID)
        )
      ]
    case .callRendererFunction:
      let sortedAllowed = validActions.sorted().joined(separator: ", ")
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: action 'callRendererFunction' is not supported "
          + "in protocol version \(version.rawValue). Allowed actions: \(sortedAllowed)."
      )
    case .agentFunctionResponse:
      let sortedAllowed = validActions.sorted().joined(separator: ", ")
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: action 'agentFunctionResponse' is not supported "
          + "in protocol version \(version.rawValue). Allowed actions: \(sortedAllowed)."
      )
    }
  }

  public override func extractOperationsFromObject(
    _ message: OrderedDictionary<String, JSONValue>,
    action: String,
    actionObject: OrderedDictionary<String, JSONValue>
  ) throws -> [InternalOperation] {
    let envelopeVersion =
      message["version"]?.stringValue.flatMap(A2UIProtocolVersion.init(rawValue:)) ?? version

    switch action {
    case "createSurface":
      let surfaceID = try requireSurfaceID(in: actionObject, action: action)
      let catalogID = actionObject["catalogId"]?.stringValue
      let theme: [String: JSONValue]? = actionObject["theme"]?.objectValue.map {
        Dictionary(uniqueKeysWithValues: $0.map { ($0.key, $0.value) })
      }
      let sendDataModel = actionObject["sendDataModel"]?.boolValue ?? false
      let components = try parseComponentsArray(actionObject["components"], action: action)
      let dataModel: [String: JSONValue]? = actionObject["dataModel"]?.objectValue.map {
        Dictionary(uniqueKeysWithValues: $0.map { ($0.key, $0.value) })
      }
      return [
        .createSurface(
          InternalCreateSurfaceOp(
            surfaceID: surfaceID,
            catalogID: catalogID,
            theme: theme,
            sendDataModel: sendDataModel,
            components: components,
            dataModel: dataModel,
            version: envelopeVersion
          )
        )
      ]

    case "updateComponents":
      let surfaceID = try requireSurfaceID(in: actionObject, action: action)
      let components = try parseComponentsArray(actionObject["components"], action: action) ?? []
      return [
        .updateComponents(
          InternalUpdateComponentsOp(
            surfaceID: surfaceID,
            components: components
          )
        )
      ]

    case "updateDataModel":
      let surfaceID = try requireSurfaceID(in: actionObject, action: action)
      let path = actionObject["path"]?.stringValue ?? "/"
      let value = actionObject["value"]
      return [
        .updateDataModel(
          InternalUpdateDataModelOp(
            surfaceID: surfaceID,
            path: path,
            value: value
          )
        )
      ]

    case "deleteSurface":
      let surfaceID = try requireSurfaceID(in: actionObject, action: action)
      return [
        .deleteSurface(
          InternalDeleteSurfaceOp(surfaceID: surfaceID)
        )
      ]

    default:
      return []
    }
  }
}
