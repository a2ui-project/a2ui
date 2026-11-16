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

  // MARK: - Activation

  #if canImport(AppKit)
    @Test func voiceOverPressOnButtonTriggerRunsActionOnceAndPresentsSheet() throws {
      let counter = ActionCounter()
      try ModalHost.withHost(trigger: buttonTrigger(action: counter.action())) { host in
        #expect(!host.isSheetPresented)

        let handled = try host.pressWithVoiceOver(label: "Open")
        #expect(handled)

        #expect(host.isSheetPresented)
        #expect(counter.count == 1)
      }
    }

    @Test func clickOnButtonTriggerRunsActionOnceAndPresentsSheet() throws {
      let counter = ActionCounter()
      try ModalHost.withHost(trigger: buttonTrigger(action: counter.action())) { host in
        try host.click(label: "Open")

        #expect(host.isSheetPresented)
        #expect(counter.count == 1)
      }
    }

    @Test func keyboardActivationOfButtonTriggerRunsActionOnceAndPresentsSheet() throws {
      let counter = ActionCounter()
      try ModalHost.withHost(trigger: buttonTrigger(action: counter.action())) { host in
        try host.pressSpace(label: "Open")

        #expect(host.isSheetPresented)
        #expect(counter.count == 1)
      }
    }

    @Test func clickOnButtonTriggerWithFailingCheckSkipsActionAndSheet() throws {
      let counter = ActionCounter()
      let trigger = buttonTrigger(checks: [failingCheck()], action: counter.action())
      try ModalHost.withHost(trigger: trigger) { host in
        try host.click(label: "Open")

        #expect(!host.isSheetPresented)
        #expect(counter.count == 0)
      }
    }

    @Test func voiceOverPressOnButtonTriggerWithFailingCheckSkipsActionAndSheet() throws {
      let counter = ActionCounter()
      let trigger = buttonTrigger(checks: [failingCheck()], action: counter.action())
      try ModalHost.withHost(trigger: trigger) { host in
        try host.pressWithVoiceOver(label: "Open")

        #expect(!host.isSheetPresented)
        #expect(counter.count == 0)
      }
    }

    @Test func voiceOverPressOnTextTriggerPresentsSheet() throws {
      try ModalHost.withHost(trigger: textTrigger()) { host in
        let handled = try host.pressWithVoiceOver(label: "Open")
        #expect(handled)

        #expect(host.isSheetPresented)
      }
    }

    @Test func clickOnTextTriggerPresentsSheet() throws {
      try ModalHost.withHost(trigger: textTrigger()) { host in
        try host.click(label: "Open")

        #expect(host.isSheetPresented)
      }
    }

    @Test func clickOnTextTriggerWithFailingCheckDoesNotPresentSheet() throws {
      try ModalHost.withHost(trigger: textTrigger(checks: [failingCheck()])) { host in
        try host.click(label: "Open")

        #expect(!host.isSheetPresented)
      }
    }

    @Test func voiceOverPressOnTextTriggerWithFailingCheckDoesNotPresentSheet() throws {
      try ModalHost.withHost(trigger: textTrigger(checks: [failingCheck()])) { host in
        try host.pressWithVoiceOver(label: "Open")

        #expect(!host.isSheetPresented)
      }
    }

    @Test func nestedModalButtonDoesNotDisableEnclosingTriggerTap() throws {
      // The nested Modal's Button opens the nested sheet itself. That must not turn off the tap
      // that opens the enclosing Modal from the rest of its trigger.
      let nestedModal = Node(
        id: "nested_modal",
        type: "Modal",
        properties: [
          "trigger": buttonTrigger(label: "Open nested"),
          "content": Node(id: "nested_body", type: "Text", properties: ["text": "Nested details"]),
        ]
      )
      let outerLabel = Node(id: "outer_label", type: "Text", properties: ["text": "Open outer"])
      let trigger = Node(
        id: "trigger_row",
        type: "Row",
        properties: ["children": [nestedModal, outerLabel]]
      )
      try ModalHost.withHost(trigger: trigger) { host in
        try host.click(label: "Open outer")

        #expect(host.sheetShows(text: "Details"))
        #expect(!host.sheetShows(text: "Nested details"))
      }
    }
  #endif

  /// Counts how many times the action it vends is triggered.
  @MainActor
  private final class ActionCounter {
    private(set) var count = 0

    func action() -> ResolvedAction {
      ResolvedAction(identity: .event(name: "tapped", context: nil)) { [self] in
        count += 1
      }
    }
  }

  private func buttonTrigger(
    label text: String = "Open",
    checks: [ResolvedCheck] = [],
    action: ResolvedAction? = nil
  ) -> Node {
    let label = Node(id: "trigger_label", type: "Text", properties: ["text": text])
    var properties: [String: any Resolved] = ["child": label]
    if !checks.isEmpty { properties["checks"] = checks }
    if let action { properties["action"] = action }
    return Node(id: "trigger_btn", type: "Button", properties: properties)
  }

  private func textTrigger(checks: [ResolvedCheck] = []) -> Node {
    var properties: [String: any Resolved] = ["text": "Open"]
    if !checks.isEmpty { properties["checks"] = checks }
    return Node(id: "trigger_text", type: "Text", properties: properties)
  }

  private func failingCheck() -> ResolvedCheck {
    ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(false)), value: false),
      message: "Required",
      validationResult: ValidationResult(valid: false, message: "Required", severity: .error)
    )
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
