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
import OrderedCollections
import OrderedJSON
import Testing

@MainActor
struct StateEngineV10Tests {

  @Test func dataModelNullDeletion() {
    let dataModel = DataModel(initial: [
      "user": [
        "name": "Alice",
        "email": "alice@example.com",
      ],
      "items": ["first", "second", "third"],
    ])

    // Explicit .null deletes key
    dataModel.set("/user/email", value: .null)
    #expect(dataModel.get("/user/email") == nil)
    #expect(dataModel.get("/user/name")?.stringValue == "Alice")

    // Explicit .null on sparse array preserves count and sets .null
    dataModel.set("/items/1", value: .null)
    let items = dataModel.get("/items")?.arrayValue
    #expect(items?.count == 3)
    #expect(items?[0] == .string("first"))
    #expect(items?[1] == .null)
    #expect(items?[2] == .string("third"))

    // Explicit .null on root resets to empty object
    dataModel.set("/", value: .null)
    #expect(dataModel.get("/") == .object([:]))
  }

  @Test func indexSystemFunctionInTemplate() throws {
    let cardSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "children": {
              "$ref": "https://a2ui.org/schemas/v1_0/common_types.json#/$defs/ChildList"
            }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let textSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "text": {
              "$ref": "https://a2ui.org/schemas/v1_0/common_types.json#/$defs/DynamicString"
            }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let cardComp = AnyComponentAPI(name: "Card", schema: cardSchema)
    let textComp = AnyComponentAPI(name: "Text", schema: textSchema)
    let catalog = Catalog(
      id: "test",
      protocolVersion: "v1.0",
      components: [cardComp, textComp] as [AnyComponentAPI]
    )

    let componentsModel = SurfaceComponentsModel()
    let dataModel = DataModel(initial: [
      "tasks": [
        ["title": "Task A"],
        ["title": "Task B"],
        ["title": "Task C"],
      ]
    ])

    componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Card",
        properties: [
          "children": .object([
            "componentId": .string("task_item"),
            "path": .string("/tasks"),
          ])
        ]
      )
    )

    componentsModel.addComponent(
      ComponentModel(
        id: "task_item",
        type: "Text",
        properties: [
          "text": .object([
            "call": .string("@index"),
            "args": .object(["offset": .integer(1)]),
          ])
        ]
      )
    )

    let resolver = NodeResolver(
      surfaceID: "surf1",
      catalogs: [catalog.eraseToAnyCatalog()],
      componentsModel: componentsModel,
      dataModel: dataModel
    )

    let rootNode = try #require(resolver.resolveTree())
    let children = rootNode.children(for: "children")
    #expect(children.count == 3)
    #expect(children[0].string(for: "text") == "1")
    #expect(children[1].string(for: "text") == "2")
    #expect(children[2].string(for: "text") == "3")
  }

  @Test func indexSystemFunctionOutsideTemplateReturnsNull() {
    let context = DataContext(
      dataModel: DataModel(),
      path: "",
      functionHandler: DummyFunctionHandler()
    )
    let res = context.resolveDynamicValue(.object(["call": .string("@index")]))
    #expect(res == .null)

    // With catalogId should also return .null (disallowed for system functions)
    let resWithCatalog = context.resolveDynamicValue(
      .object([
        "call": .string("@index"),
        "catalogId": .string("basic"),
      ])
    )
    #expect(resWithCatalog == .null)
  }

  @Test func validationResultChecksResolution() throws {
    let buttonSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "checks": {
              "type": "array",
              "items": {
                "$ref": "https://a2ui.org/schemas/v1_0/common_types.json#/$defs/CheckRule"
              }
            }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let buttonComp = AnyComponentAPI(name: "Button", schema: buttonSchema)
    let catalog = Catalog(
      id: "test",
      protocolVersion: "v1.0",
      components: [buttonComp] as [AnyComponentAPI]
    )

    let dataModel = DataModel(initial: [
      "formValidation": [
        "valid": false,
        "code": "FIELD_REQUIRED",
        "message": "Username is required",
        "severity": "error",
      ]
    ])

    let componentsModel = SurfaceComponentsModel()
    componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Button",
        properties: [
          "checks": .array([
            .object([
              "condition": .object(["path": .string("/formValidation")]),
              "message": .string("Fallback message"),
            ])
          ])
        ]
      )
    )

    let resolver = NodeResolver(
      surfaceID: "surf1",
      catalogs: [catalog.eraseToAnyCatalog()],
      componentsModel: componentsModel,
      dataModel: dataModel
    )

    let rootNode = resolver.resolveTree()
    #expect(rootNode?.isValid == false)
    #expect(rootNode?.validationErrors == ["Username is required"])

    let check = rootNode?.checks.first
    #expect(check?.validationResult?.code == "FIELD_REQUIRED")
    #expect(check?.validationResult?.severity == .error)
  }

  @Test func compositionConstraintsValidation() throws {
    let dummySchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "child": {
              "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Child"
            }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let rootOnlyComp = AnyComponentAPI(
      name: "AppLayout",
      schema: dummySchema,
      allowedParents: ["Surface"],
      allowedChildren: ["Container", "Button"]
    )
    let containerComp = AnyComponentAPI(
      name: "Container",
      schema: dummySchema,
      allowedParents: ["AppLayout"],
      allowedChildren: ["Button"]
    )
    let buttonComp = AnyComponentAPI(
      name: "Button",
      schema: dummySchema,
      allowedParents: ["Container", "AppLayout"]
    )

    let catalog = Catalog(
      id: "test",
      protocolVersion: "v1.0",
      components: [rootOnlyComp, containerComp, buttonComp]
    ).eraseToAnyCatalog()

    let catalogs = [catalog.id: catalog]

    // Valid layout
    let validComponents: [[String: JSONValue]] = [
      ["id": "root", "component": "AppLayout", "child": "container1"],
      ["id": "container1", "component": "Container", "child": "btn1"],
      ["id": "btn1", "component": "Button"],
    ]

    try GraphTopologyValidator.validate(
      components: validComponents,
      rootID: "root",
      catalogs: catalogs
    )

    // Invalid: AppLayout has parent Container (AppLayout only allowed under Surface)
    let invalidParentComponents: [[String: JSONValue]] = [
      ["id": "root", "component": "Container", "child": "nested_layout"],
      ["id": "nested_layout", "component": "AppLayout"],
    ]

    #expect(throws: A2UIValidationError.self) {
      try GraphTopologyValidator.validate(
        components: invalidParentComponents,
        rootID: "root",
        catalogs: catalogs
      )
    }

    // Invalid: Container cannot have child AppLayout (Container only allows Button)
    let invalidChildComponents: [[String: JSONValue]] = [
      ["id": "root", "component": "AppLayout", "child": "container1"],
      ["id": "container1", "component": "Container", "child": "app_child"],
      ["id": "app_child", "component": "AppLayout"],
    ]

    #expect(throws: A2UIValidationError.self) {
      try GraphTopologyValidator.validate(
        components: invalidChildComponents,
        rootID: "root",
        catalogs: catalogs
      )
    }
  }

  @Test func modalV10SchemaReferenceExtractionAndChildResolution() throws {
    let modalSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "component": { "const": "Modal" },
            "trigger": {
              "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Child"
            },
            "content": {
              "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Child"
            }
          },
          "required": ["component", "trigger", "content"]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let textSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "component": { "const": "Text" },
            "text": {
              "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/DynamicString"
            }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )

    let catalog = Catalog(
      id: "v10_modal_cat",
      protocolVersion: "v1.0",
      components: [
        AnyComponentAPI(name: "Modal", schema: modalSchema),
        AnyComponentAPI(name: "Text", schema: textSchema),
      ],
      functions: [any FunctionImplementation]()
    ).eraseToAnyCatalog()

    let validModalTree: [[String: JSONValue]] = [
      ["id": "root", "component": "Modal", "trigger": "openBtn", "content": "bodyText"],
      ["id": "openBtn", "component": "Text", "text": "Open"],
      ["id": "bodyText", "component": "Text", "text": "Details"],
    ]

    try GraphTopologyValidator.validate(
      components: validModalTree,
      rootID: "root",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id
    )

    let componentsModel = SurfaceComponentsModel()
    componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Modal",
        catalogID: catalog.id,
        properties: ["trigger": "openBtn", "content": "bodyText"]
      )
    )
    componentsModel.addComponent(
      ComponentModel(
        id: "openBtn",
        type: "Text",
        catalogID: catalog.id,
        properties: ["text": "Open"]
      )
    )
    componentsModel.addComponent(
      ComponentModel(
        id: "bodyText",
        type: "Text",
        catalogID: catalog.id,
        properties: ["text": "Details"]
      )
    )

    let resolver = NodeResolver(
      surfaceID: "surf1",
      catalogs: [catalog],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: DataModel()
    )
    let rootNode = try #require(resolver.resolveTree())
    #expect((rootNode.properties["trigger"] as? Node)?.id == "openBtn")
    #expect((rootNode.properties["content"] as? Node)?.id == "bodyText")
  }

  @Test func duplicateComponentIDsInBatchRejectedByMessageProcessor() throws {
    let dummySchema = try Schema(
      rawSchema: .object(["type": .string("object")]),
      context: Context(dialect: .draft2020_12)
    )
    let catalog = Catalog(
      id: "test_cat",
      protocolVersion: "v1.0",
      components: [AnyComponentAPI(name: "Text", schema: dummySchema)],
      functions: [any FunctionImplementation]()
    ).eraseToAnyCatalog()

    let processor = MessageProcessor(catalogs: [catalog])
    let createMsg = AgentToRendererMessage.createSurface(
      CreateSurfaceMessage(
        surfaceID: "s1",
        catalogID: "test_cat",
        components: [
          ["id": "root", "component": "Text"],
          ["id": "root", "component": "Text"],
        ]
      )
    )

    processor.process(message: createMsg)
    #expect(processor.surface(id: "s1") == nil)
  }

  @Test func prototypePollutionKeysIgnoredAndEmptyArrayPadding() {
    let model = DataModel()
    model.set("/__proto__/polluted", value: .boolean(true))
    model.set("/constructor/polluted", value: .boolean(true))
    model.set("/prototype/polluted", value: .boolean(true))
    #expect(model.get("/__proto__/polluted") == nil)
    #expect(model.get("/constructor/polluted") == nil)
    #expect(model.get("/prototype/polluted") == nil)

    model.set("/items/3", value: .string("fourth"))
    let items = model.get("/items")?.arrayValue
    #expect(items?.count == 4)
    #expect(items?[0] == .null)
    #expect(items?[1] == .null)
    #expect(items?[2] == .null)
    #expect(items?[3] == .string("fourth"))
  }
}

private final class DummyFunctionHandler: FunctionHandler {
  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    nil
  }
}
