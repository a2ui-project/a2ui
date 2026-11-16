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

import A2UIJSON
import OrderedJSON
import Testing

struct RemoteSchemaAliasesTests {
  private static let canonicalURL = "https://example.com/schemas/v1/catalog_definition.json"
  private static let aliasURL = "https://swift-json-schema.invalid/catalog_definition.json"

  @Test(arguments: ["const", "default", "enum", "examples"])
  func rewritesRelativeRefsInsideSubschemaMapEntriesNamedLikeInstanceKeywords(
    _ entryName: String
  ) throws {
    let document: JSONValue = [
      "$id": .string(Self.canonicalURL),
      "properties": [
        entryName: ["$ref": "common_types.json#/$defs/DynamicValue"]
      ],
      "$defs": [
        entryName: ["$dynamicRef": "common_types.json#node"]
      ],
      "dependentSchemas": [
        entryName: ["$ref": "common_types.json#/$defs/Action"]
      ],
      "patternProperties": [
        entryName: ["$ref": "common_types.json#/$defs/Extensions"]
      ],
      "definitions": [
        entryName: [
          "$ref": "common_types.json#/$defs/ComponentId",
          "default": ["$ref": "common_types.json#/$defs/UnchangedLiteral"],
        ]
      ],
    ]

    let result = RemoteSchemaAliases.identifyingAliases(in: [Self.aliasURL: document])
    let alias = try #require(result[Self.aliasURL]?.object)

    #expect(alias["$id"] == .string(Self.aliasURL))
    #expect(
      alias["properties"]?.object?[entryName]?.object?["$ref"]
        == "https://example.com/schemas/v1/common_types.json#/$defs/DynamicValue"
    )
    #expect(
      alias["$defs"]?.object?[entryName]?.object?["$dynamicRef"]
        == "https://example.com/schemas/v1/common_types.json#node"
    )
    #expect(
      alias["dependentSchemas"]?.object?[entryName]?.object?["$ref"]
        == "https://example.com/schemas/v1/common_types.json#/$defs/Action"
    )
    #expect(
      alias["patternProperties"]?.object?[entryName]?.object?["$ref"]
        == "https://example.com/schemas/v1/common_types.json#/$defs/Extensions"
    )
    let definitionEntry = try #require(alias["definitions"]?.object?[entryName]?.object)
    #expect(
      definitionEntry["$ref"]
        == "https://example.com/schemas/v1/common_types.json#/$defs/ComponentId"
    )
    #expect(
      definitionEntry["default"]
        == ["$ref": "common_types.json#/$defs/UnchangedLiteral"]
    )
  }

  @Test func preservesInstanceDataKeywordPayloadsContainingRefObjects() throws {
    let literalRefObject: JSONValue = [
      "$ref": "common_types.json#/$defs/DynamicValue",
      "$dynamicRef": "common_types.json#node",
    ]
    let document: JSONValue = [
      "$id": .string(Self.canonicalURL),
      "const": literalRefObject,
      "default": literalRefObject,
      "enum": [literalRefObject],
      "examples": [literalRefObject],
    ]

    let result = RemoteSchemaAliases.identifyingAliases(in: [Self.aliasURL: document])
    let alias = try #require(result[Self.aliasURL]?.object)

    #expect(alias["const"] == literalRefObject)
    #expect(alias["default"] == literalRefObject)
    #expect(alias["enum"] == [literalRefObject])
    #expect(alias["examples"] == [literalRefObject])
  }

  @Test func skipsDocumentsWhoseIdentifierHasNoScheme() {
    let document: JSONValue = [
      "$id": "common_types.json",
      "$defs": [
        "Item": ["$ref": "catalog.json#/$defs/anyFunction"]
      ],
    ]

    let result = RemoteSchemaAliases.identifyingAliases(in: [Self.aliasURL: document])
    #expect(result[Self.aliasURL] == document)
  }
}
