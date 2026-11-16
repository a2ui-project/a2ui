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
import BasicCatalog
import Foundation
import JSONSchema
import Testing

@MainActor
struct InlineCatalogAllOfRegressionTests {
  @Test func composedBasicCatalogPropertiesSurviveCapabilitiesExport() throws {
    let processor = MessageProcessor(
      catalogs: [BasicCatalog.makeCatalog(version: .v10)],
      validationConfig: .strict
    )
    let capabilities = try processor.getRendererCapabilities(
      options: .init(protocolVersion: .v10, includeInlineCatalogs: true)
    )
    let inlineCatalog = try #require(capabilities["1.0"]?["inlineCatalogs"]?.arrayValue?.first)
    let components = try #require(inlineCatalog["components"]?.objectValue)

    let catalogDefinition = try Schema(
      rawSchema: A2UICommonSchema.v10CatalogDefinitionDocument,
      context: A2UISchemaRegistry.makeContext()
    )
    #expect(catalogDefinition.validate(inlineCatalog).isValid)

    #expect(components["Text"]?["properties"]?["text"] != nil)
    let requiredFieldsByComponent = [
      "Button": ["child", "action"],
      "CheckBox": ["label", "value"],
      "ChoicePicker": ["options", "value"],
      "DateTimeInput": ["value"],
      "Slider": ["value", "max"],
      "TextField": ["label", "value"],
    ]
    for (name, requiredFields) in requiredFieldsByComponent {
      let component = try #require(components[name])
      let properties = try #require(component["properties"]?.objectValue)
      let required = try #require(component["required"]?.arrayValue)
      #expect(properties["component"]?["const"]?.stringValue == name)
      #expect(required.contains(.string("component")))
      for field in requiredFields {
        #expect(properties[field] != nil, "\(name).\(field)")
        #expect(required.contains(.string(field)), "\(name).\(field)")
      }
      for field in ["id", "@catalogId", "@accessibility", "@metadata"] {
        #expect(properties[field] == nil, "\(name).\(field)")
      }
      #expect(
        component["allOf"]?.arrayValue?.first?["$ref"]?.stringValue
          == "common_types.json#/$defs/Checkable"
      )
    }
    let button = try #require(components["Button"])
    #expect(
      button["properties"]?["child"]?["$ref"]?.stringValue == "common_types.json#/$defs/Child"
    )
    let schemaBase = try #require(
      URL(string: "https://a2ui.org/specification/v1_0/inline-catalog.json")
    )
    let buttonSchema = try Schema(
      rawSchema: button,
      context: A2UISchemaRegistry.makeContext(),
      baseURI: schemaBase
    )
    let validButton = try JSONValue.parse(
      """
      {"component": "Button", "child": "label", "action": {"event": {"name": "submit"}}}
      """
    )
    #expect(buttonSchema.validate(validButton).isValid)
    let missingAction = try JSONValue.parse(#"{"component": "Button", "child": "label"}"#)
    #expect(!buttonSchema.validate(missingAction).isValid)
    let invalidChecks = try JSONValue.parse(
      """
      {"component": "Button", "child": "label", "action": {"event": {"name": "submit"}},
       "@checks": "not an array"}
      """
    )
    #expect(!buttonSchema.validate(invalidChecks).isValid)
  }
}
