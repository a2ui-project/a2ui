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

  @Test func customComponentResolvesAccessibilityBindings() throws {
    // Like most custom schemas, this one leaves `accessibility` to `ComponentCommon`.
    let schema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "component": { "const": "ProductCard" },
            "title": { "$ref": "\(A2UICommonSchema.v10URI(for: "DynamicString"))" }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let catalog = Catalog(
      id: "shop",
      protocolVersion: .v10,
      components: [AnyComponentAPI(name: "ProductCard", schema: schema)]
    ).eraseToAnyCatalog()
    let dataModel = DataModel(
      initial: .object(["productName": .string("iPhone 17"), "hidden": .boolean(false)])
    )
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: SurfaceComponentsModel(components: [
        "root": ComponentModel(
          id: "root",
          type: "ProductCard",
          properties: [
            "title": .string("iPhone"),
            "accessibility": .object([
              "label": .object(["@path": .string("/productName")]),
              "hidden": .object(["@path": .string("/hidden")]),
              "live": .string("polite"),
            ]),
          ]
        )
      ]),
      dataModel: dataModel,
      protocolVersion: .v10
    )

    let node = try #require(resolver.resolveTree())
    #expect(
      node.explicitAccessibilityAttributes
        == AccessibilityAttributes(label: "iPhone 17", live: "polite", hidden: false)
    )

    dataModel.set("/productName", value: .string("iPhone 17 Pro"))
    let updated = try #require(resolver.resolveTree())
    #expect(updated.explicitAccessibilityAttributes?.label == "iPhone 17 Pro")
  }

  @Test func incrementalScopedBindingWriteAndNoOpDataSet() throws {
    let catalog = try makeCatalog()
    let componentsModel = SurfaceComponentsModel(
      components: [
        "root": ComponentModel(
          id: "root",
          type: "Container",
          properties: [
            "children": .object([
              "componentId": .string("personText"),
              "path": .string("/people"),
            ])
          ]
        ),
        "personText": ComponentModel(
          id: "personText",
          type: "Text",
          properties: ["text": .object(["path": .string("name")])]
        ),
      ]
    )
    let dataModel = DataModel(
      initial: .object([
        "people": .array([
          .object(["name": .string("Ada")]),
          .object(["name": .string("Lin")]),
        ])
      ])
    )
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: dataModel
    )

    let root = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 3)
    let children = root.children(for: "children")
    #expect(children.count == 2)
    let item0 = children[0]
    let item1 = children[1]

    // Write through item0's scoped DataBinding: only item0 should resolve.
    let binding0 = try #require(item0.properties["text"] as? DataBinding<String>)
    binding0.set("Grace")
    let rootAfterWrite = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 1)
    #expect(rootAfterWrite.box === root.box)
    #expect(rootAfterWrite.box.revision == 0)
    #expect(item0.box.revision == 1)
    #expect(item0.string(for: "text") == "Grace")
    #expect(item1.box.revision == 0)
    #expect(item1.string(for: "text") == "Lin")

    // Setting /people/0/name to the same value "Grace" is a no-op for resolution.
    dataModel.set("/people/0/name", value: .string("Grace"))
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 0)
    #expect(item0.box.revision == 1)
  }

  @Test func incrementalTemplateDefinitionUpdateAndMiddleInsertion() throws {
    let catalog = try makeCatalog()
    let componentsModel = SurfaceComponentsModel(
      components: [
        "root": ComponentModel(
          id: "root",
          type: "Container",
          properties: [
            "children": .object([
              "componentId": .string("personText"),
              "path": .string("/people"),
            ])
          ]
        ),
        "personText": ComponentModel(
          id: "personText",
          type: "Text",
          properties: ["text": .object(["path": .string("name")])]
        ),
      ]
    )
    let dataModel = DataModel(
      initial: .object([
        "people": .array([
          .object(["name": .string("Ada")]),
          .object(["name": .string("Lin")]),
        ])
      ])
    )
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: dataModel
    )

    let root = try #require(resolver.resolveTree())
    let initialChildren = root.children(for: "children")
    let item0 = initialChildren[0]
    let item1 = initialChildren[1]

    // 1. Update shared template definition to a literal: both instances resolve, root stays silent.
    componentsModel.addComponent(
      ComponentModel(
        id: "personText",
        type: "Text",
        properties: ["text": .string("Fixed")]
      )
    )
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 2)
    #expect(root.box.revision == 0)
    #expect(item0.box.revision == 1)
    #expect(item1.box.revision == 1)
    #expect(item0.string(for: "text") == "Fixed")
    #expect(item1.string(for: "text") == "Fixed")

    // Restore path binding on template definition.
    componentsModel.addComponent(
      ComponentModel(
        id: "personText",
        type: "Text",
        properties: ["text": .object(["path": .string("name")])]
      )
    )
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 2)
    let rev0BeforeInsert = item0.box.revision
    let rev1BeforeInsert = item1.box.revision

    // 2. Insert "New" at index 1 ([Ada, Lin] -> [Ada, New, Lin]):
    // root resolves (count 2 -> 3), item0 is untouched ("Ada" == "Ada"),
    // item1 updates ("Lin" -> "New"), and item2 is created ("Lin").
    dataModel.set(
      "/people",
      value: .array([
        .object(["name": .string("Ada")]),
        .object(["name": .string("New")]),
        .object(["name": .string("Lin")]),
      ])
    )
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 3)
    #expect(root.box.revision == 1)
    #expect(item0.box.revision == rev0BeforeInsert)
    #expect(item1.box.revision == rev1BeforeInsert + 1)
    #expect(item1.string(for: "text") == "New")
    let afterInsertChildren = root.children(for: "children")
    #expect(afterInsertChildren.count == 3)
    #expect(afterInsertChildren[0].box === item0.box)
    #expect(afterInsertChildren[1].box === item1.box)
    #expect(afterInsertChildren[2].string(for: "text") == "Lin")

    // 3. Shrink /people to 1 item ([Ada]): only root resolves, and pruned items ignore later writes.
    dataModel.set(
      "/people",
      value: .array([
        .object(["name": .string("Ada")])
      ])
    )
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 1)
    #expect(root.children(for: "children").count == 1)

    // Writing to pruned item1's path does not resolve any node.
    dataModel.set("/people/0/name", value: .string("Ada"))
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 0)
  }

  @Test func incrementalDelayedChildArrivalTypeChangeAndRemoval() throws {
    let catalog = try makeCatalog()
    // Start with root referencing "greeting", which has not arrived yet.
    let componentsModel = SurfaceComponentsModel(
      components: [
        "root": ComponentModel(
          id: "root",
          type: "Container",
          properties: ["child": .string("greeting")]
        )
      ]
    )
    let dataModel = DataModel(initial: .object(["msg": .string("Hello")]))
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: dataModel
    )

    let root = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 1)
    #expect(root.child(for: "child") == nil)

    // 1. Delayed arrival of "greeting": root and greeting resolve, root keeps identity.
    componentsModel.addComponent(
      ComponentModel(
        id: "greeting",
        type: "Text",
        properties: ["text": .object(["path": .string("/msg")])]
      )
    )
    let rootAfterArrival = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 2)
    #expect(rootAfterArrival.box === root.box)
    let greetingText = try #require(root.child(for: "child"))
    #expect(greetingText.type == "Text")
    #expect(greetingText.string(for: "text") == "Hello")

    // 2. Type change on child ("Text" -> "Container"): root keeps identity, child gets a new NodeBox.
    componentsModel.addComponent(
      ComponentModel(
        id: "greeting",
        type: "Container",
        properties: [:]
      )
    )
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 2)
    let greetingContainer = try #require(root.child(for: "child"))
    #expect(greetingContainer.type == "Container")
    #expect(greetingContainer.box !== greetingText.box)

    // 3. Remove "greeting": only root resolves, child becomes nil, and old /msg dependency is pruned.
    componentsModel.removeComponent("greeting")
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 1)
    #expect(root.child(for: "child") == nil)

    dataModel.set("/msg", value: .string("Updated"))
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 0)

    // 4. Remove "root" and re-add: tree becomes nil then resolves fresh root.
    componentsModel.removeComponent("root")
    #expect(resolver.resolveTree() == nil)
    componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Text",
        properties: ["text": .string("Reborn")]
      )
    )
    let rebornRoot = try #require(resolver.resolveTree())
    #expect(rebornRoot.box !== root.box)
    #expect(rebornRoot.string(for: "text") == "Reborn")
  }

  @Test func incrementalReparentingUpdatesVisitedAndPreservesNodeIdentity() throws {
    let catalog = try makeCatalog()
    // Initial hierarchy: root -> a -> b -> c
    let componentsModel = SurfaceComponentsModel(
      components: [
        "root": ComponentModel(
          id: "root",
          type: "Container",
          properties: ["child": .string("a")]
        ),
        "a": ComponentModel(
          id: "a",
          type: "Container",
          properties: ["child": .string("b")]
        ),
        "b": ComponentModel(
          id: "b",
          type: "Container",
          properties: ["child": .string("c")]
        ),
        "c": ComponentModel(
          id: "c",
          type: "Container",
          properties: [:]
        ),
      ]
    )
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: DataModel()
    )

    let root = try #require(resolver.resolveTree())
    let initialA = try #require(root.child(for: "child"))
    let initialB = try #require(initialA.child(for: "child"))
    let initialC = try #require(initialB.child(for: "child"))

    // Reparent to: root -> b -> c -> a
    // "a" is no longer an ancestor of "c", so "c" referencing "a" is valid and not a cycle.
    componentsModel.applyBatch(adding: [
      ComponentModel(
        id: "root",
        type: "Container",
        properties: ["child": .string("b")]
      ),
      ComponentModel(
        id: "a",
        type: "Container",
        properties: [:]
      ),
      ComponentModel(
        id: "c",
        type: "Container",
        properties: ["child": .string("a")]
      ),
    ])

    let updatedRoot = try #require(resolver.resolveTree())
    let updatedB = try #require(updatedRoot.child(for: "child"))
    let updatedC = try #require(updatedB.child(for: "child"))
    let reparentedA = try #require(updatedC.child(for: "child"))

    #expect(updatedB.id == "b")
    #expect(updatedC.id == "c")
    #expect(reparentedA.id == "a")
    #expect(updatedB.box === initialB.box)
    #expect(updatedC.box === initialC.box)
    #expect(reparentedA.box === initialA.box)
  }

  @Test func siblingTemplateListsSharingComponentIDMaintainIsolatedNodes() throws {
    let catalog = try makeCatalog()
    let componentsModel = SurfaceComponentsModel(
      components: [
        "root": ComponentModel(
          id: "root",
          type: "Container",
          properties: ["children": .array([.string("activeList"), .string("completedList")])]
        ),
        "activeList": ComponentModel(
          id: "activeList",
          type: "Container",
          properties: [
            "children": .object([
              "componentId": .string("itemCard"),
              "path": .string("/activeItems"),
            ])
          ]
        ),
        "completedList": ComponentModel(
          id: "completedList",
          type: "Container",
          properties: [
            "children": .object([
              "componentId": .string("itemCard"),
              "path": .string("/completedItems"),
            ])
          ]
        ),
        "itemCard": ComponentModel(
          id: "itemCard",
          type: "Text",
          properties: ["text": .object(["path": .string("title")])]
        ),
      ]
    )
    let dataModel = DataModel(
      initial: .object([
        "activeItems": .array([
          .object(["title": .string("Write tests")])
        ]),
        "completedItems": .array([
          .object(["title": .string("Review PR")])
        ]),
      ])
    )
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: dataModel
    )

    let root = try #require(resolver.resolveTree())
    let lists = root.children(for: "children")
    #expect(lists.count == 2)
    let activeItem0 = try #require(lists[0].children(for: "children").first)
    let completedItem0 = try #require(lists[1].children(for: "children").first)

    #expect(activeItem0.id == "itemCard_0")
    #expect(completedItem0.id == "itemCard_0")
    #expect(activeItem0.box !== completedItem0.box)
    #expect(activeItem0.string(for: "text") == "Write tests")
    #expect(completedItem0.string(for: "text") == "Review PR")

    // Updating /activeItems/0/title only re-resolves activeItem0 and leaves completedItem0 untouched.
    dataModel.set("/activeItems/0/title", value: .string("Ship fix"))
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 1)
    #expect(activeItem0.string(for: "text") == "Ship fix")
    #expect(activeItem0.box.revision == 1)
    #expect(completedItem0.string(for: "text") == "Review PR")
    #expect(completedItem0.box.revision == 0)
  }

  @Test func redundantSlashesInBindingPathReceiveIncrementalUpdates() throws {
    let catalog = try makeCatalog()
    let componentsModel = SurfaceComponentsModel(
      components: [
        "root": ComponentModel(
          id: "root",
          type: "Text",
          properties: ["text": .object(["path": .string("//user/name/")])]
        )
      ]
    )
    let dataModel = DataModel(
      initial: .object([
        "user": .object(["name": .string("Alice")])
      ])
    )
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: dataModel
    )

    let root = try #require(resolver.resolveTree())
    #expect(root.string(for: "text") == "Alice")

    dataModel.set("/user/name", value: .string("Bob"))
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 1)
    #expect(root.string(for: "text") == "Bob")
  }

  @Test func actionUserMessagePathDoesNotTriggerButtonReResolutionOnDataChange() throws {
    let buttonSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "type": "string" },
            "action": {
              "$ref": "https://a2ui.org/schemas/v1_0/common_types.json#/$defs/Action"
            }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let catalog = Catalog(
      id: "cat-v10",
      protocolVersion: .v10,
      components: [AnyComponentAPI(name: "Button", schema: buttonSchema)]
    ).eraseToAnyCatalog()

    let handler = ExpressionErrorCaptureHandler()
    let componentsModel = SurfaceComponentsModel(
      components: [
        "root": ComponentModel(
          id: "root",
          type: "Button",
          properties: [
            "action": .object([
              "event": .object([
                "name": .string("send"),
                "userMessage": .object(["@path": .string("/draft")]),
              ])
            ])
          ]
        )
      ]
    )
    let dataModel = DataModel(initial: .object(["draft": .string("Initial draft")]))
    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: dataModel,
      actionHandler: handler,
      protocolVersion: .v10
    )

    let root = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 1)
    #expect(root.box.revision == 0)

    // Updating /draft should not re-resolve the Button node or bump its revision.
    dataModel.set("/draft", value: .string("Updated draft"))
    _ = try #require(resolver.resolveTree())
    #expect(resolver.lastResolvedNodeCount == 0)
    #expect(root.box.revision == 0)

    // Triggering the action evaluates userMessage against the latest data model state.
    let action = try #require(root.action(for: "action"))
    action()
    #expect(handler.capturedActions.count == 1)
    #expect(
      handler.capturedActions.first?.identity
        == .event(name: "send", context: [:], userMessage: "Updated draft")
    )
  }
}

private final class ExpressionErrorCaptureHandler: ActionHandling, @unchecked Sendable {
  var capturedActions: [ResolvedAction] = []
  var capturedErrors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {
    capturedActions.append(action)
  }

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
