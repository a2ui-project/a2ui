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
import BasicCatalog
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import Testing

/// Runs the shared `conformance/core/multi_catalog.yaml` suite.
@MainActor
struct MultiCatalogConformanceTests {
  @Test func multiCatalogConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/multi_catalog.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/multi_catalog.yaml should hold test cases")

    var executed = 0
    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let action = testCase["action"] as? String ?? ""

      switch action {
      case "select_catalog":
        try runSelectCatalogCase(testCase, name: name)
        executed += 1
      case "validate":
        try runValidateCase(testCase, name: name)
        executed += 1
      default:
        continue
      }
    }

    #expect(executed == cases.count, "All cases in core/multi_catalog.yaml should be executed")
  }

  private func runSelectCatalogCase(_ testCase: [String: Any], name: String) throws {
    let args = (testCase["args"] as? [String: Any]) ?? [:]
    let surfaceDict = (args["surface"] as? [String: Any]) ?? [:]
    let surfaceID = (surfaceDict["id"] as? String) ?? "main_surface"
    let defaultCatalogID = surfaceDict["defaultCatalogId"] as? String
    let supportedCatalogIDs = (surfaceDict["supportedCatalogIds"] as? [String]) ?? []
    let catalogConfig = (testCase["catalog"] as? [String: Any]) ?? [:]
    let defaultVersion = (catalogConfig["protocolVersion"] as? String) ?? "v1.0"
    let explicitCatalogs = (args["catalogs"] as? [String: Any]) ?? [:]

    let openSchema = try Schema(instance: "{\"type\": \"object\"}")
    let dummyFn = ConformanceFunctionImplementation(
      api: FunctionAPI(name: "add", returnType: .number, schema: openSchema)
    )

    let catalogs: [AnyCatalog] = supportedCatalogIDs.map { catID in
      let catDict = explicitCatalogs[catID] as? [String: Any]
      let version = (catDict?["protocolVersion"] as? String) ?? defaultVersion
      return Catalog(
        id: catID,
        protocolVersion: version,
        components: [
          AnyComponentAPI(name: "Text", schema: openSchema),
          AnyComponentAPI(name: "Button", schema: openSchema),
          AnyComponentAPI(name: "LineChart", schema: openSchema),
          AnyComponentAPI(name: "BarChart", schema: openSchema),
          AnyComponentAPI(name: "GeoMap", schema: openSchema),
          AnyComponentAPI(name: "CustomWidget", schema: openSchema),
        ],
        functions: [dummyFn]
      )
    }

    let processor = MessageProcessor(catalogs: catalogs)

    var createSurfaceDict: OrderedDictionary<String, JSONValue> = [
      "surfaceId": .string(surfaceID)
    ]
    if let defaultCatalogID {
      createSurfaceDict["catalogId"] = .string(defaultCatalogID)
    }
    let createPayload: JSONValue = .object([
      "version": .string(defaultVersion),
      "createSurface": .object(createSurfaceDict),
    ])

    let rawComponents = (args["components"] as? [String: Any]) ?? [:]
    let sortedKeys = rawComponents.keys.sorted()
    var componentList: [JSONValue] = []
    for key in sortedKeys {
      guard let compDict = rawComponents[key] as? [String: Any] else { continue }
      var obj = ConformanceTestHelper.toJSONValue(compDict).objectValue ?? [:]
      obj["id"] = .string(key)
      componentList.append(.object(obj))
    }

    if componentList.isEmpty && !explicitCatalogs.isEmpty {
      for (index, catID) in supportedCatalogIDs.enumerated() {
        componentList.append(
          .object([
            "id": .string("c\(index)"),
            "component": .string("Text"),
            "catalogId": .string(catID),
          ])
        )
      }
    }

    if let expectError = testCase["expectError"] as? [String: Any] {
      do {
        try processor.processMessages(createPayload)
        if !componentList.isEmpty {
          let updatePayload: JSONValue = .object([
            "version": .string(defaultVersion),
            "updateComponents": .object([
              "surfaceId": .string(surfaceID),
              "components": .array(componentList),
            ]),
          ])
          try processor.processMessages(updatePayload)
        }
        Issue.record("[\(name)] Expected CatalogError, but succeeded")
      } catch {
        if let category = expectError["category"] as? String, category == "CatalogError" {
          #expect(error is A2UICatalogError, "[\(name)] Expected A2UICatalogError, got \(error)")
        }
      }
      return
    }

    try processor.processMessages(createPayload)
    if !componentList.isEmpty {
      let updatePayload: JSONValue = .object([
        "version": .string(defaultVersion),
        "updateComponents": .object([
          "surfaceId": .string(surfaceID),
          "components": .array(componentList),
        ]),
      ])
      try processor.processMessages(updatePayload)
    }

    let surface = try #require(processor.surfaceGroupModel[surfaceID])
    if let expectedSelected = testCase["expectSelected"] as? String {
      if let lastKey = sortedKeys.last,
        let compModel = surface.componentsModel.get(lastKey)
      {
        let resolvedCatalog = surface.getCatalog(id: compModel.catalogID)
        #expect(
          resolvedCatalog?.id == expectedSelected,
          "[\(name)] Expected catalog '\(expectedSelected)', got '\(resolvedCatalog?.id ?? "nil")'"
        )
      } else if let fnCall = args["functionCall"] as? [String: Any] {
        let fnCatalogID = fnCall["catalogId"] as? String
        let resolvedCatalog = surface.getCatalog(id: fnCatalogID)
        #expect(
          resolvedCatalog?.id == expectedSelected,
          "[\(name)] Expected catalog '\(expectedSelected)', got '\(resolvedCatalog?.id ?? "nil")'"
        )
      }
    }
  }

  private func runValidateCase(_ testCase: [String: Any], name: String) throws {
    let commonTypes = try? ConformanceTestHelper.commonTypesSchema(forProtocolVersion: "v1.0")
    var catalogs = ConformanceTestHelper.basicCatalogs(for: .v10)
    if let catalogList = testCase["catalogs"] as? [[String: Any]] {
      for dict in catalogList {
        catalogs.append(
          ConformanceTestHelper.buildCatalog(
            catalogSchema: ConformanceTestHelper.toJSONValue(dict),
            commonTypes: commonTypes,
            protocolVersion: (dict["protocolVersion"] as? String) ?? "v1.0"
          )
        )
      }
    }

    let processor = MessageProcessor(catalogs: catalogs)
    let steps = (testCase["steps"] as? [[String: Any]]) ?? []
    for step in steps {
      guard let rawPayload = step["payload"] else { continue }
      let payload = ConformanceTestHelper.toJSONValue(rawPayload)
      try processor.processMessages(payload)
    }

    if let expectDict = testCase["expect"] as? [String: Any],
      let expectSurfaces = expectDict["surfaces"] as? [String: Any]
    {
      for (surfaceID, rawSurface) in expectSurfaces {
        guard let expectedSurface = rawSurface as? [String: Any] else { continue }
        let surface = try #require(
          processor.surfaceGroupModel[surfaceID],
          "[\(name)] Expected surface '\(surfaceID)' to exist"
        )
        if let expectedComponents = expectedSurface["components"] as? [String: Any] {
          for (compID, rawComp) in expectedComponents {
            guard let compDict = rawComp as? [String: Any] else { continue }
            let node = try #require(
              surface.findNode(id: compID),
              "[\(name)] Expected node '\(compID)' to exist"
            )
            if let expectedText = compDict["text"] as? String {
              #expect(
                node.string(for: "text") == expectedText,
                "[\(name)] Expected text '\(expectedText)', got '\(node.string(for: "text") ?? "nil")'"
              )
            }
          }
        }
      }
    }
  }
}
