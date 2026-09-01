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
import JSONSchema
import SwiftUI
import Testing

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
