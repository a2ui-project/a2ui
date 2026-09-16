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

/// Provides pre-configured Basic Catalog instances containing all 18 standard components
/// and basic client-side functions across supported A2UI specification versions.
public enum BasicCatalog: Sendable {

  public static let v09CatalogURI =
    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"

  public static let v091CatalogURI =
    "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"

  /// The standard theme JSON schema for Basic Catalog surfaces.
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

  private static func makeCatalog(id: String) -> AnyCatalog {
    Catalog(
      id: id,
      components: BasicCatalogComponents.allComponents,
      functions: BasicFunctions.allFunctions,
      themeSchema: BasicCatalog.themeSchema
    )
  }

  public static let v09Catalog = makeCatalog(id: v09CatalogURI)
  public static let v091Catalog = makeCatalog(id: v091CatalogURI)

  /// All supported standard Basic Catalog instances.
  public static let allCatalogs: [AnyCatalog] = [
    v09Catalog,
    v091Catalog,
  ]
}
