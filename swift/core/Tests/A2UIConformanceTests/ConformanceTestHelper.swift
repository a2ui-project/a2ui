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

  /// Builds a `Catalog` from a test case catalog configuration dictionary.
  public static func buildCatalog(
    from catalogConfiguration: [String: JSONValue]?
  ) -> AnyCatalog? {
    guard let catalogConfiguration else { return nil }
    var catalogID = "test_catalog"
    var components: [AnyComponentAPI] = []
    var allDefinitions: OrderedDictionary<String, JSONValue> = [:]
    var remoteSchemas = A2UICommonSchema.allSchemas

    loadCommonTypesDefinitions(
      from: catalogConfiguration,
      remoteSchemas: &remoteSchemas,
      allDefinitions: &allDefinitions
    )

    let catalogSchemaJSON = loadCatalogDefinitions(
      from: catalogConfiguration,
      allDefinitions: &allDefinitions
    )

    let context = Context(dialect: .draft2020_12, remoteSchema: remoteSchemas)

    if let catalogSchemaJSON = catalogSchemaJSON {
      if let identifier = catalogSchemaJSON["catalogId"]?.stringValue {
        catalogID = identifier
      }
      if let componentsObject = catalogSchemaJSON["components"]?.objectValue {
        for (componentName, componentSchemaValue) in componentsObject {
          var fullComponentObject = componentSchemaValue.objectValue ?? [:]
          if !allDefinitions.isEmpty {
            var componentDefinitions = fullComponentObject["$defs"]?.objectValue ?? [:]
            for (key, definition) in allDefinitions {
              if componentDefinitions[key] == nil {
                componentDefinitions[key] = definition
              }
            }
            fullComponentObject["$defs"] = .object(componentDefinitions)
          }

          if let schema = try? Schema(rawSchema: .object(fullComponentObject), context: context) {
            components.append(AnyComponentAPI(name: componentName, schema: schema))
          }
        }
      }
    }

    return Catalog(id: catalogID, components: components)
  }

  private static func loadCommonTypesDefinitions(
    from catalogConfiguration: [String: JSONValue],
    remoteSchemas: inout [String: JSONValue],
    allDefinitions: inout OrderedDictionary<String, JSONValue>
  ) {
    guard let commonTypesValue = catalogConfiguration["common_types_schema"] else { return }

    var commonTypesJSON: JSONValue?
    if let pathString = commonTypesValue.stringValue {
      commonTypesJSON = try? loadJSON(filename: pathString)
    } else if commonTypesValue.objectValue != nil {
      commonTypesJSON = commonTypesValue
    }

    if let commonTypes = commonTypesJSON {
      if let identifierString = commonTypes["$id"]?.stringValue {
        remoteSchemas[identifierString] = commonTypes
      }
      remoteSchemas["common_types.json"] = commonTypes
      remoteSchemas["https://a2ui.org/specification/v0_9/common_types.json"] = commonTypes
      remoteSchemas["https://a2ui.org/specification/v0_9_1/common_types.json"] = commonTypes
    }

    if let definitions = commonTypesJSON?["$defs"]?.objectValue {
      for (key, definition) in definitions {
        allDefinitions[key] = definition
      }
    }
  }

  private static func loadCatalogDefinitions(
    from catalogConfiguration: [String: JSONValue],
    allDefinitions: inout OrderedDictionary<String, JSONValue>
  ) -> JSONValue? {
    guard let catalogSchemaValue = catalogConfiguration["catalog_schema"] else { return nil }

    var catalogSchemaJSON: JSONValue?
    if let pathString = catalogSchemaValue.stringValue {
      catalogSchemaJSON = try? loadJSON(filename: pathString)
    } else if catalogSchemaValue.objectValue != nil {
      catalogSchemaJSON = catalogSchemaValue
    }

    if let catalogDefinitions = catalogSchemaJSON?["$defs"]?.objectValue {
      for (key, definition) in catalogDefinitions {
        allDefinitions[key] = definition
      }
    }
    return catalogSchemaJSON
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

  /// Extracts test cases from a loaded YAML object.
  public static func parseTestCases(from loadedYAML: Any) -> [ConformanceTestCase] {
    guard let array = loadedYAML as? [[String: Any]] else { return [] }
    return array.compactMap { dictionary in
      guard let name = dictionary["name"] as? String else { return nil }
      let description = dictionary["description"] as? String
      let catalogConfiguration = (dictionary["catalog"] as? [String: Any]).map {
        toJSONValue($0).dictionaryValue ?? [:]
      }
      let action = dictionary["action"] as? String
      let expectError = parseExpectError(dictionary["expect_error"])
      let payload = dictionary["payload"].map { toJSONValue($0) }
      let assertions = (dictionary["assertions"] as? [String: Any]).map {
        toJSONValue($0).dictionaryValue ?? [:]
      }
      let surface = (dictionary["surface"] as? [String: Any]).map {
        toJSONValue($0).dictionaryValue ?? [:]
      }

      var steps: [ConformanceStep] = []
      if let stepsArray = dictionary["steps"] as? [[String: Any]] {
        for stepDictionary in stepsArray {
          let stepPayload = stepDictionary["payload"].map { toJSONValue($0) }
          let stepError = parseExpectError(stepDictionary["expect_error"]) ?? expectError
          steps.append(ConformanceStep(payload: stepPayload, expectError: stepError))
        }
      } else if let validateArray = dictionary["validate"] as? [[String: Any]] {
        for stepDictionary in validateArray {
          let stepPayload = stepDictionary["payload"].map { toJSONValue($0) }
          let stepError = parseExpectError(stepDictionary["expect_error"]) ?? expectError
          steps.append(ConformanceStep(payload: stepPayload, expectError: stepError))
        }
      } else if let payload {
        steps.append(ConformanceStep(payload: payload, expectError: expectError))
      }

      return ConformanceTestCase(
        name: name,
        description: description,
        catalogConfiguration: catalogConfiguration,
        action: action,
        payload: payload,
        steps: steps,
        expectError: expectError,
        assertions: assertions,
        surface: surface
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
  public let catalogConfiguration: [String: JSONValue]?
  public let action: String?
  public let payload: JSONValue?
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
