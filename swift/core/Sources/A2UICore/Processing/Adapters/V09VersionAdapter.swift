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
      guard let rawCatalogID = actionObject["catalogId"] else {
        throw A2UIValidationError(
          "Invalid \(version.rawValue) message: createSurface.catalogId is required",
          details: [
            A2UIErrorDetail(
              path: "messages.0.createSurface.catalogId",
              code: "missing_field",
              message: "Field 'catalogId' is required"
            )
          ]
        )
      }
      guard let catalogID = rawCatalogID.stringValue, !catalogID.isEmpty else {
        throw A2UIValidationError(
          "Invalid \(version.rawValue) message: createSurface.catalogId must be a non-empty string",
          details: [
            A2UIErrorDetail(
              path: "messages.0.createSurface.catalogId",
              code: rawCatalogID.stringValue == nil ? "type_mismatch" : "invalid_value",
              message: "Field 'catalogId' must be a string"
            )
          ]
        )
      }
      let theme: [String: JSONValue]?
      if let rawTheme = actionObject["theme"], rawTheme != .null {
        guard let themeObj = rawTheme.objectValue else {
          throw A2UIValidationError(
            "Invalid \(version.rawValue) message: createSurface.theme must be an object",
            details: [
              A2UIErrorDetail(
                path: "messages.0.createSurface.theme",
                code: "type_mismatch",
                message: "Field 'theme' must be an object"
              )
            ]
          )
        }
        theme = Dictionary(uniqueKeysWithValues: themeObj.map { ($0.key, $0.value) })
      } else {
        theme = nil
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
      guard let componentsValue = actionObject["components"] else {
        throw A2UIValidationError(
          "Invalid \(version.rawValue) message: updateComponents.components is required",
          details: [
            A2UIErrorDetail(
              path: "messages.0.updateComponents.components",
              code: "missing_field",
              message: "Missing required property 'components'"
            )
          ]
        )
      }
      let components = try parseComponentsArray(componentsValue, action: action) ?? []
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
      let path: String
      if let rawPath = actionObject["path"], rawPath != .null {
        guard let pathStr = rawPath.stringValue else {
          throw A2UIValidationError(
            "Invalid \(version.rawValue) message: updateDataModel.path must be a string",
            details: [
              A2UIErrorDetail(
                path: "messages.0.updateDataModel.path",
                code: "type_mismatch",
                message: "Field 'path' must be a string"
              )
            ]
          )
        }
        if !pathStr.isEmpty && !pathStr.hasPrefix("/") {
          throw A2UIValidationError(
            "Invalid \(version.rawValue) message: updateDataModel.path must start with '/'",
            details: [
              A2UIErrorDetail(
                path: "messages.0.updateDataModel.path",
                code: "invalid_value",
                message: "Field 'path' must be a valid JSON Pointer starting with '/'"
              )
            ]
          )
        }
        path = pathStr.isEmpty ? "/" : pathStr
      } else {
        path = "/"
      }
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
