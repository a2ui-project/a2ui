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
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

/// Maps a node's A2UI `accessibility` attributes to the SwiftUI accessibility API.
///
/// ``ComponentNodeView`` applies this modifier to every rendered component, so custom component
/// implementations get the mapping without extra work. Only values the agent set explicitly are
/// applied; otherwise SwiftUI keeps the label it infers from the component's visible content.
///
/// - `label` becomes `accessibilityLabel`.
/// - `description` becomes `accessibilityHint`. SwiftUI only keeps a hint on a single
///   accessibility element, so it is dropped on layout containers and other groups.
/// - `hidden` becomes `accessibilityHidden` for the whole subtree.
/// - `live` (`polite` or `assertive`) posts an announcement whenever the component's visible
///   text changes. The announcement is the visible text, preceded by the explicit label when
///   there is one. Components without visible text, such as layout containers, announce nothing.
///
/// SwiftUI applies a label set on a stack to every element inside it. A component whose root is
/// a stack should call ``SwiftUI/View/a2uiAccessibilityControl(for:)`` on its focusable control,
/// or ``SwiftUI/View/a2uiAccessibilityElement(for:children:)`` on its root.
public struct A2UIAccessibilityModifier: ViewModifier {
  public let node: Node

  /// Whether this modifier applies the label and hint. ``ComponentNodeView`` turns this off when
  /// the component applied them to its own control.
  let appliesLabelAndHint: Bool

  public init(node: Node) {
    self.init(node: node, appliesLabelAndHint: true)
  }

  init(node: Node, appliesLabelAndHint: Bool) {
    self.node = node
    self.appliesLabelAndHint = appliesLabelAndHint
  }

  private var attributes: AccessibilityAttributes? {
    node.explicitAccessibilityAttributes
  }

  /// The explicit accessibility label, if the agent set a non-empty one.
  public var label: String? {
    attributes?.label.flatMap { $0.isEmpty ? nil : $0 }
  }

  /// The accessibility hint, taken from the explicit `description`.
  public var hint: String? {
    attributes?.description.flatMap { $0.isEmpty ? nil : $0 }
  }

  /// Whether the component and its subtree are hidden from assistive technologies.
  public var isHidden: Bool {
    attributes?.hidden == true
  }

  /// Whether text changes are announced (`live` is `polite` or `assertive`).
  public var isLiveRegion: Bool {
    attributes?.live == "polite" || attributes?.live == "assertive"
  }

  /// Whether announcements interrupt current speech (`live` is `assertive`).
  public var isAssertive: Bool {
    attributes?.live == "assertive"
  }

  /// The text announced when a live component's visible text changes: the visible text,
  /// preceded by the explicit label when there is one. `nil` when nothing is announced.
  public var announcementText: String? {
    guard isLiveRegion, !isHidden else { return nil }
    let content = [node.string(for: "text"), node.string(for: "title"), node.string(for: "label")]
      .compactMap { $0 }
      .first { !$0.isEmpty }
    guard let content else { return nil }
    guard let label, label != content else { return content }
    return "\(label), \(content)"
  }

  public func body(content: Content) -> some View {
    hidden(
      content
        .a2uiOptionalAccessibilityLabel(appliesLabelAndHint ? label : nil)
        .a2uiOptionalAccessibilityHint(appliesLabelAndHint ? hint : nil)
    )
    .onChange(of: announcementText) { newText in
      guard let newText else { return }
      Self.announce(newText, assertive: isAssertive)
    }
  }

  @ViewBuilder
  private func hidden<V: View>(_ view: V) -> some View {
    if isHidden {
      view.accessibilityHidden(true)
    } else {
      view
    }
  }

  @MainActor
  private static func announce(_ text: String, assertive: Bool) {
    if #available(iOS 17.0, macOS 14.0, *) {
      var announcement = AttributedString(text)
      announcement.accessibilitySpeechAnnouncementPriority = assertive ? .high : .default
      AccessibilityNotification.Announcement(announcement).post()
    } else {
      #if canImport(UIKit)
        UIAccessibility.post(notification: .announcement, argument: text)
      #endif
    }
  }
}
