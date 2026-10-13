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

import A2UICore
import A2UIJSON
import Foundation
import JSONSchema
import OrderedJSON
import Testing

struct VersionAdapterTests {

  // MARK: - Payload Unwrapping

  @Test func v09AdapterUnwrapsSingleArrayAndMessagesWrapper() throws {
    let adapter = V09VersionAdapter(version: .v091)

    let singlePayload: JSONValue = try .parse(
      """
      {
        "version": "v0.9.1",
        "createSurface": {
          "surfaceId": "s1",
          "catalogId": "basic"
        }
      }
      """
    )
    let singleOps = try adapter.extractOperations(from: singlePayload)
    #expect(singleOps.count == 1)
    #expect(singleOps[0].type == "createSurface")
    #expect(singleOps[0].surfaceID == "s1")

    let arrayPayload: JSONValue = try .parse(
      """
      [
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "basic"
          }
        },
        {
          "version": "v0.9.1",
          "deleteSurface": {
            "surfaceId": "s1"
          }
        }
      ]
      """
    )
    let arrayOps = try adapter.extractOperations(from: arrayPayload)
    #expect(arrayOps.count == 2)
    #expect(arrayOps[0].type == "createSurface")
    #expect(arrayOps[1].type == "deleteSurface")

    let wrapperPayload: JSONValue = try .parse(
      """
      {
        "messages": [
          {
            "version": "v0.9",
            "updateDataModel": {
              "surfaceId": "s1",
              "path": "/user",
              "value": "Alice"
            }
          }
        ]
      }
      """
    )
    let wrapperOps = try adapter.extractOperations(from: wrapperPayload)
    #expect(wrapperOps.count == 1)
    #expect(wrapperOps[0].type == "updateDataModel")

    #expect(try adapter.extractOperations(from: .null).isEmpty)
    #expect(try adapter.extractOperations(from: .array([])).isEmpty)
  }

  // MARK: - Theme Extraction vs Omission (Blueprint Rule 6)

  @Test func v09ExtractsThemeWhereasV10OmitsThemeOnCreateSurface() throws {
    let v09Adapter = V09VersionAdapter(version: .v091)
    let v10Adapter = V10VersionAdapter()

    let v09Payload: JSONValue = try .parse(
      """
      {
        "version": "v0.9.1",
        "createSurface": {
          "surfaceId": "s1",
          "catalogId": "basic",
          "theme": {
            "primaryColor": "#FF0000"
          },
          "sendDataModel": true
        }
      }
      """
    )
    let v09Ops = try v09Adapter.extractOperations(from: v09Payload)
    let v09Op = try #require(v09Ops.first)
    if case .createSurface(let createOp) = v09Op {
      #expect(createOp.surfaceId == "s1")
      #expect(createOp.catalogId == "basic")
      #expect(createOp.theme?["primaryColor"] == .string("#FF0000"))
      #expect(createOp.sendDataModel == true)
    } else {
      Issue.record("Expected .createSurface operation")
    }

    let v10WithThemePayload: JSONValue = try .parse(
      """
      {
        "version": "v1.0",
        "createSurface": {
          "surfaceId": "s2",
          "catalogId": "basic",
          "theme": {
            "primaryColor": "#FF0000"
          }
        }
      }
      """
    )
    #expect(throws: A2UIValidationError.self) {
      _ = try v10Adapter.extractOperations(from: v10WithThemePayload)
    }

