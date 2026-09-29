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
import Yams

/// Test helper providing repository path resolution, YAML/JSON loading, and catalog setup.
public enum ConformanceTestHelper {
  /// Resolves the repository root URL using `#filePath` or `A2UI_CONFORMANCE_DIR`.
  public static var repoRoot: URL {
    if let environmentDirectory = ProcessInfo.processInfo.environment["A2UI_CONFORMANCE_DIR"],
      !environmentDirectory.isEmpty
    {
      let url = URL(fileURLWithPath: environmentDirectory)
      if url.lastPathComponent == "conformance" {
        return url.deletingLastPathComponent()
      }
      return url
    }

    let thisFile = URL(fileURLWithPath: #filePath)
    // #filePath -> A2UIConformanceTests -> Tests -> core -> swift -> repoRoot
    return
      thisFile
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  /// URL to the `conformance/` directory.
  public static var conformanceDirectory: URL {
    if let environmentDirectory = ProcessInfo.processInfo.environment["A2UI_CONFORMANCE_DIR"],
      !environmentDirectory.isEmpty
    {
      let url = URL(fileURLWithPath: environmentDirectory)
      if url.lastPathComponent == "conformance" {
        return url
      }
      return url.appendingPathComponent("conformance")
    }
    return repoRoot.appendingPathComponent("conformance")
  }

  /// Loads and decodes a YAML file relative to the `conformance/` directory.
  public static func loadYAML(filename: String) throws -> Any {
    let fileURL = conformanceDirectory.appendingPathComponent(filename)
    let yamlString = try String(contentsOf: fileURL, encoding: .utf8)
    guard let loaded = try Yams.load(yaml: yamlString) else {
      throw A2UIValidationError("Failed to parse YAML from \(filename)")
    }
    return loaded
  }

  /// Loads and decodes a JSON file relative to the `conformance/` directory.
  public static func loadJSON(filename: String) throws -> JSONValue {
    let fileURL = conformanceDirectory.appendingPathComponent(filename)
    let data = try Data(contentsOf: fileURL)
    return try JSONValue.parse(data)
  }

  /// Loads and decodes a JSON file relative to the repository root.
  ///
  /// Suite fields such as `catalogPaths` hold repository-relative paths.
  public static func loadRepositoryJSON(path: String) throws -> JSONValue {
    let data = try Data(contentsOf: repoRoot.appendingPathComponent(path))
    return try JSONValue.parse(data)
  }

  /// Builds the catalogs that a test case declares.
  ///
  /// An inline `catalog` object takes precedence. Otherwise, one catalog is built for each
  /// entry of `catalogPaths`, together with the `common_types.json` file of the same
  /// specification version.
  public static func buildCatalogs(for testCase: ConformanceTestCase) throws -> [AnyCatalog] {
    if let inlineCatalog = testCase.inlineCatalog {
      return [buildCatalog(catalogSchema: inlineCatalog, commonTypes: nil)]
    }
    return try testCase.catalogPaths.map { path in
      buildCatalog(
        catalogSchema: try loadRepositoryJSON(path: path),
        commonTypes: try commonTypesSchema(forCatalogPath: path)
      )
    }
  }

  /// Finds the `common_types.json` schema that a catalog file references.
  ///
  /// Specification catalogs live at `specification/<version>/catalogs/<name>/catalog.json`,
  /// and their common types at `specification/<version>/json/common_types.json`.
  private static func commonTypesSchema(forCatalogPath path: String) throws -> JSONValue? {
    let catalogDirectory = repoRoot.appendingPathComponent(path).deletingLastPathComponent()
    let candidates = [
      catalogDirectory.appendingPathComponent("common_types.json"),
      catalogDirectory
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("json/common_types.json"),
    ]
    guard
      let commonTypesURL = candidates.first(where: {
        FileManager.default.fileExists(atPath: $0.path)
      })
    else {
      return nil
    }
    return try JSONValue.parse(try Data(contentsOf: commonTypesURL))
  }

  /// Builds a `Catalog` from a catalog schema and an optional common types schema.
  public static func buildCatalog(
    catalogSchema: JSONValue,
    commonTypes: JSONValue?
  ) -> AnyCatalog {
    var allDefinitions: OrderedDictionary<String, JSONValue> = [:]
    var remoteSchemas = A2UICommonSchema.allSchemas

    if let commonTypes {
      if let identifierString = commonTypes["$id"]?.stringValue {
        remoteSchemas[identifierString] = commonTypes
      }
      remoteSchemas["common_types.json"] = commonTypes
      for (key, definition) in commonTypes["$defs"]?.objectValue ?? [:] {
        allDefinitions[key] = definition
      }
    }
    for (key, definition) in catalogSchema["$defs"]?.objectValue ?? [:] {
      allDefinitions[key] = definition
    }

    let context = Context(dialect: .draft2020_12, remoteSchema: remoteSchemas)
    var components: [AnyComponentAPI] = []
    for (componentName, componentSchemaValue) in catalogSchema["components"]?.objectValue ?? [:] {
      var fullComponentObject = componentSchemaValue.objectValue ?? [:]
      if !allDefinitions.isEmpty {
        var componentDefinitions = fullComponentObject["$defs"]?.objectValue ?? [:]
        for (key, definition) in allDefinitions where componentDefinitions[key] == nil {
          componentDefinitions[key] = definition
        }
        fullComponentObject["$defs"] = .object(componentDefinitions)
      }

      if let schema = try? Schema(rawSchema: .object(fullComponentObject), context: context) {
        components.append(AnyComponentAPI(name: componentName, schema: schema))
      }
    }

    let catalogID = catalogSchema["catalogId"]?.stringValue ?? "test_catalog"
    return Catalog(id: catalogID, components: components)
  }

  /// Recursively converts arbitrary YAML data (`[String: Any]`, `[Any]`, primitives)
  /// to `JSONValue`.
  public static func toJSONValue(_ value: Any) -> JSONValue {
    switch value {
    case let stringValue as String:
      return .string(stringValue)
    case let booleanValue as Bool:
      return .boolean(booleanValue)
    case let integerValue as Int:
      return .integer(integerValue)
    case let doubleValue as Double:
      return .number(doubleValue)
    case let dictionary as [String: Any]:
      var orderedDictionary: OrderedDictionary<String, JSONValue> = [:]
      for key in dictionary.keys.sorted() {
        if let propertyValue = dictionary[key] {
          orderedDictionary[key] = toJSONValue(propertyValue)
        }
      }
      return .object(orderedDictionary)
    case let array as [Any]:
      return .array(array.map { toJSONValue($0) })
    case is NSNull:
      return .null
    default:
      return .null
    }
  }

  /// Extracts test cases from a loaded YAML object that uses the camelCase suite schema.
  ///
  /// Each step's `messages` list becomes the step payload, and a step without its own
  /// `expectError` inherits the case-level one.
  public static func parseTestCases(from loadedYAML: Any) -> [ConformanceTestCase] {
    guard let array = loadedYAML as? [[String: Any]] else { return [] }
    return array.compactMap { dictionary in
      guard let name = dictionary["name"] as? String else { return nil }
      let expectError = parseExpectError(dictionary["expectError"])

      var catalogPaths = dictionary["catalogPaths"] as? [String] ?? []
      if let catalogPath = dictionary["catalogPath"] as? String {
        catalogPaths.append(catalogPath)
      }

      let steps = (dictionary["steps"] as? [[String: Any]] ?? []).map { stepDictionary in
        ConformanceStep(
          payload: stepDictionary["messages"].map { toJSONValue($0) },
          expectError: parseExpectError(stepDictionary["expectError"]) ?? expectError
        )
      }

      return ConformanceTestCase(
        name: name,
        description: dictionary["description"] as? String,
        action: dictionary["action"] as? String,
        protocolVersion: dictionary["protocolVersion"] as? String,
        strictMode: dictionary["strictMode"] as? Bool ?? false,
        catalogPaths: catalogPaths,
        inlineCatalog: (dictionary["catalog"] as? [String: Any]).map { toJSONValue($0) },
        steps: steps,
        expectError: expectError,
        assertions: (dictionary["assertions"] as? [String: Any]).map {
          toJSONValue($0).dictionaryValue ?? [:]
        },
        surface: (dictionary["surface"] as? [String: Any]).map {
          toJSONValue($0).dictionaryValue ?? [:]
        }
      )
    }
  }

  private static func parseExpectError(_ errorObject: Any?) -> ConformanceExpectError? {
    guard let errorObject else { return nil }
    if let message = errorObject as? String {
      return ConformanceExpectError(category: nil, message: message, details: nil)
    }
    if let dictionary = errorObject as? [String: Any] {
      let category = dictionary["category"] as? String
      let message = dictionary["message"] as? String
      var details: [A2UIErrorDetail]?
      if let detailsArray = dictionary["details"] as? [[String: Any]] {
        details = detailsArray.compactMap { detailDictionary in
          guard let path = detailDictionary["path"] as? String,
            let code = detailDictionary["code"] as? String
          else {
            return nil
          }
          return A2UIErrorDetail(
            path: path,
            code: code,
            message: detailDictionary["message"] as? String ?? ""
          )
        }
      }
      return ConformanceExpectError(category: category, message: message, details: details)
    }
    return nil
  }
}

/// A parsed test case from a conformance YAML suite.
public struct ConformanceTestCase: Sendable {
  public let name: String
  public let description: String?
  public let action: String?
  /// The protocol version the case targets, for example `"v0.9"`.
  public let protocolVersion: String?
  /// Whether the case requires strict topology validation (`strictMode: true`).
  public let strictMode: Bool
  /// Repository-relative catalog schema paths (`catalogPaths`, or a single `catalogPath`).
  public let catalogPaths: [String]
  /// An inline catalog schema (`catalog`), used instead of `catalogPaths` when present.
  public let inlineCatalog: JSONValue?
  public let steps: [ConformanceStep]
  public let expectError: ConformanceExpectError?
  public let assertions: [String: JSONValue]?
  public let surface: [String: JSONValue]?
}

/// An individual execution step within a conformance test case.
public struct ConformanceStep: Sendable {
  public let payload: JSONValue?
  public let expectError: ConformanceExpectError?
}

/// Expected error specifications for conformance assertions.
public struct ConformanceExpectError: Sendable {
  public let category: String?
  public let message: String?
  public let details: [A2UIErrorDetail]?
}
