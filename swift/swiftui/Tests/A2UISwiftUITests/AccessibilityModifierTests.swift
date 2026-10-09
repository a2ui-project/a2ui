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

@MainActor
struct AccessibilityModifierTests {

  // MARK: - Helpers

  /// Creates a v1.0 surface from the given components and returns its view model.
  private func makeSurface(
    components: [[String: Any]],
    dataModel: [String: Any]? = nil
  ) async throws -> (MessageProcessor, SurfaceViewModel) {
    let processor = MessageProcessor(catalogs: [V10BasicCatalog.catalog])
    var messages: [[String: Any]] = [
      [
        "version": "v1.0",
        "createSurface": [
          "surfaceId": "a11y",
          "catalogId": V10BasicCatalog.catalogURI,
        ],
      ],
      [
        "version": "v1.0",
        "updateComponents": ["surfaceId": "a11y", "components": components],
      ],
    ]
    if let dataModel {
      messages.append([
        "version": "v1.0",
        "updateDataModel": ["surfaceId": "a11y", "value": dataModel],
      ])
    }
    try process(messages, with: processor)
    await Task.yield()
    let surface = try #require(processor.surfaceGroupModel.surfacesMap["a11y"])
    return (processor, surface)
  }

  private func process(_ messages: [[String: Any]], with processor: MessageProcessor) throws {
    let parser = MessageParser()
    for message in messages {
      let data = try JSONSerialization.data(withJSONObject: message)
      processor.process(message: try parser.decode(jsonData: data))
    }
  }

