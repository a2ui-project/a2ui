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
import SwiftUI
import Testing

#if canImport(AppKit)
  import AppKit
#elseif canImport(UIKit)
  import UIKit
#endif

@Suite(.serialized)
@MainActor
struct A2UIDividerTests {

  @Test func horizontalAxisByDefaultAndWhenExplicit() {
    let defaultNode = Node(
      id: "divDefault",
      type: "Divider",
      properties: [:]
    )
    let explicitHorizontalNode = Node(
      id: "divHorizontal",
      type: "Divider",
      properties: ["axis": "horizontal"]
    )

    let defaultView = A2UIDivider(node: defaultNode)
    let horizontalView = A2UIDivider(node: explicitHorizontalNode)

    #expect(defaultNode.string(for: "axis") == nil)
    #expect(explicitHorizontalNode.string(for: "axis") == "horizontal")
    #expect(!containsFixedUnitWidth(defaultView.body))
    #expect(!containsFixedUnitWidth(horizontalView.body))
  }

  @Test func verticalAxisUsesUnitWidthFrame() {
    let verticalNode = Node(
      id: "divVertical",
      type: "Divider",
      properties: ["axis": "vertical"]
    )

    let view = A2UIDivider(node: verticalNode)
    #expect(verticalNode.string(for: "axis") == "vertical")
    #expect(containsFixedUnitWidth(view.body))
  }

  @Test func accessibilityDefaultsAndExplicitHidden() {
    let defaultNode = Node(
      id: "divA11yDefault",
      type: "Divider",
      properties: [:]
    )
    #expect(defaultNode.explicitAccessibilityAttributes == nil)

    var renderedNodes: [Node] = []
    let baseCatalog = BasicCatalogImplementation.makeCatalog(version: .v091)
    let instrumentedComponents = baseCatalog.components.values.map { component in
      ComponentImplementation(api: component) { node in
        renderedNodes.append(node)
        return component.builder(node)
      }
    }
    let swiftUICatalog = Catalog(
      id: baseCatalog.id,
      protocolVersion: .v091,
      components: instrumentedComponents,
      functions: Array(baseCatalog.functions.values),
      themeSchema: baseCatalog.themeSchema
    )

    let hiddenNode = Node(
      id: "divA11yHidden",
      type: "Divider",
      catalogID: swiftUICatalog.id,
      properties: ["accessibility": ResolvedDictionary(["hidden": true])]
    )
    #expect(hiddenNode.explicitAccessibilityAttributes?.hidden == true)

    let rootView = ComponentNodeView(node: hiddenNode)
      .environment(\.a2uiCatalogs, [swiftUICatalog.id: swiftUICatalog])
    #if canImport(AppKit)
      let hostingView = NSHostingView(rootView: rootView)
      hostingView.frame = NSRect(x: 0, y: 0, width: 200, height: 40)
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 200, height: 40),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      window.contentView = hostingView
      RunLoop.main.run(until: Date())
      hostingView.needsLayout = true
      hostingView.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
    #elseif canImport(UIKit)
      let hostingController = UIHostingController(rootView: rootView)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 200, height: 40))
      window.rootViewController = hostingController
      window.makeKeyAndVisible()
      RunLoop.main.run(until: Date())
      hostingController.view.setNeedsLayout()
      hostingController.view.layoutIfNeeded()
    #endif

    #expect(renderedNodes.map(\.id) == ["divA11yHidden"])
    #expect(renderedNodes.first?.explicitAccessibilityAttributes?.hidden == true)
  }

  @Test func dividerRendersFromCatalogs() throws {
    for version in [A2UIProtocolVersion.v091, .v10] {
      let catalog = BasicCatalogImplementation.makeCatalog(version: version)
      let node = Node(
        id: "divCatalog_\(version.rawValue)",
        type: "Divider",
        catalogID: catalog.id,
        properties: ["axis": "horizontal"]
      )
      let rendered = Surface.render(node: node, using: [catalog.id: catalog])
      #expect(rendered != nil)
    }
  }

  /// Walks the reflected view hierarchy to check whether the vertical `frame(width: 1)` modifier
  /// was applied.
  private func containsFixedUnitWidth(_ value: Any) -> Bool {
    let mirror = Mirror(reflecting: value)
    for child in mirror.children {
      if child.label == "width", let width = child.value as? CGFloat, width == 1 {
        return true
      }
      if containsFixedUnitWidth(child.value) {
        return true
      }
    }
    return false
  }
}
