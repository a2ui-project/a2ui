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
struct A2UIModalTests {

  @Test func triggerRendersAndContentRemainsHiddenUntilPresented() {
    let triggerText = Node(id: "trigger_label", type: "Text", properties: ["text": "Open Modal"])
    let trigger = Node(
      id: "trigger_btn",
      type: "Button",
      properties: ["child": triggerText]
    )
    let content = Node(
      id: "modal_body",
      type: "Text",
      properties: ["text": "Hidden modal content"]
    )
    let modalNode = Node(
      id: "modal1",
      type: "Modal",
      properties: [
        "trigger": trigger,
        "content": content,
      ]
    )

    let view = A2UIModal(node: modalNode)
    #expect(modalNode.child(for: "trigger")?.id == "trigger_btn")
    #expect(modalNode.child(for: "content")?.id == "modal_body")

    var inlineIDs: [String] = []
    collectComponentNodeIDs(in: view.body, into: &inlineIDs)
    #expect(inlineIDs == ["trigger_btn"])
  }

  @Test func hostedModalRendersTriggerWithoutEvaluatingSheetContent() throws {
    var renderedIDs: [String] = []
    let baseCatalog = BasicCatalogImplementation.makeCatalog(version: .v091)
    let instrumentedComponents = baseCatalog.components.values.map { component in
      ComponentImplementation(api: component) { node in
        renderedIDs.append(node.id)
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
    let coreCatalog = BasicCatalog.makeCatalog(version: .v091)
    let viewModel = SurfaceViewModel(surfaceID: "modal-surface", catalog: coreCatalog)

    let components = [
      ComponentModel(
        id: "root",
        type: "Modal",
        properties: [
          "trigger": .string("trigger_btn"),
          "content": .string("modal_body"),
        ]
      ),
      ComponentModel(
        id: "trigger_btn",
        type: "Text",
        properties: ["text": .string("Open")]
      ),
      ComponentModel(
        id: "modal_body",
        type: "Text",
        properties: ["text": .string("Details")]
      ),
    ]
    for component in components {
      viewModel.componentsModel.addComponent(component)
    }

    let rootView = Surface(viewModel: viewModel, catalog: swiftUICatalog)
    #if canImport(AppKit)
      let hostingView = NSHostingView(rootView: rootView)
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
    #elseif canImport(UIKit)
      let hostingController = UIHostingController(rootView: rootView)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 240))
      window.rootViewController = hostingController
      window.makeKeyAndVisible()
      RunLoop.main.run(until: Date())
      hostingController.view.setNeedsLayout()
      hostingController.view.layoutIfNeeded()
    #endif

    #expect(renderedIDs.contains("root"))
    #expect(renderedIDs.contains("trigger_btn"))
    #expect(!renderedIDs.contains("modal_body"))

    // Rendering the content node (as the sheet does when presentation toggles on) builds the body.
    let contentNode = try #require(viewModel.rootNode?.child(for: "content"))
    let renderedContent = Surface.render(
      node: contentNode,
      using: [swiftUICatalog.id: swiftUICatalog]
    )
    #expect(renderedContent != nil)
    #expect(renderedIDs.contains("modal_body"))
  }

  @Test func modalRendersFromCatalogs() throws {
    for version in [A2UIProtocolVersion.v091, .v10] {
      let catalog = BasicCatalogImplementation.makeCatalog(version: version)
      let trigger = Node(id: "t", type: "Text", properties: ["text": "Open"])
      let content = Node(id: "c", type: "Text", properties: ["text": "Body"])
      let node = Node(
        id: "modalCatalog_\(version.rawValue)",
        type: "Modal",
        catalogID: catalog.id,
        properties: ["trigger": trigger, "content": content]
      )
      let rendered = Surface.render(node: node, using: [catalog.id: catalog])
      #expect(rendered != nil)
    }
  }

  private func collectComponentNodeIDs(in value: Any, into ids: inout [String]) {
    if let nodeView = value as? ComponentNodeView {
      ids.append(nodeView.node.id)
      return
    }
    for child in Mirror(reflecting: value).children {
      collectComponentNodeIDs(in: child.value, into: &ids)
    }
  }
}
