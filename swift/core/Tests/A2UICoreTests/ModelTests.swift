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
import JSONSchema
import OrderedJSON
import Testing

struct NodeTests {

  // MARK: - Initialization

  @Test func nodeInitializesWithIDTypeAndProperties() {
    let node = Node(
      id: "btn1",
      type: "button",
      properties: ["label": "Click Me"]
    )
    #expect(node.id == "btn1")
    #expect(node.type == "button")
    #expect(node.catalogID == nil)
    #expect(node.properties["label"] as? String == "Click Me")
  }

  @Test func nodeStoresCatalogID() {
    let node = Node(
      id: "btn1",
      type: "button",
      catalogID: "catA",
      properties: [:]
    )
    #expect(node.catalogID == "catA")
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

  @Test func allChildNodesCollectsFromNestedStructures() {
    let tabChild1 = Node(id: "tab1-col", type: "column", properties: [:])
    let tabChild2 = Node(id: "tab2-col", type: "column", properties: [:])
    let tab1 = ResolvedDictionary(["title": "Tab 1", "child": tabChild1])
    let tab2 = ResolvedDictionary(["title": "Tab 2", "child": tabChild2])
    let tabs = Node(
      id: "tabs1",
      type: "Tabs",
      properties: ["tabs": ResolvedArray([tab1, tab2])]
    )
    #expect(tabs.allChildNodes.count == 2)
    let ids = Set(tabs.allChildNodes.map(\.id))
    #expect(ids == ["tab1-col", "tab2-col"])
  }

  // MARK: - Validation Checks

  @Test func checksCollectsFromStandardChecksProperty() {
    let check1 = ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(true)), value: true),
      message: "Pass"
    )
    let check2 = ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(false)), value: false),
      message: "Fail"
    )
    let node = Node(
      id: "input1",
      type: "textField",
      properties: ["checks": [check1, check2]]
    )
    #expect(node.checks.count == 2)
    #expect(!node.isValid)
    #expect(node.validationErrors == ["Fail"])
  }

  @Test func checksCollectsFromCustomNamedAndSingleCheckProperties() {
    let check1 = ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(true)), value: true),
      message: "Custom check pass"
    )
    let check2 = ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(false)), value: false),
      message: "Single rule fail"
    )
    let node = Node(
      id: "input2",
      type: "customInput",
      properties: [
        "rules": [check1],
        "validation": check2,
      ]
    )
    #expect(node.checks.count == 2)
    #expect(!node.isValid)
    #expect(node.validationErrors == ["Single rule fail"])
  }
  // MARK: - Equality

  @Test func nodesEqualByIDTypeAndProperties() {
    let a = Node(id: "btn1", type: "button", properties: ["label": "OK"])
    let b = Node(id: "btn1", type: "button", properties: ["label": "OK"])
    #expect(a == b)
  }

  @Test func nodesNotEqualByDifferentID() {
    let a = Node(id: "btn1", type: "button", properties: [:])
    let b = Node(id: "btn2", type: "button", properties: [:])
    #expect(a != b)
  }

  @Test func nodesNotEqualByDifferentType() {
    let a = Node(id: "btn1", type: "button", properties: [:])
    let b = Node(id: "btn1", type: "text", properties: [:])
    #expect(a != b)
  }

  @Test func nodesNotEqualByDifferentCatalogID() {
    let a = Node(id: "btn1", type: "button", catalogID: "catalogA", properties: [:])
    let b = Node(id: "btn1", type: "button", catalogID: "catalogB", properties: [:])
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

  // MARK: - Typed Property Accessors

  @Test func stringAccessorUnwrapsLiteralAndBinding() {
    let literalNode = Node(id: "n1", type: "text", properties: ["text": "hello"])
    #expect(literalNode.string(for: "text") == "hello")

    let boundNode = Node(
      id: "n2",
      type: "text",
      properties: ["text": DataBinding<String>(identity: .path("/msg"), value: "world")]
    )
    #expect(boundNode.string(for: "text") == "world")

    let missingNode = Node(id: "n4", type: "text", properties: [:])
    #expect(missingNode.string(for: "text") == nil)
  }

  @Test func doubleAccessorUnwrapsLiteralAndBinding() {
    let doubleNode = Node(id: "n1", type: "slider", properties: ["max": 100.5])
    #expect(doubleNode.double(for: "max") == 100.5)

    let boundNode = Node(
      id: "n2",
      type: "slider",
      properties: ["value": DataBinding<Double>(identity: .path("/val"), value: 0.45)]
    )
    #expect(boundNode.double(for: "value") == 0.45)

    let missingNode = Node(id: "n3", type: "slider", properties: [:])
    #expect(missingNode.double(for: "max") == nil)
  }

  @Test func intAccessorUnwrapsLiteralAndBinding() {
    let intNode = Node(id: "n1", type: "item", properties: ["weight": 5])
    #expect(intNode.int(for: "weight") == 5)

    let boundNode = Node(
      id: "n2",
      type: "item",
      properties: ["weight": DataBinding<Int>(identity: .path("/w"), value: 10)]
    )
    #expect(boundNode.int(for: "weight") == 10)

    let missingNode = Node(id: "n3", type: "item", properties: [:])
    #expect(missingNode.int(for: "weight") == nil)
  }

  @Test func boolAccessorUnwrapsLiteralAndBinding() {
    let boolNode = Node(id: "n1", type: "checkbox", properties: ["enabled": true])
    #expect(boolNode.bool(for: "enabled") == true)

    let boundNode = Node(
      id: "n2",
      type: "checkbox",
      properties: ["value": DataBinding<Bool>(identity: .path("/checked"), value: false)]
    )
    #expect(boundNode.bool(for: "value") == false)
  }

  @Test func childAndChildrenAccessors() {
    let child1 = Node(id: "c1", type: "text", properties: [:])
    let child2 = Node(id: "c2", type: "text", properties: [:])
    let parent = Node(
      id: "p",
      type: "card",
      properties: [
        "child": child1,
        "children": [child1, child2],
      ]
    )

    #expect(parent.child(for: "child")?.id == "c1")
    #expect(parent.children(for: "children").count == 2)
    #expect(parent.children(for: "children").map(\.id) == ["c1", "c2"])
  }
}

