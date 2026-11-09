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
import A2UISwiftUI
import BasicCatalog
import BasicCatalogSwiftUI
import Foundation
import JSONSchema
import OrderedJSON
import SwiftUI
import Testing

@MainActor
struct BasicCatalogExamplesTests {

  struct ExampleCase: Sendable, CustomTestStringConvertible {
    let suiteName: String
    let relativeDirectory: String
    let fileName: String
    let fileURL: URL

    var testDescription: String {
      "\(suiteName)/\(fileName)"
    }
  }

  private final class RecordingActionHandler: ActionHandling, @unchecked Sendable {
    var errors: [RendererError] = []

    func handle(action: ResolvedAction, from surfaceID: String) {}

    func handle(error: RendererError, from surfaceID: String) {
      errors.append(error)
    }
  }

  nonisolated private static var repoRoot: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  nonisolated private static let exampleSuites: [(name: String, relativePath: String)] = [
    ("v0.9", "specification/v0_9/catalogs/basic/examples"),
    ("v0.9.1", "specification/v0_9_1/catalogs/basic/examples"),
    ("v1.0", "catalogs/basic/v1/examples"),
  ]

  nonisolated static var allExamples: [ExampleCase] {
    let fileManager = FileManager.default
    var cases: [ExampleCase] = []
    for suite in exampleSuites {
      let directoryURL = repoRoot.appendingPathComponent(suite.relativePath)
      let files =
        (try? fileManager.contentsOfDirectory(
          at: directoryURL,
          includingPropertiesForKeys: nil
        )) ?? []
      let jsonFiles =
        files
        .filter { $0.pathExtension.lowercased() == "json" }
        .sorted { $0.lastPathComponent < $1.lastPathComponent }
      for url in jsonFiles {
        cases.append(
          ExampleCase(
            suiteName: suite.name,
            relativeDirectory: suite.relativePath,
            fileName: url.lastPathComponent,
            fileURL: url
          )
        )
      }
    }
    return cases
  }

  @Test func discoversExamplesInEveryDirectory() throws {
    let fileManager = FileManager.default
    for suite in Self.exampleSuites {
      let directoryURL = Self.repoRoot.appendingPathComponent(suite.relativePath)
      let files = try fileManager.contentsOfDirectory(
        at: directoryURL,
        includingPropertiesForKeys: nil
      ).filter { $0.pathExtension.lowercased() == "json" }
      #expect(!files.isEmpty, "Expected JSON examples in \(suite.relativePath)")
    }
  }

  @Test(arguments: allExamples)
  func processesAndRendersExample(_ example: ExampleCase) throws {
    let data = try Data(contentsOf: example.fileURL)
    let document = try JSONValue.parse(data)

    let messages: JSONValue
    let customComponentNames: Set<String>
    if let array = document.arrayValue {
      messages = .array(array)
      customComponentNames = []
    } else {
      let dict = try #require(document.objectValue)
      let msgArray = try #require(dict["messages"]?.arrayValue)
      messages = .array(msgArray)
      let names = dict["customComponents"]?.arrayValue?.compactMap(\.stringValue) ?? []
      customComponentNames = Set(names)
    }

    let catalogs = try makeCatalogs(customComponents: customComponentNames)
    let catalogMap = Dictionary(
      catalogs.map { ($0.id, $0) },
      uniquingKeysWith: { _, last in last }
    )
    let handler = RecordingActionHandler()
    let processor = MessageProcessor(
      catalogs: catalogs,
      actionHandler: handler,
      validationConfig: ValidationConfig(
        allowOrphanComponents: true,
        allowDanglingReferences: true,
        allowMissingRoot: true,
        allowUnknownElements: false
      )
    )

    let messageItems = try #require(messages.arrayValue)
    let parser = MessageParser()
    let encoder = JSONEncoder()
    for (index, item) in messageItems.enumerated() {
      let itemData = try encoder.encode(item)
      _ = try parser.decode(jsonData: itemData)
      #expect(item.objectValue != nil, "Expected object at message[\(index)]")
    }

    try processor.processMessages(messages)
    #expect(
      handler.errors.isEmpty,
      "Unexpected errors for \(example.testDescription): \(handler.errors)"
    )

    let surfaces = processor.surfaceGroupModel.surfacesMap
    #expect(!surfaces.isEmpty, "Expected at least one surface for \(example.testDescription)")

    for (surfaceID, surface) in surfaces {
      let rootNode = try #require(
        surface.rootNode,
        "Expected resolved rootNode on surface '\(surfaceID)' in \(example.testDescription)"
      )
      assertAllNodesRender(
        rootNode,
        catalogs: catalogMap,
        defaultCatalogID: surface.defaultCatalogID,
        context: "\(example.testDescription)#\(surfaceID)"
      )
    }
  }

  private func assertAllNodesRender(
    _ node: Node,
    catalogs: [String: Catalog<ComponentImplementation>],
    defaultCatalogID: String?,
    context: String
  ) {
    let rendered = Surface.render(
      node: node,
      using: catalogs,
      defaultCatalogID: defaultCatalogID
    )
    #expect(
      rendered != nil, "Missing SwiftUI builder for '\(node.type)' (\(node.id)) in \(context)")
    for child in node.allChildNodes {
      assertAllNodesRender(
        child,
        catalogs: catalogs,
        defaultCatalogID: defaultCatalogID,
        context: context
      )
    }
  }

  private func makeCatalogs(
    customComponents: Set<String>
  ) throws -> [Catalog<ComponentImplementation>] {
    let baseCatalogs = BasicCatalogImplementation.allCatalogs
    guard !customComponents.isEmpty else {
      return baseCatalogs
    }

    let standIns = try makeCustomComponentStandIns().filter {
      customComponents.contains($0.name)
    }
    return baseCatalogs.map { catalog in
      Catalog(
        id: catalog.id,
        protocolVersion: catalog.protocolVersion,
        components: Array(catalog.components.values) + standIns,
        functions: Array(catalog.functions.values),
        themeSchema: catalog.themeSchema
      )
    }
  }

  private func makeCustomComponentStandIns() throws -> [ComponentImplementation] {
    let remote = A2UICommonSchema.allSchemas
    let customGridSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": {"type": "string"},
            "component": {"const": "CustomGrid"},
            "title": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"
            },
            "description": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"
            },
            "children": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ChildList"
            }
          },
          "required": ["id", "component"],
          "additionalProperties": false
        }
        """,
      remoteSchemas: remote
    )
    let customSliderSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": {"type": "string"},
            "component": {"const": "CustomSlider"},
            "label": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"
            },
            "value": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicNumber"
            },
            "min": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicNumber"
            },
            "max": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicNumber"
            }
          },
          "required": ["id", "component"],
          "additionalProperties": false
        }
        """,
      remoteSchemas: remote
    )

    return [
      ComponentImplementation(name: "CustomGrid", schema: customGridSchema) { node in
        AnyView(
          VStack(alignment: .leading) {
            Text(node.string(for: "title") ?? "")
            ForEach(node.children(for: "children")) { child in
              ComponentNodeView(node: child)
            }
          }
        )
      },
      ComponentImplementation(name: "CustomSlider", schema: customSliderSchema) { node in
        AnyView(Text("\(node.string(for: "label") ?? ""): \(node.string(for: "value") ?? "")"))
      },
    ]
  }
}
