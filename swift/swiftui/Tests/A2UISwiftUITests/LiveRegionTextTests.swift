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
@_spi(Testing) import A2UISwiftUI
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
/// `A2UIAccessibleTextKey`, and what a live region announces from it.
@MainActor
struct LiveRegionTextTests {

  /// An announcement posted by a live region.
  private struct Announcement: Equatable {
    let text: String
    let isAssertive: Bool
  }

  /// Records the last `A2UIAccessibleTextKey` value that reached the top of a hosted surface,
  /// and the announcements posted inside it.
  @MainActor
  private final class TextRecorder {
    var text: [String]?
    var announcements: [Announcement] = []
  }

  /// Hosts a surface and keeps it on screen while the test inspects the reported text and the
  /// announcements. Use ``withHost(_:inLiveRegion:_:)``, which tears the host down.
  ///
  /// With `inLiveRegion`, the surface and the recorder sit inside a live region, which is where
  /// components report their text. The recorder sits below the region, which consumes the text.
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

    static func withHost(
      _ viewModel: SurfaceViewModel,
      inLiveRegion: Bool = true,
      _ body: (HostedSurface) async throws -> Void
    ) async rethrows {
      let host = HostedSurface(viewModel: viewModel, inLiveRegion: inLiveRegion)
      defer { host.tearDown() }
      try await body(host)
    }