  /// Finds a node by ID in the resolved tree of the surface.
  private func node(_ id: String, in surface: SurfaceViewModel) throws -> Node {
    var pending = [try #require(surface.rootNode)]
    while let current = pending.popLast() {
      if current.id == id { return current }
      pending.append(contentsOf: current.allChildNodes)
    }
    Issue.record("Node '\(id)' not found")
    throw CancellationError()
  }

  // MARK: - Label and description

  @Test func explicitLabelAndDescriptionMapToLabelAndHint() async throws {
    let (_, surface) = try await makeSurface(components: [
      ["id": "root", "component": "Column", "children": ["btn1"]],
      [
        "id": "btn1", "component": "Button", "child": "btn1_text",
        "action": ["event": ["name": "mute"]],
        "accessibility": [
          "label": "Mute Notifications",
          "description": "Silences notifications about this conversation",
        ],
      ],
      ["id": "btn1_text", "component": "Text", "text": "Mute"],
    ])

    let modifier = A2UIAccessibilityModifier(node: try node("btn1", in: surface))
    #expect(modifier.label == "Mute Notifications")
    #expect(modifier.hint == "Silences notifications about this conversation")
    #expect(!modifier.isHidden)
    #expect(!modifier.isLiveRegion)
  }

  @Test func visibleTextIsNotTurnedIntoAnExplicitLabel() async throws {
    let (_, surface) = try await makeSurface(components: [
      ["id": "root", "component": "Text", "text": "Submit Form"]
    ])

    let modifier = A2UIAccessibilityModifier(node: try node("root", in: surface))
    #expect(modifier.label == nil)
    #expect(modifier.hint == nil)
  }

  @Test func boundLabelFollowsTheDataModel() async throws {
    let (processor, surface) = try await makeSurface(
      components: [
        [
          "id": "root", "component": "Text", "text": "3 unread",
          "accessibility": ["label": ["@path": "/unreadLabel"]],
        ]
      ],
      dataModel: ["unreadLabel": "Three unread messages"]
    )

    let before = A2UIAccessibilityModifier(node: try node("root", in: surface))
    #expect(before.label == "Three unread messages")

    try process(
      [
        [
          "version": "v1.0",
          "updateDataModel": [
            "surfaceId": "a11y", "path": "/unreadLabel", "value": "Four unread messages",
          ],
        ]
      ],
      with: processor
    )
    await Task.yield()

    let after = A2UIAccessibilityModifier(node: try node("root", in: surface))
    #expect(after.label == "Four unread messages")
  }

  // MARK: - Hidden

  @Test func hiddenHidesTheComponent() async throws {
    let (_, surface) = try await makeSurface(components: [
      [
        "id": "root", "component": "Column", "children": ["visible_text", "decorative_icon"],
        "accessibility": ["hidden": true],
      ],
      ["id": "visible_text", "component": "Text", "text": "Visible Content"],
      ["id": "decorative_icon", "component": "Icon", "name": "star"],
    ])

    #expect(A2UIAccessibilityModifier(node: try node("root", in: surface)).isHidden)
    #expect(!A2UIAccessibilityModifier(node: try node("visible_text", in: surface)).isHidden)
  }

  @Test func hiddenFalseDoesNotHide() {
    let node = Node(
      id: "t",
      type: "Text",
      properties: ["accessibility": ResolvedDictionary(["hidden": false])]
    )
    #expect(!A2UIAccessibilityModifier(node: node).isHidden)
  }

  // MARK: - Live regions

  @Test func politeLiveRegionAnnouncesItsText() async throws {
    let (_, surface) = try await makeSurface(components: [
      [
        "id": "root", "component": "Text", "text": "Status: Active",
        "accessibility": ["live": "polite"],
      ]
    ])

    let modifier = A2UIAccessibilityModifier(node: try node("root", in: surface))
    #expect(modifier.isLiveRegion)
    #expect(!modifier.isAssertive)
    #expect(modifier.announcementText == "Status: Active")
  }

  @Test func assertiveLiveRegionAnnouncesLabelAndContent() async throws {
    let (_, surface) = try await makeSurface(components: [
      ["id": "root", "component": "Column", "children": ["alert_box"]],
      [
        "id": "alert_box", "component": "Text", "text": "Connection Lost!",
        "accessibility": ["label": "Critical Alert", "live": "assertive"],
      ],
    ])

    let modifier = A2UIAccessibilityModifier(node: try node("alert_box", in: surface))
    #expect(modifier.isAssertive)
    #expect(modifier.announcementText == "Critical Alert, Connection Lost!")
  }

  @Test func liveRegionWithFixedLabelAnnouncesContentChanges() async throws {
    let (processor, surface) = try await makeSurface(
      components: [
        [
          "id": "root", "component": "Text", "text": ["@path": "/status"],
          "accessibility": ["label": "Critical Alert", "live": "assertive"],
        ]
      ],
      dataModel: ["status": "Connection Lost!"]
    )
    let before = A2UIAccessibilityModifier(node: try node("root", in: surface))

    try process(
      [
        [
          "version": "v1.0",
          "updateDataModel": ["surfaceId": "a11y", "path": "/status", "value": "Reconnected"],
        ]
      ],
      with: processor
    )
    await Task.yield()
    let after = A2UIAccessibilityModifier(node: try node("root", in: surface))

    // The announcement is the change trigger, so it must differ when only the content changes.
    #expect(before.label == after.label)
    #expect(before.announcementText == "Critical Alert, Connection Lost!")
    #expect(after.announcementText == "Critical Alert, Reconnected")
  }

  @Test func liveOffAndHiddenRegionsDoNotAnnounce() {
    let off = Node(
      id: "off",
      type: "Text",
      properties: ["text": "Idle", "accessibility": ResolvedDictionary(["live": "off"])]
    )
    let hidden = Node(
      id: "hidden",
      type: "Text",
      properties: [
        "text": "Idle",
        "accessibility": ResolvedDictionary(["live": "polite", "hidden": true]),
      ]
    )

    #expect(A2UIAccessibilityModifier(node: off).announcementText == nil)
    #expect(A2UIAccessibilityModifier(node: hidden).announcementText == nil)
  }

  // MARK: - Rendering

  @Test func componentsWithAccessibilityRender() async throws {
    let (_, surface) = try await makeSurface(components: [
      [
        "id": "root", "component": "Column", "children": ["title", "name", "agree"],
        "accessibility": ["label": "Profile form"],
      ],
      [
        "id": "title", "component": "Text", "text": "# Profile",
        "accessibility": ["label": "Profile", "live": "polite"],
      ],
      [
        "id": "name", "component": "TextField", "label": "Name",
        "value": ["@path": "/name"],
        "accessibility": ["label": "Full name", "description": "As on your ID"],
      ],
      [
        "id": "agree", "component": "CheckBox", "label": "I agree",
        "value": ["@path": "/agree"],
        "accessibility": ["hidden": true],
      ],
    ])

    let root = try #require(surface.rootNode)
    _ = Surface(viewModel: surface, catalogs: BasicCatalogImplementation.allCatalogs).body
    _ = ComponentNodeView(node: root).body
    _ = A2UIText(node: try node("title", in: surface)).body
    _ = A2UITextField(node: try node("name", in: surface)).body
    _ = A2UICheckBox(node: try node("agree", in: surface)).body
  }
}
