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

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/ via swift/scripts/generate_schemas.py

import Foundation
import JSONSchema
import OrderedJSON

/// Namespace for A2UI common type schema URIs and schema registration.
///
/// Provides the base URIs and embedded specification JSON documents for
/// A2UI v0.9.1 and v1.0 common types and catalog definitions.
public enum A2UICommonSchema {
  /// The base URI for all A2UI v0.9.1 common type schemas.
  public static let baseURI = V09CommonTypesSchema.baseURI

  /// Returns the full URI for a named A2UI v0.9.1 common type schema definition.
  ///
  /// - Parameter name: The name of the common type (e.g., `"DataBinding"`).
  /// - Returns: The full URI (e.g.,
  ///   `https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DataBinding`).
  public static func uri(for name: String) -> String {
    V09CommonTypesSchema.uri(for: name)
  }

  /// The base URI for all A2UI v1.0 common type schemas.
  public static let v10BaseURI = V10CommonTypesSchema.baseURI

  /// The base URI for the A2UI v1.0 catalog definition schema.
  public static let v10CatalogDefinitionURI = V10CatalogDefinitionSchema.schemaURI

  /// Returns the full URI for a named A2UI v1.0 common type schema definition.
  public static func v10URI(for name: String) -> String {
    V10CommonTypesSchema.uri(for: name)
  }

  /// The complete A2UI v0.9.1 common types document as a parsed `JSONValue`.
  public static let document: JSONValue = V09CommonTypesSchema.document

  /// The complete A2UI v1.0 common types document as a parsed `JSONValue`.
  public static let v10Document: JSONValue = V10CommonTypesSchema.document

  /// The complete A2UI v1.0 catalog definition document as a parsed `JSONValue`.
  public static let v10CatalogDefinitionDocument: JSONValue =
    V10CatalogDefinitionSchema.document

  /// Baseline v0.9 catalog stub satisfying `catalog.json#/$defs/anyFunction` references.
  public static let v09CatalogFunctionStubDocument: JSONValue =
    V09CommonTypesSchema.catalogFunctionStubDocument

  /// Baseline v1.0 catalog stub satisfying `catalog.json#/$defs/anyFunction` references.
  public static let v10CatalogFunctionStubDocument: JSONValue =
    V10CommonTypesSchema.catalogFunctionStubDocument

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
      "https://a2ui.org/schemas/v0_9_1/catalog.json": v09CatalogFunctionStubDocument,
      "https://a2ui.org/specification/v0_9/catalog.json": v09CatalogFunctionStubDocument,
      "https://a2ui.org/specification/v0_9_1/catalog.json": v09CatalogFunctionStubDocument,
      "https://a2ui.org/specification/v1_0/catalog.json": v10CatalogFunctionStubDocument,
      "catalog.json": v10CatalogFunctionStubDocument,
      "https://swift-json-schema.invalid/catalog.json": v10CatalogFunctionStubDocument,
    ]
  }
}
