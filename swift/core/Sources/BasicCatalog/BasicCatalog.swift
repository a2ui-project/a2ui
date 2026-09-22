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

  public static let v10CatalogURI =
    "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"

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

  private static func migrateSchemaToV10(name: String, _ schema: Schema) -> Schema {
    guard let jsonString = try? schema.jsonValue.serialized() else {
      return schema
    }
    let v10JSONString = jsonString.replacingOccurrences(
      of: A2UICommonSchema.baseURI,
      with: A2UICommonSchema.v10BaseURI
    )
    guard var rootObj = (try? JSONValue.parse(v10JSONString))?.objectValue else {
      return schema
    }

    if var props = rootObj["properties"]?.objectValue {
      props["catalogId"] = .object(["type": .string("string")])
      props["metadata"] = .object(["type": .string("object")])

      for childKey in ["child", "trigger", "content"] {
        if var childProp = props[childKey]?.objectValue {
          childProp["$ref"] = .string(A2UICommonSchema.v10URI(for: "Child"))
          props[childKey] = .object(childProp)
        }
      }

      switch name {
      case "Video":
        props["posterUrl"] = .object([
          "$ref": .string(A2UICommonSchema.v10URI(for: "DynamicString"))
        ])
      case "Slider":
        props["steps"] = .object(["type": .string("number")])
      case "Text":
        props["variant"] = .object([
          "type": .string("string"),
          "enum": .array([.string("caption"), .string("body")]),
        ])
      case "Icon":
        if var nameProp = props["name"]?.objectValue,
          var oneOf = nameProp["oneOf"]?.arrayValue,
          oneOf.count >= 2,
          var customObj = oneOf[1].objectValue,
          var customProps = customObj["properties"]?.objectValue
        {
          customProps["svgPath"] = .object([
            "$ref": .string(A2UICommonSchema.v10URI(for: "DynamicString"))
          ])
          customObj["properties"] = .object(customProps)
          oneOf[1] = .object(customObj)
          nameProp["oneOf"] = .array(oneOf)
          props["name"] = .object(nameProp)
        }
      case "Tabs":
        if var tabsProp = props["tabs"]?.objectValue,
          var itemsObj = tabsProp["items"]?.objectValue,
          var itemProps = itemsObj["properties"]?.objectValue,
          var childObj = itemProps["child"]?.objectValue
        {
          childObj["$ref"] = .string(A2UICommonSchema.v10URI(for: "Child"))
          itemProps["child"] = .object(childObj)
          itemsObj["properties"] = .object(itemProps)
          tabsProp["items"] = .object(itemsObj)
          props["tabs"] = .object(tabsProp)
        }
      default:
        break
      }

      rootObj["properties"] = .object(props)
    }

    rootObj["unevaluatedProperties"] = .boolean(false)

    guard
      let serialized = try? JSONValue.object(rootObj).serialized(),
      let v10Schema = try? Schema(
        instance: serialized,
        remoteSchemas: A2UICommonSchema.allSchemas
      )
    else {
      return schema
    }
    return v10Schema
  }

  /// Component APIs configured with v1.0 common schema definitions.
  public static let v10Components: [AnyComponentAPI] = {
    BasicCatalogComponents.allComponents.map { comp in
      AnyComponentAPI(
        name: comp.name,
        schema: migrateSchemaToV10(name: comp.name, comp.schema),
        allowedParents: comp.allowedParents,
        allowedChildren: comp.allowedChildren,
        metadata: comp.metadata
      )
    }
  }()

  private static func makeCatalog(
    id: String,
    protocolVersion: A2UIProtocolVersion? = nil,
    components: [AnyComponentAPI] = BasicCatalogComponents.allComponents,
    functions: [any FunctionImplementation] = BasicFunctions.allFunctions,
    themeSchema: Schema? = BasicCatalog.themeSchema
  ) -> AnyCatalog {
    Catalog(
      id: id,
      protocolVersion: protocolVersion?.rawValue,
      components: components,
      functions: functions,
      themeSchema: themeSchema
    )
  }

  public static let v09Catalog = makeCatalog(
    id: v09CatalogURI,
    protocolVersion: .v09,
    functions: BasicFunctions.v09Functions
  )
  public static let v091Catalog = makeCatalog(
    id: v091CatalogURI,
    protocolVersion: .v091,
    functions: BasicFunctions.v09Functions
  )
  public static let v10Catalog = makeCatalog(
    id: v10CatalogURI,
    protocolVersion: .v10,
    components: v10Components,
    functions: BasicFunctions.v10Functions,
    themeSchema: nil
  )

  /// All supported standard Basic Catalog instances.
  public static let allCatalogs: [AnyCatalog] = [
    v09Catalog,
    v091Catalog,
    v10Catalog,
  ]
}
