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
import JSONSchema
import OrderedJSON
import Testing

/// Covers v1.0 catalog resolution on surfaces, resolvers, the message processor, and at runtime.
@MainActor
struct CatalogResolutionV10Tests {

  private func makeCatalog(
    id: String,
    protocolVersion: A2UIProtocolVersion = .v10,
    functions: [any FunctionImplementation] = []
  ) throws -> AnyCatalog {
    Catalog(
      id: id,
      protocolVersion: protocolVersion,
      components: [
        AnyComponentAPI(name: "Text", schema: try Schema(instance: "{\"type\": \"object\"}"))
      ],
      functions: functions
    ).eraseToAnyCatalog()
  }

  private func genericCodes(_ errors: [RendererError]) -> [String] {
    errors.compactMap { error in
      if case .generic(let generic) = error {
        return generic.code
      }
      return nil
    }
  }

  // MARK: - No single-catalog fallback

  @Test func surfaceViewModelHasNoSingleCatalogFallbackOnV10() throws {
    let catalog = try makeCatalog(id: "a")
    let surface = SurfaceViewModel(surfaceID: "s", catalogs: [catalog], protocolVersion: .v10)
    #expect(surface.defaultCatalogID == nil)
    #expect(surface.getCatalog() == nil)
    #expect(surface.getCatalog(id: "a")?.id == "a")
  }

  @Test func surfaceViewModelKeepsSingleCatalogFallbackOnV09() throws {
    let catalog = try makeCatalog(id: "a", protocolVersion: .v091)
    let surface = SurfaceViewModel(surfaceID: "s", catalogs: [catalog], protocolVersion: .v091)
    #expect(surface.defaultCatalogID == "a")
    #expect(surface.getCatalog()?.id == "a")
  }

  @Test func nodeResolverHasNoSingleCatalogFallbackOnV10() throws {
    let catalog = try makeCatalog(id: "a")
    let fromArray = NodeResolver(surfaceID: "s", catalogs: [catalog], protocolVersion: .v10)
    #expect(fromArray.defaultCatalogID == nil)
    #expect(fromArray.getCatalog() == nil)
    #expect(fromArray.isV10)

    let fromDictionary = NodeResolver(
      surfaceID: "s",
      catalogs: ["a": catalog],
      protocolVersion: .v10
    )
    #expect(fromDictionary.defaultCatalogID == nil)
    #expect(fromDictionary.getCatalog() == nil)
  }

  @Test func nodeResolverKeepsSingleCatalogFallbackOnV09() throws {
    let catalog = try makeCatalog(id: "a", protocolVersion: .v091)
    let resolver = NodeResolver(surfaceID: "s", catalogs: [catalog], protocolVersion: .v091)
    #expect(resolver.defaultCatalogID == "a")
    #expect(resolver.getCatalog()?.id == "a")
  }

