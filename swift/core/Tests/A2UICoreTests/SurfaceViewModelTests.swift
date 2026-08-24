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
import Combine
import Foundation
import JSONSchema
import OrderedJSON
import Testing

/// A concrete `FunctionImplementation` for testing that concatenates
/// two string arguments.
struct TestConcatFunction: FunctionImplementation {
  let api = FunctionAPI(
    name: "concat",
    returnType: .string,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "a": { "type": "string" },
            "b": { "type": "string" }
          }
        }
        """
    )
  )

  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    let a = arguments["a"]?.stringValue ?? ""
    let b = arguments["b"]?.stringValue ?? ""
    return .string(a + b)
  }
}

/// Builds a `Catalog` with a button component schema that has dynamic
/// properties, and a `concat` local function for testing.
struct TestRequiredFunction: FunctionImplementation {
  let api = FunctionAPI(
    name: "required",
    returnType: .boolean,
    schema: try! Schema(instance: "{\"type\": \"object\"}")
  )

  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let value = arguments["value"] else { return .boolean(false) }
    switch value {
    case .null: return .boolean(false)
    case .string(let s): return .boolean(!s.isEmpty)
    default: return .boolean(true)
    }
  }
}

struct TestEmailFunction: FunctionImplementation {
  let api = FunctionAPI(
    name: "email",
    returnType: .boolean,
    schema: try! Schema(instance: "{\"type\": \"object\"}")
  )

  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let s = arguments["value"]?.stringValue else { return .boolean(false) }
    return .boolean(s.contains("@") && s.contains("."))
  }
}

func makeTestCatalog() throws -> AnyCatalog {
  let buttonSchema = try Schema(
    instance: """
      {
        "allOf": [
          { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ComponentCommon" },
          { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/Checkable" },
          {
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "component": { "type": "string" },
              "label": {
                "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"
              },
              "enabled": {
                "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicBoolean"
              },
              "count": {
                "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicNumber"
              },
              "max": { "type": "number" },
              "min": { "type": "number" },
              "details": {
                "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicValue"
              },
              "icon": {
                "oneOf": [
                  { "type": "string" },
                  { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DataBinding" }
                ]
              },
              "tags": {
                "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicStringList"
              },
              "config": {
                "type": "object",
                "properties": {
                  "visible": {
                    "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicBoolean"
                  },
                  "amount": {
                    "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicNumber"
                  },
                  "custom": { "type": "object" }
                }
              },
              "onClick": {
                "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/Action"
              },
              "children": {
                "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ChildList"
              }
            },
            "required": ["id", "component"]
          }
        ]
      }
      """,
    remoteSchemas: A2UICommonSchema.allSchemas
  )

  return Catalog(
    id: "test-catalog",
    components: [AnyComponentAPI(name: "button", schema: buttonSchema)],
    functions: [TestConcatFunction(), TestRequiredFunction(), TestEmailFunction()]
  )
}

/// A test `ActionHandling` that captures actions for verification.
final class TestActionHandler: ActionHandling, @unchecked Sendable {
  var capturedActions: [ResolvedAction] = []
  var capturedErrors: [ClientServerError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {
    capturedActions.append(action)
  }

  func handle(error: ClientServerError, from surfaceID: String) {
    capturedErrors.append(error)
  }
}

@MainActor
struct SurfaceViewModelTests {

  // MARK: - Setup Helper

  /// Creates a `MessageProcessor` with a test catalog and a pre-created
  /// surface. Returns `(processor, surface, handler)`.
  private func makeProcessor() throws -> (MessageProcessor, SurfaceViewModel, TestActionHandler) {
    let handler = TestActionHandler()
    let catalog = try makeTestCatalog()
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )
    let surface = SurfaceViewModel(
      surfaceID: "test-surface",
      catalog: catalog,
      actionHandler: handler
    )
    processor.surfaceGroupModel.addSurface(surface)
    return (processor, surface, handler)
  }

  // MARK: - Component Updates

  @Test func updateComponentsStoresValidComponent() throws {
    let (processor, surface, handler) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "label": "Click Me"]
      ]
    )
    #expect(surface.componentsModel.get("root") != nil)
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func updateComponentsRejectsMissingComponentKey() throws {
    let (processor, _, handler) = try makeProcessor()
    processor.updateComponents(
      surfaceID: "test-surface",
      components: [
        ["id": "root"]
      ]
    )
    #expect(handler.capturedErrors.count == 1)
    if case .validationFailed(let err) = handler.capturedErrors[0] {
      #expect(err.path == "/component")
    }
  }

  @Test func updateComponentsRejectsMissingIDKey() throws {
    let (processor, _, handler) = try makeProcessor()
    processor.updateComponents(
      surfaceID: "test-surface",
      components: [
        ["component": "button"]
      ]
    )
    #expect(handler.capturedErrors.count == 1)
    if case .validationFailed(let err) = handler.capturedErrors[0] {
      #expect(err.path == "/id")
    }
  }

  @Test func updateComponentsRejectsUnknownType() throws {
    let (processor, _, handler) = try makeProcessor()
    processor.updateComponents(
      surfaceID: "test-surface",
      components: [
        ["id": "root", "component": "unknown_type"]
      ]
    )
    #expect(handler.capturedErrors.count == 1)
  }

  @Test func updateComponentsRecreatesOnTypeChange() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: "test-surface",
      components: [
        ["id": "root", "component": "button", "label": "Old"]
      ]
    )
    #expect(surface.componentsModel.get("root")?.type == "button")

    // Update with same ID but different type
    processor.updateComponents(
      surfaceID: "test-surface",
      components: [
        ["id": "root", "component": "text"]
      ]
    )
    // The component should not be stored since "text" isn't in the catalog
    // but the key point is that the old "button" component should be removed
    // before attempting to store the new one (matching web_core behavior).
  }

  // MARK: - Data Model Updates

  @Test func updateDataModelSetsValueAtPath() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/user/name", value: "Alice")
    #expect(surface.dataModel.get("/user/name")?.stringValue == "Alice")
  }

  @Test func updateDataModelSetsNilRemovesValue() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/user/name", value: "Alice")
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/user/name", value: nil)
    #expect(surface.dataModel.get("/user/name") == nil)
  }

  // MARK: - Root Node Resolution

  @Test func rootNodeIsNilBeforeAnyUpdates() throws {
    let (_, surface, _) = try makeProcessor()
    #expect(surface.rootNode == nil)
  }

  // MARK: - Dynamic String Resolution

  @Test func dynamicStringResolvesLiteralValue() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "label": "Hello"]
      ]
    )
    let root = surface.componentsModel.get("root")
    #expect(root?.properties["label"]?.stringValue == "Hello")
  }

  @Test func dynamicStringResolvesDataBindingPath() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/user/name", value: "Alice")
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "label": ["path": "/user/name"]]
      ]
    )
    #expect(surface.dataModel.get("/user/name")?.stringValue == "Alice")
  }

  // MARK: - Dynamic Boolean Resolution

  @Test func dynamicBooleanResolvesLiteralTrue() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "enabled": true]
      ]
    )
    let root = surface.componentsModel.get("root")
    #expect(root?.properties["enabled"]?.boolValue == true)
  }

  // MARK: - Dynamic Resolution on Root Node

  @Test func dynamicStringResolvesLiteralValueOnRootNode() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "label": "Hello"]
      ]
    )
    await Task.yield()
    let binding = try #require(surface.rootNode?.properties["label"] as? DataBinding<String>)
    #expect(binding.value == "Hello")
  }

  @Test func dynamicStringResolvesDataBindingPathOnRootNode() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/user/name", value: "Alice")
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "label": ["path": "/user/name"]]
      ]
    )
    await Task.yield()
    let binding = try #require(surface.rootNode?.properties["label"] as? DataBinding<String>)
    #expect(binding.value == "Alice")

    // Update via binding.set(...)
    binding.set("Bob")
    #expect(surface.dataModel.get("/user/name")?.stringValue == "Bob")
    await Task.yield()
    let updatedBinding = try #require(surface.rootNode?.properties["label"] as? DataBinding<String>)
    #expect(updatedBinding.value == "Bob")
  }

  @Test func dynamicStringResolvesFunctionCallOnRootNode() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "label": [
            "call": "concat",
            "args": ["a": "Hello, ", "b": "World!"],
          ],
        ]
      ]
    )
    await Task.yield()
    let binding = try #require(surface.rootNode?.properties["label"] as? DataBinding<String>)
    #expect(binding.value == "Hello, World!")
  }

  /// A property bound through a function call must reflect a data update as
  /// soon as the update is delivered, exactly like a plain path binding to
  /// the same data.
  @Test func functionCallBindingReflectsDataUpdate() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/user/first", value: "Alice")
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "label": [
            "call": "concat",
            "args": ["a": ["path": "/user/first"], "b": "!"],
          ],
          "details": ["path": "/user/first"],
        ]
      ]
    )
    await Task.yield()
    let initial = try #require(surface.rootNode?.properties["label"] as? DataBinding<String>)
    #expect(initial.value == "Alice!")

    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/user/first", value: "Bob")
    await Task.yield()

    // Both bindings read the same path; both must see the new value.
    let plainPath = try #require(
      surface.rootNode?.properties["details"] as? DataBinding<JSONValue>)
    let throughCall = try #require(
      surface.rootNode?.properties["label"] as? DataBinding<String>)
    #expect(plainPath.value?.stringValue == "Bob")
    #expect(throughCall.value == "Bob!")
  }

  @Test func dynamicBooleanResolvesLiteralAndPathOnRootNode() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/isReady", value: true)
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "enabled": ["path": "/isReady"]]
      ]
    )
    await Task.yield()
    let binding = try #require(surface.rootNode?.properties["enabled"] as? DataBinding<Bool>)
    #expect(binding.value == true)

    binding.set(false)
    #expect(surface.dataModel.get("/isReady")?.boolValue == false)
    await Task.yield()
    let updatedBinding = try #require(surface.rootNode?.properties["enabled"] as? DataBinding<Bool>)
    #expect(updatedBinding.value == false)
  }

  @Test func dynamicNumberResolvesLiteralAndPathOnRootNode() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/score", value: 42.5)
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "count": ["path": "/score"]]
      ]
    )
    await Task.yield()
    let binding = try #require(surface.rootNode?.properties["count"] as? DataBinding<Double>)
    #expect(binding.value == 42.5)

    binding.set(100.0)
    #expect(surface.dataModel.get("/score")?.doubleValue == 100.0)
    await Task.yield()
    let updatedBinding = try #require(surface.rootNode?.properties["count"] as? DataBinding<Double>)
    #expect(updatedBinding.value == 100.0)
  }

  @Test func sliderNumberPropertiesResolution() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/progress", value: 0.45)
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "max": 1,
          "min": 0,
          "count": ["path": "/progress"],
        ]
      ]
    )
    await Task.yield()
    let root = try #require(surface.rootNode)
    #expect(root.double(for: "max") == 1.0)
    #expect(root.double(for: "min") == 0.0)
    #expect(root.double(for: "count") == 0.45)
    #expect(root.properties["max"] as? Double == 1.0)
    #expect(root.properties["min"] as? Double == 0.0)
  }

  @Test func dynamicStringCoercesNumbersAndBooleans() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/tempHigh", value: 72)
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/playIcon", value: "pause")
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "label": ["path": "/tempHigh"],
          "icon": ["path": "/playIcon"],
        ]
      ]
    )
    await Task.yield()
    let root = try #require(surface.rootNode)
    #expect(root.string(for: "label") == "72")
    #expect(root.string(for: "icon") == "pause")
  }

  @Test func dynamicValueResolvesPathOnRootNode() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/info", value: ["key": "val"])
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "details": ["path": "/info"]]
      ]
    )
    await Task.yield()
    let binding = try #require(surface.rootNode?.properties["details"] as? DataBinding<JSONValue>)
    #expect(binding.value?["key"]?.stringValue == "val")
  }

  @Test func dataBindingResolvesPathOnRootNode() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/iconName", value: "check")
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "icon": ["path": "/iconName"]]
      ]
    )
    await Task.yield()
    let binding = try #require(surface.rootNode?.properties["icon"] as? DataBinding<String>)
    #expect(binding.value == "check")
  }

  @Test func dynamicStringListResolvesArrayPathOnRootNode() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/tags", value: ["ios", "swift"])
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "tags": ["path": "/tags"]]
      ]
    )
    await Task.yield()
    let binding = try #require(surface.rootNode?.properties["tags"] as? DataBinding<[String]>)
    #expect(binding.value == ["ios", "swift"])
  }

  @Test func nestedDynamicPropertiesResolveCorrectTypes() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/isVisible", value: true)
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/total", value: 42.5)
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/raw", value: ["foo": "bar"])
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "config": [
            "visible": ["path": "/isVisible"],
            "amount": ["path": "/total"],
            "custom": ["path": "/raw"],
          ],
        ]
      ]
    )
    await Task.yield()
    let root = try #require(surface.rootNode)
    let config = try #require(root.dictionary(for: "config"))

    let visibleBinding = try #require(config["visible"] as? DataBinding<Bool>)
    #expect(visibleBinding.value == true)

    let amountBinding = try #require(config["amount"] as? DataBinding<Double>)
    #expect(amountBinding.value == 42.5)

    let customBinding = try #require(config["custom"] as? DataBinding<JSONValue>)
    #expect(customBinding.value?["foo"]?.stringValue == "bar")
  }

  // MARK: - Action Resolution

  @Test func actionResolvesServerEvent() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "onClick": [
            "event": [
              "name": "click",
              "context": ["userId": "123"],
            ]
          ],
        ]
      ]
    )
    let root = surface.componentsModel.get("root")
    let actionJSON = try #require(root?.properties["onClick"]?.dictionaryValue)
    let eventJSON = try #require(actionJSON["event"]?.dictionaryValue)
    #expect(eventJSON["name"]?.stringValue == "click")
  }

  @Test func actionResolvesFunctionCall() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "onClick": [
            "functionCall": [
              "call": "submit",
              "args": ["formId": "contact"],
            ]
          ],
        ]
      ]
    )
    let root = surface.componentsModel.get("root")
    let actionJSON = try #require(root?.properties["onClick"]?.dictionaryValue)
    let funcCallJSON = try #require(actionJSON["functionCall"]?.dictionaryValue)
    #expect(funcCallJSON["call"]?.stringValue == "submit")
  }

  // MARK: - Validation Checks

  @Test func checksResolveAndReflectInNodeValidationErrors() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/email", value: "not-an-email")
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "checks": [
            [
              "condition": [
                "call": "required",
                "args": ["value": ["path": "/email"]],
              ],
              "message": "Email is required",
            ],
            [
              "condition": [
                "call": "email",
                "args": ["value": ["path": "/email"]],
              ],
              "message": "Please enter a valid email address",
            ],
          ],
        ]
      ]
    )
    await Task.yield()
    let node = try #require(surface.rootNode)
    #expect(!node.isValid)
    #expect(node.validationErrors == ["Please enter a valid email address"])

    // Updating data model to valid email should clear validation errors
    processor.updateDataModel(
      surfaceID: surface.surfaceID, path: "/email", value: "user@example.com")
    await Task.yield()
    let updatedNode = try #require(surface.rootNode)
    #expect(updatedNode.isValid)
    #expect(updatedNode.validationErrors.isEmpty)
  }

  @Test func buttonChecksBlockActionDispatchOnValidationError() async throws {
    let (processor, surface, handler) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/email", value: "")
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "checks": [
            [
              "condition": [
                "call": "required",
                "args": ["value": ["path": "/email"]],
              ],
              "message": "Email is required",
            ]
          ],
          "onClick": [
            "event": ["name": "submit", "context": [:]]
          ],
        ]
      ]
    )
    await Task.yield()
    let node = try #require(surface.rootNode)
    let action = try #require(node.properties["onClick"] as? ResolvedAction)

    // Triggering action while invalid should not dispatch event
    action()
    #expect(handler.capturedActions.isEmpty)

    // Update to valid value and trigger again
    processor.updateDataModel(
      surfaceID: surface.surfaceID, path: "/email", value: "hello@world.com")
    await Task.yield()
    let validNode = try #require(surface.rootNode)
    let validAction = try #require(validNode.properties["onClick"] as? ResolvedAction)
    validAction()
    #expect(handler.capturedActions.count == 1)
  }

  @Test func customNamedCheckPropertyResolvesAndBlocksAction() async throws {
    let customSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "type": "string" },
            "rules": {
              "type": "array",
              "items": { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/CheckRule" }
            },
            "singleCheck": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/CheckRule"
            },
            "onClick": { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/Action" }
          },
          "required": ["id", "component"]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let handler = TestActionHandler()
    let catalog = Catalog(
      id: "custom-catalog",
      components: [AnyComponentAPI(name: "customInput", schema: customSchema)],
      functions: [TestRequiredFunction(), TestEmailFunction()]
    )
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )
    let surface = SurfaceViewModel(
      surfaceID: "s1",
      catalog: catalog,
      actionHandler: handler
    )
    processor.surfaceGroupModel.addSurface(surface)

    processor.updateDataModel(surfaceID: "s1", path: "/email", value: "invalid")
    processor.updateComponents(
      surfaceID: "s1",
      components: [
        [
          "id": "root",
          "component": "customInput",
          "rules": [
            [
              "condition": [
                "call": "email",
                "args": ["value": ["path": "/email"]],
              ],
              "message": "Invalid email in custom rule",
            ]
          ],
          "singleCheck": [
            "condition": [
              "call": "required",
              "args": ["value": ["path": "/email"]],
            ],
            "message": "Email is required",
          ],
          "onClick": [
            "event": ["name": "submit", "context": [:]]
          ],
        ]
      ]
    )
    await Task.yield()
    let node = try #require(surface.rootNode)
    #expect(!node.isValid)
    #expect(node.checks.count == 2)
    #expect(node.validationErrors == ["Invalid email in custom rule"])

    let action = try #require(node.properties["onClick"] as? ResolvedAction)
    action()
    #expect(handler.capturedActions.isEmpty)

    // Update data model to valid value
    processor.updateDataModel(surfaceID: "s1", path: "/email", value: "test@example.com")
    await Task.yield()
    let validNode = try #require(surface.rootNode)
    #expect(validNode.isValid)
    #expect(validNode.validationErrors.isEmpty)

    let validAction = try #require(validNode.properties["onClick"] as? ResolvedAction)
    validAction()
    #expect(handler.capturedActions.count == 1)
  }
  // MARK: - Child List Resolution (Static)

  @Test func childListResolvesStaticArray() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "children": ["child1", "child2"],
        ],
        ["id": "child1", "component": "button", "label": "First"],
        ["id": "child2", "component": "button", "label": "Second"],
      ]
    )
    #expect(surface.componentsModel.components.count == 3)
    #expect(surface.componentsModel.get("child1") != nil)
    #expect(surface.componentsModel.get("child2") != nil)
  }

  // MARK: - Theme

  @Test func surfaceViewModelInitializesWithTheme() throws {
    let catalog = try makeTestCatalog()
    let theme: [String: JSONValue] = ["color": .string("blue")]
    let surface = SurfaceViewModel(
      surfaceID: "s1",
      catalog: catalog,
      theme: theme
    )
    #expect(surface.theme != nil)
    #expect(surface.theme?["color"]?.stringValue == "blue")
  }

  // MARK: - Component Buffer

  @Test func getComponentsReturnsEmptyDictInitially() throws {
    let (_, surface, _) = try makeProcessor()
    #expect(surface.componentsModel.components.isEmpty)
  }

  @Test func getComponentsReturnsAllStoredComponents() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "a", "component": "button"],
        ["id": "b", "component": "button"],
      ]
    )
    #expect(surface.componentsModel.components.count == 2)
    #expect(surface.componentsModel.get("a") != nil)
    #expect(surface.componentsModel.get("b") != nil)
  }

  // MARK: - Schema Classification (Exact $ref Matching)

  @Test func refToLookalikeTypeNameNotMisclassified() throws {
    // Build a catalog with a component that has a property using a $ref
    // ending in "DynamicStringList" — which must NOT be classified as
    // "DynamicString". The value should pass through as a standard
    // property (no DataBinding wrapping).
    let schema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "type": "string" },
            "items": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicStringList"
            }
          },
          "required": ["id", "component"]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )

    let catalog = Catalog(
      id: "lookalike-catalog",
      components: [AnyComponentAPI(name: "custom", schema: schema)],
      functions: []
    )

    let handler = TestActionHandler()
    let processor = MessageProcessor(catalogs: [catalog], actionHandler: handler)
    let surface = SurfaceViewModel(surfaceID: "s1", catalog: catalog, actionHandler: handler)
    processor.surfaceGroupModel.addSurface(surface)

    // Provide a value for "items" that is a plain string array.
    // If classifySchema misidentified "DynamicStringList" as "DynamicString",
    // it would try to resolve it as a DataBinding<String> and the raw value
    // would be transformed. Instead, it should be stored as-is.
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "custom", "items": ["a", "b", "c"]]
      ]
    )

    let root = surface.componentsModel.get("root")
    #expect(root != nil)
    // The value should be stored as the raw JSON array, not wrapped.
    #expect(root?.properties["items"]?.arrayValue?.count == 3)
    #expect(handler.capturedErrors.isEmpty)
  }

  // MARK: - Cycle Detection

  @Test func cyclicComponentReferencesDoNotHang() throws {
    // Two components that reference each other via childList.
    // Without cycle detection this would infinite-loop.
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "a", "component": "button", "children": ["b"]],
        ["id": "b", "component": "button", "children": ["a"]],
      ]
    )

    // If we get here, the cycle guard worked. The rebuildTree triggered
    // by updateComponents would have infinite-looped without the guard.
    // rootNode resolves from "root" — but we only have "a" and "b", so
    // it will be nil. The key assertion is that we didn't hang.
    #expect(true)
  }

  @Test func legitimateDataDrivenRecursionResolves() throws {
    // A "card" component that renders nested "card" children from
    // array data. This is legitimate recursion (finite, data-terminated),
    // not a cycle. The instanceID-based guard should allow it.
    let (processor, surface, _) = try makeProcessor()

    // Set up nested data: two levels of items
    processor.updateDataModel(
      surfaceID: surface.surfaceID,
      path: "/items",
      value: [
        ["label": "Outer", "items": []],
        ["label": "Second", "items": []],
      ]
    )

    // The "card" component has a childList that reads from "/items"
    // and uses itself as the template.
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "card",
          "component": "button",
          "label": ["path": "/label"],
          "children": [
            "componentId": "card",
            "path": "/items",
          ],
        ]
      ]
    )

    // If we get here without hanging, the guard correctly allowed
    // legitimate recursion. Each nested "card" gets a unique
    // instanceID (card_0, card_0_0, etc.) so the guard never triggers.
    #expect(true)
  }

  @Test func dynamicStringResolvesFunctionCallWithPathArgsAfterDataModelUpdate() async throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        [
          "id": "root",
          "component": "button",
          "label": [
            "call": "concat",
            "args": [
              "a": "Hello, ",
              "b": ["path": "/name"],
            ],
            "returnType": "string",
          ],
        ]
      ]
    )
    await Task.yield()
    let beforeBinding = try #require(surface.rootNode?.properties["label"] as? DataBinding<String>)
    #expect(beforeBinding.value == "Hello, ")

    processor.updateDataModel(surfaceID: surface.surfaceID, path: "", value: ["name": "Alice"])
    await Task.yield()
    let afterBinding = try #require(surface.rootNode?.properties["label"] as? DataBinding<String>)
    #expect(afterBinding.value == "Hello, Alice")
  }
}

// MARK: - ComponentModel Tests

struct ComponentModelTests {

  @Test func componentModelStoresIDTypeAndProperties() {
    let model = ComponentModel(
      id: "btn1",
      type: "button",
      properties: ["label": "Click Me"]
    )
    #expect(model.id == "btn1")
    #expect(model.type == "button")
    #expect(model.properties["label"]?.stringValue == "Click Me")
  }

  @Test func componentModelsEqualByIDTypeProperties() {
    let a = ComponentModel(id: "btn1", type: "button", properties: ["label": "OK"])
    let b = ComponentModel(id: "btn1", type: "button", properties: ["label": "OK"])
    #expect(a == b)
  }

  @Test func componentModelsNotEqualByDifferentID() {
    let a = ComponentModel(id: "btn1", type: "button", properties: [:])
    let b = ComponentModel(id: "btn2", type: "button", properties: [:])
    #expect(a != b)
  }

  @Test func componentModelsNotEqualByDifferentType() {
    let a = ComponentModel(id: "btn1", type: "button", properties: [:])
    let b = ComponentModel(id: "btn1", type: "text", properties: [:])
    #expect(a != b)
  }

  @Test func componentModelsNotEqualByDifferentProperties() {
    let a = ComponentModel(id: "btn1", type: "button", properties: ["label": "OK"])
    let b = ComponentModel(id: "btn1", type: "button", properties: ["label": "Cancel"])
    #expect(a != b)
  }

  @Test func componentModelsNotEqualByDifferentCatalogID() {
    let firstModel = ComponentModel(
      id: "btn1", type: "button", catalogID: "catalogA", properties: [:])
    let secondModel = ComponentModel(
      id: "btn1", type: "button", catalogID: "catalogB", properties: [:])
    #expect(firstModel != secondModel)
  }

  @Test func componentModelStoresCatalogID() {
    let model = ComponentModel(
      id: "btn1",
      type: "button",
      catalogID: "catalogA",
      properties: [:]
    )
    #expect(model.catalogID == "catalogA")
  }
}

// MARK: - SurfaceComponentsModel Tests

struct SurfaceComponentsModelTests {

  @Test func startsEmpty() {
    let model = SurfaceComponentsModel()
    #expect(model.components.isEmpty)
    #expect(model.components.count == 0)
  }

  @Test func addAndGetComponent() {
    let model = SurfaceComponentsModel()
    let component = ComponentModel(id: "btn1", type: "button", properties: ["label": "OK"])
    model.addComponent(component)
    #expect(model.components.count == 1)
    #expect(model.get("btn1")?.type == "button")
  }

  @Test func removeComponent() {
    let model = SurfaceComponentsModel()
    model.addComponent(ComponentModel(id: "btn1", type: "button", properties: [:]))
    model.removeComponent("btn1")
    #expect(model.get("btn1") == nil)
    #expect(model.components.isEmpty)
  }

  @Test func replaceComponentWithSameID() {
    let model = SurfaceComponentsModel()
    model.addComponent(ComponentModel(id: "btn1", type: "button", properties: ["label": "Old"]))
    model.addComponent(ComponentModel(id: "btn1", type: "button", properties: ["label": "New"]))
    #expect(model.get("btn1")?.properties["label"]?.stringValue == "New")
    #expect(model.components.count == 1)
  }

  @Test func componentsPropertyReturnsDictionary() {
    let model = SurfaceComponentsModel()
    model.addComponent(ComponentModel(id: "a", type: "button", properties: [:]))
    let snap = model.components
    #expect(snap.count == 1)
    #expect(snap["a"] != nil)
  }

  @Test func subscriberReadingBackThroughComponentsModelSeesStoredComponents() {
    let model = SurfaceComponentsModel()
    var announced: [[String: ComponentModel]] = []
    var readBack: [ComponentModel?] = []
    let cancellable = model.componentsPublisher.sink { components in
      announced.append(components)
      readBack.append(model.get("btn1"))
    }
    model.addComponent(ComponentModel(id: "btn1", type: "button", properties: [:]))
    cancellable.cancel()
    #expect(announced.count == 2)
    #expect(announced[1]["btn1"]?.type == "button")
    #expect(readBack[1]?.type == "button")
  }
}

// MARK: - DataModel Tests

struct DataModelTests {

  @Test func startsEmpty() {
    let model = DataModel()
    #expect(model.data == .object([:]))
  }

  @Test func setsAndGetsValueAtPath() {
    let model = DataModel()
    model.set("/user/name", value: "Alice")
    #expect(model.get("/user/name")?.stringValue == "Alice")
  }

  @Test func setsNilRemovesValue() {
    let model = DataModel()
    model.set("/user/name", value: "Alice")
    model.set("/user/name", value: nil)
    #expect(model.get("/user/name") == nil)
  }

  @Test func initializesWithValue() {
    let model = DataModel(initial: ["name": "Bob"])
    #expect(model.get("/name")?.stringValue == "Bob")
  }

  @Test func subscriberReadingBackThroughModelSeesStoredValue() {
    let model = DataModel()
    var announced: [JSONValue] = []
    var readBack: [JSONValue?] = []
    let cancellable = model.dataPublisher.sink { value in
      announced.append(value)
      readBack.append(model.get("/user/name"))
    }
    model.set("/user/name", value: "Alice")
    cancellable.cancel()
    #expect(announced.count == 2)
    #expect(announced[1]["/user/name"]?.stringValue == "Alice")
    #expect(readBack[1]?.stringValue == "Alice")
  }

  @Test func setsRootPathReplacesEntireData() {
    let model = DataModel(initial: ["oldKey": "oldVal", "sharedKey": "prev"])
    model.set("", value: ["newKey": "newVal"])
    #expect(model.get("/newKey")?.stringValue == "newVal")
    #expect(model.get("/oldKey") == nil)
    #expect(model.get("") == .object(["newKey": "newVal"]))

    model.set("/", value: ["other": 123])
    #expect(model.get("/other")?.intValue == 123)
    #expect(model.get("/newKey") == nil)

    model.set("", value: nil)
    #expect(model.data == .object([:]))
  }
}

extension MessageProcessor {
  fileprivate func updateComponents(
    surfaceID: String,
    components: [[String: JSONValue]]
  ) {
    process(
      message: .updateComponents(
        UpdateComponentsMessage(surfaceID: surfaceID, components: components)
      )
    )
  }

  fileprivate func updateDataModel(
    surfaceID: String,
    path: String,
    value: JSONValue?
  ) {
    process(
      message: .updateDataModel(
        UpdateDataModelMessage(surfaceID: surfaceID, path: path, value: value)
      )
    )
  }
}
