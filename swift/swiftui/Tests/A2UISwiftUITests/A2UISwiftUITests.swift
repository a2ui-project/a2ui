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
import A2UIJSON
import A2UISwiftUI
import JSONSchema
import OrderedJSON
import SwiftUI
import Testing

// MARK: - Test Helpers

/// A simple catalog view for testing that renders a text label.
struct TestCatalogView: CatalogView {
  let node: Node

  init(node: Node) {
    self.node = node
  }

  var body: some View {
    VStack {
      Text("Type: \(node.type)")
      Text("ID: \(node.id)")
    }
  }
}



// MARK: - Surface Tests

@MainActor
struct SurfaceTests {

  @Test func surfaceInitializesWithViewModel() throws {
    let catalog = try makeTestSurfaceCatalogForRendering()
    let vm = SurfaceViewModel(surfaceID: "s1", catalog: catalog)
    let surface = Surface<TestCatalogView>(viewModel: vm, catalogType: TestCatalogView.self)
    #expect(surface.surfaceID == "s1")
  }

  @Test func surfaceIDMatchesViewModel() throws {
    let catalog = try makeTestSurfaceCatalogForRendering()
    let vm = SurfaceViewModel(surfaceID: "s1", catalog: catalog)
    let a = Surface<TestCatalogView>(viewModel: vm, catalogType: TestCatalogView.self)
    let b = Surface<TestCatalogView>(viewModel: vm, catalogType: TestCatalogView.self)
    #expect(a.surfaceID == b.surfaceID)
  }

  @Test func surfaceDifferentSurfaceIDs() throws {
    let catalog = try makeTestSurfaceCatalogForRendering()
    let vm1 = SurfaceViewModel(surfaceID: "s1", catalog: catalog)
    let vm2 = SurfaceViewModel(surfaceID: "s2", catalog: catalog)
    let a = Surface<TestCatalogView>(viewModel: vm1, catalogType: TestCatalogView.self)
    let b = Surface<TestCatalogView>(viewModel: vm2, catalogType: TestCatalogView.self)
    #expect(a.surfaceID != b.surfaceID)
  }
}

// MARK: - DataBinding+SwiftUI Tests

struct DataBindingSwiftUITests {

  @Test func swiftUIBindingGetsValue() {
    let box = TestBox("hello")
    let binding = DataBinding<String>(
      identity: .path("/text"),
      get: { box.value },
      set: { box.value = $0 }
    )
    let swiftBinding = binding.swiftUIBinding
    #expect(swiftBinding.wrappedValue == "hello")
  }

  @Test func swiftUIBindingSetsValue() {
    let box = TestBox("hello")
    let binding = DataBinding<String>(
      identity: .path("/text"),
      get: { box.value },
      set: { box.value = $0 }
    )
    let swiftBinding = binding.swiftUIBinding
    swiftBinding.wrappedValue = "world"
    #expect(binding.get() == "world")
  }

  @Test func swiftUIBindingGetsAndSetsValue() {
    let box = TestBox(42.0)
    let binding = DataBinding<Double>(
      identity: .path("/value"),
      get: { box.value },
      set: { box.value = $0 }
    )
    let swiftBinding = binding.swiftUIBinding
    #expect(swiftBinding.wrappedValue == 42.0)
    swiftBinding.wrappedValue = 99.0
    #expect(binding.get() == 99.0)
  }
}

// MARK: - Theme Environment Tests

struct ThemeEnvironmentTests {

  @Test func themeKeyDefaultValueIsNil() {
    #expect(A2UIThemeKey.defaultValue == nil)
  }

  @Test func themeEnvironmentCanBeSet() throws {
    let theme: [String: JSONValue] = ["color": .string("blue")]
    var env = EnvironmentValues()
    env.a2uiTheme = theme
    #expect(env.a2uiTheme != nil)
    #expect(env.a2uiTheme?["color"]?.stringValue == "blue")
  }

  @Test func themeEnvironmentDefaultsToNil() {
    let env = EnvironmentValues()
    #expect(env.a2uiTheme == nil)
  }
}

// MARK: - CatalogView Tests

struct CatalogViewTests {

  @MainActor @Test func catalogViewInitializesWithNode() {
    let node = Node(id: "test", type: "text", properties: ["label": "Hello"])
    let view = TestCatalogView(node: node)
    #expect(view.node.id == "test")
    #expect(view.node.type == "text")
  }
}

// MARK: - Helpers

/// A mutable box for testing Sendable closures.
final class TestBox<T>: @unchecked Sendable {
  var value: T
  init(_ value: T) { self.value = value }
}

/// Helper function returning a catalog with a simple text schema for rendering tests.
func makeTestSurfaceCatalogForRendering() throws -> Catalog {
  let textSchema = try Schema(
    instance: """
      {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "component": { "type": "string" },
          "text": { "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString" }
        },
        "required": ["id", "component"]
      }
      """,
    remoteSchemas: A2UICommonSchema.allSchemas
  )
  return Catalog(
    id: "default",
    components: [ComponentAPI(name: "text", schema: textSchema)]
  )
}
