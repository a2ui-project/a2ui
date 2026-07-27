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
import JSONSchema
import OrderedJSON
import Testing

struct NodeTests {

  // MARK: - Initialization

  @Test func nodeInitializesWithIdTypeAndProperties() {
    let node = Node(
      id: "btn1",
      type: "button",
      properties: ["label": "Click Me"]
    )
    #expect(node.id == "btn1")
    #expect(node.type == "button")
    #expect(node.properties["label"] as? String == "Click Me")
  }

  // MARK: - allChildNodes

  @Test func allChildNodesCollectsFromStandardChildrenProperty() {
    let child1 = Node(id: "c1", type: "text", properties: [:])
    let child2 = Node(id: "c2", type: "text", properties: [:])
    let parent = Node(
      id: "parent",
      type: "column",
      properties: ["children": [child1, child2]]
    )
    #expect(parent.allChildNodes.count == 2)
  }

  @Test func allChildNodesCollectsFromSingularChildProperty() {
    let label = Node(id: "label1", type: "text", properties: [:])
    let button = Node(
      id: "btn1",
      type: "button",
      properties: ["child": label]
    )
    #expect(button.allChildNodes.count == 1)
    #expect(button.allChildNodes[0].id == "label1")
  }

  @Test func allChildNodesCollectsFromCustomNamedChildProperties() {
    // Simulates a custom catalog component like "FoodAndDrinkCard" that
    // uses non-standard property names typed as ChildList.
    let food1 = Node(id: "f1", type: "text", properties: [:])
    let food2 = Node(id: "f2", type: "text", properties: [:])
    let drink1 = Node(id: "d1", type: "text", properties: [:])
    let card = Node(
      id: "card1",
      type: "FoodAndDrinkCard",
      properties: [
        "foodChildren": [food1, food2],
        "drinkChildren": [drink1],
      ]
    )
    #expect(card.allChildNodes.count == 3)
    let ids = Set(card.allChildNodes.map(\.id))
    #expect(ids == ["f1", "f2", "d1"])
  }

  @Test func allChildNodesIgnoresNonNodeProperties() {
    let child = Node(id: "c1", type: "text", properties: [:])
    let parent = Node(
      id: "parent",
      type: "container",
      properties: [
        "children": [child],
        "label": "Container Title",
        "weight": 1.0,
        "visible": true,
      ]
    )
    #expect(parent.allChildNodes.count == 1)
    #expect(parent.allChildNodes[0].id == "c1")
  }

  @Test func allChildNodesReturnsEmptyWhenNoChildren() {
    let node = Node(id: "btn1", type: "button", properties: ["label": "OK"])
    #expect(node.allChildNodes.isEmpty)
  }

  // MARK: - Equality

  @Test func nodesEqualByIdTypeAndProperties() {
    let a = Node(id: "btn1", type: "button", properties: ["label": "OK"])
    let b = Node(id: "btn1", type: "button", properties: ["label": "OK"])
    #expect(a == b)
  }

  @Test func nodesNotEqualByDifferentId() {
    let a = Node(id: "btn1", type: "button", properties: [:])
    let b = Node(id: "btn2", type: "button", properties: [:])
    #expect(a != b)
  }

  @Test func nodesNotEqualByDifferentType() {
    let a = Node(id: "btn1", type: "button", properties: [:])
    let b = Node(id: "btn1", type: "text", properties: [:])
    #expect(a != b)
  }

  @Test func nodesNotEqualByDifferentProperties() {
    let a = Node(id: "btn1", type: "button", properties: ["label": "OK"])
    let b = Node(id: "btn1", type: "button", properties: ["label": "Cancel"])
    #expect(a != b)
  }

  @Test func nodesEqualWithNestedChildren() {
    let child = Node(id: "c1", type: "text", properties: ["text": "hello"])
    let a = Node(id: "parent", type: "container", properties: ["children": [child]])
    let b = Node(id: "parent", type: "container", properties: ["children": [child]])
    #expect(a == b)
  }

