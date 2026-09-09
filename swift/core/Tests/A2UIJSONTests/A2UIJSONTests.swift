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
import JSONSchema
import Testing

struct A2UIJSONTests {
  @Test func testSchemaURIs() {
    #expect(A2UICommonSchema.baseURI == "https://a2ui.org/schemas/v0_9_1/common.json")
    #expect(
      A2UICommonSchema.v10BaseURI == "https://a2ui.org/specification/v1_0/common_types.json")
    #expect(
      A2UICommonSchema.v10CatalogDefinitionURI
        == "https://a2ui.org/specification/v1_0/catalog_definition.json")
    #expect(
      A2UICommonSchema.uri(for: "DataBinding")
        == "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DataBinding")
    #expect(
      A2UICommonSchema.v10URI(for: "DataBinding")
        == "https://a2ui.org/specification/v1_0/common_types.json#/$defs/DataBinding")
  }

  @Test func testSchemaDocumentsParsed() {
    #expect(A2UICommonSchema.document != .object([:]))
    #expect(A2UICommonSchema.v10Document != .object([:]))
    #expect(A2UICommonSchema.v10CatalogDefinitionDocument != .object([:]))
    #expect(A2UICommonSchema.allSchemas.count == 3)
  }

  @Test func testRegistryContextResolvesV10Refs() throws {
    let context = A2UISchemaRegistry.makeContext()
    let rawSchema: JSONValue = try .parse(
      """
      { "$ref": "\(A2UICommonSchema.v10URI(for: "DataBinding"))" }
      """
    )
    let schema = try Schema(
      rawSchema: rawSchema,
      context: context
    )
    let value: JSONValue = ["path": "/test"]
    let result = schema.validate(value)
    #expect(result.isValid)
  }
}
