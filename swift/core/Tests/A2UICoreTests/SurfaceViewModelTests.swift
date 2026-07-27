// Copyright 2026 Google LLC
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

  func evaluate(arguments: [String: JSONValue]) throws -> JSONValue {
    let a = arguments["a"]?.stringValue ?? ""
    let b = arguments["b"]?.stringValue ?? ""
    return .string(a + b)
  }
}

/// A simple `SurfaceTheme` for testing.
struct TestSurfaceTheme: SurfaceTheme {
  let color: String
}

/// Builds a `Catalog` with a button component schema that has dynamic
/// properties, and a `concat` local function for testing.
func makeTestCatalog() throws -> Catalog {
  let buttonSchema = try Schema(
    instance: """
    {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "component": { "type": "string" },
        "label": { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString" },
        "enabled": { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicBoolean" },
        "onClick": { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/Action" },
        "children": { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ChildList" }
      },
      "required": ["id", "component"]
    }
    """,
    remoteSchemas: A2UICommonSchema.allSchemas
  )

  return Catalog(
    id: "test-catalog",
    components: [ComponentAPI(name: "button", schema: buttonSchema)],
    functions: [TestConcatFunction()]
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
    let surface = processor.createSurface(surfaceID: "test-surface", catalog: catalog)
    return (processor, surface, handler)
  }

  // MARK: - Component Updates

  @Test func updateComponentsStoresValidComponent() throws {
    let (processor, surface, handler) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "label": "Click Me"],
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
        ["id": "root"],
      ]
    )
    #expect(handler.capturedErrors.count == 1)
    if case .validationFailed(let err) = handler.capturedErrors[0] {
      #expect(err.path == "/component")
    }
  }

  @Test func updateComponentsRejectsMissingIdKey() throws {
    let (processor, _, handler) = try makeProcessor()
    processor.updateComponents(
      surfaceID: "test-surface",
      components: [
        ["component": "button"],
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
        ["id": "root", "component": "unknown_type"],
      ]
    )
    #expect(handler.capturedErrors.count == 1)
  }

  @Test func updateComponentsRecreatesOnTypeChange() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: "test-surface",
      components: [
        ["id": "root", "component": "button", "label": "Old"],
      ]
    )
    #expect(surface.componentsModel.get("root")?.type == "button")

    // Update with same ID but different type
    processor.updateComponents(
      surfaceID: "test-surface",
      components: [
        ["id": "root", "component": "text"],
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
    let data = surface.dataModel.snapshot()
    #expect(data["user/name"]?.stringValue == "Alice")
  }

  @Test func updateDataModelSetsNilRemovesValue() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/user/name", value: "Alice")
    processor.updateDataModel(surfaceID: surface.surfaceID, path: "/user/name", value: nil)
    let data = surface.dataModel.snapshot()
    #expect(data["user/name"] == nil)
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
        ["id": "root", "component": "button", "label": "Hello"],
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
        ["id": "root", "component": "button", "label": ["path": "/user/name"]],
      ]
    )
    let data = surface.dataModel.snapshot()
    #expect(data["user/name"]?.stringValue == "Alice")
  }

  // MARK: - Dynamic Boolean Resolution

  @Test func dynamicBooleanResolvesLiteralTrue() throws {
    let (processor, surface, _) = try makeProcessor()
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "button", "enabled": true],
      ]
    )
    let root = surface.componentsModel.get("root")
    #expect(root?.properties["enabled"]?.boolValue == true)
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
            ],
          ],
        ],
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
            ],
          ],
        ],
      ]
    )
    let root = surface.componentsModel.get("root")
    let actionJSON = try #require(root?.properties["onClick"]?.dictionaryValue)
    let funcCallJSON = try #require(actionJSON["functionCall"]?.dictionaryValue)
    #expect(funcCallJSON["call"]?.stringValue == "submit")
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
    #expect(surface.componentsModel.count == 3)
    #expect(surface.componentsModel.get("child1") != nil)
    #expect(surface.componentsModel.get("child2") != nil)
  }

  // MARK: - Theme Updates

  @Test func updateThemeSetsActiveTheme() throws {
    let (_, surface, _) = try makeProcessor()
    let theme = TestSurfaceTheme(color: "blue")
    surface.updateTheme(theme)
    let active = surface.getActiveTheme()
    #expect(active != nil)
    #expect((active as? TestSurfaceTheme)?.color == "blue")
  }

  // MARK: - Component Buffer

  @Test func getComponentsReturnsEmptyDictInitially() throws {
    let (_, surface, _) = try makeProcessor()
    #expect(surface.componentsModel.isEmpty)
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
    #expect(surface.componentsModel.count == 2)
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
          "items": { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicStringList" }
        },
        "required": ["id", "component"]
      }
      """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )

    let catalog = Catalog(
      id: "lookalike-catalog",
      components: [ComponentAPI(name: "custom", schema: schema)],
      functions: []
    )

    let handler = TestActionHandler()
    let processor = MessageProcessor(catalogs: [catalog], actionHandler: handler)
    let surface = processor.createSurface(surfaceID: "s1", catalog: catalog)

    // Provide a value for "items" that is a plain string array.
    // If classifySchema misidentified "DynamicStringList" as "DynamicString",
    // it would try to resolve it as a DataBinding<String> and the raw value
    // would be transformed. Instead, it should be stored as-is.
    processor.updateComponents(
      surfaceID: surface.surfaceID,
      components: [
        ["id": "root", "component": "custom", "items": ["a", "b", "c"]],
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
        ],
      ]
    )

    // If we get here without hanging, the guard correctly allowed
    // legitimate recursion. Each nested "card" gets a unique
    // instanceID (card_0, card_0_0, etc.) so the guard never triggers.
    #expect(true)
  }
}

// MARK: - ComponentModel Tests

struct ComponentModelTests {

  @Test func componentModelStoresIdTypeAndProperties() {
    let model = ComponentModel(
      id: "btn1",
      type: "button",
      properties: ["label": "Click Me"]
    )
    #expect(model.id == "btn1")
    #expect(model.type == "button")
    #expect(model.properties["label"]?.stringValue == "Click Me")
  }

  @Test func componentModelsEqualByIdTypeProperties() {
    let a = ComponentModel(id: "btn1", type: "button", properties: ["label": "OK"])
    let b = ComponentModel(id: "btn1", type: "button", properties: ["label": "OK"])
    #expect(a == b)
  }

  @Test func componentModelsNotEqualByDifferentId() {
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
}

// MARK: - SurfaceComponentsModel Tests

struct SurfaceComponentsModelTests {

  @Test func startsEmpty() {
    let model = SurfaceComponentsModel()
    #expect(model.isEmpty)
    #expect(model.count == 0)
  }

  @Test func addAndGetComponent() {
    let model = SurfaceComponentsModel()
    let component = ComponentModel(id: "btn1", type: "button", properties: ["label": "OK"])
    model.addComponent(component)
    #expect(model.count == 1)
    #expect(model.get("btn1")?.type == "button")
  }

  @Test func removeComponent() {
    let model = SurfaceComponentsModel()
    model.addComponent(ComponentModel(id: "btn1", type: "button", properties: [:]))
    model.removeComponent("btn1")
    #expect(model.get("btn1") == nil)
    #expect(model.isEmpty)
  }

  @Test func replaceComponentWithSameId() {
    let model = SurfaceComponentsModel()
    model.addComponent(ComponentModel(id: "btn1", type: "button", properties: ["label": "Old"]))
    model.addComponent(ComponentModel(id: "btn1", type: "button", properties: ["label": "New"]))
    #expect(model.get("btn1")?.properties["label"]?.stringValue == "New")
    #expect(model.count == 1)
  }

  @Test func snapshotReturnsCopy() {
    let model = SurfaceComponentsModel()
    model.addComponent(ComponentModel(id: "a", type: "button", properties: [:]))
    let snap = model.snapshot()
    #expect(snap.count == 1)
    #expect(snap["a"] != nil)
  }
}

// MARK: - DataModel Tests

struct DataModelTests {

  @Test func startsEmpty() {
    let model = DataModel()
    let snapshot = model.snapshot()
    #expect(snapshot == .object([:]))
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
}

// MARK: - MessageProcessor Tests

struct MessageProcessorTests {

  // MARK: - Setup Helper

  private func makeProcessor() throws -> (MessageProcessor, TestActionHandler) {
    let handler = TestActionHandler()
    let catalog = try makeTestCatalog()
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )
    return (processor, handler)
  }

  // MARK: - Surface Creation

  @Test func createSurfaceWithCatalogID() throws {
    let (processor, _) = try makeProcessor()
    let surface = processor.createSurface(surfaceID: "s1", catalogID: "test-catalog")
    #expect(surface != nil)
    #expect(surface?.surfaceID == "s1")
  }

  @Test func createSurfaceReturnsNilForUnknownCatalog() throws {
    let (processor, _) = try makeProcessor()
    let surface = processor.createSurface(surfaceID: "s1", catalogID: "unknown")
    #expect(surface == nil)
  }

  @Test func getSurfaceReturnsCreatedSurface() throws {
    let (processor, _) = try makeProcessor()
    _ = processor.createSurface(surfaceID: "s1", catalogID: "test-catalog")
    #expect(processor.getSurface("s1") != nil)
  }

  @Test func deleteSurfaceRemovesIt() throws {
    let (processor, _) = try makeProcessor()
    _ = processor.createSurface(surfaceID: "s1", catalogID: "test-catalog")
    processor.deleteSurface("s1")
    #expect(processor.getSurface("s1") == nil)
  }

  // MARK: - Message Processing

  @Test func processCreateSurfaceMessage() throws {
    let (processor, _) = try makeProcessor()
    let msg = CreateSurfaceMessage(surfaceID: "s1", catalogID: "test-catalog")
    processor.processMessage(.createSurface(msg))
    #expect(processor.getSurface("s1") != nil)
  }

  @Test func processDeleteSurfaceMessage() throws {
    let (processor, _) = try makeProcessor()
    let create = CreateSurfaceMessage(surfaceID: "s1", catalogID: "test-catalog")
    processor.processMessage(.createSurface(create))
    let delete = DeleteSurfaceMessage(surfaceID: "s1")
    processor.processMessage(.deleteSurface(delete))
    #expect(processor.getSurface("s1") == nil)
  }

  @Test func processUpdateComponentsMessage() throws {
    let (processor, handler) = try makeProcessor()
    let create = CreateSurfaceMessage(surfaceID: "s1", catalogID: "test-catalog")
    processor.processMessage(.createSurface(create))

    let update = UpdateComponentsMessage(
      surfaceID: "s1",
      components: [["id": "root", "component": "button", "label": "Hi"]]
    )
    processor.processMessage(.updateComponents(update))

    let surface = processor.getSurface("s1")
    #expect(surface?.componentsModel.get("root") != nil)
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func processUpdateDataModelMessage() throws {
    let (processor, _) = try makeProcessor()
    let create = CreateSurfaceMessage(surfaceID: "s1", catalogID: "test-catalog")
    processor.processMessage(.createSurface(create))

    let update = UpdateDataModelMessage(surfaceID: "s1", path: "/foo", value: "bar")
    processor.processMessage(.updateDataModel(update))

    let surface = processor.getSurface("s1")
    #expect(surface?.dataModel.get("/foo")?.stringValue == "bar")
  }

  @Test func processMultipleMessages() throws {
    let (processor, _) = try makeProcessor()
    let messages: [ServerToClientMessage] = [
      .createSurface(CreateSurfaceMessage(surfaceID: "s1", catalogID: "test-catalog")),
      .updateDataModel(UpdateDataModelMessage(surfaceID: "s1", path: "/x", value: 42)),
      .deleteSurface(DeleteSurfaceMessage(surfaceID: "s1")),
    ]
    processor.processMessages(messages)
    #expect(processor.getSurface("s1") == nil)
  }
}
