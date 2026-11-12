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
import BasicCatalog
import Foundation
import JSONSchema
import OrderedJSON
import Testing

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    if named == "upper" {
      return UpperFunction()
    }
    return nil
  }

  func validateFunctionCatalog(id catalogID: String?, functionName: String) throws {}
}

private struct UpperFunction: FunctionImplementation, Sendable {
  let api = FunctionAPI(
    name: "upper", returnType: .string, schema: try! JSONSchema.Schema(instance: "{}"))

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    return .string(arguments["text"]?.stringValue?.uppercased() ?? "")
  }
}

@MainActor
struct FormatStringFunctionTests {

  let function = FormatStringFunction()
  let dataModel: DataModel
  let context: DataContext
  let v10Context: DataContext
  private let handler: MockFunctionHandler

  init() {
    let dm = DataModel()
    dm.set(JSONValue.absolutePath(for: "/user/name", in: ""), value: .string("Alice"))
    dm.set(JSONValue.absolutePath(for: "/count", in: ""), value: .integer(5))
    dm.set(JSONValue.absolutePath(for: "/price", in: ""), value: .number(9.99))
    dm.set(JSONValue.absolutePath(for: "/isTrue", in: ""), value: .boolean(true))
    self.dataModel = dm
    let h = MockFunctionHandler()
    self.handler = h
    self.context = DataContext(
      dataModel: dm, path: "", functionHandler: h)
    self.v10Context = DataContext(
      dataModel: dm, path: "", functionHandler: h, protocolVersion: .v10)
  }

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    #expect(function.api.name == "formatString")
    #expect(function.api.returnType == .string)
  }

  // MARK: - Evaluation

  @Test func formatsLiteralString() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("hello world")],
      context: context
    )
    #expect(result == .string("hello world"))
  }

  @Test func formatsStringWithDataPaths() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Hello ${/user/name}, you have ${/count} items.")],
      context: context
    )
    #expect(result == .string("Hello Alice, you have 5 items."))
  }

  @Test func formatsStringWithNestedFunctionCall() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Hello ${upper(text: 'bob')}")],
      context: context
    )
    #expect(result == .string("Hello BOB"))
  }

  @Test func formatsStringWithNumbersAndBooleans() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Price: ${/price}, Active: ${/isTrue}")],
      context: context
    )
    #expect(result == .string("Price: 9.99, Active: true"))
  }

  @Test func formatsEscapedInterpolation() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Cost is \\${/price}")],
      context: context
    )
    // Note: The expression parser leaves the inner text unevaluated.
    // Wait, the parser returns "${" and "/price}". So the string is "Cost is ${/price}" literally.
    #expect(result == .string("Cost is ${/price}"))
  }

  @Test func skipsNullValues() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Hello ${/missing/path}")],
      context: context
    )
    #expect(result == .string("Hello "))
  }

  @Test(arguments: [
    (JSONValue.array([.string("swift"), .string("ios")]), "[\"swift\",\"ios\"]"),
    (.object(["name": .string("Alice")]), "{\"name\":\"Alice\"}"),
    (.array([.integer(1), .null, .boolean(true)]), "[1,null,true]"),
    (.object(["items": .array([.object(["id": .integer(1)])])]), "{\"items\":[{\"id\":1}]}"),
    (
      .object(["z": .object(["b": .integer(2), "a": .integer(1)]), "a": .integer(0)]),
      "{\"z\":{\"b\":2,\"a\":1},\"a\":0}"
    ),
    (.array([]), "[]"),
    (.object([:]), "{}"),
  ])
  func formatsObjectsAndArraysAsJSON(value: JSONValue, expected: String) throws {
    dataModel.set("/payload", value: value)
    let result = try function.evaluate(
      arguments: ["value": .string("Value: ${/payload}!")], context: context)
    #expect(result == .string("Value: \(expected)!"))
  }

  @Test func throwsErrorWhenMissingValueArgument() {
    #expect(throws: FunctionError.self) {
      try function.evaluate(arguments: [:], context: context)
    }
  }

  // MARK: - v1.0 surfaces

  @Test func formatsDataPathsOnV10Surface() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Hello ${/user/name}, you have ${/count} items.")],
      context: v10Context
    )
    #expect(result == .string("Hello Alice, you have 5 items."))
  }

  @Test func formatsRelativePathOnV10Surface() throws {
    let userContext = DataContext(
      dataModel: dataModel, path: "/user", functionHandler: handler, protocolVersion: .v10)
    let result = try function.evaluate(
      arguments: ["value": .string("Hi ${name}")],
      context: userContext
    )
    #expect(result == .string("Hi Alice"))
  }

  @Test func formatsFunctionCallWithPathArgumentOnV10Surface() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Hello ${upper(text: /user/name)}")],
      context: v10Context
    )
    #expect(result == .string("Hello ALICE"))
  }

  @Test func formatsNestedFunctionCallsOnV10Surface() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("${upper(text: ${upper(text: 'bob')})}")],
      context: v10Context
    )
    #expect(result == .string("BOB"))
  }

  @Test func skipsMissingPathOnV10Surface() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Hello ${/missing/path}")],
      context: v10Context
    )
    #expect(result == .string("Hello "))
  }

  @Test func serializesDataModelObjectWithUnprefixedDirectiveKeysOnV10Surface() throws {
    dataModel.set("/literalObj", value: .object(["path": .string("/user/name")]))
    let result = try function.evaluate(
      arguments: ["value": .string("${/literalObj}")],
      context: v10Context
    )
    #expect(result == .string("{\"path\":\"/user/name\"}"))
  }

  @Test func inheritsCatalogIDForTemplateCallsWhileKeepingIndexCataloglessOnDefaultlessV10Surface()
    throws
  {
    let basicCatalog = BasicCatalog.makeCatalog(version: .v10).eraseToAnyCatalog()
    let resolver = NodeResolver(
      surfaceID: "s-no-default",
      catalogs: [basicCatalog],
      defaultCatalogID: nil,
      protocolVersion: .v10
    )
    let itemContext = DataContext(
      dataModel: resolver.dataModel,
      path: "/items/2",
      functionHandler: resolver,
      protocolVersion: .v10,
      index: 2
    )
    let template = """
      Row ${@index()}: ${pluralize(value: 2, one: 'drop', other: 'drops')} \
      (${not(value: not(value: true))})
      """
    let resolved = itemContext.resolveDynamicValue(
      .object([
        "@call": .string("formatString"),
        "catalogId": .string(basicCatalog.id),
        "args": .object([
          "value": .string(template)
        ]),
      ])
    )
    #expect(resolved == .string("Row 2: drops (true)"))
  }

  @Test func recordsDefaultCatalogIDWhenFormatStringOmitsCatalogIDOnV10Surface() throws {
    let customID = "https://example.com/custom.json"
    let customCatalog = AnyCatalog(
      id: customID,
      protocolVersion: .v10,
      components: [],
      functions: [FormatStringFunction(), ActiveCatalogFunction()]
    )
    let resolver = NodeResolver(
      surfaceID: "s-default",
      catalogs: [customCatalog],
      defaultCatalogID: customID,
      protocolVersion: .v10
    )
    let context = DataContext(
      dataModel: resolver.dataModel,
      path: "/",
      functionHandler: resolver,
      protocolVersion: .v10
    )
    let resolved = context.resolveDynamicValue(
      .object([
        "@call": .string("formatString"),
        "args": .object([
          "value": .string("${activeCat()}")
        ]),
      ])
    )
    #expect(resolved == .string(customID))
    #expect(context.activeFunctionCatalogID == nil)
  }

  @Test func clearsOuterCatalogIDWhenNestedCallResolvesToNilCatalogIDOnCustomHandler() throws {
    let customHandler = CataloglessCustomFunctionHandler()
    let context = DataContext(
      dataModel: DataModel(),
      path: "/",
      functionHandler: customHandler,
      protocolVersion: .v10
    )
    let resolved = context.resolveDynamicValue(
      .object([
        "@call": .string("outer"),
        "catalogId": .string("https://example.com/outer.json"),
        "args": .object([:]),
      ])
    )
    #expect(resolved == .string("none"))
    #expect(context.activeFunctionCatalogID == nil)
  }

  @Test func resolvesTemplateCallsInFormatStringCatalogOverSurfaceDefaultCatalog() throws {
    let customID = "https://example.com/custom.json"
    let customCatalog = AnyCatalog(
      id: customID,
      protocolVersion: .v10,
      components: [],
      functions: []
    )
    let basicCatalog = BasicCatalog.makeCatalog(version: .v10).eraseToAnyCatalog()
    let resolver = NodeResolver(
      surfaceID: "s-custom-default",
      catalogs: [customCatalog, basicCatalog],
      defaultCatalogID: customID,
      protocolVersion: .v10
    )
    let context = DataContext(
      dataModel: resolver.dataModel,
      path: "/",
      functionHandler: resolver,
      protocolVersion: .v10
    )
    let resolved = context.resolveDynamicValue(
      .object([
        "@call": .string("formatString"),
        "catalogId": .string(basicCatalog.id),
        "args": .object([
          "value": .string("Count: ${pluralize(value: 2, one: 'drop', other: 'drops')}")
        ]),
      ])
    )
    #expect(resolved == .string("Count: drops"))
  }

  @Test func resolvesTemplateCallsInStandaloneRPCCatalogWhenSurfaceLacksCatalog() async throws {
    let surfaceCatalogID = "https://example.com/surface.json"
    let surfaceCatalog = AnyCatalog(
      id: surfaceCatalogID,
      protocolVersion: .v10,
      components: [],
      functions: [
        FormatStringFunction(),
        AgentFormatStringFunction(),
        ActiveCatalogFunction(),
      ]
    )
    let errorRecorder = RPCTestErrorHandler()
    let surface = SurfaceViewModel(
      surfaceID: "s-surface",
      catalogs: [surfaceCatalog],
      defaultCatalogID: surfaceCatalogID,
      actionHandler: errorRecorder,
      protocolVersion: .v10
    )
    var agentCallerInvocations = 0
    surface.agentFunctionCaller = { _ in
      agentCallerInvocations += 1
      return .string("from-agent")
    }
    surface.dataModel.set("/label", value: .string("ok"))
    let surfaceContext = DataContext(
      dataModel: surface.dataModel,
      path: "/",
      functionHandler: surface,
      protocolVersion: .v10
    )
    let standaloneID = "https://example.com/standalone-rpc.json"
    let standaloneCatalog = AnyCatalog(
      id: standaloneID,
      protocolVersion: .v10,
      components: [],
      functions: [
        AgentEchoFunction(),
        FormatStringFunction(),
        AgentFormatStringFunction(),
        ActiveCatalogFunction(),
      ]
    )
    let unnegotiatedID = "https://example.com/unnegotiated-rpc.json"
    let unnegotiatedCatalog = AnyCatalog(
      id: unnegotiatedID,
      protocolVersion: .v10,
      components: [],
      functions: [ActiveCatalogFunction()]
    )
    let allCatalogs: [String: AnyCatalog] = [
      surfaceCatalogID: surfaceCatalog,
      standaloneID: standaloneCatalog,
      unnegotiatedID: unnegotiatedCatalog,
    ]
    let message = CallRendererFunctionMessage(
      surfaceID: "s-surface",
      functionCallID: "rpc-1",
      callFunction: CallFunctionPayload(
        call: "rpcFormatString",
        catalogID: standaloneID,
        args: ["value": .string("${/label}:${activeCat()}")]
      ),
      version: .v10
    )
    let response = await RPCHandler().handleIncomingCall(
      message,
      catalogs: allCatalogs,
      defaultCatalogID: surfaceCatalogID,
      dataContext: surfaceContext
    )
    #expect(response.error == nil)
    #expect(response.value == .string("ok:\(standaloneID)"))
    #expect(surfaceContext.activeFunctionCatalogID == nil)

    // Dynamic `@call` in `callFunction.args` targeting `standaloneID` resolves cleanly.
    let argMessage = CallRendererFunctionMessage(
      surfaceID: "s-surface",
      functionCallID: "rpc-2",
      callFunction: CallFunctionPayload(
        call: "rpcEcho",
        catalogID: standaloneID,
        args: [
          "value": .object([
            "@call": .string("formatString"),
            "catalogId": .string(standaloneID),
            "args": .object(["value": .string("arg:${activeCat()}")]),
          ])
        ]
      ),
      version: .v10
    )
    let argResponse = await RPCHandler().handleIncomingCall(
      argMessage,
      catalogs: allCatalogs,
      defaultCatalogID: surfaceCatalogID,
      dataContext: surfaceContext
    )
    #expect(argResponse.error == nil)
    #expect(argResponse.value == .string("arg:\(standaloneID)"))

    // Other unnegotiated catalogs in `allCatalogs` do not leak into surface-bound RPC calls.
    errorRecorder.capturedErrors.removeAll()
    let leakMessage = CallRendererFunctionMessage(
      surfaceID: "s-surface",
      functionCallID: "rpc-3",
      callFunction: CallFunctionPayload(
        call: "rpcEcho",
        catalogID: standaloneID,
        args: [
          "value": .object([
            "@call": .string("activeCat"),
            "catalogId": .string(unnegotiatedID),
            "args": .object([:]),
          ])
        ]
      ),
      version: .v10
    )
    let leakResponse = await RPCHandler().handleIncomingCall(
      leakMessage,
      catalogs: allCatalogs,
      defaultCatalogID: surfaceCatalogID,
      dataContext: surfaceContext
    )
    #expect(leakResponse.error?.code == "EXECUTION_ERROR")
    #expect(!errorRecorder.capturedErrors.isEmpty)

    // A failing `${...}` inside RPC-invoked `formatString` forwards the error to the surface
    // without outbound agent routing and returns the truncated string.
    errorRecorder.capturedErrors.removeAll()
    agentCallerInvocations = 0
    let missingFnMessage = CallRendererFunctionMessage(
      surfaceID: "s-surface",
      functionCallID: "rpc-4",
      callFunction: CallFunctionPayload(
        call: "rpcFormatString",
        catalogID: standaloneID,
        args: ["value": .string("Prefix: ${noSuchFn()}")]
      ),
      version: .v10
    )
    let missingFnResponse = await RPCHandler().handleIncomingCall(
      missingFnMessage,
      catalogs: allCatalogs,
      defaultCatalogID: surfaceCatalogID,
      dataContext: surfaceContext
    )
    #expect(missingFnResponse.error == nil)
    #expect(missingFnResponse.value == .string("Prefix: "))
    #expect(agentCallerInvocations == 0)
    #expect(!errorRecorder.capturedErrors.isEmpty)

    // A nested `@call` to `rpcFormatString` without `catalogId` resolves via the surface default
    // catalog (`RPCArgumentFunctionHandler.resolvedFunctionCatalogID`) and scopes its template
    // calls to `surfaceCatalogID`.
    errorRecorder.capturedErrors.removeAll()
    let defaultCatMessage = CallRendererFunctionMessage(
      surfaceID: "s-surface",
      functionCallID: "rpc-5",
      callFunction: CallFunctionPayload(
        call: "rpcEcho",
        catalogID: standaloneID,
        args: [
          "value": .object([
            "@call": .string("rpcFormatString"),
            "args": .object(["value": .string("Default:${activeCat()}")]),
          ])
        ]
      ),
      version: .v10
    )
    let defaultCatResponse = await RPCHandler().handleIncomingCall(
      defaultCatMessage,
      catalogs: allCatalogs,
      defaultCatalogID: surfaceCatalogID,
      dataContext: surfaceContext
    )
    #expect(defaultCatResponse.error == nil)
    #expect(defaultCatResponse.value == .string("Default:\(surfaceCatalogID)"))
    #expect(errorRecorder.capturedErrors.isEmpty)
  }
}

