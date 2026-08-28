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

  // MARK: - Path Subscript: Edge Cases

  @Test func subscriptGetHandlesDeepNesting() {
    let value: JSONValue = [
      "a": ["b": ["c": ["d": "deep"]]]
    ]
    #expect(value["a/b/c/d"]?.stringValue == "deep")
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

  @Test func subscriptSetAutoVivifiesArrayFromPrimitive() {
    var value: JSONValue = "primitive"
    value["0/name"] = "Alice"
    #expect(value.arrayValue?.count == 1)
    #expect(value["0/name"]?.stringValue == "Alice")
  }
}
