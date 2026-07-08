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

  @Test func testTypeName() throws {
    #expect(JSONValue.null.typeName == "null")
    #expect(JSONValue.boolean(true).typeName == "boolean")
    #expect(JSONValue.number(1.0).typeName == "number")
    #expect(JSONValue.string("str").typeName == "string")
    #expect(JSONValue.array([]).typeName == "array")
    #expect(JSONValue.object([:]).typeName == "object")
  }

  @Test func testDecodingErrors() throws {
    // Test nested array mismatch (triggers line 52 throw)
    struct DeepArrayMismatchDecoder: Decoder {
      var codingPath: [CodingKey] = []
      var userInfo: [CodingUserInfoKey : Any] = [:]
      func container<Key>(keyedBy type: Key.Type) throws -> KeyedDecodingContainer<Key> { throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
      func unkeyedContainer() throws -> UnkeyedDecodingContainer { throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
      func singleValueContainer() throws -> SingleValueDecodingContainer {
        return MockContainer(codingPath: codingPath, arrayErrorType: .deep, objectErrorType: .none)
      }
    }

    #expect(throws: DecodingError.self) {
      _ = try JSONValue(from: DeepArrayMismatchDecoder())
    }

    // Test nested object mismatch (triggers line 64 throw)
    struct DeepObjectMismatchDecoder: Decoder {
      var codingPath: [CodingKey] = []
      var userInfo: [CodingUserInfoKey : Any] = [:]
      func container<Key>(keyedBy type: Key.Type) throws -> KeyedDecodingContainer<Key> { throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
      func unkeyedContainer() throws -> UnkeyedDecodingContainer { throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
      func singleValueContainer() throws -> SingleValueDecodingContainer {
        return MockContainer(codingPath: codingPath, arrayErrorType: .flat, objectErrorType: .deep)
      }
    }

    #expect(throws: DecodingError.self) {
      _ = try JSONValue(from: DeepObjectMismatchDecoder())
    }

    // Test unknown type mismatch (triggers line 67 throw)
    struct FlatMismatchDecoder: Decoder {
      var codingPath: [CodingKey] = []
      var userInfo: [CodingUserInfoKey : Any] = [:]
      func container<Key>(keyedBy type: Key.Type) throws -> KeyedDecodingContainer<Key> { throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
      func unkeyedContainer() throws -> UnkeyedDecodingContainer { throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
      func singleValueContainer() throws -> SingleValueDecodingContainer {
        return MockContainer(codingPath: codingPath, arrayErrorType: .flat, objectErrorType: .flat)
      }
    }

    #expect(throws: DecodingError.self) {
      _ = try JSONValue(from: FlatMismatchDecoder())
    }
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

private enum ErrorType {
  case none
  case flat
  case deep
}

private struct MockKey: CodingKey {
  var stringValue: String = "mock"
  var intValue: Int? = nil
  init() {}
  init?(stringValue: String) { self.stringValue = stringValue }
  init?(intValue: Int) { self.intValue = intValue }
}

private struct MockContainer: SingleValueDecodingContainer {
  var codingPath: [CodingKey]
  var arrayErrorType: ErrorType
  var objectErrorType: ErrorType

  func decodeNil() -> Bool { return false }
  func decode(_ type: Bool.Type) throws -> Bool { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: String.Type) throws -> String { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: Double.Type) throws -> Double { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: Float.Type) throws -> Float { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: Int.Type) throws -> Int { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: Int8.Type) throws -> Int8 { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: Int16.Type) throws -> Int16 { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: Int32.Type) throws -> Int32 { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: Int64.Type) throws -> Int64 { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: UInt.Type) throws -> UInt { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: UInt8.Type) throws -> UInt8 { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: UInt16.Type) throws -> UInt16 { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: UInt32.Type) throws -> UInt32 { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }
  func decode(_ type: UInt64.Type) throws -> UInt64 { throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: "")) }

  func decode<T>(_ type: T.Type) throws -> T where T : Decodable {
    if type == [JSONValue].self {
      switch arrayErrorType {
      case .flat:
        throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: ""))
      case .deep:
        throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath + [MockKey()], debugDescription: ""))
      case .none:
        return [] as! T
      }
    }
    if type == [String: JSONValue].self {
      switch objectErrorType {
      case .flat:
        throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: ""))
      case .deep:
        throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath + [MockKey()], debugDescription: ""))
      case .none:
        return [:] as! T
      }
    }
    throw DecodingError.typeMismatch(type, DecodingError.Context(codingPath: codingPath, debugDescription: ""))
  }
}