    private init(viewModel: SurfaceViewModel, inLiveRegion: Bool) {
      let recorder = recorder
      let recorded = Surface(viewModel: viewModel, catalogs: BasicCatalogImplementation.allCatalogs)
        .frame(width: 400, height: 400)
        .onPreferenceChange(A2UIAccessibleTextKey.self) { text in
          MainActor.assumeIsolated { recorder.text = text }
        }
      let region = Node(
        id: "region",
        type: "Column",
        properties: ["accessibility": ResolvedDictionary(["live": "polite"])]
      )
      let regionView =
        inLiveRegion
        ? AnyView(recorded.modifier(A2UIAccessibilityModifier(node: region)))
        : AnyView(recorded)
      let announcer = A2UIAnnouncer { text, isAssertive in
        recorder.announcements.append(Announcement(text: text, isAssertive: isAssertive))
      }
      let rootView = AnyView(regionView.environment(\.a2uiAnnouncer, announcer))
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

    /// Removes the surface from the window and closes the window, so nothing outlives the test.
    private func tearDown() {
      #if canImport(AppKit)
        hostingView.rootView = AnyView(EmptyView())
        window.contentView = nil
        window.orderOut(nil)
        window.close()
      #elseif canImport(UIKit)
        hostingController.rootView = AnyView(EmptyView())
        window.rootViewController = nil
        window.isHidden = true
      #endif
      RunLoop.main.run(until: Date())
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

  /// Sets a data model value and lets the hosted surface render the change.
  private func update(
    _ path: String,
    to value: Any,
    with processor: MessageProcessor,
    in host: HostedSurface
  ) async throws {
    try process(
      [
        [
          "version": "1.0",
          "updateDataModel": ["surfaceId": "live", "path": path, "value": value],
        ]
      ],
      with: processor
    )
    await Task.yield()
    host.flush()
  }

  // MARK: - Announcement text

  @Test func liveRegionWithoutLabelAnnouncesItsSubtreeText() {
    let modifier = A2UIAccessibilityModifier(node: liveNode(["live": "polite"]))

    #expect(modifier.announcementText(subtreeText: ["Order shipped"]) == "Order shipped")
    #expect(
      modifier.announcementText(subtreeText: ["Order shipped", "", "Arrives Friday"])
        == "Order shipped\nArrives Friday")
  }

  @Test func explicitLabelIsAnnouncedBeforeSubtreeText() {
    let modifier = A2UIAccessibilityModifier(
      node: liveNode(["live": "assertive", "label": "System alert"]))

    #expect(modifier.announcementText(subtreeText: []) == "System alert")
    #expect(
      modifier.announcementText(subtreeText: ["Connection lost"]) == "System alert\nConnection lost"
    )
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
        "text": """
        # Shipped

        Your order *left* the warehouse.

        - Box one
        - Box two

        1. Unpack

           Keep the box.
        2. Check the **contents**
        """,
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

    try await HostedSurface.withHost(surface) { host in
      // Markdown syntax is dropped, a hidden subtree reports nothing, and a live region keeps
      // its text so that only the nearest live region announces it.
      #expect(
        host.recorder.text == [
          "Order status",
          "Shipped\nYour order left the warehouse.\nBox one\nBox two\n1. Unpack\n"
            + "Keep the box.\n2. Check the contents",
        ])
    }
  }

  @Test func labelsAreReportedInsteadOfTheTextTheyReplace() async throws {
    let (_, surface) = try await makeSurface(components: [
      [
        "id": "root", "component": "Column", "children": ["status", "card"],
        "accessibility": ["label": "Order"],
      ],
      [
        "id": "status", "component": "Text", "text": "3/5",
        "accessibility": ["label": "Step 3 of 5"],
      ],
      ["id": "card", "component": "Card", "child": "detail"],
      ["id": "detail", "component": "Text", "text": "Packing"],
    ])

    try await HostedSurface.withHost(surface) { host in
      // A group label comes before the text inside the group, and a label on a `Text` replaces
      // its visible text, as VoiceOver reads them.
      #expect(host.recorder.text == ["Order", "Step 3 of 5", "Packing"])
    }
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

    try await HostedSurface.withHost(surface) { host in
      #expect(host.recorder.text == ["Status", "Connecting"])

      try await update("/status", to: "Connected", with: processor, in: host)

      #expect(host.recorder.text == ["Status", "Connected"])
    }
  }

  @Test func textOutsideLiveRegionsReportsNothing() async throws {
    let (_, surface) = try await makeSurface(components: [
      ["id": "root", "component": "Column", "children": ["status"]],
      ["id": "status", "component": "Text", "text": "Connected"],
    ])

    try await HostedSurface.withHost(surface, inLiveRegion: false) { host in
      #expect(host.recorder.text?.isEmpty ?? true)
    }
  }

  @Test func liveContainerKeepsItsSubtreeText() async throws {
    let (_, surface) = try await makeSurface(components: [
      [
        "id": "root", "component": "Column", "children": ["status"],
        "accessibility": ["live": "polite"],
      ],
      ["id": "status", "component": "Text", "text": "Connected"],
    ])

    try await HostedSurface.withHost(surface) { host in
      #expect(host.recorder.text?.isEmpty ?? true)
    }
  }

  // MARK: - Announcements

  @Test func dataModelUpdateIsAnnouncedOnceAndNothingOnMount() async throws {
    let (processor, surface) = try await makeSurface(
      components: [
        [
          "id": "root", "component": "Card", "child": "value",
          "accessibility": ["label": "System alert", "live": "assertive"],
        ],
        ["id": "value", "component": "Text", "text": ["@path": "/status"]],
      ],
      dataModel: ["status": "Connecting"]
    )

    try await HostedSurface.withHost(surface, inLiveRegion: false) { host in
      #expect(host.recorder.announcements.isEmpty)

      try await update("/status", to: "Connection lost", with: processor, in: host)

      #expect(
        host.recorder.announcements == [
          Announcement(text: "System alert\nConnection lost", isAssertive: true)
        ])
    }
  }

  @Test func labeledLiveTextReadsItsLabelOnce() async throws {
    let (processor, surface) = try await makeSurface(
      components: [
        [
          "id": "root", "component": "Text", "text": ["@path": "/status"],
          "accessibility": ["label": ["@path": "/label"], "live": "polite"],
        ]
      ],
      dataModel: ["status": "Connection lost!", "label": "Offline"]
    )

    try await HostedSurface.withHost(surface, inLiveRegion: false) { host in
      try await update("/label", to: "Critical alert", with: processor, in: host)

      #expect(
        host.recorder.announcements == [Announcement(text: "Critical alert", isAssertive: false)])
    }
  }

  @Test func showingHiddenLiveRegionAnnouncesItsText() async throws {
    let (processor, surface) = try await makeSurface(
      components: [
        [
          "id": "root", "component": "Column", "children": ["status"],
          "accessibility": ["live": "polite", "hidden": ["@path": "/hidden"]],
        ],
        ["id": "status", "component": "Text", "text": ["@path": "/status"]],
      ],
      dataModel: ["status": "Connecting", "hidden": true]
    )

    try await HostedSurface.withHost(surface, inLiveRegion: false) { host in
      try await update("/status", to: "Connected", with: processor, in: host)
      #expect(host.recorder.announcements.isEmpty)

      try await update("/hidden", to: false, with: processor, in: host)

      #expect(
        host.recorder.announcements == [Announcement(text: "Connected", isAssertive: false)])
    }
  }

  @Test func liveRegionInsideHiddenAncestorAnnouncesNothing() async throws {
    let (processor, surface) = try await makeSurface(
      components: [
        [
          "id": "root", "component": "Column", "children": ["status"],
          "accessibility": ["hidden": true],
        ],
        [
          "id": "status", "component": "Text", "text": ["@path": "/status"],
          "accessibility": ["live": "assertive"],
        ],
      ],
      dataModel: ["status": "Connecting"]
    )

    try await HostedSurface.withHost(surface, inLiveRegion: false) { host in
      try await update("/status", to: "Connected", with: processor, in: host)

      #expect(host.recorder.announcements.isEmpty)
    }
  }
}
