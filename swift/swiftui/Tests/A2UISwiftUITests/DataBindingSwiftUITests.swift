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
import A2UISwiftUI
import SwiftUI
import Testing

private final class TestBox<T>: @unchecked Sendable {
  var value: T
  init(_ value: T) { self.value = value }
}

@MainActor
struct DataBindingSwiftUITests {

  @Test func swiftUIBindingGetsValue() {
    let box = TestBox("hello")
    let binding = DataBinding<String>(
      identity: .path("/text"),
      value: "hello",
      set: { box.value = $0 }
    )
    let swiftBinding = binding.swiftUIBinding
    #expect(swiftBinding.wrappedValue == "hello")
  }

  @Test func swiftUIBindingSetsValue() {
    let box = TestBox("hello")
    let binding = DataBinding<String>(
      identity: .path("/text"),
      value: "hello",
      set: { box.value = $0 }
    )
    let swiftBinding = binding.swiftUIBinding
    swiftBinding.wrappedValue = "world"
    #expect(box.value == "world")
  }

  @Test func swiftUIBindingGetsAndSetsValue() {
    let box = TestBox(42.0)
    let binding = DataBinding<Double>(
      identity: .path("/value"),
      value: 42.0,
      set: { box.value = $0 }
    )
    let swiftBinding = binding.swiftUIBinding
    #expect(swiftBinding.wrappedValue == 42.0)
    swiftBinding.wrappedValue = 99.0
    #expect(box.value == 99.0)
  }

  @Test func swiftUIBindingWithDefaultFallback() {
    let box = TestBox("default")
    let binding = DataBinding<String>(
      identity: .path("/text"),
      value: nil,
      set: { box.value = $0 }
    )
    let swiftBinding = binding.swiftUIBinding(default: "fallback")
    #expect(swiftBinding.wrappedValue == "fallback")
    swiftBinding.wrappedValue = "updated"
    #expect(box.value == "updated")
  }

  @Test func stringBindingDefaultsToEmptyString() {
    let box = TestBox("")
    let binding = DataBinding<String>(
      identity: .path("/text"),
      value: nil,
      set: { box.value = $0 }
    )
    let swiftBinding = binding.stringBinding
    #expect(swiftBinding.wrappedValue == "")
    swiftBinding.wrappedValue = "typed"
    #expect(box.value == "typed")
  }

  @Test func nodeBindingAccessors() {
    let boxString = TestBox("initial")
    let boxDouble = TestBox(0.45)
    let boxBool = TestBox(true)
    let boxList = TestBox(["a", "b"])

    let node = Node(
      id: "testNode",
      type: "form",
      properties: [
        "title": DataBinding<String>(
          identity: .path("/title"), value: "initial", set: { boxString.value = $0 }),
        "progress": DataBinding<Double>(
          identity: .path("/progress"), value: 0.45, set: { boxDouble.value = $0 }),
        "active": DataBinding<Bool>(
          identity: .path("/active"), value: true, set: { boxBool.value = $0 }),
        "tags": DataBinding<[String]>(
          identity: .path("/tags"), value: ["a", "b"], set: { boxList.value = $0 }),
      ]
    )

    let strBinding = node.binding(for: "title", default: "")
    #expect(strBinding.wrappedValue == "initial")
    strBinding.wrappedValue = "new title"
    #expect(boxString.value == "new title")

    let dblBinding = node.binding(for: "progress", default: 0.0)
    #expect(dblBinding.wrappedValue == 0.45)
    dblBinding.wrappedValue = 0.9
    #expect(boxDouble.value == 0.9)

    let bBinding = node.binding(for: "active", default: false)
    #expect(bBinding.wrappedValue == true)
    bBinding.wrappedValue = false
    #expect(boxBool.value == false)

    let listBinding = node.binding(for: "tags", default: [String]())
    #expect(listBinding.wrappedValue == ["a", "b"])
    listBinding.wrappedValue = ["c"]
    #expect(boxList.value == ["c"])

    // Optional binding
    let optBinding: Binding<String?> = node.optionalBinding(for: "title")
    #expect(optBinding.wrappedValue == "initial")
    optBinding.wrappedValue = "opt title"
    #expect(boxString.value == "opt title")

    // Fallbacks for missing properties
    let missingNode = Node(id: "empty", type: "form", properties: [:])
    #expect(missingNode.binding(for: "missing", default: "fallback").wrappedValue == "fallback")
    #expect(missingNode.binding(for: "missing", default: Double(1.0)).wrappedValue == 1.0)
    #expect(missingNode.binding(for: "missing", default: true).wrappedValue == true)
    let missingOpt: Binding<Double?> = missingNode.optionalBinding(for: "missing")
    #expect(missingOpt.wrappedValue == nil)
  }
}
