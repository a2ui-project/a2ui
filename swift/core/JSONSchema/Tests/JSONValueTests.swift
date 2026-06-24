// Copyright 2026 Google LLC
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
import JSONSchema
import Testing

struct JSONValueTests {

  @Test func testDeterministicObjectEncoding() throws {
    var obj = [String: JSONValue]()
    obj["z"] = .string("last")
    obj["a"] = .string("first")
    obj["m"] = .number(42.0)
    obj["b"] = .boolean(true)
    obj["n"] = .null

    let jsonValue = JSONValue.object(obj)
    let jsonString = toString(from: jsonValue)

    // Keys are now sorted alphabetically for deterministic output
    let expectedString = """
      {"a":"first","b":true,"m":42,"n":null,"z":"last"}
      """
    #expect(jsonString == expectedString)
  }
  @Test func testRoundTripSerialization() throws {
    let jsonInput = """
      {
        "array": [1, 2, {"nested": "value"}, true, null],
        "string": "text",
        "num": 3.14,
        "bool": false,
        "nil": null
      }
      """
    let dataInput = Data(jsonInput.utf8)

    // Decode and immediately re-encode using standard library decoders/encoders
    let decoded = try JSONValue.decode(from: dataInput)
    let jsonOutput = toString(from: decoded)

    let decodedAgain = try JSONValue.decode(from: Data(jsonOutput.utf8))
    #expect(decoded == decodedAgain)
  }

  @Test func testEqualityIgnoringOrder() throws {
    // Identical trees should be ==
    var obj1 = [String: JSONValue]()
    obj1["key1"] = .string("val1")
    obj1["key2"] = .string("val2")

    var obj2 = [String: JSONValue]()
    obj2["key1"] = .string("val1")
    obj2["key2"] = .string("val2")

    #expect(JSONValue.object(obj1) == JSONValue.object(obj2))

    // Same keys but different insertion orders should be == when using standard Dictionary
    var obj3 = [String: JSONValue]()
    obj3["key2"] = .string("val2")
    obj3["key1"] = .string("val1")

    #expect(JSONValue.object(obj1) == JSONValue.object(obj3))
  }

  private func toString(from value: JSONValue) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    do {
      let data = try encoder.encode(value)
      return String(data: data, encoding: .utf8) ?? "null"
    } catch {
      return "null"
    }
  }
}