private final class RPCTestErrorHandler: ActionHandling, @unchecked Sendable {
  var capturedErrors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: RendererError, from surfaceID: String) {
    capturedErrors.append(error)
  }
}

@MainActor
private final class CataloglessCustomFunctionHandler: FunctionHandler {
  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    switch name {
    case "outer":
      return OuterCatalogFunction()
    case "activeCat":
      return ActiveCatalogFunction()
    default:
      return nil
    }
  }
}

private struct OuterCatalogFunction: FunctionImplementation, Sendable {
  let api = FunctionAPI(
    name: "outer",
    returnType: .string,
    schema: try! JSONSchema.Schema(instance: "{}")
  )

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    context.resolveDynamicValue(.object(["@call": .string("activeCat"), "args": .object([:])]))
  }
}

private struct ActiveCatalogFunction: FunctionImplementation, Sendable {
  let api = FunctionAPI(
    name: "activeCat",
    returnType: .string,
    schema: try! JSONSchema.Schema(instance: "{}")
  )

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    .string(context.activeFunctionCatalogID ?? "none")
  }
}

private struct AgentEchoFunction: FunctionImplementation, Sendable {
  let api = FunctionAPI(
    name: "rpcEcho",
    returnType: .string,
    schema: FormatStringFunction().api.schema,
    allowedCallers: .agentOnly
  )

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    arguments["value"] ?? .null
  }
}

private struct AgentFormatStringFunction: FunctionImplementation, Sendable {
  let api = FunctionAPI(
    name: "rpcFormatString",
    returnType: .string,
    schema: FormatStringFunction().api.schema,
    allowedCallers: .rendererOrAgent
  )

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    try FormatStringFunction().evaluate(arguments: arguments, context: context)
  }
}