    let v10Payload: JSONValue = try .parse(
      """
      {
        "version": "v1.0",
        "createSurface": {
          "surfaceId": "s2",
          "catalogId": "basic",
          "sendDataModel": true,
          "components": [
            { "id": "root", "component": "Text", "text": "Hi" }
          ],
          "dataModel": {
            "count": 42
          }
        }
      }
      """
    )
    let v10Ops = try v10Adapter.extractOperations(from: v10Payload)
    let v10Op = try #require(v10Ops.first)
    if case .createSurface(let createOp) = v10Op {
      #expect(createOp.surfaceId == "s2")
      #expect(createOp.catalogId == "basic")
      #expect(createOp.theme == nil)
      #expect(createOp.sendDataModel == true)
      #expect(createOp.components?.count == 1)
      #expect(createOp.dataModel?["count"] == .integer(42))
    } else {
      Issue.record("Expected .createSurface operation")
    }
  }

  // MARK: - Action Validation & Cross-Version Action Errors

  @Test func crossVersionActionRejectedWithSpecificErrorMessage() throws {
    let v09Adapter = V09VersionAdapter(version: .v09)
    let rpcPayloadInV09: JSONValue = try .parse(
      """
      {
        "version": "v0.9",
        "callRendererFunction": {
          "functionCallId": "fc1",
          "callFunction": {
            "call": "openUrl",
            "catalogId": "basic"
          }
        }
      }
      """
    )

    do {
      _ = try v09Adapter.extractOperations(from: rpcPayloadInV09)
      Issue.record("Expected v0.9 adapter to reject callRendererFunction")
    } catch let error as A2UIValidationError {
      #expect(error.message.contains("action 'callRendererFunction' is not supported"))
      #expect(error.message.contains("protocol version v0.9"))
    }

    let conflictingPayload: JSONValue = try .parse(
      """
      {
        "version": "v1.0",
        "createSurface": { "surfaceId": "s1" },
        "deleteSurface": { "surfaceId": "s1" }
      }
      """
    )
    #expect(throws: A2UIValidationError.self) {
      try V10VersionAdapter().extractOperations(from: conflictingPayload)
    }
  }

  // MARK: - V10 RPC Operations

  @Test func v10AdapterExtractsRPCOperations() throws {
    let v10Adapter = V10VersionAdapter()
    let payload: JSONValue = try .parse(
      """
      [
        {
          "version": "v1.0",
          "callRendererFunction": {
            "functionCallId": "call-1",
            "callFunction": {
              "call": "formatString",
              "catalogId": "basic",
              "args": { "value": "hello" }
            }
          }
        },
        {
          "version": "v1.0",
          "agentFunctionResponse": {
            "functionCallId": "call-2",
            "value": { "ok": true }
          }
        }
      ]
      """
    )

    let ops = try v10Adapter.extractOperations(from: payload)
    #expect(ops.count == 2)

    if case .callRendererFunction(let callOp) = ops[0] {
      #expect(callOp.functionCallId == "call-1")
      #expect(callOp.call == "formatString")
      #expect(callOp.catalogId == "basic")
      #expect(callOp.args?["value"] == .string("hello"))
      #expect(callOp.version == .v10)
    } else {
      Issue.record("Expected .callRendererFunction")
    }

    if case .agentFunctionResponse(let respOp) = ops[1] {
      #expect(respOp.functionCallId == "call-2")
      #expect(respOp.value?["ok"] == .boolean(true))
    } else {
      Issue.record("Expected .agentFunctionResponse")
    }
  }

  // MARK: - VersionAdapterFactory & Catalog Version Compatibility

  @Test func versionAdapterFactoryResolvesAdaptersAndChecksCatalogCompatibility() throws {
    let factory = VersionAdapterFactory()
    let v09Adapter = try factory.getAdapter(for: "v0.9")
    #expect(v09Adapter.version == .v09)

    let v091Adapter = try factory.getAdapter(for: "0.9.1")
    #expect(v091Adapter.version == .v091)

    let v10Adapter = try factory.getAdapter(for: "v1.0")
    #expect(v10Adapter.version == .v10)

    #expect(throws: A2UIValidationError.self) {
      _ = try factory.getAdapter(for: "v2.0")
    }

    let payload: JSONValue = try .parse(
      """
      {
        "version": "v1.0",
        "deleteSurface": { "surfaceId": "s1" }
      }
      """
    )
    let resolved = try factory.resolveFromPayload(payload)
    #expect(resolved.version == .v10)

    // Catalog compatibility rules (Blueprint Rule 5):
    // Unversioned catalog is accepted for v0.9 / v0.9.1 and rejected for v1.0.
    #expect(isCatalogVersionCompatible(catalogVersion: nil, expectedVersion: "v0.9") == true)
    #expect(isCatalogVersionCompatible(catalogVersion: nil, expectedVersion: "v0.9.1") == true)
    #expect(isCatalogVersionCompatible(catalogVersion: nil, expectedVersion: "v1.0") == false)
    #expect(v09Adapter.isCatalogCompatible(nil) == true)
    #expect(v10Adapter.isCatalogCompatible(nil) == false)

    // Matching and cross-minor compatibility
    #expect(isCatalogVersionCompatible(catalogVersion: "v0.9", expectedVersion: "v0.9.1") == true)
    #expect(isCatalogVersionCompatible(catalogVersion: "0.9.1", expectedVersion: "v0.9") == true)
    #expect(isCatalogVersionCompatible(catalogVersion: "v1.0", expectedVersion: "1.0.0") == true)
    #expect(isCatalogVersionCompatible(catalogVersion: "v1.1", expectedVersion: "v1.0") == true)
    #expect(isCatalogVersionCompatible(catalogVersion: "v0.9.1", expectedVersion: "v1.0") == false)
    #expect(isCatalogVersionCompatible(catalogVersion: "v1.0", expectedVersion: "v0.9.1") == false)
  }

  // MARK: - Versioned Schemas in A2UIJSON

  @Test func versionedV09AndV10SchemasArePopulated() {
    #expect(V09CommonTypesSchema.document.object != nil)
    #expect(V09ServerToClientSchema.document.object != nil)
    #expect(V09ClientToServerSchema.document.object != nil)
    #expect(V09ClientCapabilitiesSchema.document.object != nil)

    #expect(V10CommonTypesSchema.document.object != nil)
    #expect(V10CatalogDefinitionSchema.document.object != nil)
    #expect(V10AgentToRendererSchema.document.object != nil)
    #expect(V10RendererToAgentSchema.document.object != nil)
    #expect(V10RendererCapabilitiesSchema.document.object != nil)
  }

  // MARK: - MessageProcessor Payload Entry Point

  @MainActor
  @Test func messageProcessorProcessesRawPayloadThroughVersionAdapter() throws {
    let textSchema = try Schema(instance: "{\"type\": \"object\"}")
    let catalog = Catalog(
      id: "basic",
      protocolVersion: "v1.0",
      components: [AnyComponentAPI(name: "Text", schema: textSchema)]
    )
    let processor = MessageProcessor(catalogs: [catalog])

    let payload: JSONValue = try .parse(
      """
      [
        {
          "version": "v1.0",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "basic",
            "dataModel": { "greeting": "Hello" },
            "components": [
              { "id": "root", "component": "Text", "text": "Hello" }
            ]
          }
        }
      ]
      """
    )

    processor.process(payload: payload)
    let surface = try #require(processor.surfaceGroupModel["s1"])
    #expect(surface.dataModel.get("/greeting") == .string("Hello"))
    #expect(surface.componentsModel.get("root")?.type == "Text")
  }

  @Test func v10AdapterRejectsEmptyComponentsArray() throws {
    let adapter = V10VersionAdapter()
    let emptyCreateComponents: JSONValue = try .parse(
      """
      {
        "version": "v1.0",
        "createSurface": {
          "surfaceId": "s1",
          "catalogId": "basic",
          "components": []
        }
      }
      """
    )
    #expect(throws: A2UIValidationError.self) {
      _ = try adapter.extractOperations(from: emptyCreateComponents)
    }

    let emptyUpdateComponents: JSONValue = try .parse(
      """
      {
        "version": "v1.0",
        "updateComponents": {
          "surfaceId": "s1",
          "components": []
        }
      }
      """
    )
    #expect(throws: A2UIValidationError.self) {
      _ = try adapter.extractOperations(from: emptyUpdateComponents)
    }
  }
}