  @Test func createSurfaceWithoutCatalogIDHasNoDefaultOnV10() throws {
    let processor = MessageProcessor(catalogs: [try makeCatalog(id: "a")])
    try processor.processMessages(
      try JSONValue.parse(
        """
        { "version": "v1.0", "createSurface": { "surfaceId": "s" } }
        """
      )
    )
    let surface = try #require(processor.surfaceGroupModel["s"])
    #expect(surface.defaultCatalogID == nil)

    // A component must name its catalog on a surface without a default.
    #expect(throws: A2UICatalogError.self) {
      try processor.processMessages(
        try JSONValue.parse(
          """
          {
            "version": "v1.0",
            "updateComponents": {
              "surfaceId": "s",
              "components": [{ "id": "root", "component": "Text" }]
            }
          }
          """
        )
      )
    }
    try processor.processMessages(
      try JSONValue.parse(
        """
        {
          "version": "v1.0",
          "updateComponents": {
            "surfaceId": "s",
            "components": [{ "id": "root", "component": "Text", "catalogId": "a" }]
          }
        }
        """
      )
    )
    #expect(surface.componentsModel.get("root")?.catalogID == "a")
  }

  // MARK: - Default processing of undeclared functions

  private func updateWithCall(_ callName: String) throws -> JSONValue {
    try JSONValue.parse(
      """
      {
        "version": "v1.0",
        "updateComponents": {
          "surfaceId": "s",
          "components": [
            { "id": "root", "component": "Text", "text": { "@call": "\(callName)" } }
          ]
        }
      }
      """
    )
  }

  private func makeProcessorWithSurface(
    validationConfig: ValidationConfig
  ) throws -> MessageProcessor {
    let processor = MessageProcessor(
      catalogs: [try makeCatalog(id: "a")],
      validationConfig: validationConfig
    )
    try processor.processMessages(
      try JSONValue.parse(
        """
        { "version": "v1.0", "createSurface": { "surfaceId": "s", "catalogId": "a" } }
        """
      )
    )
    return processor
  }

  @Test func defaultProcessingAcceptsUndeclaredFunction() throws {
    let relaxed = try makeProcessorWithSurface(validationConfig: .relaxed)
    try relaxed.processMessages(try updateWithCall("notAFunction"))
    #expect(throws: A2UIValidationError.self) {
      try relaxed.processMessages(try self.updateWithCall("@notAFunction"))
    }

    let strict = try makeProcessorWithSurface(validationConfig: .strict)
    #expect(throws: A2UIValidationError.self) {
      try strict.processMessages(try self.updateWithCall("notAFunction"))
    }
  }

  // MARK: - Runtime resolution

  private func makeResolver(
    defaultCatalogID: String?,
    handler: TestProcessorActionHandler
  ) throws -> NodeResolver {
    NodeResolver(
      surfaceID: "s",
      catalogs: [
        try makeCatalog(id: "a", functions: [ConcatFunction()]),
        try makeCatalog(id: "b"),
      ],
      defaultCatalogID: defaultCatalogID,
      actionHandler: handler,
      protocolVersion: .v10
    )
  }

  private func evaluate(_ value: JSONValue, with resolver: NodeResolver) -> JSONValue {
    DataContext(
      dataModel: resolver.dataModel,
      path: "",
      functionHandler: resolver,
      protocolVersion: .v10
    ).resolveDynamicValue(value)
  }

  @Test func runtimeRunsCallInTheCatalogItNames() throws {
    let handler = TestProcessorActionHandler()
    let resolver = try makeResolver(defaultCatalogID: "b", handler: handler)
    let result = evaluate(
      .object([
        "@call": .string("concat"),
        "catalogId": .string("a"),
        "args": .object(["a": .string("x"), "b": .string("y")]),
      ]),
      with: resolver
    )
    #expect(result == .string("xy"))
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func runtimeReportsSystemFunctionNamingCatalogAsExpressionError() throws {
    let handler = TestProcessorActionHandler()
    let resolver = try makeResolver(defaultCatalogID: "a", handler: handler)
    for catalogID: JSONValue in [.string("a"), .integer(42)] {
      let result = evaluate(
        .object(["@call": .string("@index"), "catalogId": catalogID]),
        with: resolver
      )
      #expect(result == .null)
    }
    #expect(genericCodes(handler.capturedErrors) == ["EXPRESSION_ERROR", "EXPRESSION_ERROR"])
  }

  @Test func runtimeReportsUnresolvableCatalogAsCatalogError() throws {
    let handler = TestProcessorActionHandler()
    let resolver = try makeResolver(defaultCatalogID: "a", handler: handler)
    // A non-string catalogId names no available catalog; it doesn't fall back to the default.
    #expect(
      evaluate(.object(["@call": .string("concat"), "catalogId": .integer(42)]), with: resolver)
        == .null
    )
    #expect(
      evaluate(
        .object(["@call": .string("concat"), "catalogId": .string("missing")]),
        with: resolver
      ) == .null
    )

    let noDefault = try makeResolver(defaultCatalogID: nil, handler: handler)
    #expect(evaluate(.object(["@call": .string("concat")]), with: noDefault) == .null)

    #expect(
      genericCodes(handler.capturedErrors) == ["CATALOG_ERROR", "CATALOG_ERROR", "CATALOG_ERROR"]
    )
  }

  @Test func runtimeReportsFunctionMissingFromResolvedCatalogAsExpressionError() throws {
    let handler = TestProcessorActionHandler()
    let resolver = try makeResolver(defaultCatalogID: "a", handler: handler)
    let result = evaluate(
      .object(["@call": .string("concat"), "catalogId": .string("b")]),
      with: resolver
    )
    #expect(result == .null)
    #expect(genericCodes(handler.capturedErrors) == ["EXPRESSION_ERROR"])
  }

  @Test func runtimeRunsIndexWithoutDefaultCatalog() throws {
    let handler = TestProcessorActionHandler()
    let resolver = try makeResolver(defaultCatalogID: nil, handler: handler)
    let context = DataContext(
      dataModel: resolver.dataModel,
      path: "",
      functionHandler: resolver,
      protocolVersion: .v10,
      index: 2
    )
    let result = context.resolveDynamicValue(.object(["@call": .string("@index")]))
    #expect(result == .integer(2))
    #expect(handler.capturedErrors.isEmpty)
  }
}
