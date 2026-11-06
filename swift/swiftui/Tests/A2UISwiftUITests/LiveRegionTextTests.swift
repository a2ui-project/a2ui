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
import Foundation
import SwiftUI
import Testing

#if canImport(AppKit)
  import AppKit
#elseif canImport(UIKit)
  import UIKit
#endif

/// Checks the visible text that components report to live regions through
/// `A2UIAccessibleTextKey`, and the text a live region announces from it.
@MainActor
struct LiveRegionTextTests {

  /// Records the last `A2UIAccessibleTextKey` value that reached the top of a hosted surface.
  @MainActor
  private final class TextRecorder {
    var text: [String]?
  }

  /// Hosts a surface and keeps it on screen while the test inspects the reported text.
  @MainActor
  private final class HostedSurface {
    let recorder = TextRecorder()
    #if canImport(AppKit)
      private let hostingView: NSHostingView<AnyView>
      private let window: NSWindow
    #elseif canImport(UIKit)
      private let hostingController: UIHostingController<AnyView>
      private let window: UIWindow
    #endif

    init(viewModel: SurfaceViewModel) {
      let recorder = recorder
      let rootView = AnyView(
        Surface(viewModel: viewModel, catalogs: BasicCatalogImplementation.allCatalogs)
          .frame(width: 400, height: 400)
          .onPreferenceChange(A2UIAccessibleTextKey.self) { text in
            MainActor.assumeIsolated { recorder.text = text }
          }
      )
      let frame = CGRect(x: 0, y: 0, width: 400, height: 400)
      #if canImport(AppKit)
        hostingView = NSHostingView(rootView: rootView)
        hostingView.frame = frame
        window = NSWindow(
          contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = hostingView
      #elseif canImport(UIKit)
        hostingController = UIHostingController(rootView: rootView)
        window = UIWindow(frame: frame)
        window.rootViewController = hostingController
        window.makeKeyAndVisible()
      #endif
      flush()
    }

    func flush() {
      RunLoop.main.run(until: Date())
      #if canImport(AppKit)
        hostingView.needsLayout = true
        hostingView.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        RunLoop.main.run(until: Date())
        hostingView.layoutSubtreeIfNeeded()
      #elseif canImport(UIKit)
        hostingController.view.setNeedsLayout()
        hostingController.view.layoutIfNeeded()
        RunLoop.main.run(until: Date())
        hostingController.view.layoutIfNeeded()
      #endif
    }
  }

  // MARK: - Helpers

  /// Creates a v1.0 surface from the given components and returns its view model.
  private func makeSurface(
    components: [[String: Any]],
    dataModel: [String: Any]? = nil
  ) async throws -> (MessageProcessor, SurfaceViewModel) {
    let processor = MessageProcessor(catalogs: [V10BasicCatalog.catalog])
    var messages: [[String: Any]] = [
      [
        "version": "1.0",
        "createSurface": ["surfaceId": "live", "catalogId": V10BasicCatalog.catalogURI],
      ],
      [
        "version": "1.0",
        "updateComponents": ["surfaceId": "live", "components": components],
      ],
    ]
    if let dataModel {
      messages.append([
        "version": "1.0",
        "updateDataModel": ["surfaceId": "live", "value": dataModel],
      ])
    }
    try process(messages, with: processor)
    await Task.yield()
    let surface = try #require(processor.surfaceGroupModel.surfacesMap["live"])
    return (processor, surface)
  }

  private func process(_ messages: [[String: Any]], with processor: MessageProcessor) throws {
    let parser = MessageParser()
    for message in messages {
      let data = try JSONSerialization.data(withJSONObject: message)
      processor.process(message: try parser.decode(jsonData: data))
    }
  }

  private func liveNode(_ accessibility: [String: any Resolved]) -> Node {
    Node(
      id: "status",
      type: "Column",
      properties: ["accessibility": ResolvedDictionary(accessibility)]
    )
  }

  // MARK: - Announcement text

