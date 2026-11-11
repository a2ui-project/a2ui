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
import JSONSchema
import OrderedJSON
import Testing

/// Covers the v1.0 rule that an `agentOnly` function runs only through an agent-initiated
/// `callRendererFunction`, never from a binding, check or action.
@MainActor
struct AgentOnlyFunctionTests {

  /// A function that records each run at `/ran/<name>` in the data model.
  private struct RecordingFunction: FunctionImplementation {
    let api: FunctionAPI

    init(name: String, allowedCallers: AllowedCallers) {
      api = FunctionAPI(
        name: name,
        returnType: .any,
        schema: try! Schema(instance: "{\"type\": \"object\"}"),
        allowedCallers: allowedCallers
      )
    }

    func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
      context.set("/ran/\(api.name)", value: .boolean(true))
      return .boolean(true)
    }
  }

  private func makeCatalog(protocolVersion: A2UIProtocolVersion = .v10) throws -> AnyCatalog {
    let common = "https://a2ui.org/schemas/v0_9_1/common.json#/$defs"
    let buttonSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "label": { "$ref": "\(common)/DynamicString" },
            "checks": { "type": "array", "items": { "$ref": "\(common)/CheckRule" } },
            "onClick": { "$ref": "\(common)/Action" }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    return Catalog(
      id: "a",
      protocolVersion: protocolVersion,
      components: [AnyComponentAPI(name: "Button", schema: buttonSchema)],
      functions: [
        RecordingFunction(name: "agentOnly", allowedCallers: .agentOnly),
        RecordingFunction(name: "rendererOrAgent", allowedCallers: .rendererOrAgent),
      ]
    ).eraseToAnyCatalog()
  }

  /// Resolves a `Button` whose `property` calls `function`, triggering the action for `onClick`.
  private func render(
    _ function: String,
    in property: String,
    handler: TestProcessorActionHandler,
    protocolVersion: A2UIProtocolVersion = .v10
  ) throws -> NodeResolver {
    let resolver = NodeResolver(
      surfaceID: "s",
      catalogs: ["a": try makeCatalog(protocolVersion: protocolVersion)],
      defaultCatalogID: "a",
      actionHandler: handler,
      protocolVersion: protocolVersion
    )
    let callKey = protocolVersion.isAtLeastV10 ? "@call" : "call"
    let call: JSONValue = .object([callKey: .string(function)])
    let value: JSONValue =
      property == "checks"
      ? .array([.object(["condition": call, "message": .string("Blocked")])])
      : call
    resolver.componentsModel.addComponent(
      ComponentModel(id: "root", type: "Button", properties: [property: value])
    )
    let root = try #require(resolver.resolveTree())
    if property == "onClick" {
      let action = try #require(root.properties["onClick"] as? ResolvedAction)
      action()
    }
    return resolver
  }

  @Test(arguments: ["label", "checks", "onClick"])
  func rendererCallerDoesNotRunAgentOnlyFunction(property: String) throws {
    let handler = TestProcessorActionHandler()
    let resolver = try render("agentOnly", in: property, handler: handler)

    #expect(resolver.dataModel.get("/ran/agentOnly") == nil)
    #expect(handler.capturedErrors.count == 1)
    guard case .generic(let error) = handler.capturedErrors.first else {
      Issue.record("Expected a generic error, got \(handler.capturedErrors)")
      return
    }
    #expect(error.code == "EXPRESSION_ERROR")
    #expect(error.expression == "agentOnly")
    #expect(error.message.contains("cannot be called by renderer"))
  }

  @Test(arguments: ["label", "checks", "onClick"])
  func rendererCallerRunsRendererOrAgentFunction(property: String) throws {
    let handler = TestProcessorActionHandler()
    let resolver = try render("rendererOrAgent", in: property, handler: handler)

    #expect(resolver.dataModel.get("/ran/rendererOrAgent") == .boolean(true))
    #expect(handler.capturedErrors.isEmpty)
  }

  /// allowedCallers is a v1.0 feature, so a v0.9 renderer call is not restricted by it.
  @Test(arguments: ["label", "checks", "onClick"])
  func v09RendererCallerIgnoresAllowedCallers(property: String) throws {
    let handler = TestProcessorActionHandler()
    let resolver = try render("agentOnly", in: property, handler: handler, protocolVersion: .v091)

    #expect(resolver.dataModel.get("/ran/agentOnly") == .boolean(true))
    #expect(handler.capturedErrors.isEmpty)
  }

  /// A catalog whose `Button` takes any properties, so validation judges only its calls.
  private func makePermissiveCatalog(
    protocolVersion: A2UIProtocolVersion = .v10
  ) throws -> AnyCatalog {
    Catalog(
      id: "a",
      protocolVersion: protocolVersion,
      components: [
        AnyComponentAPI(name: "Button", schema: try Schema(instance: "{\"type\": \"object\"}"))
      ],
      functions: [
        RecordingFunction(name: "agentOnly", allowedCallers: .agentOnly),
        RecordingFunction(name: "rendererOrAgent", allowedCallers: .rendererOrAgent),
      ]
    ).eraseToAnyCatalog()
  }

  /// A `Button` whose `property` calls `function`: a binding, a check's condition, an
  /// action's `functionCall`, or, for `onClickContext`, a value in the context of an
  /// `onClick` event.
  private func button(
    calling function: String,
    in property: String,
    callKey: String = "@call"
  ) -> [String: JSONValue] {
    let call: JSONValue = .object([callKey: .string(function)])
    let key: String
    let value: JSONValue
    switch property {
    case "checks":
      key = property
      value = .array([.object(["condition": call, "message": .string("Blocked")])])
    case "onClick":
      key = property
      value = .object(["@functionCall": call])
    case "onClickContext":
      key = "onClick"
      value = .object([
        "@action": .object(["name": .string("submit"), "context": .object(["flag": call])])
      ])
    default:
      key = property
      value = call
    }
    return ["id": .string("root"), "component": .string("Button"), key: value]
  }

  /// A call held in a component is a renderer call, so validation rejects one to an
  /// `agentOnly` function at the call's location, before any binding is evaluated.
  @Test(arguments: [
    ("label", "label"), ("checks", "checks/0/condition"), ("onClick", "onClick/@functionCall"),
    ("onClickContext", "onClick/@action/context/flag"),
  ])
  func validationRejectsAgentOnlyFunctionInComponent(property: String, path: String) throws {
    let validator = PayloadValidator(
      catalog: try makePermissiveCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
    do {
      try validator.validateComponent(button(calling: "agentOnly", in: property))
      Issue.record("Expected an A2UIValidationError")
    } catch let error as A2UIValidationError {
      #expect(
        error.message
          == "Function 'agentOnly' cannot be called by renderer (allowedCallers is agentOnly)."
      )
      #expect(error.details.first?.path == path)
      #expect(error.details.first?.code == "invalid_function_call")
    }
  }

  @Test(arguments: ["label", "checks", "onClick"])
  func validationAcceptsRendererOrAgentFunctionInComponent(property: String) throws {
    let validator = PayloadValidator(
      catalog: try makePermissiveCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
    try validator.validateComponent(button(calling: "rendererOrAgent", in: property))
  }

  /// allowedCallers is a v1.0 feature, so v0.9 validation does not restrict a renderer call.
  @Test func v09ValidationIgnoresAllowedCallers() throws {
    let validator = PayloadValidator(
      catalog: try makePermissiveCatalog(protocolVersion: .v091),
      config: ValidationConfig(protocolVersion: .v091)
    )
    try validator.validateComponent(button(calling: "agentOnly", in: "label", callKey: "call"))
  }

  @Test func agentInitiatedCallRunsAgentOnlyFunction() async throws {
    let catalog = try makeCatalog()
    let response = await RPCHandler().handleIncomingCall(
      CallRendererFunctionMessage(
        functionCallID: "c1",
        callFunction: CallFunctionPayload(call: "agentOnly", catalogID: "a"),
        version: .v10
      ),
      catalogs: ["a": catalog]
    )

    #expect(response.error == nil)
    #expect(response.value == .boolean(true))
  }
}