  @Test func nodesNotEqualWithDifferentChildren() {
    let child1 = Node(id: "c1", type: "text", properties: [:])
    let child2 = Node(id: "c2", type: "text", properties: [:])
    let a = Node(id: "parent", type: "container", properties: ["children": [child1]])
    let b = Node(id: "parent", type: "container", properties: ["children": [child2]])
    #expect(a != b)
  }
}

/// A mutable box for testing `DataBinding` closures in a Sendable context.
final class Box<T>: @unchecked Sendable {
  var value: T
  init(_ value: T) { self.value = value }
}

struct DataBindingTests {

  // MARK: - Path-based Binding

  @Test func dataBindingGetReturnsCurrentValue() {
    let box = Box("initial")
    let binding = DataBinding<String>(
      identity: .path("/user/name"),
      get: { box.value },
      set: { box.value = $0 }
    )
    #expect(binding.get() == "initial")
  }

  @Test func dataBindingSetUpdatesValue() {
    let box = Box("initial")
    let binding = DataBinding<String>(
      identity: .path("/user/name"),
      get: { box.value },
      set: { box.value = $0 }
    )
    binding.set("updated")
    #expect(binding.get() == "updated")
  }

  // MARK: - Literal Binding

  @Test func literalDataBindingHasLiteralIdentity() {
    let box = Box(JSONValue.string("hello"))
    let binding = DataBinding<JSONValue>(
      identity: .literal(.string("hello")),
      get: { box.value },
      set: { box.value = $0 }
    )
    if case .literal(let val) = binding.identity {
      #expect(val.stringValue == "hello")
    } else {
      Issue.record("Expected .literal identity")
    }
  }

  // MARK: - Equality

  @Test func dataBindingsEqualByIdentity() {
    let box = Box("")
    let a = DataBinding<String>(
      identity: .path("/user/name"),
      get: { box.value },
      set: { box.value = $0 }
    )
    let b = DataBinding<String>(
      identity: .path("/user/name"),
      get: { box.value },
      set: { box.value = $0 }
    )
    #expect(a == b)
  }

  @Test func dataBindingsNotEqualByDifferentPath() {
    let box = Box("")
    let a = DataBinding<String>(
      identity: .path("/user/name"),
      get: { box.value },
      set: { box.value = $0 }
    )
    let b = DataBinding<String>(
      identity: .path("/user/email"),
      get: { box.value },
      set: { box.value = $0 }
    )
    #expect(a != b)
  }

  @Test func dataBindingsNotEqualByDifferentIdentityType() {
    let box = Box("")
    let a = DataBinding<String>(
      identity: .path("/user/name"),
      get: { box.value },
      set: { box.value = $0 }
    )
    let b = DataBinding<String>(
      identity: .literal(.string("name")),
      get: { box.value },
      set: { box.value = $0 }
    )
    #expect(a != b)
  }
}

struct ComponentPropertiesTests {

  @Test func componentPropertiesInitializesCorrectly() throws {
    let schema = try Schema(
      instance: """
        {"type": "object", "properties": {"id": {"type": "string"}}}
        """
    )
    let json: JSONValue = ["id": "btn1"]
    let props = ComponentProperties(type: "button", schema: schema, json: json)
    #expect(props.type == "button")
    #expect(props.json["id"]?.stringValue == "btn1")
  }

  @Test func componentPropertiesEquality() throws {
    let schema = try Schema(
      instance: """
        {"type": "object"}
        """
    )
    let json: JSONValue = ["id": "btn1"]
    let a = ComponentProperties(type: "button", schema: schema, json: json)
    let b = ComponentProperties(type: "button", schema: schema, json: json)
    #expect(a == b)
  }

  @Test func componentPropertiesInequalityByDifferentType() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let json: JSONValue = ["id": "btn1"]
    let a = ComponentProperties(type: "button", schema: schema, json: json)
    let b = ComponentProperties(type: "text", schema: schema, json: json)
    #expect(a != b)
  }

  @Test func componentPropertiesInequalityByDifferentJson() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let a = ComponentProperties(type: "button", schema: schema, json: ["id": "btn1"])
    let b = ComponentProperties(type: "button", schema: schema, json: ["id": "btn2"])
    #expect(a != b)
  }
}