  @Test func liveRegionWithoutLabelAnnouncesItsSubtreeText() {
    let modifier = A2UIAccessibilityModifier(node: liveNode(["live": "polite"]))

    #expect(modifier.announcementText(subtreeText: ["Order shipped"]) == "Order shipped")
    #expect(
      modifier.announcementText(subtreeText: ["Order shipped", "", "Arrives Friday"])
        == "Order shipped\nArrives Friday")
  }

  @Test func explicitLabelIsAnnouncedInsteadOfSubtreeText() {
    let modifier = A2UIAccessibilityModifier(
      node: liveNode(["live": "assertive", "label": "Critical Alert"]))

    #expect(modifier.announcementText(subtreeText: ["Connection Lost!"]) == "Critical Alert")
  }

  @Test func liveRegionWithoutTextAnnouncesNothing() {
    let modifier = A2UIAccessibilityModifier(node: liveNode(["live": "polite"]))

    #expect(modifier.announcementText(subtreeText: []) == nil)
    #expect(modifier.announcementText(subtreeText: [""]) == nil)
  }

  @Test func liveOffAndHiddenRegionsIgnoreSubtreeText() {
    let off = A2UIAccessibilityModifier(node: liveNode(["live": "off"]))
    let hidden = A2UIAccessibilityModifier(node: liveNode(["live": "polite", "hidden": true]))

    #expect(off.announcementText(subtreeText: ["Idle"]) == nil)
    #expect(hidden.announcementText(subtreeText: ["Idle"]) == nil)
  }

  // MARK: - Reported text

  @Test func textReportsWhatItShowsInTreeOrder() async throws {
    let (_, surface) = try await makeSurface(components: [
      [
        "id": "root", "component": "Column",
        "children": ["title", "body", "secret", "nested_live"],
      ],
      ["id": "title", "component": "Text", "text": "**Order** status", "variant": "caption"],
      [
        "id": "body", "component": "Text",
        "text": "# Shipped\n\nYour order *left* the warehouse.\n\n- Box one\n- Box two",
      ],
      [
        "id": "secret", "component": "Text", "text": "Internal note",
        "accessibility": ["hidden": true],
      ],
      [
        "id": "nested_live", "component": "Text", "text": "Updated just now",
        "accessibility": ["live": "polite"],
      ],
    ])
    let host = HostedSurface(viewModel: surface)

    // Markdown syntax is dropped, a hidden subtree reports nothing, and a live region keeps its
    // text so that only the nearest live region announces it.
    #expect(
      host.recorder.text == [
        "Order status",
        "Shipped\nYour order left the warehouse.\nBox one\nBox two",
      ])
  }

  @Test func reportedTextFollowsTheDataModel() async throws {
    let (processor, surface) = try await makeSurface(
      components: [
        ["id": "root", "component": "Card", "child": "column"],
        ["id": "column", "component": "Column", "children": ["label", "value"]],
        ["id": "label", "component": "Text", "text": "Status"],
        ["id": "value", "component": "Text", "text": ["@path": "/status"]],
      ],
      dataModel: ["status": "Connecting"]
    )
    let host = HostedSurface(viewModel: surface)
    #expect(host.recorder.text == ["Status", "Connecting"])

    try process(
      [
        [
          "version": "1.0",
          "updateDataModel": ["surfaceId": "live", "path": "/status", "value": "Connected"],
        ]
      ],
      with: processor
    )
    await Task.yield()
    host.flush()

    #expect(host.recorder.text == ["Status", "Connected"])
  }

  @Test func liveContainerKeepsItsSubtreeText() async throws {
    let (_, surface) = try await makeSurface(components: [
      [
        "id": "root", "component": "Column", "children": ["status"],
        "accessibility": ["live": "polite"],
      ],
      ["id": "status", "component": "Text", "text": "Connected"],
    ])
    let host = HostedSurface(viewModel: surface)

    #expect(host.recorder.text?.isEmpty ?? true)
  }
}