/// A mutable box for testing `DataBinding` closures in a Sendable context.
final class Box<T>: @unchecked Sendable {
  var value: T
  init(_ value: T) { self.value = value }
}

struct DataBindingTests {

  // MARK: - Path-based Binding

  @Test func dataBindingValueReturnsResolvedValue() {
    let binding = DataBinding<String>(
      identity: .path("/user/name"),
      value: "initial",
      set: { _ in }
    )
    #expect(binding.value == "initial")
  }

  @Test func dataBindingSetUpdatesViaSetter() {
    let box = Box("initial")
    let binding = DataBinding<String>(
      identity: .path("/user/name"),
      value: "initial",
      set: { box.value = $0 }
    )
    binding.set("updated")
    #expect(box.value == "updated")
  }

  @Test func dataBindingWithNilValue() {
    let binding = DataBinding<String>(
      identity: .path("/user/name"),
      value: nil
    )
    #expect(binding.value == nil)
  }

  // MARK: - Literal Binding

  @Test func literalDataBindingHasLiteralIdentityAndValue() {
    let binding = DataBinding<JSONValue>(
      identity: .literal(.string("hello")),
      value: .string("hello")
    )
    if case .literal(let val) = binding.identity {
      #expect(val.stringValue == "hello")
    } else {
      Issue.record("Expected .literal identity")
    }
    #expect(binding.value?.stringValue == "hello")
  }

  // MARK: - Equality

  @Test func dataBindingsEqualByIdentityAndValue() {
    let a = DataBinding<String>(
      identity: .path("/user/name"),
      value: "Alice"
    )
    let b = DataBinding<String>(
      identity: .path("/user/name"),
      value: "Alice"
    )
    #expect(a == b)
  }

  @Test func dataBindingsNotEqualByDifferentValue() {
    let a = DataBinding<String>(
      identity: .path("/user/name"),
      value: "Alice"
    )
    let b = DataBinding<String>(
      identity: .path("/user/name"),
      value: "Bob"
    )
    #expect(a != b)
  }

  @Test func dataBindingsNotEqualByDifferentPath() {
    let a = DataBinding<String>(
      identity: .path("/user/name"),
      value: "Alice"
    )
    let b = DataBinding<String>(
      identity: .path("/user/email"),
      value: "Alice"
    )
    #expect(a != b)
  }

  @Test func dataBindingsNotEqualByDifferentIdentityType() {
    let a = DataBinding<String>(
      identity: .path("/user/name"),
      value: "name"
    )
    let b = DataBinding<String>(
      identity: .literal(.string("name")),
      value: "name"
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

  @Test func componentPropertiesInequalityByDifferentJSON() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let a = ComponentProperties(type: "button", schema: schema, json: ["id": "btn1"])
    let b = ComponentProperties(type: "button", schema: schema, json: ["id": "btn2"])
    #expect(a != b)
  }
}
