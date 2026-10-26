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

/// Provides pre-configured Basic Catalog definitions for A2UI Protocol v0.9 and v0.9.1.
public enum V09BasicCatalog: Sendable {
  /// The canonical catalog URI for A2UI v0.9 Basic Catalog.
  public static let catalogURI =
    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"

  /// The canonical catalog URI for A2UI v0.9.1 Basic Catalog.
  public static let v091CatalogURI =
    "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"

  /// The standard theme JSON schema for v0.9 / v0.9.1 Basic Catalog surfaces.
  public static let themeSchema: Schema = try! Schema(
    instance: """
      {
        "type": "object",
        "properties": {
          "primaryColor": {
            "type": "string",
            "pattern": "^#[0-9a-fA-F]{6}$"
          },
          "iconUrl": {
            "type": "string"
          },
          "agentDisplayName": {
            "type": "string"
          }
        }
      }
      """
  )

  /// All 18 standard component APIs for A2UI Protocol v0.9 and v0.9.1.
  public static let components: [AnyComponentAPI] =
    V09BasicCatalogComponents.allComponents

  /// Standard function implementations for A2UI Protocol v0.9 and v0.9.1.
  public static let functions: [any FunctionImplementation] =
    V09BasicFunctions.allFunctions

  /// Pre-configured Basic Catalog instance for A2UI Protocol v0.9.
  public static let catalog = Catalog(
    id: catalogURI,
    protocolVersion: .v09,
    components: components,
    functions: functions,
    themeSchema: themeSchema
  )

  /// Pre-configured Basic Catalog instance for A2UI Protocol v0.9.1.
  public static let v091Catalog = Catalog(
    id: v091CatalogURI,
    protocolVersion: .v091,
    components: components,
    functions: functions,
    themeSchema: themeSchema
  )
}
