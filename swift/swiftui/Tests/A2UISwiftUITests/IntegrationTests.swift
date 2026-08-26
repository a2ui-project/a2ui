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
import SwiftUI
import Testing

// MARK: - Test Catalog for Integration Tests

/// Builds a catalog with button, text, and textField component schemas for integration tests.
func makeIntegrationCatalog() throws -> AnyCatalog {
  let remote = A2UICommonSchema.allSchemas
  let buttonSchema = try Schema(
    instance: """
      {
        "type": "object",
        "properties": {
          "id": {"type": "string"},
          "component": {"type": "string"},
          "label": {"$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"},
          "onClick": {"$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/Action"},
          "children": {"$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ChildList"}
        },
        "required": ["id", "component"]
      }
      """,
    remoteSchemas: remote
  )
  let textSchema = try Schema(
    instance: """
      {
        "type": "object",
        "properties": {
          "id": {"type": "string"},
          "component": {"type": "string"},
          "text": {"$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"}
        },
        "required": ["id", "component"]
      }
      """,
    remoteSchemas: remote
  )
  let textFieldSchema = try Schema(
    instance: """
      {
        "type": "object",
        "properties": {
          "id": {"type": "string"},
          "component": {"type": "string"},
          "value": {"$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"},
          "placeholder": {"$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"}
        },
        "required": ["id", "component"]
      }
      """,
    remoteSchemas: remote
  )

  let iconSchema = try Schema(
    instance: """
      {
        "type": "object",
        "properties": {
          "id": {"type": "string"},
          "component": {"type": "string"},
          "name": {
            "oneOf": [
              {"type": "string"},
              {"$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DataBinding"}
            ]
          }
        },
        "required": ["id", "component", "name"]
      }
      """,
    remoteSchemas: remote
  )

  return Catalog(
    id: "default",
    components: [
      AnyComponentAPI(name: "button", schema: buttonSchema),
      AnyComponentAPI(name: "text", schema: textSchema),
      AnyComponentAPI(name: "textField", schema: textFieldSchema),
      AnyComponentAPI(name: "icon", schema: iconSchema),
    ]
  )
}

/// A simple action handler that records actions for integration tests.
final class IntegrationActionHandler: ActionHandling, @unchecked Sendable {
  var actions: [ResolvedAction] = []
  var errors: [ClientServerError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {
    actions.append(action)
  }

  func handle(error: ClientServerError, from surfaceID: String) {
    errors.append(error)
  }
}

// MARK: - Integration Tests

@MainActor
struct IntegrationTests {

  private let parser = MessageParser()

  private func parse(_ json: String) throws -> ServerToClientMessage {
    try parser.parse(jsonString: json)
  }

  // MARK: - Button + Text Binding

