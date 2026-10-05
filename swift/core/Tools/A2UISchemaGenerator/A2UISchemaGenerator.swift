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

/// Build-time generator that emits Swift JSON Schema definitions from `specification/` and
/// `catalogs/basic/`.
@main
enum A2UISchemaGenerator {
  private static let v091BaseURI = "https://a2ui.org/schemas/v0_9_1/common.json"
  private static let v10BaseURI = "https://a2ui.org/specification/v1_0/common_types.json"

  private enum GeneratorError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case invalidJSON(String)

    var description: String {
      switch self {
      case .invalidArguments(let message):
        return "Invalid arguments: \(message)"
      case .invalidJSON(let path):
        return "Expected JSON object at \(path)"
      }
    }
  }

  static func main() throws {
    let args = Array(CommandLine.arguments.dropFirst())
    var target: String?
    var repoRootPath: String?
    var outputPath: String?

    var index = 0
    while index < args.count {
      switch args[index] {
      case "--target":
        index += 1
        if index < args.count { target = args[index] }
      case "--repo-root":
        index += 1
        if index < args.count { repoRootPath = args[index] }
      case "--output":
        index += 1
        if index < args.count { outputPath = args[index] }
      default:
        throw GeneratorError.invalidArguments("Unknown flag '\(args[index])'")
      }
      index += 1
    }

    guard let target, let repoRootPath, let outputPath else {
      throw GeneratorError.invalidArguments(
        "Usage: A2UISchemaGenerator --target <A2UIJSON|BasicCatalog> "
          + "--repo-root <path> --output <path>"
      )
    }

    let repoRoot = URL(fileURLWithPath: repoRootPath)
    let outputURL = URL(fileURLWithPath: outputPath)
    try FileManager.default.createDirectory(
      at: outputURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )

    let generatedSource: String
    switch target {
    case "A2UIJSON":
      generatedSource = try generateA2UIJSONSchemas(repoRoot: repoRoot)
    case "BasicCatalog":
      generatedSource = try generateBasicCatalogComponents(repoRoot: repoRoot)
    default:
      throw GeneratorError.invalidArguments("Unsupported target '\(target)'")
    }

    try generatedSource.write(to: outputURL, atomically: true, encoding: .utf8)
  }

  // MARK: - JSON Helpers

  private static func loadJSONObject(at url: URL) throws -> [String: Any] {
    let data = try Data(contentsOf: url)
    guard let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw GeneratorError.invalidJSON(url.path)
    }
    return dict
  }

  private static func formatEmbeddedJSON(_ dict: [String: Any], indent: Int) throws -> String {
    let data = try JSONSerialization.data(
      withJSONObject: dict,
      options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    )
    let raw = String(decoding: data, as: UTF8.self)
    let escaped = raw.replacingOccurrences(of: "\\", with: "\\\\")
    let prefix = String(repeating: " ", count: indent)
    return
      escaped
      .split(separator: "\n", omittingEmptySubsequences: false)
      .map { "\(prefix)\($0)" }
      .joined(separator: "\n")
  }

  private static func rewriteRefs(_ node: Any, isV10: Bool) -> Any {
    if let list = node as? [Any] {
      return list.map { rewriteRefs($0, isV10: isV10) }
    }
    if let dict = node as? [String: Any] {
      var out: [String: Any] = [:]
      for (key, value) in dict {
        if key == "$ref", let refStr = value as? String {
          if isV10, refStr.hasPrefix("common_types.json#/") {
            let suffix = refStr.dropFirst("common_types.json".count)
            out[key] = "\(v10BaseURI)\(suffix)"
          } else if !isV10,
            refStr.hasPrefix("https://a2ui.org/specification/v0_9/common_types.json#/")
          {
            let suffix = refStr.dropFirst(
              "https://a2ui.org/specification/v0_9/common_types.json".count
            )
            out[key] = "\(v091BaseURI)\(suffix)"
          } else {
            out[key] = value
          }
        } else {
          out[key] = rewriteRefs(value, isV10: isV10)
        }
      }
      return out
    }
    return node
  }

  // MARK: - A2UIJSON Generation

  private static func generateA2UIJSONSchemas(repoRoot: URL) throws -> String {
    let specV091Dir = repoRoot.appendingPathComponent("specification/v0_9_1/json")
    let specV10Dir = repoRoot.appendingPathComponent("specification/v1_0/json")

    var v091Common = try loadJSONObject(
      at: specV091Dir.appendingPathComponent("common_types.json")
    )
    v091Common["$id"] = v091BaseURI
    let v091Body = try formatEmbeddedJSON(v091Common, indent: 4)

    let v09S2C = try loadJSONObject(
      at: specV091Dir.appendingPathComponent("server_to_client.json")
    )
    let v09C2S = try loadJSONObject(
      at: specV091Dir.appendingPathComponent("client_to_server.json")
    )
    let v09Caps = try loadJSONObject(
      at: specV091Dir.appendingPathComponent("client_capabilities.json")
    )

    let v10Common = try loadJSONObject(
      at: specV10Dir.appendingPathComponent("common_types.json")
    )
    let v10Body = try formatEmbeddedJSON(v10Common, indent: 4)

    let v10CatalogDef = try loadJSONObject(
      at: specV10Dir.appendingPathComponent("catalog_definition.json")
    )
    let v10A2R = try loadJSONObject(
      at: specV10Dir.appendingPathComponent("agent_to_renderer.json")
    )
    let v10R2A = try loadJSONObject(
      at: specV10Dir.appendingPathComponent("renderer_to_agent.json")
    )
    let v10Caps = try loadJSONObject(
      at: specV10Dir.appendingPathComponent("renderer_capabilities.json")
    )

    var sections: [String] = [
      """
      // AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
      import Foundation
      import JSONSchema
      import OrderedJSON
      """
    ]

    sections.append(
      """
      /// A2UI v0.9 / v0.9.1 common types JSON Schema definitions.
      public enum V09CommonTypesSchema {
        public static let baseURI = "\(v091BaseURI)"

        public static func uri(for name: String) -> String {
          "\\(baseURI)#/$defs/\\(name)"
        }

        public static let document: JSONValue = parseEmbedded(rawDocument)

        public static let catalogFunctionStubDocument: JSONValue = parseEmbedded(
          catalogFunctionStubRawDocument
        )

        private static func parseEmbedded(_ raw: String) -> JSONValue {
          do {
            return try JSONValue.parse(raw)
          } catch {
            assertionFailure("Failed to parse embedded V09CommonTypesSchema document: \\(error)")
            return .object([:])
          }
        }

        private static let catalogFunctionStubRawDocument = \"\"\"
          {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://a2ui.org/schemas/v0_9_1/catalog.json",
            "$defs": {
              "anyFunction": {
                "type": "object",
                "properties": {
                  "call": { "type": "string" },
                  "args": { "type": "object" },
                  "returnType": { "type": "string" }
                },
                "required": ["call"],
                "additionalProperties": false
              },
              "anyComponent": {
                "type": "object"
              },
              "theme": {
                "type": "object"
              }
            }
          }
          \"\"\"

        private static let rawDocument = \"\"\"
      \(v091Body)
          \"\"\"
      }
      """
    )

    sections.append(
      try renderStandaloneSchemaEnum(
        typeName: "V09ServerToClientSchema",
        docComment: "A2UI v0.9 / v0.9.1 server-to-client message JSON Schema.",
        schemaURI: (v09S2C["$id"] as? String)
          ?? "https://a2ui.org/specification/v0_9/server_to_client.json",
        schemaData: v09S2C
      )
    )

    sections.append(
      try renderStandaloneSchemaEnum(
        typeName: "V09ClientToServerSchema",
        docComment: "A2UI v0.9 / v0.9.1 client-to-server event JSON Schema.",
        schemaURI: (v09C2S["$id"] as? String)
          ?? "https://a2ui.org/specification/v0_9/client_to_server.json",
        schemaData: v09C2S
      )
    )

    sections.append(
      try renderStandaloneSchemaEnum(
        typeName: "V09ClientCapabilitiesSchema",
        docComment: "A2UI v0.9 / v0.9.1 client capabilities JSON Schema.",
        schemaURI: (v09Caps["$id"] as? String)
          ?? "https://a2ui.org/specification/v0_9/client_capabilities.json",
        schemaData: v09Caps
      )
    )

    sections.append(
      """
      /// A2UI v1.0 common types JSON Schema definitions.
      public enum V10CommonTypesSchema {
        public static let baseURI = "\(v10BaseURI)"

        public static func uri(for name: String) -> String {
          "\\(baseURI)#/$defs/\\(name)"
        }

        public static let document: JSONValue = parseEmbedded(rawDocument)

        public static let catalogFunctionStubDocument: JSONValue = parseEmbedded(
          catalogFunctionStubRawDocument
        )

        private static func parseEmbedded(_ raw: String) -> JSONValue {
          do {
            return try JSONValue.parse(raw)
          } catch {
            assertionFailure("Failed to parse embedded V10CommonTypesSchema document: \\(error)")
            return .object([:])
          }
        }

        private static let catalogFunctionStubRawDocument = \"\"\"
          {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://a2ui.org/specification/v1_0/catalog.json",
            "$defs": {
              "anyFunction": {
                "type": "object",
                "not": {
                  "properties": {
                    "@call": { "const": "@index" }
                  },
                  "required": ["@call"]
                },
                "properties": {
                  "@call": { "type": "string" },
                  "catalogId": { "type": "string" },
                  "args": {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "\(v10BaseURI)#/$defs/DynamicValue"
                    }
                  }
                },
                "required": ["@call"]
              },
              "anyComponent": {
                "type": "object"
              }
            }
          }
          \"\"\"

        private static let rawDocument = \"\"\"
      \(v10Body)
          \"\"\"
      }
      """
    )

    sections.append(
      try renderStandaloneSchemaEnum(
        typeName: "V10CatalogDefinitionSchema",
        docComment: "A2UI v1.0 catalog definition JSON Schema.",
        schemaURI: (v10CatalogDef["$id"] as? String)
          ?? "https://a2ui.org/specification/v1_0/catalog_definition.json",
        schemaData: v10CatalogDef
      )
    )

    sections.append(
      try renderStandaloneSchemaEnum(
        typeName: "V10AgentToRendererSchema",
        docComment: "A2UI v1.0 agent-to-renderer message JSON Schema.",
        schemaURI: (v10A2R["$id"] as? String)
          ?? "https://a2ui.org/specification/v1_0/agent_to_renderer.json",
        schemaData: v10A2R
      )
    )

    sections.append(
      try renderStandaloneSchemaEnum(
        typeName: "V10RendererToAgentSchema",
        docComment: "A2UI v1.0 renderer-to-agent event JSON Schema.",
        schemaURI: (v10R2A["$id"] as? String)
          ?? "https://a2ui.org/specification/v1_0/renderer_to_agent.json",
        schemaData: v10R2A
      )
    )

    sections.append(
      try renderStandaloneSchemaEnum(
        typeName: "V10RendererCapabilitiesSchema",
        docComment: "A2UI v1.0 renderer capabilities JSON Schema.",
        schemaURI: (v10Caps["$id"] as? String)
          ?? "https://a2ui.org/specification/v1_0/renderer_capabilities.json",
        schemaData: v10Caps
      )
    )

    sections.append(
      """
      /// Namespace for A2UI common type schema URIs and schema registration.
      public enum A2UICommonSchema {
        public static let baseURI = V09CommonTypesSchema.baseURI

        public static func uri(for name: String) -> String {
          V09CommonTypesSchema.uri(for: name)
        }

        public static let v10BaseURI = V10CommonTypesSchema.baseURI

        public static let v10CatalogDefinitionURI = V10CatalogDefinitionSchema.schemaURI

        public static func v10URI(for name: String) -> String {
          V10CommonTypesSchema.uri(for: name)
        }

        public static let document: JSONValue = V09CommonTypesSchema.document

        public static let v10Document: JSONValue = V10CommonTypesSchema.document

        public static let v10CatalogDefinitionDocument: JSONValue =
          V10CatalogDefinitionSchema.document

        public static let v09CatalogFunctionStubDocument: JSONValue =
          V09CommonTypesSchema.catalogFunctionStubDocument

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
      """
    )

    return sections.joined(separator: "\n\n") + "\n"
  }

  private static func renderStandaloneSchemaEnum(
    typeName: String,
    docComment: String,
    schemaURI: String,
    schemaData: [String: Any]
  ) throws -> String {
    let jsonBody = try formatEmbeddedJSON(schemaData, indent: 4)
    return """
      /// \(docComment)
      public enum \(typeName) {
        public static let schemaURI = "\(schemaURI)"

        public static let document: JSONValue = parseEmbedded(rawDocument)

        private static func parseEmbedded(_ raw: String) -> JSONValue {
          do {
            return try JSONValue.parse(raw)
          } catch {
            assertionFailure("Failed to parse embedded \(typeName) document: \\(error)")
            return .object([:])
          }
        }

        private static let rawDocument = \"\"\"
      \(jsonBody)
          \"\"\"
      }
      """
  }

  // MARK: - BasicCatalog Generation

  private static func generateBasicCatalogComponents(repoRoot: URL) throws -> String {
    let v091CatalogURL = repoRoot.appendingPathComponent(
      "specification/v0_9_1/catalogs/basic/catalog.json"
    )
    let v10CatalogURL = repoRoot.appendingPathComponent(
      "catalogs/basic/v1/catalog.json"
    )

    let v091Catalog = try loadJSONObject(at: v091CatalogURL)
    let v10Catalog = try loadJSONObject(at: v10CatalogURL)

    guard
      let v091Components = v091Catalog["components"] as? [String: [String: Any]],
      let v10Components = v10Catalog["components"] as? [String: [String: Any]]
    else {
      throw GeneratorError.invalidJSON("catalog.json components")
    }

    var sections: [String] = [
      """
      // AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
      import A2UICore
      import A2UIJSON
      import JSONSchema
      """
    ]

    for compName in v091Components.keys.sorted() {
      guard
        let v091Def = v091Components[compName],
        let v10Def = v10Components[compName]
      else {
        continue
      }

      let v09Schema = buildV09ComponentSchema(v091Def)
      let v10Schema = buildV10ComponentSchema(v10Def)

      let propName = compName.prefix(1).lowercased() + compName.dropFirst()
      let v09Body = try formatEmbeddedJSON(v09Schema, indent: 8)
      let v10Body = try formatEmbeddedJSON(v10Schema, indent: 8)
      let formatValidatorsArg =
        compName == "DateTimeInput"
        ? ",\n      formatValidators: DefaultFormatValidators.all"
        : ""

      sections.append(
        """
        extension V09BasicCatalogComponents {
          // MARK: - \(compName) (v0.9)
          public static let \(propName) = AnyComponentAPI(
            name: "\(compName)",
            schema: try! Schema(
              instance: \"\"\"
        \(v09Body)
                \"\"\",
              remoteSchemas: A2UICommonSchema.allSchemas\(formatValidatorsArg)
            )
          )
        }

        extension V10BasicCatalogComponents {
          // MARK: - \(compName) (v1.0)
          public static let \(propName) = AnyComponentAPI(
            name: "\(compName)",
            schema: try! Schema(
              instance: \"\"\"
        \(v10Body)
                \"\"\",
              remoteSchemas: A2UICommonSchema.allSchemas\(formatValidatorsArg)
            )
          )
        }
        """
      )
    }

    return sections.joined(separator: "\n\n") + "\n"
  }

  private static func buildV09ComponentSchema(_ compDef: [String: Any]) -> [String: Any] {
    let schema = (rewriteRefs(compDef, isV10: false) as? [String: Any]) ?? compDef
    let commonProps: [String: Any] = [
      "id": ["$ref": "\(v091BaseURI)#/$defs/ComponentId"],
      "accessibility": ["$ref": "\(v091BaseURI)#/$defs/AccessibilityAttributes"],
      "weight": ["type": "number"],
    ]

    if let allOf = schema["allOf"] as? [Any] {
      var filteredAllOf: [[String: Any]] = []
      for item in allOf {
        guard var itemDict = item as? [String: Any] else { continue }
        let ref = (itemDict["$ref"] as? String) ?? ""
        if ref.hasSuffix("/ComponentCommon") || ref.hasSuffix("/CatalogComponentCommon") {
          continue
        }
        if var props = itemDict["properties"] as? [String: Any] {
          for (ck, cv) in commonProps where props[ck] == nil {
            props[ck] = cv
          }
          itemDict["properties"] = props
        }
        filteredAllOf.append(itemDict)
      }

      if filteredAllOf.count == 1, let innerProps = filteredAllOf[0]["properties"] {
        var result: [String: Any] = [
          "type": "object",
          "properties": innerProps,
          "unevaluatedProperties": false,
        ]
        if let required = filteredAllOf[0]["required"] {
          result["required"] = required
        }
        return result
      }

      return [
        "type": "object",
        "allOf": filteredAllOf,
        "unevaluatedProperties": false,
      ]
    }

    var props = (schema["properties"] as? [String: Any]) ?? [:]
    for (ck, cv) in commonProps where props[ck] == nil {
      props[ck] = cv
    }
    var result: [String: Any] = [
      "type": "object",
      "properties": props,
      "unevaluatedProperties": false,
    ]
    if let required = schema["required"] {
      result["required"] = required
    }
    return result
  }

  private static func buildV10ComponentSchema(_ compDef: [String: Any]) -> [String: Any] {
    let schema = (rewriteRefs(compDef, isV10: true) as? [String: Any]) ?? compDef
    let commonProps: [String: Any] = [
      "id": ["$ref": "\(v10BaseURI)#/$defs/ComponentId"],
      "catalogId": ["type": "string"],
      "accessibility": ["$ref": "\(v10BaseURI)#/$defs/AccessibilityAttributes"],
      "metadata": [
        "type": "object",
        "properties": [
          "extensions": ["$ref": "\(v10BaseURI)#/$defs/Extensions"]
        ],
        "additionalProperties": false,
      ],
    ]

    if let allOf = schema["allOf"] as? [Any] {
      var updatedAllOf: [[String: Any]] = []
      for item in allOf {
        guard var itemDict = item as? [String: Any] else { continue }
        if var props = itemDict["properties"] as? [String: Any] {
          for (ck, cv) in commonProps where props[ck] == nil {
            props[ck] = cv
          }
          itemDict["properties"] = props
        }
        updatedAllOf.append(itemDict)
      }
      return [
        "type": "object",
        "allOf": updatedAllOf,
        "unevaluatedProperties": false,
      ]
    }

    var props = (schema["properties"] as? [String: Any]) ?? [:]
    for (ck, cv) in commonProps where props[ck] == nil {
      props[ck] = cv
    }
    var result: [String: Any] = [
      "type": "object",
      "properties": props,
      "unevaluatedProperties": false,
    ]
    if let required = schema["required"] {
      result["required"] = required
    }
    return result
  }
}
