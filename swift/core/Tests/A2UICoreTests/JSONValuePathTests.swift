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

import A2UICore
import OrderedJSON
import Testing

struct JSONValuePathTests {

  // MARK: - Type Accessors

  @Test func stringValueReturnsString() {
    let value: JSONValue = "hello"
    #expect(value.stringValue == "hello")
  }

  @Test func stringValueReturnsNilForNonString() {
    let value: JSONValue = 42
    #expect(value.stringValue == nil)
  }

  @Test func doubleValueReturnsDoubleFromNumber() {
    let value: JSONValue = .number(3.14)
    #expect(value.doubleValue == 3.14)
  }

  @Test func doubleValueReturnsDoubleFromInteger() {
    let value: JSONValue = .integer(42)
    #expect(value.doubleValue == 42.0)
  }

  @Test func intValueReturnsFromInteger() {
    let value: JSONValue = .integer(42)
    #expect(value.intValue == 42)
  }

  @Test func intValueReturnsFromWholeNumber() {
    let value: JSONValue = .number(42.0)
    #expect(value.intValue == 42)
  }

  @Test func intValueReturnsNilForFractional() {
    let value: JSONValue = .number(3.14)
    #expect(value.intValue == nil)
  }

  @Test func boolValueReturnsBool() {
    let value: JSONValue = true
    #expect(value.boolValue == true)
  }

  @Test func boolValueReturnsNilForNonBool() {
    let value: JSONValue = "true"
    #expect(value.boolValue == nil)
  }

  @Test func arrayValueReturnsArray() {
    let value: JSONValue = [1, 2, 3]
    #expect(value.arrayValue?.count == 3)
  }

  @Test func dictionaryValueReturnsDict() {
    let value: JSONValue = ["name": "Alice", "age": 30]
    let dict = value.dictionaryValue
    #expect(dict != nil)
    #expect(dict?["name"]?.stringValue == "Alice")
  }

  // MARK: - Path Subscript: Get

  @Test func subcriptGetReturnsRootForEmptyPath() {
    let value: JSONValue = ["name": "Alice"]
    #expect(value[""] != nil)
  }

  @Test func subscriptGetReturnsNestedValue() {
    let value: JSONValue = [
      "user": ["name": "Alice"],
    ]
    #expect(value["user/name"]?.stringValue == "Alice")
  }

  @Test func subscriptGetReturnsNilForMissingKey() {
    let value: JSONValue = ["name": "Alice"]
    #expect(value["age"] == nil)
  }

  @Test func subscriptGetReturnsArrayElement() {
    let value: JSONValue = [
      "items": ["a", "b", "c"],
    ]
    #expect(value["items/1"]?.stringValue == "b")
  }

  @Test func subscriptGetReturnsNilForInvalidArrayIndex() {
    let value: JSONValue = [
      "items": ["a", "b"],
    ]
    #expect(value["items/5"] == nil)
  }

  @Test func subscriptGetHandlesDeepNesting() {
    let value: JSONValue = [
      "a": ["b": ["c": ["d": "deep"]]],
    ]
    #expect(value["a/b/c/d"]?.stringValue == "deep")
  }

  // MARK: - Path Subscript: Set

  @Test func subscriptSetSetsNestedValue() {
    var value: JSONValue = ["name": "Alice"]
    value["name"] = "Bob"
    #expect(value["name"]?.stringValue == "Bob")
  }

  @Test func subscriptSetCreatesNestedPath() {
    var value: JSONValue = JSONValue.object([:])
    value["user/name"] = "Alice"
    #expect(value["user/name"]?.stringValue == "Alice")
  }

  @Test func subscriptSetRootToArray() {
    var value: JSONValue = ["name": "Alice"]
    value[""] = [1, 2, 3]
    #expect(value.arrayValue?.count == 3)
    #expect(value["0"]?.intValue == 1)
  }

  @Test func subscriptSetRootToPrimitive() {
    var value: JSONValue = ["name": "Alice"]
    value[""] = JSONValue.string("hello")
    #expect(value == .string("hello"))
  }

  @Test func subscriptSetAppendsToArray() {
    var value: JSONValue = [
      "items": [1, 2, 3],
    ]
    value["items/3"] = 4
    #expect(value["items"]?.arrayValue?.count == 4)
    #expect(value["items/3"]?.intValue == 4)
  }

  @Test func subscriptSetReplacesArrayElement() {
    var value: JSONValue = [
      "items": [1, 2, 3],
    ]
    value["items/1"] = 99
    #expect(value["items/1"]?.intValue == 99)
  }

  @Test func subscriptSetDeletesByKey() {
    var value: JSONValue = ["name": "Alice", "age": 30]
    value["name"] = nil
    #expect(value["name"] == nil)
    #expect(value["age"]?.intValue == 30)
  }

  @Test func subscriptSetDeletesByArrayIndex() {
    var value: JSONValue = [
      "items": [1, 2, 3],
    ]
    value["items/1"] = nil
    // Setting an array index to nil preserves length (sparse array)
    #expect(value["items"]?.arrayValue?.count == 3)
    #expect(value["items/0"]?.intValue == 1)
    #expect(value["items/1"] == .null)
    #expect(value["items/2"]?.intValue == 3)
  }

  @Test func subscriptSetAutoVivifiesObjectFromArray() {
    var value: JSONValue = [
      "items": [["name": "Alice"]],
    ]
    value["items/0/age"] = 30
    #expect(value["items/0/age"]?.intValue == 30)
    #expect(value["items/0/name"]?.stringValue == "Alice")
  }

  @Test func subscriptSetAutoVivifiesArrayFromPrimitive() {
    var value: JSONValue = "primitive"
    value["0/name"] = "Alice"
    #expect(value.arrayValue?.count == 1)
    #expect(value["0/name"]?.stringValue == "Alice")
  }

  // MARK: - absolutePath

  @Test func absolutePathResolvesAbsolutePath() {
    let result = JSONValue.absolutePath(for: "/user/name", in: "/user")
    #expect(result == "/user/name")
  }

  @Test func absolutePathResolvesRelativePath() {
    let result = JSONValue.absolutePath(for: "name", in: "/user")
    #expect(result == "/user/name")
  }

  @Test func absolutePathResolvesRelativePathWithNilBase() {
    let result = JSONValue.absolutePath(for: "name", in: nil)
    #expect(result == "/name")
  }

  @Test func absolutePathResolvesRelativePathWithEmptyBase() {
    let result = JSONValue.absolutePath(for: "name", in: "")
    #expect(result == "/name")
  }

  @Test func absolutePathHandlesTrailingSlashInBase() {
    let result = JSONValue.absolutePath(for: "name", in: "/user/")
    #expect(result == "/user/name")
  }
}
