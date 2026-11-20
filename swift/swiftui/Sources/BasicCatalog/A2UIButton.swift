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
import SwiftUI

// MARK: - Component Implementation

@MainActor
extension BasicCatalogImplementation {
  public static let button = ComponentImplementation(api: BasicCatalogComponents.button) { node in
    A2UIButton(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Button` component.
public struct A2UIButton: View {
  @Environment(\.a2uiButtonStyle) private var buttonStyle
  @Environment(\.a2uiModalTriggerAction) private var modalTriggerAction

  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  /// Whether the button is disabled due to a blocking validation error (`!node.isValid`) or
  /// explicit `disabled` property.
  public var isDisabled: Bool {
    !node.isValid || node.bool(for: "disabled") == true
  }

  private var hasExplicitLabel: Bool {
    node.explicitAccessibilityAttributes?.label?.isEmpty == false
  }

  private var childNode: Node? {
    node.child(for: "child")
  }

  private var variant: A2UIButtonStyleConfiguration.Variant {
    A2UIButtonStyleConfiguration.Variant(rawValue: node.string(for: "variant") ?? "") ?? .standard
  }

  private var action: ResolvedAction? {
    node.action(for: "action", userActivation: true)
  }

  public var body: some View {
    let style = buttonStyle
    Button(action: {
      action?()
      modalTriggerAction?()
    }) {
      if let childNode {
        ComponentNodeView(node: childNode)
      }
    }
    .buttonStyle(
      A2UIButtonStyleBridge(
        resolveStyle: { style.resolve(configuration: $0) },
        variant: variant,
        isDisabled: isDisabled,
        node: node
      )
    )
    .disabled(isDisabled)
    .accessibilityIdentifier("a2ui-\(node.id)")
    // The button combines its content into one element, so an explicit label replaces the
    // content's text, and a live region reads only the label.
    .transformPreference(A2UIAccessibleTextKey.self) { text in
      if hasExplicitLabel { text = [] }
    }
    .preference(key: A2UIModalTriggerHandledKey.self, value: modalTriggerAction != nil)
  }
}

private struct A2UIButtonStyleBridge: ButtonStyle {
  @Environment(\.isEnabled) private var isEnabled

  let resolveStyle: @MainActor (A2UIButtonStyleConfiguration) -> AnyView
  let variant: A2UIButtonStyleConfiguration.Variant
  let isDisabled: Bool
  let node: Node

  func makeBody(configuration: Configuration) -> some View {
    let styleConfiguration = A2UIButtonStyleConfiguration(
      label: A2UIButtonStyleConfiguration.Label(configuration.label),
      variant: variant,
      isPressed: configuration.isPressed,
      isDisabled: isDisabled || !isEnabled,
      node: node
    )
    resolveStyle(styleConfiguration)
  }
}
