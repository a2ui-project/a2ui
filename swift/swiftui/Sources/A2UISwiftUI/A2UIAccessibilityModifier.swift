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
/// - `live` (`polite` or `assertive`) posts an announcement whenever the region's text changes:
///   the explicit label if set, followed by the visible text that components in the subtree
///   report with ``SwiftUI/View/a2uiAccessibleText(_:)``. This works for a live `Text` and for a
///   live container such as a `Column` or `Card`. A label on a `Text` replaces its visible text,
///   so it is read once. Nothing is announced while the region or an ancestor is hidden. See
///   ``A2UIAccessibleTextKey``.
///
/// SwiftUI applies a label set on a stack to every element inside it. A component whose root is
/// a stack should call ``SwiftUI/View/a2uiAccessibilityControl(for:)`` on its focusable control,
/// or ``SwiftUI/View/a2uiAccessibilityElement(for:children:)`` on its root.
public struct A2UIAccessibilityModifier: ViewModifier {
  public let node: Node

  private let attributes: AccessibilityAttributes?

  /// Whether this modifier applies the label and hint. ``ComponentNodeView`` turns this off when
  /// the component applied them to its own control.
  let appliesLabelAndHint: Bool

  public init(node: Node) {
    self.init(node: node, appliesLabelAndHint: true)
  }

  init(node: Node, appliesLabelAndHint: Bool) {
    self.node = node
    self.attributes = node.explicitAccessibilityAttributes
    self.appliesLabelAndHint = appliesLabelAndHint
  }

  /// The accessibility identifier (`a2ui-<componentId>`) assigned to the rendered view.
  public var identifier: String {
    "a2ui-\(node.id)"
  }

  /// Whether the identifier is set here. A component that applied its label and hint to its own
  /// control set the identifier on that control too. A container whose children stay separate
  /// elements clears it with ``SwiftUI/View/a2uiAccessibilityElement(for:children:)``.
  private var appliesAccessibilityIdentifier: Bool {
    appliesLabelAndHint
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

  /// The text announced when it changes, for a component whose subtree reports no visible
  /// text. Same as ``announcementText(subtreeText:)`` with no text.
  public var announcementText: String? {
    announcementText(subtreeText: [])
  }

  /// The text announced when it changes: the explicit label of a live component followed by
  /// the visible text its subtree reports through ``A2UIAccessibleTextKey``, one entry per line.
  /// `nil` when nothing is announced.
  public func announcementText(subtreeText: [String]) -> String? {
    guard isLiveRegion, !isHidden else { return nil }
    let parts = ([label].compactMap { $0 } + subtreeText).filter { !$0.isEmpty }
    return parts.isEmpty ? nil : parts.joined(separator: "\n")
  }

  public func body(content: Content) -> some View {
    liveRegion(
      hidden(
        labelText(
          content
            .a2uiOptionalAccessibilityIdentifier(appliesAccessibilityIdentifier ? identifier : nil)
            .a2uiOptionalAccessibilityLabel(appliesLabelAndHint ? label : nil)
            .a2uiOptionalAccessibilityHint(appliesLabelAndHint ? hint : nil)
        )
      )
    )
  }

  /// Reports the explicit label of a component inside a live region, ahead of its subtree text,
  /// so the region reads it too. A live component announces its own label instead.
  private func labelText<V: View>(_ view: V) -> some View {
    view.a2uiAccessibleText(isLiveRegion ? nil : label)
  }

  /// Hides the view and its subtree from assistive technologies when `hidden` is set.
  ///
  /// `hidden` can be bound to the data model. On iOS 18 and macOS 15 and later the view tree is
  /// the same either way, so changing it keeps the component's state. The live region trigger
  /// sits outside this modifier, so it stays mounted on every version.
  private func hidden<V: View>(_ view: V) -> some View {
    let isHidden = isHidden
    return
      accessibilityHiddenIfNeeded(view, isHidden: isHidden)
      // Text that assistive technologies can't reach is not announced by a live ancestor.
      .transformPreference(A2UIAccessibleTextKey.self) { text in
        if isHidden { text = [] }
      }
      .transformEnvironment(\.a2uiInLiveRegion) { isInLiveRegion in
        if isHidden { isInLiveRegion = false }
      }
      .transformEnvironment(\.a2uiAccessibilityHidden) { isAncestorHidden in
        if isHidden { isAncestorHidden = true }
      }
  }

  /// Applies `accessibilityHidden(true)` only when the component is hidden. An outer
  /// `accessibilityHidden(false)` would expose descendants that hide themselves, such as a
  /// `hidden` child of a `Column` or the title `Text` of a `TextField`.
  @ViewBuilder
  private func accessibilityHiddenIfNeeded<V: View>(_ view: V, isHidden: Bool) -> some View {
    if #available(iOS 18, macOS 15, tvOS 18, watchOS 11, visionOS 2, *) {
      // With `isEnabled: false` the modifier does nothing, and the view tree doesn't change.
      view.accessibilityHidden(true, isEnabled: isHidden)
    } else if isHidden {
      // Changing `hidden` swaps these branches, which resets the subtree's state.
      view.accessibilityHidden(true)
    } else {
      view
    }
  }

  @ViewBuilder
  private func liveRegion<V: View>(_ view: V) -> some View {
    // Not conditional on `hidden`, which can be bound to the data model: the announcement
    // trigger stays mounted, so showing the region again announces its text.
    if isLiveRegion {
      view.modifier(LiveRegionHostModifier(modifier: self))
    } else {
      view
    }
  }

  @MainActor
  static func announce(_ text: String, assertive: Bool) {
    guard !text.isEmpty else { return }
    var announcement = AttributedString(text)
    announcement.accessibilitySpeechAnnouncementPriority = assertive ? .high : .default
    AccessibilityNotification.Announcement(announcement).post()
  }
}
