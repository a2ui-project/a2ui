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

@MainActor
struct NodeResolverTests {

  private func makeCatalog() throws -> AnyCatalog {
    let containerSchema = try Schema(
      instance: """
        {
          "allOf": [
            { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ComponentCommon" },
            {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "component": { "type": "string" },
                "child": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ComponentId"
                },
                "children": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ChildList"
                }
              }
            }
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )

    let textSchema = try Schema(
      instance: """
        {
          "allOf": [
            { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ComponentCommon" },
            {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "component": { "type": "string" },
                "text": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"
                }
              }
            }
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )

    return Catalog(
      id: "test",
      components: [
        AnyComponentAPI(name: "Container", schema: containerSchema),
        AnyComponentAPI(name: "Text", schema: textSchema),
      ]
    )
  }

  @Test func resolveTreeReturnsNilWhenRootMissing() throws {
    let catalog = try makeCatalog()
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: SurfaceComponentsModel(),
      dataModel: DataModel()
    )

    let rootNode = resolver.resolveTree()
    #expect(rootNode == nil)
  }

  @Test func resolveTreeBuildsHierarchy() throws {
    let catalog = try makeCatalog()
    let components: [String: ComponentModel] = [
      "root": ComponentModel(
        id: "root",
        type: "Container",
        properties: ["children": .array([.string("child1")])]
      ),
      "child1": ComponentModel(
        id: "child1",
        type: "Text",
        properties: ["text": .string("Hello World")]
      ),
    ]

    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: SurfaceComponentsModel(components: components),
      dataModel: DataModel()
    )

    let rootNode = try #require(resolver.resolveTree())
    #expect(rootNode.id == "root")
    #expect(rootNode.type == "Container")

