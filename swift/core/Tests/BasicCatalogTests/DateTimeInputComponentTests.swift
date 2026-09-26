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
import BasicCatalog
import JSONSchema
import Testing

struct DateTimeInputComponentTests {

  private func instance(min: JSONValue? = nil, max: JSONValue? = nil) -> JSONValue {
    var properties: JSONValue = [
      "component": "DateTimeInput",
      "id": "root",
      "value": ["path": "/when"],
      "enableDate": true,
      "enableTime": true,
    ]
    if let min { properties["min"] = min }
    if let max { properties["max"] = max }
    return properties
  }

  @Test func validatesWithoutMinOrMax() {
    let result = BasicCatalogComponents.dateTimeInput.schema.validate(instance())
    #expect(result.isValid == true)
  }

  @Test(arguments: [
    "2026-01-01",
    "14:30:00",
    "2026-01-01T00:00:00.000Z",
  ])
  func validatesMinWithEachSupportedFormat(minValue: String) {
    let result = BasicCatalogComponents.dateTimeInput.schema.validate(
      instance(min: .string(minValue)))
    #expect(result.isValid == true)
  }

  @Test(arguments: [
    "2026-01-01",
    "14:30:00",
    "2026-01-01T00:00:00.000Z",
  ])
  func validatesMaxWithEachSupportedFormat(maxValue: String) {
    let result = BasicCatalogComponents.dateTimeInput.schema.validate(
      instance(max: .string(maxValue)))
    #expect(result.isValid == true)
  }

  @Test func rejectsMinWithMalformedDateTime() {
    let result = BasicCatalogComponents.dateTimeInput.schema.validate(
      instance(min: .string("not a date")))
    #expect(result.isValid == false)
  }

  @Test func rejectsMaxWithMalformedDateTime() {
    let result = BasicCatalogComponents.dateTimeInput.schema.validate(
      instance(max: .string("not a date")))
    #expect(result.isValid == false)
  }
}
