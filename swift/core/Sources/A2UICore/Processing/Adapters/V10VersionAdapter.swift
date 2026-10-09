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
            theme: nil,
            sendDataModel: msg.shouldSendDataModel,
            components: msg.components,
            dataModel: msg.dataModel,
            metadata: msg.metadata,
            version: msg.version
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
    case .callRendererFunction(let msg):
      return [
        .callRendererFunction(
          InternalCallRendererFunctionOp(
            surfaceID: msg.surfaceID,
            functionCallID: msg.functionCallID,
            call: msg.callFunction.call,
            version: msg.version,
            catalogID: msg.callFunction.catalogID,
            args: msg.callFunction.args,
            returnType: msg.callFunction.returnType
          )
        )
      ]
    case .agentFunctionResponse(let msg):
      return [
        .agentFunctionResponse(
          InternalAgentFunctionResponseOp(
            functionCallID: msg.functionCallID,
            version: msg.version,
            value: msg.value,
            error: msg.error
          )
        )
      ]
    }
  }

  public override func extractOperationsFromObject(
    _ message: OrderedDictionary<String, JSONValue>,
    action: String,
    actionObject: OrderedDictionary<String, JSONValue>
  ) throws -> [InternalOperation] {
    switch action {
    case "createSurface":
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
      let sendDataModel = actionObject["sendDataModel"]?.boolValue ?? false
      let components = try parseComponentsArray(actionObject["components"], action: action)
      let dataModel: [String: JSONValue]? = actionObject["dataModel"]?.objectValue.map {
        Dictionary(uniqueKeysWithValues: $0.map { ($0.key, $0.value) })
      }
      let metadata: [String: JSONValue]? = actionObject["metadata"]?.objectValue.map {
        Dictionary(uniqueKeysWithValues: $0.map { ($0.key, $0.value) })
      }
      // Per blueprint rule 6, v1.0 removed `theme` and must NOT extract it.
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
      let surfaceID = try requireSurfaceID(in: actionObject, action: action)
      return [
        .deleteSurface(
          InternalDeleteSurfaceOp(surfaceID: surfaceID)
        )
      ]

    case "callRendererFunction":
      var surfaceID: String?
      if let rawSurfaceID = actionObject["surfaceId"], rawSurfaceID != .null {
        guard let str = rawSurfaceID.stringValue, !str.isEmpty else {
          throw A2UIValidationError(
            "Invalid v1.0 message: callRendererFunction.surfaceId must be a non-empty string",
            details: [
              A2UIErrorDetail(
                path: "messages.0.callRendererFunction.surfaceId",
                code: rawSurfaceID.stringValue == nil ? "type_mismatch" : "invalid_value",
                message: "Field 'surfaceId' must be a non-empty string"
              )
            ]
          )
        }
        surfaceID = str
      }
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
      guard let catalogID = callFunctionObj["catalogId"]?.stringValue, !catalogID.isEmpty else {
        throw A2UIValidationError(
          "Invalid v1.0 message: callRendererFunction.callFunction.catalogId is required",
          details: [
            A2UIErrorDetail(
              path: "messages.0.callRendererFunction.callFunction.catalogId",
              code: callFunctionObj["catalogId"] == nil ? "missing_field" : "type_mismatch",
              message: "Field 'catalogId' is required"
            )
          ]
        )
      }
      let args: [String: JSONValue]? = callFunctionObj["args"]?.objectValue.map {
        Dictionary(uniqueKeysWithValues: $0.map { ($0.key, $0.value) })
      }
      let returnType = callFunctionObj["returnType"]?.stringValue
      return [
        .callRendererFunction(
          InternalCallRendererFunctionOp(
            surfaceID: surfaceID,
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
}