    let children = rootNode.children(for: "children")
    #expect(children.count == 1)
    #expect(children[0].id == "child1")
    #expect(children[0].type == "Text")
    #expect(children[0].string(for: "text") == "Hello World")
  }

  @Test func childListSkipsUnarrivedComponents() throws {
    let catalog = try makeCatalog()
    // child1 not in components dictionary yet
    let components: [String: ComponentModel] = [
      "root": ComponentModel(
        id: "root",
        type: "Container",
        properties: ["children": .array([.string("child1"), .string("child2")])]
      ),
      "child2": ComponentModel(
        id: "child2",
        type: "Text",
        properties: ["text": .string("Second")]
      ),
    ]

    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: SurfaceComponentsModel(components: components),
      dataModel: DataModel()
    )

    let rootNode = try #require(resolver.resolveTree())
    let children = rootNode.children(for: "children")
    #expect(children.count == 1)
    #expect(children[0].id == "child2")
  }

  @Test func cyclicReferencesReturnNilWithoutInfiniteLoop() throws {
    let catalog = try makeCatalog()
    let components: [String: ComponentModel] = [
      "root": ComponentModel(
        id: "root",
        type: "Container",
        properties: ["children": .array([.string("a")])]
      ),
      "a": ComponentModel(
        id: "a",
        type: "Container",
        properties: ["children": .array([.string("b")])]
      ),
      "b": ComponentModel(
        id: "b",
        type: "Container",
        properties: ["children": .array([.string("a")])]
      ),
    ]

    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: SurfaceComponentsModel(components: components),
      dataModel: DataModel()
    )

    let rootNode = try #require(resolver.resolveTree())
    let aNode = try #require(rootNode.children(for: "children").first)
    let bNode = try #require(aNode.children(for: "children").first)
    // b's reference back to a is detected as cyclic and omitted
    #expect(bNode.children(for: "children").isEmpty)
  }

  @Test func unknownComponentTypeResolvesWithFallbackSchema() throws {
    let catalog = try makeCatalog()
    let components: [String: ComponentModel] = [
      "root": ComponentModel(
        id: "root",
        type: "Container",
        properties: ["child": .string("unknownChild")]
      ),
      "unknownChild": ComponentModel(
        id: "unknownChild",
        type: "NonExistentWidget",
        properties: ["someProp": .string("unclassifiedValue")]
      ),
    ]

    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: SurfaceComponentsModel(components: components),
      dataModel: DataModel()
    )

    let rootNode = try #require(resolver.resolveTree())
    let childNode = try #require(rootNode.child(for: "child"))
    #expect(childNode.id == "unknownChild")
    #expect(childNode.type == "NonExistentWidget")
    #expect(childNode.properties["someProp"] as? String == "unclassifiedValue")
  }

  @Test func standardArrayPreservesNullElements() throws {
    let arrayComponentSchema = try Schema(
      instance: """
        {
          "allOf": [
            { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ComponentCommon" },
            {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "component": { "type": "string" },
                "tags": {
                  "type": "array",
                  "items": { "type": ["string", "null"] }
                }
              }
            }
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )

    let catalog = Catalog(
      id: "test",
      components: [
        AnyComponentAPI(name: "TagList", schema: arrayComponentSchema)
      ]
    )

    let components: [String: ComponentModel] = [
      "root": ComponentModel(
        id: "root",
        type: "TagList",
        properties: [
          "tags": .array([.string("first"), .null, .string("third")])
        ]
      )
    ]

    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: SurfaceComponentsModel(components: components),
      dataModel: DataModel()
    )

    let rootNode = try #require(resolver.resolveTree())
    let tagsArray = try #require(rootNode.properties["tags"] as? ResolvedArray)
    #expect(tagsArray.elements.count == 3)
    #expect(tagsArray.elements[0] as? String == "first")
    #expect((tagsArray.elements[1] as? JSONValue) == .null)
    #expect(tagsArray.elements[2] as? String == "third")
  }

  @Test func dynamicTemplateResolvesWithData() throws {
    let catalog = try makeCatalog()
    let components: [String: ComponentModel] = [
      "root": ComponentModel(
        id: "root",
        type: "Container",
        properties: [
          "children": .object([
            "componentId": .string("itemTemplate"),
            "path": .string("/items"),
          ])
        ]
      ),
      "itemTemplate": ComponentModel(
        id: "itemTemplate",
        type: "Text",
        properties: ["text": .object(["path": .string("name")])]
      ),
    ]

    let data: JSONValue = .object([
      "items": .array([
        .object(["name": .string("First Item")]),
        .object(["name": .string("Second Item")]),
      ])
    ])

    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: SurfaceComponentsModel(components: components),
      dataModel: DataModel(initial: data)
    )

    let rootNode = try #require(resolver.resolveTree())
    let children = rootNode.children(for: "children")

    #expect(children.count == 2)
    #expect(children[0].id == "itemTemplate_0")
    #expect(children[0].string(for: "text") == "First Item")
    #expect(children[1].id == "itemTemplate_1")
    #expect(children[1].string(for: "text") == "Second Item")
  }

  @Test func convenienceInitFromSurfaceViewModel() throws {
    let catalog = try makeCatalog()
    let surface = SurfaceViewModel(
      surfaceID: "testSurface",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id
    )
    surface.componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Text",
        properties: ["text": .string("From Surface")]
      )
    )

    let resolver = NodeResolver(surface: surface)
    let rootNode = try #require(resolver.resolveTree())
    #expect(rootNode.id == "root")
    #expect(rootNode.type == "Text")
    #expect(rootNode.string(for: "text") == "From Surface")
  }

  @Test func nestedDynamicTemplateGeneratesDistinctNodeIDs() throws {
    let catalog = try makeCatalog()
    let components: [String: ComponentModel] = [
      "root": ComponentModel(
        id: "root",
        type: "Container",
        properties: [
          "children": .object([
            "componentId": .string("outerGroup"),
            "path": .string("/groups"),
          ])
        ]
      ),
      "outerGroup": ComponentModel(
        id: "outerGroup",
        type: "Container",
        properties: [
          "children": .object([
            "componentId": .string("innerItem"),
            "path": .string("items"),
          ])
        ]
      ),
      "innerItem": ComponentModel(
        id: "innerItem",
        type: "Text",
        properties: ["text": .object(["path": .string("label")])]
      ),
    ]

    let data: JSONValue = .object([
      "groups": .array([
        .object([
          "items": .array([
            .object(["label": .string("G0-I0")]),
            .object(["label": .string("G0-I1")]),
          ])
        ]),
        .object([
          "items": .array([
            .object(["label": .string("G1-I0")]),
            .object(["label": .string("G1-I1")]),
          ])
        ]),
      ])
    ])

    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: SurfaceComponentsModel(components: components),
      dataModel: DataModel(initial: data)
    )

    let rootNode = try #require(resolver.resolveTree())
    let outerNodes = rootNode.children(for: "children")
    #expect(outerNodes.count == 2)
    #expect(outerNodes[0].id == "outerGroup_0")
    #expect(outerNodes[1].id == "outerGroup_1")

    let inner0 = outerNodes[0].children(for: "children")
    let inner1 = outerNodes[1].children(for: "children")
    #expect(inner0.map(\.id) == ["innerItem_0_0", "innerItem_0_1"])
    #expect(inner1.map(\.id) == ["innerItem_1_0", "innerItem_1_1"])
    #expect(inner0[0].string(for: "text") == "G0-I0")
    #expect(inner1[1].string(for: "text") == "G1-I1")
  }

  @Test func expressionErrorsEmitPerComponentAndReEmitAfterRecovery() throws {
    let textSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "type": "string" },
            "text": {
              "$ref": "https://a2ui.org/schemas/v1_0/common_types.json#/$defs/DynamicString"
            }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let containerSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "type": "string" },
            "children": {
              "$ref": "https://a2ui.org/schemas/v1_0/common_types.json#/$defs/ChildList"
            }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let positiveNumberFunction = NonNegativeStringFunction()
    let catalog = Catalog(
      id: "cat-v10",
      protocolVersion: .v10,
      components: [
        AnyComponentAPI(name: "Container", schema: containerSchema),
        AnyComponentAPI(name: "Text", schema: textSchema),
      ],
      functions: [positiveNumberFunction]
    )

    let handler = ExpressionErrorCaptureHandler()
    let componentsModel = SurfaceComponentsModel(
      components: [
        "root": ComponentModel(
          id: "root",
          type: "Container",
          properties: ["children": .array([.string("t1"), .string("t2")])]
        ),
        "t1": ComponentModel(
          id: "t1",
          type: "Text",
          properties: [
            "text": .object([
              "@call": .string("nonNegative"),
              "args": .object(["value": .object(["@path": .string("/val")])]),
            ])
          ]
        ),
        "t2": ComponentModel(
          id: "t2",
          type: "Text",
          properties: [
            "text": .object([
              "@call": .string("nonNegative"),
              "args": .object(["value": .object(["@path": .string("/val")])]),
            ])
          ]
        ),
      ]
    )
    let dataModel = DataModel(initial: .object(["val": .integer(-1)]))
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: dataModel,
      actionHandler: handler,
      protocolVersion: .v10
    )

    // Pass 1: Both t1 and t2 fail with the same function error; both must emit EXPRESSION_ERROR.
    _ = resolver.resolveTree()
    #expect(handler.capturedErrors.count == 2)

    // Pass 2: Unrelated data change while /val is still -1; errors should be deduplicated.
    dataModel.set("/unrelated", value: .string("ok"))
    _ = resolver.resolveTree()
    #expect(handler.capturedErrors.count == 2)

    // Pass 3: /val recovers to a valid non-negative integer; no new errors and active set clears.
    dataModel.set("/val", value: .integer(10))
    _ = resolver.resolveTree()
    #expect(handler.capturedErrors.count == 2)

    // Pass 4: /val fails again in the exact same way; both t1 and t2 must emit EXPRESSION_ERROR again.
    dataModel.set("/val", value: .integer(-1))
    _ = resolver.resolveTree()
    #expect(handler.capturedErrors.count == 4)
  }
}

private final class ExpressionErrorCaptureHandler: ActionHandling, @unchecked Sendable {
  var capturedErrors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: RendererError, from surfaceID: String) {
    capturedErrors.append(error)
  }
}

private struct NonNegativeStringFunction: FunctionImplementation {
  let api = FunctionAPI(
    name: "nonNegative",
    returnType: .string,
    schema: try! Schema(instance: "{\"type\": \"object\"}")
  )

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    let val = arguments["value"]?.intValue ?? 0
    if val < 0 {
      throw FunctionError.executionFailed(
        name: "nonNegative", message: "Value must be non-negative")
    }
    return .string("\(val)")
  }
}
