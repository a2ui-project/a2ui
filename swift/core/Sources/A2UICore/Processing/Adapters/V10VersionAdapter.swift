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

/// Protocol version adapter for A2UI specification v1.0.
///
/// Supports `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`,
/// `callRendererFunction`, and `agentFunctionResponse`. Per the v1.0 specification and
/// core blueprint rule 6, `theme` is not extracted on `createSurface`.
public final class V10VersionAdapter: BaseVersionAdapter, @unchecked Sendable {
  private static let supportedActions: Set<String> = Set(InternalOperation.allOperationTypes)
  private static let supportedCatalogVersions: Set<String> = ["1.0"]

  public init() {
    super.init(version: .v10)
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
    switch action {
    case "createSurface":
      try validateAllowedKeys(
        in: actionObject,
        action: action,
        allowed: ["surfaceId", "catalogId", "sendDataModel", "components", "dataModel", "metadata"]
      )
      let surfaceID = try requireSurfaceID(in: actionObject, action: action)
      var catalogID: String?
      if let rawCatalogID = actionObject["catalogId"], rawCatalogID != .null {
        guard let str = rawCatalogID.stringValue, !str.isEmpty else {
          throw A2UIValidationError(
            "Invalid v1.0 message: createSurface.catalogId must be a non-empty string",
            details: [
              A2UIErrorDetail(
                path: "messages.0.createSurface.catalogId",
                code: rawCatalogID.stringValue == nil ? "type_mismatch" : "invalid_value",
                message: "Field 'catalogId' must be a string"
              )
            ]
          )
        }
        catalogID = str
      }
      let sendDataModel: Bool
      if let rawSend = actionObject["sendDataModel"], rawSend != .null {
        guard let boolVal = rawSend.boolValue else {
          throw A2UIValidationError(
            "Invalid v1.0 message: createSurface.sendDataModel must be a boolean",
            details: [
              A2UIErrorDetail(
                path: "messages.0.createSurface.sendDataModel",
                code: "type_mismatch",
                message: "Field 'sendDataModel' must be a boolean"
              )
            ]
          )
        }
        sendDataModel = boolVal
      } else {
        sendDataModel = false
      }
      let components = try parseV10ComponentsArray(actionObject["components"], action: action)
      let dataModel: [String: JSONValue]?
      if let rawDataModel = actionObject["dataModel"], rawDataModel != .null {
        guard let dmObj = rawDataModel.objectValue else {
          throw A2UIValidationError(
            "Invalid v1.0 message: createSurface.dataModel must be an object",
            details: [
              A2UIErrorDetail(
                path: "messages.0.createSurface.dataModel",
                code: "type_mismatch",
                message: "Field 'dataModel' must be an object"
              )
            ]
          )
        }
        dataModel = Dictionary(uniqueKeysWithValues: dmObj.map { ($0.key, $0.value) })
      } else {
        dataModel = nil
      }
      let metadata: [String: JSONValue]?
      if let rawMetadata = actionObject["metadata"], rawMetadata != .null {
        metadata = try validateMetadata(
          rawMetadata,
          pathPrefix: "messages.0.createSurface.metadata"
        )
      } else {
        metadata = nil
      }
      return [
        .createSurface(
          InternalCreateSurfaceOp(
            surfaceID: surfaceID,
            catalogID: catalogID,
            theme: nil,
            sendDataModel: sendDataModel,
            components: components,
            dataModel: dataModel,
            metadata: metadata,
            version: .v10
          )
        )
      ]

    case "updateComponents":
      try validateAllowedKeys(
        in: actionObject,
        action: action,
        allowed: ["surfaceId", "components"]
      )
      let surfaceID = try requireSurfaceID(in: actionObject, action: action)
      guard let componentsValue = actionObject["components"] else {
        throw A2UIValidationError(
          "Invalid v1.0 message: updateComponents.components is required",
          details: [
            A2UIErrorDetail(
              path: "messages.0.updateComponents.components",
              code: "missing_field",
              message: "Missing required property 'components'"
            )
          ]
        )
      }
      let components = try parseV10ComponentsArray(componentsValue, action: action) ?? []
      return [
        .updateComponents(
          InternalUpdateComponentsOp(
            surfaceID: surfaceID,
            components: components
          )
        )
      ]

    case "updateDataModel":
      try validateAllowedKeys(
        in: actionObject,
        action: action,
        allowed: ["surfaceId", "path", "value"]
      )
      let surfaceID = try requireSurfaceID(in: actionObject, action: action)
      let path: String
      if let rawPath = actionObject["path"], rawPath != .null {
        guard let pathStr = rawPath.stringValue else {
          throw A2UIValidationError(
            "Invalid v1.0 message: updateDataModel.path must be a string",
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
            "Invalid v1.0 message: updateDataModel.path must start with '/'",
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
      guard let value = actionObject["value"] else {
        throw A2UIValidationError(
          "Invalid v1.0 message: updateDataModel.value is required",
          details: [
            A2UIErrorDetail(
              path: "messages.0.updateDataModel.value",
              code: "missing_field",
              message: "Missing required property 'value'"
            )
          ]
        )
      }
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
      try validateAllowedKeys(
        in: actionObject,
        action: action,
        allowed: ["surfaceId"]
      )
      let surfaceID = try requireSurfaceID(in: actionObject, action: action)
      return [
        .deleteSurface(
          InternalDeleteSurfaceOp(surfaceID: surfaceID)
        )
      ]

    case "callRendererFunction":
      try validateAllowedKeys(
        in: actionObject,
        action: action,
        allowed: ["functionCallId", "callFunction"]
      )
      guard let functionCallID = actionObject["functionCallId"]?.stringValue,
        !functionCallID.isEmpty
      else {
        throw A2UIValidationError(
          "Invalid v1.0 message: callRendererFunction.functionCallId is required",
          details: [
            A2UIErrorDetail(
              path: "messages.0.callRendererFunction.functionCallId",
              code: actionObject["functionCallId"] == nil ? "missing_field" : "type_mismatch",
              message: "Field 'functionCallId' is required"
            )
          ]
        )
      }
      guard let callFunctionObj = actionObject["callFunction"]?.objectValue,
        let call = (callFunctionObj["@call"] ?? callFunctionObj["call"])?.stringValue,
        !call.isEmpty
      else {
        throw A2UIValidationError(
          "Invalid v1.0 message: callRendererFunction.callFunction.call is required",
          details: [
            A2UIErrorDetail(
              path: "messages.0.callRendererFunction.callFunction.call",
              code: "missing_field",
              message: "Field 'call' is required"
            )
          ]
        )
      }
      var catalogID: String?
      if let rawCatalogID = callFunctionObj["catalogId"], rawCatalogID != .null {
        guard let str = rawCatalogID.stringValue, !str.isEmpty else {
          throw A2UIValidationError(
            "Invalid v1.0 message: callRendererFunction.callFunction.catalogId must be a string",
            details: [
              A2UIErrorDetail(
                path: "messages.0.callRendererFunction.callFunction.catalogId",
                code: rawCatalogID.stringValue == nil ? "type_mismatch" : "invalid_value",
                message: "Field 'catalogId' must be a non-empty string"
              )
            ]
          )
        }
        catalogID = str
      }
      let args: [String: JSONValue]? = callFunctionObj["args"]?.objectValue.map {
        Dictionary(uniqueKeysWithValues: $0.map { ($0.key, $0.value) })
      }
      let returnType = callFunctionObj["returnType"]?.stringValue
      return [
        .callRendererFunction(
          InternalCallRendererFunctionOp(
            functionCallID: functionCallID,
            call: call,
            version: .v10,
            catalogID: catalogID,
            args: args,
            returnType: returnType
          )
        )
      ]

    case "agentFunctionResponse":
      try validateAllowedKeys(
        in: actionObject,
        action: action,
        allowed: ["functionCallId", "value", "error"]
      )
      guard let functionCallID = actionObject["functionCallId"]?.stringValue,
        !functionCallID.isEmpty
      else {
        throw A2UIValidationError(
          "Invalid v1.0 message: agentFunctionResponse.functionCallId is required",
          details: [
            A2UIErrorDetail(
              path: "messages.0.agentFunctionResponse.functionCallId",
              code: actionObject["functionCallId"] == nil ? "missing_field" : "type_mismatch",
              message: "Field 'functionCallId' is required"
            )
          ]
        )
      }
      let hasValue = actionObject["value"] != nil
      let hasError = actionObject["error"] != nil
      if !hasValue && !hasError {
        throw A2UIValidationError(
          "Invalid v1.0 message: agentFunctionResponse must contain either 'value' or 'error'",
          details: [
            A2UIErrorDetail(
              path: "messages.0.agentFunctionResponse",
              code: "missing_field",
              message: "FunctionResponse must contain either 'value' or 'error'"
            )
          ]
        )
      }
      if hasValue && hasError {
        throw A2UIValidationError(
          "Invalid v1.0 message: agentFunctionResponse cannot contain both 'value' and 'error'",
          details: [
            A2UIErrorDetail(
              path: "messages.0.agentFunctionResponse",
              code: "invalid_value",
              message: "FunctionResponse cannot contain both 'value' and 'error'"
            )
          ]
        )
      }
      let value = actionObject["value"]
      var errorPayload: FunctionErrorPayload?
      if let rawError = actionObject["error"] {
        guard let errObj = rawError.objectValue,
          errObj.keys.allSatisfy({ $0 == "code" || $0 == "message" }),
          let code = errObj["code"]?.stringValue,
          let errMessage = errObj["message"]?.stringValue
        else {
          throw A2UIValidationError(
            "Invalid v1.0 message: agentFunctionResponse.error must be an object with 'code' and 'message'",
            details: [
              A2UIErrorDetail(
                path: "messages.0.agentFunctionResponse.error",
                code: rawError.objectValue == nil ? "type_mismatch" : "missing_field",
                message: "Field 'error' must be an object with 'code' and 'message'"
              )
            ]
          )
        }
        errorPayload = FunctionErrorPayload(code: code, message: errMessage)
      }
      return [
        .agentFunctionResponse(
          InternalAgentFunctionResponseOp(
            functionCallID: functionCallID,
            version: .v10,
            value: value,
            error: errorPayload
          )
        )
      ]

    default:
      return []
    }
  }

  private func parseV10ComponentsArray(
    _ value: JSONValue?,
    action: String
  ) throws -> [[String: JSONValue]]? {
    guard let components = try parseComponentsArray(value, action: action) else {
      return nil
    }
    guard !components.isEmpty else {
      throw A2UIValidationError(
        "Invalid v1.0 message: \(action).components must contain at least 1 item",
        details: [
          A2UIErrorDetail(
            path: "messages.0.\(action).components",
            code: "invalid_value",
            message: "Components array must contain at least 1 item"
          )
        ]
      )
    }
    for (index, comp) in components.enumerated() {
      if comp["component"]?.stringValue == "Surface" {
        let msg =
          "Component type cannot be \"Surface\". \"Surface\" is a top-level protocol "
          + "container defined in createSurface, not a child component."
        throw A2UIValidationError(
          msg,
          details: [
            A2UIErrorDetail(
              path: "messages.0.\(action).components.\(index).component",
              code: "invalid_value",
              message: msg
            )
          ]
        )
      }
      if let rawMetadata = comp["metadata"], rawMetadata != .null {
        _ = try validateMetadata(
          rawMetadata,
          pathPrefix: "messages.0.\(action).components.\(index).metadata"
        )
      }
    }
    return components
  }

  private func validateMetadata(
    _ rawMetadata: JSONValue,
    pathPrefix: String
  ) throws -> [String: JSONValue] {
    guard let metaObj = rawMetadata.objectValue else {
      throw A2UIValidationError(
        "Invalid v1.0 message: metadata must be an object",
        details: [
          A2UIErrorDetail(
            path: pathPrefix,
            code: "type_mismatch",
            message: "Field 'metadata' must be an object"
          )
        ]
      )
    }
    for key in metaObj.keys where key != "extensions" {
      throw A2UIValidationError(
        "Invalid v1.0 message: unrecognized property '\(key)' in metadata",
        details: [
          A2UIErrorDetail(
            path: "\(pathPrefix).\(key)",
            code: "invalid_value",
            message: "Unrecognized property '\(key)' in metadata"
          )
        ]
      )
    }
    if let rawExtensions = metaObj["extensions"], rawExtensions != .null {
      guard let extObj = rawExtensions.objectValue else {
        throw A2UIValidationError(
          "Invalid v1.0 message: metadata.extensions must be an object",
          details: [
            A2UIErrorDetail(
              path: "\(pathPrefix).extensions",
              code: "type_mismatch",
              message: "Field 'extensions' must be an object"
            )
          ]
        )
      }
      for extKey in extObj.keys where !UnicodeIdentifierValidator.isValidIdentifier(extKey) {
        let msg = "Invalid extension key \"\(extKey)\": Keys MUST be Unicode identifiers (UAX #31)."
        throw A2UIValidationError(
          msg,
          details: [
            A2UIErrorDetail(
              path: "\(pathPrefix).extensions.\(extKey)",
              code: "invalid_identifier",
              message: msg
            )
          ]
        )
      }
    }
    return Dictionary(uniqueKeysWithValues: metaObj.map { ($0.key, $0.value) })
  }
}
