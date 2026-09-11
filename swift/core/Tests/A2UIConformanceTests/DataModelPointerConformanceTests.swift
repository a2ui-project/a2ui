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
import Combine
import Foundation
import OrderedCollections
import OrderedJSON
import Testing

@MainActor
struct DataModelPointerConformanceTests {
  @Test func numericAutoVivification() {
    let dataModel = DataModel()
    dataModel.set("/items/0/name", value: .string("First Item"))
    dataModel.set("/items/1/name", value: .string("Second Item"))

    let items = dataModel.get("/items")
    #expect(items?.arrayValue?.count == 2)
    #expect(dataModel.get("/items/0/name")?.stringValue == "First Item")
    #expect(dataModel.get("/items/1/name")?.stringValue == "Second Item")
  }

  @Test func sparseArrayNullPreservation() {
    let dataModel = DataModel(
      initial: .object([
        "list": .array([.string("a"), .string("b"), .string("c")])
      ])
    )

    dataModel.set("/list/1", value: nil)
    let list = dataModel.get("/list")?.arrayValue

    #expect(list?.count == 3)
    #expect(list?[0] == .string("a"))
    #expect(list?[1] == .null)
    #expect(list?[2] == .string("c"))
  }

  @Test func primitiveInTheWaySurvives() {
    let dataModel = DataModel(
      initial: .object(["user": .object(["name": .string("Alice")])])
    )

    dataModel.set("/user/name/first", value: .string("Bob"))

    // Growing an object over "Alice" would delete it, which is what a
    // malformed path from the agent used to do.
    #expect(dataModel.get("/user/name")?.stringValue == "Alice")
    #expect(dataModel.get("/user/name/first") == nil)
  }

  @Test func primitiveListElementSurvives() {
    let dataModel = DataModel(
      initial: .object(["items": .array([.string("a"), .string("b")])])
    )

    dataModel.set("/items/0/foo", value: .string("bar"))

    #expect(dataModel.get("/items")?.arrayValue == [.string("a"), .string("b")])
  }

  @Test func nonNumericKeyLeavesTheListAlone() {
    let dataModel = DataModel(
      initial: .object(["items": .array([.string("a"), .string("b")])])
    )

    dataModel.set("/items/foo", value: .string("bar"))
    dataModel.set("/items/foo/bar", value: .string("value"))

    // Either write used to replace the whole array with an object, taking
    // every element with it.
    #expect(dataModel.get("/items")?.arrayValue == [.string("a"), .string("b")])
  }

  @Test func nullIsStillFilledIn() {
    let dataModel = DataModel(initial: .object(["slot": .null]))

    dataModel.set("/slot/name", value: .string("Alice"))

    // Null is absence, not a value someone put there, so it is still grown
    // into a container.
    #expect(dataModel.get("/slot/name")?.stringValue == "Alice")
  }

  @Test func rootReplacement() {
    let dataModel = DataModel(initial: .object(["a": .integer(1)]))

    dataModel.set("/", value: .object(["b": .integer(2)]))
    #expect(dataModel.get("/a") == nil)
    #expect(dataModel.get("/b")?.intValue == 2)

    dataModel.set("", value: nil)
    #expect(dataModel.get("/") == .object([:]))
  }

  @Test func escapedPointerCharacters() {
    let dataModel = DataModel()
    dataModel.set("/escaped~1key", value: .string("Slash in key"))
    dataModel.set("/tilde~0key", value: .string("Tilde in key"))

    #expect(dataModel.get("/escaped~1key")?.stringValue == "Slash in key")
    #expect(dataModel.get("/tilde~0key")?.stringValue == "Tilde in key")
  }

  @Test func pathResolution() {
    #expect(JSONValue.absolutePath(for: "name", in: "/user") == "/user/name")
    #expect(JSONValue.absolutePath(for: "0/item", in: "/list") == "/list/0/item")
    #expect(JSONValue.absolutePath(for: "/root/name", in: "/user") == "/root/name")
    #expect(JSONValue.absolutePath(for: "name", in: nil) == "/name")
  }

  @Test func dataPublisher() {
    let dataModel = DataModel()
    var receivedValues: [JSONValue] = []
    var cancellables = Set<AnyCancellable>()

    dataModel.dataPublisher
      .sink { receivedValues.append($0) }
      .store(in: &cancellables)

    dataModel.set("/count", value: .integer(10))
    dataModel.set("/count", value: .integer(20))

    #expect(receivedValues.count >= 3)
    #expect(receivedValues.last?["count"]?.intValue == 20)
  }
}
