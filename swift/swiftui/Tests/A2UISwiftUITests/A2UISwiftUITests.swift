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
import A2UIJSON
import A2UISwiftUI
import JSONSchema
import OrderedJSON
import SwiftUI
import Testing

// MARK: - Test Helpers

/// A simple view for testing that renders a component node's type and ID.
struct TestComponentView: View {
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
    let viewModel = SurfaceViewModel(
      surfaceID: "s1",
      catalog: catalog
    )
    let catalogImplementation = CatalogImplementation()
    let surface = Surface(
      viewModel: viewModel,
      catalogImplementation: catalogImplementation
    )
    #expect(surface.surfaceID == "s1")
  }

  @Test func surfaceIDMatchesViewModel() throws {
    let catalog = try makeTestSurfaceCatalogForRendering()
    let viewModel = SurfaceViewModel(
      surfaceID: "s1",
      catalog: catalog
    )
    let firstSurface = Surface(
      viewModel: viewModel
    )
    let secondSurface = Surface(
      viewModel: viewModel
    )
    #expect(firstSurface.surfaceID == secondSurface.surfaceID)
  }

  @Test func surfaceDifferentSurfaceIDs() throws {
    let catalog = try makeTestSurfaceCatalogForRendering()
    let firstViewModel = SurfaceViewModel(
      surfaceID: "s1",
      catalog: catalog
    )
    let secondViewModel = SurfaceViewModel(
      surfaceID: "s2",
      catalog: catalog
    )
    let firstSurface = Surface(
      viewModel: firstViewModel
    )
    let secondSurface = Surface(
      viewModel: secondViewModel
    )
    #expect(firstSurface.surfaceID != secondSurface.surfaceID)
  }
}

// MARK: - DataBinding+SwiftUI Tests

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
}

// MARK: - Theme Environment Tests

struct ThemeEnvironmentTests {

  @Test func themeKeyDefaultValueIsNil() {
    #expect(A2UIThemeKey.defaultValue == nil)
  }

  @Test func themeEnvironmentCanBeSet() throws {
    let theme: [String: JSONValue] = ["color": .string("blue")]
    var environment = EnvironmentValues()
    environment.a2uiTheme = theme
    #expect(environment.a2uiTheme != nil)
    #expect(environment.a2uiTheme?["color"]?.stringValue == "blue")
  }

  @Test func themeEnvironmentDefaultsToNil() {
    let environment = EnvironmentValues()
    #expect(environment.a2uiTheme == nil)
  }
}

// MARK: - CatalogImplementation Tests

@MainActor
struct CatalogImplementationTests {

  @Test func componentKeyEquality() {
    let firstKey = ComponentKey(
      catalogID: "catalogA",
      type: "button"
    )
    let secondKey = ComponentKey(
      catalogID: "catalogA",
      type: "button"
    )
    let thirdKey = ComponentKey(
      catalogID: "catalogB",
      type: "button"
    )
    #expect(firstKey == secondKey)
    #expect(firstKey != thirdKey)
  }

  @Test func catalogImplementationResolvesUnqualifiedFallback() {
    let catalogImplementation = CatalogImplementation()
    catalogImplementation.register(
      type: "button",
      builder: { node in AnyView(Text(node.type)) }
    )
    let builder = catalogImplementation.builder(
      catalogID: "catalogA",
      type: "button"
    )
    #expect(builder != nil)

    let node = Node(
      id: "btn1",
      type: "button",
      catalogID: "catalogA",
      properties: [:]
    )
    let renderedView = Surface.render(node: node, using: catalogImplementation)
    #expect(renderedView != nil)
  }

  @Test func catalogImplementationResolvesQualifiedKeyOverFallback() {
    let catalogImplementation = CatalogImplementation()
    var qualifiedCalled = false
    var fallbackCalled = false

    catalogImplementation.register(
      catalogID: "catalogA",
      type: "button",
      builder: { _ in
        qualifiedCalled = true
        return AnyView(Text("Qualified"))
      }
    )
    catalogImplementation.register(
      type: "button",
      builder: { _ in
        fallbackCalled = true
        return AnyView(Text("Fallback"))
      }
    )

    let node = Node(
      id: "btn1",
      type: "button",
      catalogID: "catalogA",
      properties: [:]
    )
    _ = Surface.render(node: node, using: catalogImplementation)
    #expect(qualifiedCalled)
    #expect(!fallbackCalled)
  }

  @Test func catalogImplementationRegistersComponentImplementation() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    var builderCalled = false
    let component = ComponentImplementation(
      name: "map",
      schema: schema
    ) { _ in
      builderCalled = true
      return AnyView(Text("Map"))
    }

    #expect(component.name == "map")
    #expect(component.api.name == "map")
    #expect(component.schema == schema)

    let catalogImplementation = CatalogImplementation(
      catalogID: "mapsCatalog",
      components: [component]
    )

    let node = Node(
      id: "map1",
      type: "map",
      catalogID: "mapsCatalog",
      properties: [:]
    )
    _ = Surface.render(node: node, using: catalogImplementation)
    #expect(builderCalled)
  }

  @Test func catalogImplementationEnvironmentDefaultsToNil() {
    let environment = EnvironmentValues()
    #expect(environment.a2uiCatalogImplementation == nil)
  }

  @Test func catalogImplementationEnvironmentCanBeSet() {
    var environment = EnvironmentValues()
    let catalogImplementation = CatalogImplementation()
    environment.a2uiCatalogImplementation = catalogImplementation
    #expect(environment.a2uiCatalogImplementation != nil)
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
    components: [
      ComponentAPI(
        name: "text",
        schema: textSchema
      )
    ]
  )
}
