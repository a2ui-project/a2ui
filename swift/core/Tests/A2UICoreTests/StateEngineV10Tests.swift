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
            "@call": .string("@index"),
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
    #expect(resolver.isV10 == true)

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
              "condition": .object(["@path": .string("/formValidation")]),
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
    #expect(resolver.isV10 == true)

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
        ],
        version: .v10
      )
    )

    processor.process(message: createMsg)
    #expect(processor.surfaceGroupModel["s1"] == nil)
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

  @Test func nodeResolverResolvesV10FunctionCallActionsAndCheckPaths() throws {
    let buttonSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "action": {
              "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Action"
            },
            "checks": {
              "type": "array",
              "items": {
                "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/CheckRule"
              }
            }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let catalog = Catalog(
      id: "test_v10",
      protocolVersion: "v1.0",
      components: [AnyComponentAPI(name: "Button", schema: buttonSchema)]
    ).eraseToAnyCatalog()

    let dataModel = DataModel(initial: ["isValid": true])
    let componentsModel = SurfaceComponentsModel()
    componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Button",
        properties: [
          "action": .object([
            "functionCall": .object([
              "@call": .string("openUrl"),
              "args": .object(["url": .string("https://a2ui.org")]),
            ])
          ]),
          "checks": .array([
            .object([
              "condition": .object(["@path": .string("/isValid")]),
              "message": .string("Must be valid"),
            ])
          ]),
        ]
      )
    )

    let resolver = NodeResolver(
      surfaceID: "s1",
      catalogs: [catalog],
      componentsModel: componentsModel,
      dataModel: dataModel,
      protocolVersion: "1.0"
    )

    let rootNode = try #require(resolver.resolveTree())
    #expect(rootNode.isValid == true)
    let action = try #require(rootNode.action(for: "action"))
    if case .function(let call, let args) = action.identity {
      #expect(call == "openUrl")
      #expect(args?["url"]?.stringValue == "https://a2ui.org")
    } else {
      Issue.record("Expected function action identity")
    }
  }

  @Test func adapterValidatesAtPathAndAtCallAndSkipsRawDataModelPayloads() throws {
    let v10Adapter = V10VersionAdapter()
    let v09Adapter = V09VersionAdapter()

    // 1. Invalid @path in v1.0 components should throw A2UIValidationError
    let invalidAtPathMsg: JSONValue = .object([
      "version": .string("v1.0"),
      "updateComponents": .object([
        "surfaceId": .string("s1"),
        "components": .array([
          .object([
            "id": .string("root"),
            "component": .string("Text"),
            "text": .object(["@path": .string("/invalid/escape/~2")]),
          ])
        ]),
      ]),
    ])
    #expect(throws: A2UIValidationError.self) {
      _ = try v10Adapter.extractOperations(from: invalidAtPathMsg)
    }

    // 2. Invalid @call identifier in v1.0 components should throw A2UIValidationError
    let invalidAtCallMsg: JSONValue = .object([
      "version": .string("v1.0"),
      "updateComponents": .object([
        "surfaceId": .string("s1"),
        "components": .array([
          .object([
            "id": .string("root"),
            "component": .string("Text"),
            "text": .object(["@call": .string("911")]),
          ])
        ]),
      ]),
    ])
    #expect(throws: A2UIValidationError.self) {
      _ = try v10Adapter.extractOperations(from: invalidAtCallMsg)
    }

    // 3. Excessive @call nesting depth (> 5) in v1.0 components should throw A2UIRecursionError
    let deepAtCallMsg: JSONValue = .object([
      "version": .string("v1.0"),
      "updateComponents": .object([
        "surfaceId": .string("s1"),
        "components": .array([
          .object([
            "id": .string("root"),
            "component": .string("Text"),
            "text": .object([
              "@call": .string("f1"),
              "args": .object([
                "v": .object([
                  "@call": .string("f2"),
                  "args": .object([
                    "v": .object([
                      "@call": .string("f3"),
                      "args": .object([
                        "v": .object([
                          "@call": .string("f4"),
                          "args": .object([
                            "v": .object([
                              "@call": .string("f5"),
                              "args": .object([
                                "v": .object([
                                  "@call": .string("f6"),
                                  "args": .object([:]),
                                ])
                              ]),
                            ])
                          ]),
                        ])
                      ]),
                    ])
                  ]),
                ])
              ]),
            ]),
          ])
        ]),
      ]),
    ])
    #expect(throws: A2UIRecursionError.self) {
      _ = try v10Adapter.extractOperations(from: deepAtCallMsg)
    }

    // 4. Raw user data with "path"/"@path"/"call"/"@call" in createSurface.dataModel
    //    and updateDataModel.value must NOT be rejected in either v0.9 or v1.0.
    let rawUserData: JSONValue = .object([
      "file": .object([
        "path": .string("/invalid/escape/~2"),
        "@path": .string("/invalid/escape/~2"),
      ]),
      "emergency": .object([
        "call": .string("911"),
        "@call": .string("911"),
      ]),
    ])

    let v10CreateWithUserData: JSONValue = .object([
      "version": .string("v1.0"),
      "createSurface": .object([
        "surfaceId": .string("s1"),
        "catalogId": .string("https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"),
        "dataModel": rawUserData,
      ]),
    ])
    let v10CreateOps = try v10Adapter.extractOperations(from: v10CreateWithUserData)
    #expect(v10CreateOps.count == 1)

    let v10UpdateDataWithUserData: JSONValue = .object([
      "version": .string("v1.0"),
      "updateDataModel": .object([
        "surfaceId": .string("s1"),
        "path": .string("/"),
        "value": rawUserData,
      ]),
    ])
    let v10UpdateDataOps = try v10Adapter.extractOperations(from: v10UpdateDataWithUserData)
    #expect(v10UpdateDataOps.count == 1)

    let v09UpdateDataWithUserData: JSONValue = .object([
      "version": .string("v0.9"),
      "updateDataModel": .object([
        "surfaceId": .string("s1"),
        "path": .string("/"),
        "value": rawUserData,
      ]),
    ])
    let v09UpdateDataOps = try v09Adapter.extractOperations(from: v09UpdateDataWithUserData)
    #expect(v09UpdateDataOps.count == 1)
  }
}

private final class DummyFunctionHandler: FunctionHandler {
  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    nil
  }
}
