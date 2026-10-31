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
  private static let knownSelectCaseKeys: Set<String> = [
    "action",
    "args",
    "catalog",
    "expectError",
    "expectSelected",
  ]

  private static let knownSelectArgsKeys: Set<String> = [
    "catalogs",
    "components",
    "functionCall",
    "surface",
  ]

  private static let knownValidateCaseKeys: Set<String> = [
    "action",
    "catalogs",
    "expect",
    "steps",
  ]

  private static let knownValidateStepKeys: Set<String> = [
    "payload"
  ]

  private static let knownExpectErrorKeys: Set<String> = [
    "category",
    "message",
  ]

  @Test(arguments: ConformanceTestHelper.cases("core/multi_catalog.yaml"))
  func multiCatalogConformance(_ conformanceCase: ConformanceCase) throws {
    try ConformanceManifest.run(conformanceCase) {
      try dispatchMultiCatalogCase(conformanceCase.rawDictionary, name: conformanceCase.name)
    }
  }

  private func dispatchMultiCatalogCase(_ testCase: [String: Any], name: String) throws {
    let action = testCase["action"] as? String ?? ""
    switch action {
    case "select_catalog":
      try ConformanceTestHelper.assertKnownKeys(
        testCase,
        Self.knownSelectCaseKeys,
        "multi_catalog.yaml select_catalog case '\(name)'"
      )
      try runSelectCatalogCase(testCase, name: name)
    case "validate":
      try ConformanceTestHelper.assertKnownKeys(
        testCase,
        Self.knownValidateCaseKeys,
        "multi_catalog.yaml validate case '\(name)'"
      )
      try runValidateCase(testCase, name: name)
    default:
      throw UnknownConformanceKeyError("[\(name)] Unknown multi_catalog.yaml action '\(action)'")
    }
  }

  private func runSelectCatalogCase(_ testCase: [String: Any], name: String) throws {
    let args = (testCase["args"] as? [String: Any]) ?? [:]
    try ConformanceTestHelper.assertKnownKeys(
      args,
      Self.knownSelectArgsKeys,
      "multi_catalog.yaml args in '\(name)'",
      allowMetadata: false
    )
    let surfaceDict = (args["surface"] as? [String: Any]) ?? [:]
    let surfaceID = (surfaceDict["id"] as? String) ?? "main_surface"
    let defaultCatalogID = surfaceDict["defaultCatalogId"] as? String
    let supportedCatalogIDs = (surfaceDict["supportedCatalogIds"] as? [String]) ?? []
    let catalogConfig = (testCase["catalog"] as? [String: Any]) ?? [:]
    let defaultVersion = (catalogConfig["protocolVersion"] as? String) ?? "1.0"
    let explicitCatalogs = (args["catalogs"] as? [String: Any]) ?? [:]

    let catalogs = try buildSelectCatalogs(
      supportedCatalogIDs: supportedCatalogIDs,
      explicitCatalogs: explicitCatalogs,
      defaultVersion: defaultVersion
    )
    let processor = MessageProcessor(catalogs: catalogs)
    let createPayload = buildCreateSurfacePayload(
      surfaceID: surfaceID,
      defaultCatalogID: defaultCatalogID,
      defaultVersion: defaultVersion
    )

    let rawComponents = (args["components"] as? [String: Any]) ?? [:]
    let sortedKeys = rawComponents.keys.sorted()
    let componentList = buildSelectComponentList(
      rawComponents: rawComponents,
      sortedKeys: sortedKeys,
      explicitCatalogs: explicitCatalogs,
      supportedCatalogIDs: supportedCatalogIDs
    )

    if let expectError = testCase["expectError"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expectError,
        Self.knownExpectErrorKeys,
        "multi_catalog.yaml expectError in '\(name)'",
        allowMetadata: false
      )
      assertSelectCatalogError(
        processor: processor,
        createPayload: createPayload,
        componentList: componentList,
        surfaceID: surfaceID,
        defaultVersion: defaultVersion,
        expectError: expectError,
        name: name
      )
      return
    }

    try processSelectPayloads(
      processor: processor,
      createPayload: createPayload,
      componentList: componentList,
      surfaceID: surfaceID,
      defaultVersion: defaultVersion
    )

    let surface = try #require(processor.surfaceGroupModel[surfaceID])
    if let expectedSelected = testCase["expectSelected"] as? String {
      assertSelectedCatalog(
        expectedSelected: expectedSelected,
        sortedKeys: sortedKeys,
        args: args,
        surface: surface,
        name: name
      )
    }
  }

  private func buildSelectCatalogs(
    supportedCatalogIDs: [String],
    explicitCatalogs: [String: Any],
    defaultVersion: String
  ) throws -> [AnyCatalog] {
    let openSchema = try Schema(instance: "{\"type\": \"object\"}")
    let dummyFn = ConformanceFunctionImplementation(
      api: FunctionAPI(name: "add", returnType: .number, schema: openSchema)
    )
    return supportedCatalogIDs.map { catID in
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
  }

  private func buildCreateSurfacePayload(
    surfaceID: String,
    defaultCatalogID: String?,
    defaultVersion: String
  ) -> JSONValue {
    var createSurfaceDict: OrderedDictionary<String, JSONValue> = [
      "surfaceId": .string(surfaceID)
    ]
    if let defaultCatalogID {
      createSurfaceDict["catalogId"] = .string(defaultCatalogID)
    }
    return .object([
      "version": .string(defaultVersion),
      "createSurface": .object(createSurfaceDict),
    ])
  }

  private func buildSelectComponentList(
    rawComponents: [String: Any],
    sortedKeys: [String],
    explicitCatalogs: [String: Any],
    supportedCatalogIDs: [String]
  ) -> [JSONValue] {
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
    return componentList
  }

  private func processSelectPayloads(
    processor: MessageProcessor,
    createPayload: JSONValue,
    componentList: [JSONValue],
    surfaceID: String,
    defaultVersion: String
  ) throws {
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
  }

  private func assertSelectCatalogError(
    processor: MessageProcessor,
    createPayload: JSONValue,
    componentList: [JSONValue],
    surfaceID: String,
    defaultVersion: String,
    expectError: [String: Any],
    name: String
  ) {
    do {
      try processSelectPayloads(
        processor: processor,
        createPayload: createPayload,
        componentList: componentList,
        surfaceID: surfaceID,
        defaultVersion: defaultVersion
      )
      Issue.record("[\(name)] Expected CatalogError, but succeeded")
    } catch {
      if let category = expectError["category"] as? String {
        switch category {
        case "CatalogError":
          #expect(error is A2UICatalogError, "[\(name)] Expected A2UICatalogError, got \(error)")
        default:
          Issue.record("[\(name)] Unknown expected error category '\(category)'")
        }
      }
    }
  }

  private func assertSelectedCatalog(
    expectedSelected: String,
    sortedKeys: [String],
    args: [String: Any],
    surface: SurfaceViewModel,
    name: String
  ) {
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

  private func runValidateCase(_ testCase: [String: Any], name: String) throws {
    let commonTypes = try? ConformanceTestHelper.commonTypesSchema(forProtocolVersion: "1.0")
    var catalogs = ConformanceTestHelper.basicCatalogs(for: .v10)
    if let catalogList = testCase["catalogs"] as? [[String: Any]] {
      for dict in catalogList {
        catalogs.append(
          ConformanceTestHelper.buildCatalog(
            catalogSchema: ConformanceTestHelper.toJSONValue(dict),
            commonTypes: commonTypes,
            protocolVersion: (dict["protocolVersion"] as? String) ?? "1.0"
          )
        )
      }
    }

    let processor = MessageProcessor(catalogs: catalogs)
    let steps = (testCase["steps"] as? [[String: Any]]) ?? []
    for step in steps {
      try ConformanceTestHelper.assertKnownKeys(
        step,
        Self.knownValidateStepKeys,
        "multi_catalog.yaml validate step in '\(name)'",
        allowMetadata: false
      )
      guard let rawPayload = step["payload"] else { continue }
      let payload = ConformanceTestHelper.toJSONValue(rawPayload)
      try processor.processMessages(payload)
    }

    if let expectDict = testCase["expect"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expectDict,
        ["surfaces"],
        "multi_catalog.yaml validate expect in '\(name)'",
        allowMetadata: false
      )
      if let expectSurfaces = expectDict["surfaces"] as? [String: Any] {
        try assertMultiCatalogSurfaces(expectSurfaces, on: processor, name: name)
      }
    }
  }

  private func assertMultiCatalogSurfaces(
    _ expectSurfaces: [String: Any],
    on processor: MessageProcessor,
    name: String
  ) throws {
    for (surfaceID, rawSurface) in expectSurfaces {
      guard let expectedSurface = rawSurface as? [String: Any] else { continue }
      try ConformanceTestHelper.assertKnownKeys(
        expectedSurface,
        ["components"],
        "multi_catalog.yaml expect.surfaces.\(surfaceID) in '\(name)'",
        allowMetadata: false
      )
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
              """
              [\(name)] Expected text '\(expectedText)', \
              got '\(node.string(for: "text") ?? "nil")'
              """
            )
          }
        }
      }
    }
  }
}
