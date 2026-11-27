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

import OrderedJSON

/// Canonical, JSON-Schema-independent in-memory representation of an A2UI catalog.
///
/// Maps 1:1 to the A2UI Catalog Document format (`formatVersion: "1.0"`) while supporting
/// bidirectional translation to and from legacy v0.9 / v0.9.1 / v1.0 JSON Schema catalogs.
public struct CatalogModel: Sendable, Equatable {
  /// Optional JSON Schema URI reference (`$schema`) for editor validation.
  public var schemaURI: String?

  /// Catalog Document format version (currently `"1.0"`).
  public var formatVersion: String

  /// Unique opaque identifier for this catalog.
  public var catalogID: String

  /// A2UI protocol version targeted by this catalog (e.g. `"1.0"`, `"0.9.1"`).
  public var protocolVersion: String?

  /// Optional human-readable catalog title.
  public var title: String?

  /// Optional human-readable catalog description.
  public var description: String?

  /// Optional Markdown design guidelines for LLM prompts.
  public var instructions: String?

  /// Optional catalog-level static metadata and vendor extensions.
  public var metadata: [String: JSONValue]?

  /// Catalog-local reusable leaf data type definitions keyed by UAX #31 identifier.
  public var types: [String: TypeDefinition]

  /// Optional schema for surface-level data properties (maps to v0.9 `theme`).
  public var surfaceProperties: SurfacePropertiesDefinition?

  /// Ordered list of UI component definitions supported by this catalog.
  public var components: [ComponentDefinition]

  /// Ordered list of function definitions supported by this catalog.
  public var functions: [FunctionDefinition]

  public init(
    schemaURI: String? = nil,
    formatVersion: String = CatalogDocumentCodec.supportedFormatVersion,
    catalogID: String,
    protocolVersion: String? = "1.0",
    title: String? = nil,
    description: String? = nil,
    instructions: String? = nil,
    metadata: [String: JSONValue]? = nil,
    types: [String: TypeDefinition] = [:],
    surfaceProperties: SurfacePropertiesDefinition? = nil,
    components: [ComponentDefinition] = [],
    functions: [FunctionDefinition] = []
  ) {
    self.schemaURI = schemaURI
    self.formatVersion = formatVersion
    self.catalogID = catalogID
    self.protocolVersion = protocolVersion
    self.title = title
    self.description = description
    self.instructions = instructions
    self.metadata = metadata
    self.types = types
    self.surfaceProperties = surfaceProperties
    self.components = components
    self.functions = functions
  }
}
