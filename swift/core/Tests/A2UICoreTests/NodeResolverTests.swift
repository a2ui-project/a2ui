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
    let dataModel = DataModel()
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      dataModel: dataModel
    )

    let rootNode = resolver.resolveTree(components: [:], data: .object([:]))
    #expect(rootNode == nil)
  }

  @Test func resolveTreeBuildsHierarchy() throws {
    let catalog = try makeCatalog()
    let dataModel = DataModel()
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      dataModel: dataModel
    )

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

    let rootNode = try #require(resolver.resolveTree(components: components, data: .object([:])))
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
    let dataModel = DataModel()
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      dataModel: dataModel
    )

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

    let rootNode = try #require(resolver.resolveTree(components: components, data: .object([:])))
    let children = rootNode.children(for: "children")
    #expect(children.count == 1)
    #expect(children[0].id == "child2")
  }

  @Test func cyclicReferencesReturnNilWithoutInfiniteLoop() throws {
    let catalog = try makeCatalog()
    let dataModel = DataModel()
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      dataModel: dataModel
    )

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

    let rootNode = try #require(resolver.resolveTree(components: components, data: .object([:])))
    let aNode = try #require(rootNode.children(for: "children").first)
    let bNode = try #require(aNode.children(for: "children").first)
    // b's reference back to a is detected as cyclic and omitted
    #expect(bNode.children(for: "children").isEmpty)
  }

  @Test func unknownComponentTypeResolvesWithFallbackSchema() throws {
    let catalog = try makeCatalog()
    let dataModel = DataModel()
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      dataModel: dataModel
    )

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

    let rootNode = try #require(resolver.resolveTree(components: components, data: .object([:])))
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

    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      dataModel: DataModel()
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

    let rootNode = try #require(resolver.resolveTree(components: components, data: .object([:])))
    let tagsArray = try #require(rootNode.properties["tags"] as? ResolvedArray)
    #expect(tagsArray.elements.count == 3)
    #expect(tagsArray.elements[0] as? String == "first")
    #expect((tagsArray.elements[1] as? JSONValue) == .null)
    #expect(tagsArray.elements[2] as? String == "third")
  }

  @Test func dynamicTemplateResolvesWithData() throws {
    let catalog = try makeCatalog()
    let dataModel = DataModel()
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      dataModel: dataModel
    )

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

    let rootNode = try #require(resolver.resolveTree(components: components, data: data))
    let children = rootNode.children(for: "children")

    #expect(children.count == 2)
    #expect(children[0].id == "itemTemplate_0")
    #expect(children[0].string(for: "text") == "First Item")
    #expect(children[1].id == "itemTemplate_1")
    #expect(children[1].string(for: "text") == "Second Item")
  }
}
