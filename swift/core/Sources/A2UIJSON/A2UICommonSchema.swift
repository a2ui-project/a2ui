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

import Foundation
import JSONSchema
import OrderedJSON

/// Namespace for A2UI common type schema URIs and schema registration.
///
/// This enum provides the base URIs for A2UI v0.9.1 and v1.0 common type
/// and catalog definition schemas, loading the canonical JSON documents
/// directly from `specification/` so `$ref` references resolve without
/// duplicating schema JSON in Swift source files.
public enum A2UICommonSchema {
  /// The base URI for all A2UI v0.9.1 common type schemas.
  public static let baseURI =
    "https://a2ui.org/schemas/v0_9_1/common.json"

  /// Returns the full URI for a named A2UI v0.9.1 common type schema definition.
  ///
  /// - Parameter name: The name of the common type (e.g., `"DataBinding"`).
  /// - Returns: The full URI (e.g.,
  ///   `https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DataBinding`).
  public static func uri(for name: String) -> String {
    "\(baseURI)#/$defs/\(name)"
  }

  /// The base URI for all A2UI v1.0 common type schemas.
  public static let v10BaseURI =
    "https://a2ui.org/specification/v1_0/common_types.json"

  /// The base URI for the A2UI v1.0 catalog definition schema.
  public static let v10CatalogDefinitionURI =
    "https://a2ui.org/specification/v1_0/catalog_definition.json"

  /// Returns the full URI for a named A2UI v1.0 common type schema definition.
  public static func v10URI(for name: String) -> String {
    "\(v10BaseURI)#/$defs/\(name)"
  }

  /// The complete A2UI v0.9.1 common types document as a parsed `JSONValue`.
  public static let document: JSONValue = loadSpecDocument(
    relativePath: "specification/v0_9_1/json/common_types.json",
    overrideID: baseURI
  )

  /// The complete A2UI v1.0 common types document as a parsed `JSONValue`.
  public static let v10Document: JSONValue = loadSpecDocument(
    relativePath: "specification/v1_0/json/common_types.json",
    overrideID: v10BaseURI
  )

  /// The complete A2UI v1.0 catalog definition document as a parsed `JSONValue`.
  public static let v10CatalogDefinitionDocument: JSONValue = loadSpecDocument(
    relativePath: "specification/v1_0/json/catalog_definition.json",
    overrideID: v10CatalogDefinitionURI
  )

  public static var allSchemas: [String: JSONValue] {
    [
      baseURI: document,
      v10BaseURI: v10Document,
      "common_types.json": v10Document,
      "https://swift-json-schema.invalid/common_types.json": v10Document,
      "https://a2ui.org/specification/v1_0/catalogs/basic/common_types.json": v10Document,
      v10CatalogDefinitionURI: v10CatalogDefinitionDocument,
      "catalog_definition.json": v10CatalogDefinitionDocument,
      "https://swift-json-schema.invalid/catalog_definition.json":
        v10CatalogDefinitionDocument,
    ]
  }

  private static func loadSpecDocument(
    relativePath: String,
    overrideID: String? = nil,
    filePath: String = #filePath
  ) -> JSONValue {
    let repoRoot = URL(fileURLWithPath: filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let schemaURL = repoRoot.appendingPathComponent(relativePath)
    do {
      let raw = try String(contentsOf: schemaURL, encoding: .utf8)
      var parsed = try JSONValue.parse(raw)
      if case .object(var dict) = parsed {
        if let overrideID {
          dict["$id"] = .string(overrideID)
        }
        if case .object(var defs) = dict["$defs"], defs["FunctionCall"] != nil {
          defs["FunctionCall"] = .object([
            "type": .string("object"),
            "properties": .object([
              "call": .object(["type": .string("string")]),
              "catalogId": .object(["type": .string("string")]),
              "args": .object([
                "type": .string("object"),
                "additionalProperties": .object(["$ref": .string("#/$defs/DynamicValue")]),
              ]),
              "returnType": .object([
                "type": .string("string"),
                "enum": .array([
                  .string("string"),
                  .string("number"),
                  .string("boolean"),
                  .string("array"),
                  .string("object"),
                  .string("any"),
                  .string("void"),
                  .string("validationResult"),
                ]),
              ]),
            ]),
            "required": .array([.string("call")]),
            "additionalProperties": .boolean(false),
          ])
          dict["$defs"] = .object(defs)
        }
        parsed = .object(dict)
      }
      return parsed
    } catch {
      assertionFailure("Failed to load A2UICommonSchema at \(schemaURL.path): \(error)")
      return .object([:])
    }
  }
}
