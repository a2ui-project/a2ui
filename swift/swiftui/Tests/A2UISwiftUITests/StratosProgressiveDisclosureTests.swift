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

private final class StyleInvocationTracker: @unchecked Sendable {
  var cardStyleInvoked = false
  var buttonVariants: [A2UIButtonStyleConfiguration.Variant] = []
}

private struct ProbeCardStyle: A2UICardStyle {
  let tracker: StyleInvocationTracker

  func makeBody(configuration: Configuration) -> some View {
    let _ = { tracker.cardStyleInvoked = true }()
    configuration.content
  }
}

private struct ProbeButtonStyle: A2UIButtonStyle {
  let tracker: StyleInvocationTracker

  func makeBody(configuration: Configuration) -> some View {
    let _ = { tracker.buttonVariants.append(configuration.variant) }()
    configuration.label
  }
}

@Suite(.serialized)
@MainActor
struct StratosProgressiveDisclosureTests {

  #if canImport(AppKit)
    private func host(_ view: some View) -> NSWindow {
      let hostingView = NSHostingView(rootView: view)
      hostingView.frame = NSRect(x: 0, y: 0, width: 320, height: 240)
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 320, height: 240),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      window.contentView = hostingView
      RunLoop.main.run(until: Date())
      hostingView.needsLayout = true
      hostingView.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
      return window
    }
  #elseif canImport(UIKit)
    private func host(_ view: some View) -> UIWindow {
      let controller = UIHostingController(rootView: view)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 240))
      window.rootViewController = controller
      window.makeKeyAndVisible()
      RunLoop.main.run(until: Date())
      controller.view.setNeedsLayout()
      controller.view.layoutIfNeeded()
      return window
    }
  #endif

  @Test func basicCatalogConvenienceSurfaceInitializerRendersAllVersions() {
    let coreCatalog = BasicCatalog.makeCatalog(version: .v091)
    let viewModel = SurfaceViewModel(surfaceID: "troposphere", catalog: coreCatalog)
    viewModel.componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Text",
        properties: ["text": .string("Hello Troposphere")]
      )
    )

    let surface = Surface(basicCatalogViewModel: viewModel)
    #expect(!surface.catalogs.isEmpty)
    #expect(surface.defaultCatalogID == coreCatalog.id)
  }

  @Test func surfaceInheritsEnvironmentCatalogsAndThemeWithoutClobbering() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    var customRendered = false
    let customCatalog = Catalog(
      id: "custom",
      components: [
        ComponentImplementation(name: "CustomBadge", schema: schema) { _ in
          customRendered = true
          return Text("Badge")
        }
      ]
    )
    let coreCatalog = Catalog(
      id: "custom",
      components: [AnyComponentAPI(name: "CustomBadge", schema: schema)]
    )
    let viewModel = SurfaceViewModel(surfaceID: "mesosphere", catalog: coreCatalog)
    viewModel.componentsModel.addComponent(
      ComponentModel(id: "root", type: "CustomBadge", properties: [:])
    )

    let rootView = Surface(viewModel: viewModel)
      .a2uiBasicCatalog()
      .a2uiCatalog(customCatalog, isDefault: true)
      .a2uiTheme(["primaryColor": .string("#4F46E5")])

    let window = host(rootView)
    withExtendedLifetime(window) {
      #expect(customRendered)
    }
  }

  @Test func customCardAndButtonStylesReceiveConfiguration() {
    let tracker = StyleInvocationTracker()
    let coreCatalog = BasicCatalog.makeCatalog(version: .v091)
    let viewModel = SurfaceViewModel(surfaceID: "thermosphere", catalog: coreCatalog)
    viewModel.componentsModel.applyBatch(adding: [
      ComponentModel(
        id: "root",
        type: "Card",
        properties: ["child": .string("btn")]
      ),
      ComponentModel(
        id: "btn",
        type: "Button",
        properties: [
          "child": .string("lbl"),
          "variant": .string("primary"),
        ]
      ),
      ComponentModel(
        id: "lbl",
        type: "Text",
        properties: ["text": .string("Confirm")]
      ),
    ])

    let rootView = Surface(basicCatalogViewModel: viewModel)
      .a2uiCardStyle(ProbeCardStyle(tracker: tracker))
      .a2uiButtonStyle(ProbeButtonStyle(tracker: tracker))

    let window = host(rootView)
    withExtendedLifetime(window) {
      #expect(tracker.cardStyleInvoked)
      #expect(Set(tracker.buttonVariants) == [.primary])
    }
  }

  @Test func builtInCardStylesConstructAndRender() {
    let node = Node(
      id: "card",
      type: "Card",
      properties: ["child": Node(id: "txt", type: "Text", properties: ["text": "Body"])]
    )
    let automaticView = A2UICard(node: node).a2uiCardStyle(.automatic)
    let elevatedView = A2UICard(node: node).a2uiCardStyle(.elevated)
    let outlinedView = A2UICard(node: node).a2uiCardStyle(.outlined)

    let w1 = host(automaticView)
    let w2 = host(elevatedView)
    let w3 = host(outlinedView)
    withExtendedLifetime((w1, w2, w3)) {}
  }
}
