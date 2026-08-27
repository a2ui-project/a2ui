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
    let surface = Surface(
      viewModel: viewModel
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

// MARK: - SwiftUICatalogRendering Tests

@MainActor
struct SwiftUICatalogRenderingTests {

  @Test func catalogResolvesUnqualifiedFallback() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let buttonComponent = ComponentImplementation(name: "button", schema: schema) { node in
      AnyView(Text(node.type))
    }
    let catalog = Catalog(id: "catalogA", components: [buttonComponent])

    let node = Node(
      id: "btn1",
      type: "button",
      catalogID: "catalogA",
      properties: [:]
    )
    let renderedView = Surface.render(node: node, using: ["catalogA": catalog])
    #expect(renderedView != nil)
  }

  @Test func catalogResolvesQualifiedOverFallback() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    var qualifiedCalled = false
    var fallbackCalled = false

    let qualifiedButton = ComponentImplementation(name: "button", schema: schema) { _ in
      qualifiedCalled = true
      return AnyView(Text("Qualified"))
    }
    let fallbackButton = ComponentImplementation(name: "button", schema: schema) { _ in
      fallbackCalled = true
      return AnyView(Text("Fallback"))
    }

    let catalogA = Catalog(id: "catalogA", components: [qualifiedButton])
    let catalogB = Catalog(id: "catalogB", components: [fallbackButton])

    let node = Node(
      id: "btn1",
      type: "button",
      catalogID: "catalogA",
      properties: [:]
    )
    _ = Surface.render(
      node: node, using: ["catalogA": catalogA, "catalogB": catalogB], defaultCatalogID: "catalogB")
    #expect(qualifiedCalled)
    #expect(!fallbackCalled)
  }

  @Test func componentImplementationConformsToComponentAPIAndExposesBuilder() throws {
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
    #expect(component.schema == schema)
    let api: any ComponentAPI = component
    #expect(api.name == "map")
    #expect(api.schema == schema)

    let catalog = Catalog(id: "mapsCatalog", components: [component])
    let node = Node(
      id: "map1",
      type: "map",
      catalogID: "mapsCatalog",
      properties: [:]
    )
    _ = Surface.render(node: node, using: ["mapsCatalog": catalog])
    #expect(builderCalled)
  }

  @Test func catalogsEnvironmentDefaultsToEmpty() {
    let environment = EnvironmentValues()
    #expect(environment.a2uiCatalogs.isEmpty)
    #expect(environment.a2uiDefaultCatalogID == nil)
  }

  @Test func catalogsEnvironmentCanBeSet() throws {
    var environment = EnvironmentValues()
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let component = ComponentImplementation(name: "custom", schema: schema) { _ in
      AnyView(EmptyView())
    }
    let catalog = Catalog(id: "test", components: [component])
    environment.a2uiCatalogs = ["test": catalog]
    environment.a2uiDefaultCatalogID = "test"
    #expect(environment.a2uiCatalogs.count == 1)
    #expect(environment.a2uiDefaultCatalogID == "test")
  }
}

// MARK: - Helpers

/// A mutable box for testing Sendable closures.
final class TestBox<T>: @unchecked Sendable {
  var value: T
  init(_ value: T) { self.value = value }
}

/// Helper function returning a catalog with a simple text schema for rendering tests.
func makeTestSurfaceCatalogForRendering() throws -> AnyCatalog {
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
      AnyComponentAPI(
        name: "text",
        schema: textSchema
      )
    ]
  )
}
