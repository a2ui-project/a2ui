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
import BasicCatalog
import BasicCatalogSwiftUI
import JSONSchema
import OrderedJSON
import SwiftUI
import Testing

#if canImport(AppKit)
  import AppKit
#elseif canImport(UIKit)
  import UIKit
#endif

/// Origins of the probed children, written from `GeometryReader` during layout.
private final class OriginRecorder: @unchecked Sendable {
  var origins: [String: CGPoint] = [:]
}

@Suite(.serialized)
@MainActor
struct RenderedChildrenTests {

  @Test func leavesOutChildrenWithNoViewBuilder() {
    let catalog = BasicCatalogImplementation.makeCatalog(version: .v091)
    let node = Node(
      id: "col",
      type: "Column",
      properties: [
        "children": [
          Node(id: "a", type: "Text", properties: ["text": "A"]),
          Node(id: "x", type: "StarRating", properties: [:]),
          Node(id: "b", type: "Text", properties: ["text": "B"]),
        ]
      ]
    )

    let ids = node.renderedChildren(
      for: "children", in: [catalog.id: catalog], defaultCatalogID: catalog.id
    ).map(\.id)
    #expect(ids == ["a", "b"])
  }

  @Test func keepsChildrenThatAnotherCatalogRenders() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let basic = BasicCatalogImplementation.makeCatalog(version: .v091)
    let maps = Catalog(
      id: "maps",
      components: [
        ComponentImplementation(name: "Map", schema: schema) { _ in AnyView(EmptyView()) }
      ]
    )
    let catalogs = [basic.id: basic, maps.id: maps]
    let map = Node(id: "m", type: "Map", properties: [:])
    let node = Node(
      id: "col",
      type: "Column",
      properties: [
        "children": [
          Node(id: "a", type: "Text", properties: ["text": "A"]),
          map,
          Node(id: "x", type: "StarRating", properties: [:]),
        ]
      ]
    )

    let ids = node.renderedChildren(for: "children", in: catalogs, defaultCatalogID: basic.id)
      .map(\.id)
    #expect(ids == ["a", "m"])
    #expect(Surface.render(node: map, using: catalogs, defaultCatalogID: basic.id) != nil)
  }

  @Test(arguments: ["Row", "Column"])
  func spaceBetweenIgnoresUnrenderedChildren(container: String) throws {
    let reference = try measureOrigins(container, ["a", "b", "c"])
    #expect(reference.count == 3)
    #expect(try measureOrigins(container, ["a", "x", "b", "c"]) == reference)
    #expect(try measureOrigins(container, ["a", "b", "c", "x"]) == reference)
  }

  /// Hosts a `container` ("Row" or "Column") with `justify: spaceBetween` and returns the
  /// origins of its Text children. "x" is a child of an unknown type.
  private func measureOrigins(_ container: String, _ ids: [String]) throws -> [String: CGPoint] {
    let recorder = OriginRecorder()
    let base = BasicCatalogImplementation.makeCatalog(version: .v091)
    let probedText = ComponentImplementation(api: BasicCatalogComponents.text) { node in
      Text(node.string(for: "text") ?? "")
        .background(
          GeometryReader { proxy in
            let origin = proxy.frame(in: .named("container")).origin
            let _ = MainActor.assumeIsolated { recorder.origins[node.id] = origin }
            Color.clear
          }
        )
    }
    let catalog = Catalog(
      id: base.id,
      protocolVersion: .v091,
      components: base.components.values.filter { $0.name != "Text" } + [probedText]
    )
    let starRatingSchema = try Schema(instance: #"{"type": "object"}"#)
    let coreBase = BasicCatalog.makeCatalog(version: .v091)
    let coreCatalog = Catalog(
      id: coreBase.id,
      protocolVersion: .v091,
      components: Array(coreBase.components.values) + [
        AnyComponentAPI(name: "StarRating", schema: starRatingSchema)
      ]
    )
    let viewModel = SurfaceViewModel(surfaceID: "container-surface", catalog: coreCatalog)
    viewModel.componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: container,
        properties: [
          "justify": .string("spaceBetween"),
          "children": .array(ids.map(JSONValue.string)),
        ]
      )
    )
    for id in ids {
      if id == "x" {
        viewModel.componentsModel.addComponent(
          ComponentModel(id: id, type: "StarRating", properties: [:])
        )
      } else {
        viewModel.componentsModel.addComponent(
          ComponentModel(id: id, type: "Text", properties: ["text": .string("Item \(id)")])
        )
      }
    }
    let size = CGSize(width: 300, height: 200)
    let rootView =
      Surface(viewModel: viewModel, catalog: catalog)
      .frame(width: size.width, height: size.height)
      .coordinateSpace(.named("container"))

    #if canImport(AppKit)
      let hostingView = NSHostingView(rootView: rootView)
      hostingView.frame = CGRect(origin: .zero, size: size)
      let window = NSWindow(
        contentRect: hostingView.frame, styleMask: [.borderless], backing: .buffered, defer: false)
      window.contentView = hostingView
      hostingView.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
    #elseif canImport(UIKit)
      let controller = UIHostingController(rootView: rootView)
      let window = UIWindow(frame: CGRect(origin: .zero, size: size))
      window.rootViewController = controller
      window.makeKeyAndVisible()
      controller.view.frame = window.bounds
      controller.view.layoutIfNeeded()
    #endif
    return withExtendedLifetime(window) { recorder.origins }
  }
}
