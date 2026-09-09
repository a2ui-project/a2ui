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
import Testing

// MARK: - Stress Tests

@MainActor
struct StressTests {

  private let parser = MessageParser()

  private func parse(_ json: String) throws -> ServerToClientMessage {
    try parser.parse(jsonString: json)
  }

  // MARK: - Deep Nesting

  @Test func deeplyNestedDataModel100Levels() throws {
    let dataModel = DataModel()

    // Build a 100-level deep nested data model
    var path = "/level0"
    for i in 1..<100 {
      dataModel.set(path, value: .object(["level\(i)": .object([:])]))
      path += "/level\(i)"
    }
    dataModel.set(path, value: .string("deep"))

    // Traverse 100 levels deep from the data model root
    var current = dataModel.data
    for i in 0..<100 {
      let key = "level\(i)"
      guard let next = current[key] else {
        Issue.record("Missing level \(i) at key \(key)")
        return
      }
      current = next
    }
    #expect(current.stringValue == "deep")
  }

  @Test func deeplyNestedComponentDefinitions100Children() throws {
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

    // Create 100 child components
    var components: [[String: JSONValue]] = []
    var childIDs: [JSONValue] = []
    for i in 0..<100 {
      let id = "child\(i)"
      childIDs.append(.string(id))
      components.append([
        "id": .string(id),
        "component": .string("text"),
        "text": .string("Child \(i)"),
      ])
    }

    // Root component with 100 static children
    components.append([
      "id": .string("root"),
      "component": .string("button"),
      "label": .string("Root"),
      "children": .array(childIDs),
    ])

    let updateMsg = ServerToClientMessage.updateComponents(
      UpdateComponentsMessage(surfaceID: "s1", components: components)
    )
    processor.process(message: updateMsg)

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    let stored = vm?.componentsModel.components ?? [:]
    #expect(stored.count == 101)
    #expect(stored["root"] != nil)
    #expect(stored["child99"] != nil)
  }

  // MARK: - Concurrent Updates

  @Test func concurrentDataModelUpdates() async throws {
    let dataModel = DataModel()

    // 10 tasks × 200 updates each
    let taskCount = 10
    let updatesPerTask = 200

    await withTaskGroup(of: Void.self) { group in
      for taskIndex in 0..<taskCount {
        group.addTask {
          for updateIndex in 0..<updatesPerTask {
            let path = "/task\(taskIndex)/val\(updateIndex)"
            let value: JSONValue = .integer(updateIndex)
            await dataModel.set(path, value: value)
          }
        }
      }
    }

    // Verify all updates were applied
    for taskIndex in 0..<taskCount {
      for updateIndex in 0..<updatesPerTask {
        let path = "/task\(taskIndex)/val\(updateIndex)"
        let value = dataModel.get(path)
        #expect(
          value?.intValue == updateIndex,
          "Missing update at \(path)"
        )
      }
    }
  }

  @Test func concurrentComponentUpdates() async throws {
    let componentsModel = SurfaceComponentsModel()

    // Multiple tasks updating different components concurrently
    await withTaskGroup(of: Void.self) { group in
      for taskIndex in 0..<10 {
        group.addTask {
          for i in 0..<20 {
            let comp = ComponentModel(
              id: "t\(taskIndex)_c\(i)",
              type: "text",
              properties: ["text": .string("Task \(taskIndex) Component \(i)")]
            )
            await componentsModel.addComponent(comp)
          }
        }
      }
    }

    let stored = componentsModel.components
    // Each task creates 20 components with unique IDs
    #expect(stored.count == 200)
  }

  // MARK: - Missing Optional Properties

  @Test func missingOptionalPropertiesDoesNotCrash() throws {
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

    // Button with only required fields — no label, no onClick
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateComponents": {"surfaceId": "s1", "components": [
          {"id": "root", "component": "button"}
        ]}}
        """))

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    #expect(vm?.componentsModel.get("root") != nil)
  }

  @Test func missingDataModelPathReturnsNull() throws {
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

    // Component references a data path that doesn't exist
    processor.process(
      message: try parse(
        """
        {"version": "v0.9.1", "updateComponents": {"surfaceId": "s1", "components": [
          {
            "id": "root",
            "component": "text",
            "text": {"path": "/nonexistent/path"}
          }
        ]}}
        """))

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    #expect(vm?.dataModel.get("/nonexistent/path") == nil)
  }

  @Test func emptyComponentListDoesNotCrash() throws {
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
        {"version": "v0.9.1", "updateComponents": {"surfaceId": "s1", "components": []}}
        """))

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    #expect(vm?.componentsModel.components.isEmpty == true)
  }

  @Test func emptyChildListResolvesToEmptyArray() throws {
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
            "label": "Root",
            "children": []
          }
        ]}}
        """))

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    let root = try #require(vm?.componentsModel.get("root"))
    let children = root.properties["children"]?.arrayValue
    #expect(children?.isEmpty == true)
  }

  @Test func dynamicChildListWithEmptyDataModelReturnsEmptyArray() throws {
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
            "label": "Root",
            "children": {
              "componentId": "childTemplate",
              "path": "/items"
            }
          },
          {"id": "childTemplate", "component": "text", "text": "Item"}
        ]}}
        """))

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    #expect(vm?.componentsModel.get("childTemplate") != nil)
  }

  // MARK: - Rapid Sequential Updates

  @Test func rapidSequentialUpdatesPreserveLatestState() throws {
    let dataModel = DataModel()

    // Rapidly update the same data model path 500 times
    for i in 0..<500 {
      dataModel.set("/counter", value: .integer(i))
    }

    #expect(dataModel.get("/counter")?.intValue == 499)
  }

  @Test func rapidComponentUpdatesReplaceLatest() throws {
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

    // Rapidly update the same component 500 times
    for i in 0..<500 {
      processor.process(
        message: try parse(
          """
          {"version": "v0.9.1", "updateComponents": {"surfaceId": "s1", "components": [
            {"id": "root", "component": "text", "text": "Update \(i)"}
          ]}}
          """))
    }

    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    let components = vm?.componentsModel.components ?? [:]
    #expect(components.count == 1)
    #expect(components["root"]?.properties["text"]?.stringValue == "Update 499")
  }
}
