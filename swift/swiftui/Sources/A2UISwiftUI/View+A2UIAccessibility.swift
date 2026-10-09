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

extension View {
  /// Applies the node's A2UI `accessibility` attributes. See ``A2UIAccessibilityModifier``.
  public func a2uiAccessibility(for node: Node) -> some View {
    modifier(A2UIAccessibilityModifier(node: node))
  }

  /// Applies the node's explicit accessibility label and hint to this view, the component's
  /// focusable control (for example the text field of a `TextField` component).
  ///
  /// Call this on the control when the component's root is a stack that also holds a visible
  /// label or error text. ``ComponentNodeView`` then leaves the label and hint off the root, so
  /// they reach the element that assistive technologies focus. `hidden` and `live` still apply to
  /// the whole component.
  public func a2uiAccessibilityControl(for node: Node) -> some View {
    let modifier = A2UIAccessibilityModifier(node: node)
    return
      self
      .a2uiOptionalAccessibilityLabel(modifier.label)
      .a2uiOptionalAccessibilityHint(modifier.hint)
      .preference(key: A2UIAccessibilityControlKey.self, value: true)
  }

  /// Turns this view into a single accessibility element when the node has an explicit
  /// accessibility label or description, so the label describes the component as a whole
  /// instead of being applied to each element inside a stack.
  ///
  /// Use `.contain` for components with several interactive elements, and `.combine` for
  /// read-only content such as text. For a component with one focusable control, use
  /// ``SwiftUI/View/a2uiAccessibilityControl(for:)`` on that control instead. SwiftUI drops an
  /// accessibility hint on a `.contain` group, so `description` does not reach assistive
  /// technologies there.
  @ViewBuilder
  public func a2uiAccessibilityElement(
    for node: Node,
    children: AccessibilityChildBehavior
  ) -> some View {
    let attributes = node.explicitAccessibilityAttributes
    if attributes?.label?.isEmpty == false || attributes?.description?.isEmpty == false {
      accessibilityElement(children: children)
    } else {
      self
    }
  }

  @ViewBuilder
  func a2uiOptionalAccessibilityLabel(_ label: String?) -> some View {
    if let label {
      accessibilityLabel(label)
    } else {
      self
    }
  }

  @ViewBuilder
  func a2uiOptionalAccessibilityHint(_ hint: String?) -> some View {
    if let hint {
      accessibilityHint(hint)
    } else {
      self
    }
  }
}
