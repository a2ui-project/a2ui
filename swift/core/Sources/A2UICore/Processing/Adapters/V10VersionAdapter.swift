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
      return try extractCreateSurfaceOp(actionObject, action: action)
    case "updateComponents":
      return try extractUpdateComponentsOp(actionObject, action: action)
    case "updateDataModel":
      return try extractUpdateDataModelOp(actionObject, action: action)
    case "deleteSurface":
      return try extractDeleteSurfaceOp(actionObject, action: action)
    case "callRendererFunction":
      return try extractCallRendererFunctionOp(actionObject, action: action)
    case "agentFunctionResponse":
      return try extractAgentFunctionResponseOp(actionObject, action: action)
    default:
      return []
    }
  }

  private func extractCreateSurfaceOp(
    _ actionObject: OrderedDictionary<String, JSONValue>,
    action: String
  ) throws -> [InternalOperation] {
    try validateAllowedKeys(
      in: actionObject,
      action: action,
      allowed: ["surfaceId", "catalogId", "sendDataModel", "components", "dataModel", "metadata"]
    )
    let surfaceID = try requireSurfaceID(in: actionObject, action: action)
    let catalogID = try parseOptionalCatalogID(actionObject["catalogId"])
    let sendDataModel = try parseSendDataModel(actionObject["sendDataModel"])
    let components = try parseV10ComponentsArray(actionObject["components"], action: action)
    let dataModel = try parseCreateSurfaceDataModel(actionObject["dataModel"])
    let metadata: [String: JSONValue]? =
      if let rawMetadata = actionObject["metadata"], rawMetadata != .null {
        try validateMetadata(rawMetadata, pathPrefix: "messages.0.createSurface.metadata")
      } else {
        nil
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
  }

  private func parseOptionalCatalogID(_ rawCatalogID: JSONValue?) throws -> String? {
    guard let rawCatalogID, rawCatalogID != .null else { return nil }
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
    return str
  }

  private func parseSendDataModel(_ rawSend: JSONValue?) throws -> Bool {
    guard let rawSend, rawSend != .null else { return false }
    guard let booleanValue = rawSend.boolValue else {
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
    return booleanValue
  }

  private func parseCreateSurfaceDataModel(
    _ rawDataModel: JSONValue?
  ) throws -> [String: JSONValue]? {
    guard let rawDataModel, rawDataModel != .null else { return nil }
    guard let dataModel = rawDataModel.dictionaryValue else {
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
    return dataModel
  }

  private func extractUpdateComponentsOp(
    _ actionObject: OrderedDictionary<String, JSONValue>,
    action: String
  ) throws -> [InternalOperation] {
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
  }

  private func extractUpdateDataModelOp(
    _ actionObject: OrderedDictionary<String, JSONValue>,
    action: String
  ) throws -> [InternalOperation] {
    try validateAllowedKeys(
      in: actionObject,
      action: action,
      allowed: ["surfaceId", "path", "value"]
    )
    let surfaceID = try requireSurfaceID(in: actionObject, action: action)
    let path = try parseUpdateDataModelPath(actionObject["path"])
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
  }

  private func parseUpdateDataModelPath(_ rawPath: JSONValue?) throws -> String {
    guard let rawPath, rawPath != .null else { return "/" }
    guard let path = rawPath.stringValue else {
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
    guard path.isEmpty || path.hasPrefix("/") else {
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
    return path.isEmpty ? "/" : path
  }

  private func extractDeleteSurfaceOp(
    _ actionObject: OrderedDictionary<String, JSONValue>,
    action: String
  ) throws -> [InternalOperation] {
    try validateAllowedKeys(
      in: actionObject,
      action: action,
      allowed: ["surfaceId"]
    )
    let surfaceID = try requireSurfaceID(in: actionObject, action: action)
    return [.deleteSurface(InternalDeleteSurfaceOp(surfaceID: surfaceID))]
  }

  private func extractCallRendererFunctionOp(
    _ actionObject: OrderedDictionary<String, JSONValue>,
    action: String
  ) throws -> [InternalOperation] {
    try validateAllowedKeys(
      in: actionObject,
      action: action,
      allowed: ["surfaceId", "functionCallId", "callFunction"]
    )
    let surfaceID = try parseOptionalCallSurfaceID(actionObject["surfaceId"])
    let functionCallID = try requireFunctionCallID(
      actionObject["functionCallId"],
      action: "callRendererFunction"
    )
    let (call, catalogID, args) = try parseCallFunctionObject(
      actionObject["callFunction"]
    )
    return [
      .callRendererFunction(
        InternalCallRendererFunctionOp(
          surfaceID: surfaceID,
          functionCallID: functionCallID,
          call: call,
          version: .v10,
          catalogID: catalogID,
          args: args
        )
      )
    ]
  }

  private func parseOptionalCallSurfaceID(_ rawSurfaceID: JSONValue?) throws -> String? {
    guard let rawSurfaceID else { return nil }
    guard let str = rawSurfaceID.stringValue else {
      throw A2UIValidationError(
        "Invalid v1.0 message: callRendererFunction.surfaceId must be a string",
        details: [
          A2UIErrorDetail(
            path: "messages.0.callRendererFunction.surfaceId",
            code: "type_mismatch",
            message: "Field 'surfaceId' must be a string"
          )
        ]
      )
    }
    return str
  }

  private func requireFunctionCallID(
    _ rawFunctionCallID: JSONValue?,
    action: String
  ) throws -> String {
    guard let functionCallID = rawFunctionCallID?.stringValue, !functionCallID.isEmpty else {
      throw A2UIValidationError(
        "Invalid v1.0 message: \(action).functionCallId is required",
        details: [
          A2UIErrorDetail(
            path: "messages.0.\(action).functionCallId",
            code: rawFunctionCallID == nil ? "missing_field" : "type_mismatch",
            message: "Field 'functionCallId' is required"
          )
        ]
      )
    }
    return functionCallID
  }

  private func parseCallFunctionObject(
    _ rawCallFunction: JSONValue?
  ) throws -> (call: String, catalogID: String, args: [String: JSONValue]?) {
    guard let callFunctionObj = rawCallFunction?.objectValue,
      let call = (callFunctionObj["@call"] ?? callFunctionObj["call"])?.stringValue,
      !call.isEmpty
    else {
      let msg = "Invalid v1.0 message: callRendererFunction.callFunction.call is required"
      throw A2UIValidationError(
        msg,
        details: [
          A2UIErrorDetail(
            path: "messages.0.callRendererFunction.callFunction.call",
            code: "missing_field",
            message: msg
          )
        ]
      )
    }
    guard let rawCatalogID = callFunctionObj["catalogId"],
      let catalogID = rawCatalogID.stringValue,
      !catalogID.isEmpty
    else {
      let msg = "Invalid v1.0 message: callRendererFunction.callFunction.catalogId is required"
      let code =
        callFunctionObj["catalogId"] == nil
        ? "missing_field"
        : (callFunctionObj["catalogId"]?.stringValue == nil ? "type_mismatch" : "invalid_value")
      throw A2UIValidationError(
        msg,
        details: [
          A2UIErrorDetail(
            path: "messages.0.callRendererFunction.callFunction.catalogId",
            code: code,
            message: msg
          )
        ]
      )
    }
    var args: [String: JSONValue]?
    if let rawArgs = callFunctionObj["args"], rawArgs != .null {
      guard let argsDictionary = rawArgs.dictionaryValue else {
        let msg =
          "Invalid v1.0 message: callRendererFunction.callFunction.args must be an object"
        throw A2UIValidationError(
          msg,
          details: [
            A2UIErrorDetail(
              path: "messages.0.callRendererFunction.callFunction.args",
              code: "type_mismatch",
              message: msg
            )
          ]
        )
      }
      args = argsDictionary
    }
    return (call, catalogID, args)
  }

  private func extractAgentFunctionResponseOp(
    _ actionObject: OrderedDictionary<String, JSONValue>,
    action: String
  ) throws -> [InternalOperation] {
    try validateAllowedKeys(
      in: actionObject,
      action: action,
      allowed: ["functionCallId", "value", "error"]
    )
    let functionCallID = try requireFunctionCallID(
      actionObject["functionCallId"],
      action: "agentFunctionResponse"
    )
    let hasValue = actionObject["value"] != nil
    let hasError = actionObject["error"] != nil
    guard hasValue || hasError else {
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
    guard !(hasValue && hasError) else {
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
    let errorPayload = try parseAgentFunctionErrorPayload(actionObject["error"])
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
  }

  private func parseAgentFunctionErrorPayload(
    _ rawError: JSONValue?
  ) throws -> FunctionErrorPayload? {
    guard let rawError else { return nil }
    guard let errorObject = rawError.objectValue,
      errorObject.keys.allSatisfy({ $0 == "code" || $0 == "message" }),
      let code = errorObject["code"]?.stringValue,
      let errorMessage = errorObject["message"]?.stringValue
    else {
      let message =
        "Invalid v1.0 message: agentFunctionResponse.error must be an object "
        + "with 'code' and 'message'"
      throw A2UIValidationError(
        message,
        details: [
          A2UIErrorDetail(
            path: "messages.0.agentFunctionResponse.error",
            code: rawError.objectValue == nil ? "type_mismatch" : "missing_field",
            message: "Field 'error' must be an object with 'code' and 'message'"
          )
        ]
      )
    }
    return FunctionErrorPayload(code: code, message: errorMessage)
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
        "Invalid 1.0 message: \(action).components must contain at least 1 item",
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
        "Invalid 1.0 message: metadata must be an object",
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
        "Invalid 1.0 message: unrecognized property '\(key)' in metadata",
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
          "Invalid 1.0 message: metadata.extensions must be an object",
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