  @Test func buttonWithDynamicLabelResolvesFromDataModel() throws {
    let catalog = try makeIntegrationCatalog()
    let handler = IntegrationActionHandler()
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )

    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "createSurface": {"surfaceId": "s1", "catalogId": "default"}}
        """))
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateDataModel": {"surfaceId": "s1", "path": "/buttonLabel", "value": "Submit"}}
        """))
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateComponents": {"surfaceId": "s1", "components": [
          {
            "id": "root",
            "component": "button",
            "label": {"path": "/buttonLabel"}
          }
        ]}}
        """))

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    #expect(vm?.dataModel.get("/buttonLabel")?.stringValue == "Submit")
    let component = vm?.componentsModel.get("root")
    #expect(component != nil)
  }

  @Test func buttonWithActionResolvesEvent() throws {
    let catalog = try makeIntegrationCatalog()
    let handler = IntegrationActionHandler()
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )

    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "createSurface": {"surfaceId": "s1", "catalogId": "default"}}
        """))
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateComponents": {"surfaceId": "s1", "components": [
          {
            "id": "root",
            "component": "button",
            "label": "Click Me",
            "onClick": {
              "event": {
                "name": "submit",
                "context": {"formId": "contact"}
              }
            }
          }
        ]}}
        """))

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    let root = try #require(vm?.componentsModel.get("root"))
    let action = try #require(root.properties["onClick"]?.dictionaryValue)
    let event = try #require(action["event"]?.dictionaryValue)
    #expect(event["name"]?.stringValue == "submit")
  }

  @Test func textComponentResolvesLiteralString() throws {
    let catalog = try makeIntegrationCatalog()
    let handler = IntegrationActionHandler()
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )

    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "createSurface": {"surfaceId": "s1", "catalogId": "default"}}
        """))
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateComponents": {"surfaceId": "s1", "components": [
          {
            "id": "label1",
            "component": "text",
            "text": "Hello, World!"
          }
        ]}}
        """))

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    let textComp = vm?.componentsModel.get("label1")
    #expect(textComp?.properties["text"]?.stringValue == "Hello, World!")
  }

  // MARK: - Multi-Step Form

  @Test func multiStepFormWithLiveValidation() throws {
    let catalog = try makeIntegrationCatalog()
    let handler = IntegrationActionHandler()
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )

    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "createSurface": {"surfaceId": "form-surface", "catalogId": "default"}}
        """))

    // Step 1: Create form with text fields bound to data model
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateComponents": {"surfaceId": "form-surface", "components": [
          {
            "id": "nameField",
            "component": "textField",
            "value": {"path": "/form/name"},
            "placeholder": "Enter your name"
          },
          {
            "id": "emailField",
            "component": "textField",
            "value": {"path": "/form/email"},
            "placeholder": "Enter your email"
          },
          {
            "id": "submitBtn",
            "component": "button",
            "label": {"path": "/form/submitLabel"},
            "onClick": {
              "event": {"name": "submitForm"}
            }
          }
        ]}}
        """))

    // Step 2: Update data model with user input
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateDataModel": {"surfaceId": "form-surface", "path": "/form/name", "value": "Alice"}}
        """))
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateDataModel": {"surfaceId": "form-surface", "path": "/form/email", "value": "alice@example.com"}}
        """))
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateDataModel": {"surfaceId": "form-surface", "path": "/form/submitLabel", "value": "Submit Form"}}
        """))

    // Verify data model state
    let vm = try #require(processor.surfaceGroupModel.surfacesMap["form-surface"])
    #expect(vm.dataModel.get("/form/name")?.stringValue == "Alice")
    #expect(vm.dataModel.get("/form/email")?.stringValue == "alice@example.com")
    #expect(vm.dataModel.get("/form/submitLabel")?.stringValue == "Submit Form")

    // Verify components are stored
    #expect(vm.componentsModel.components.count == 3)

    // Step 3: Update name and verify
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateDataModel": {"surfaceId": "form-surface", "path": "/form/name", "value": "Bob"}}
        """))
    #expect(vm.dataModel.get("/form/name")?.stringValue == "Bob")
  }

  // MARK: - End-to-End Message Processing

  @Test func endToEndCreateSurfaceAndUpdateComponents() throws {
    let catalog = try makeIntegrationCatalog()
    let handler = IntegrationActionHandler()
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )

    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "createSurface": {"surfaceId": "s1", "catalogId": "default"}}
        """))

    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateComponents": {"surfaceId": "s1", "components": [
          {"id": "root", "component": "text", "text": "Hello"}
        ]}}
        """))

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    let components = vm?.componentsModel.components
    #expect(components?["root"]?.properties["text"]?.stringValue == "Hello")
  }

  @Test func endToEndDataModelUpdateAndComponentBinding() throws {
    let catalog = try makeIntegrationCatalog()
    let handler = IntegrationActionHandler()
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )

    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "createSurface": {"surfaceId": "s1", "catalogId": "default"}}
        """))

    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateComponents": {"surfaceId": "s1", "components": [
          {"id": "lbl", "component": "text", "text": {"path": "/title"}}
        ]}}
        """))

    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateDataModel": {"surfaceId": "s1", "path": "/title", "value": "Dynamic Title"}}
        """))

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    #expect(vm?.dataModel.get("/title")?.stringValue == "Dynamic Title")
  }

  @Test func iconComponentResolvesDynamicDataBinding() async throws {
    let catalog = try makeIntegrationCatalog()
    let handler = IntegrationActionHandler()
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )

    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "createSurface": {"surfaceId": "s1", "catalogId": "default"}}
        """))
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateDataModel": {"surfaceId": "s1", "path": "/icon", "value": "check"}}
        """))
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateComponents": {"surfaceId": "s1", "components": [
          {
            "id": "root",
            "component": "icon",
            "name": {"path": "/icon"}
          }
        ]}}
        """))

    await Task.yield()
    let vm = try #require(processor.surfaceGroupModel.surfacesMap["s1"])
    let root = try #require(vm.rootNode)
    let binding = try #require(root.properties["name"] as? DataBinding<String>)
    #expect(binding.value == "check")
  }
}
