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

import SwiftUI

/// Exposes the checked or selected state of a basic catalog control that is drawn as a plain
/// button, so assistive technologies announce it.
///
/// - A checkbox (`CheckBox`, `ChoicePicker` options with `multipleSelection`) reports
///   "checked" or "unchecked" as its accessibility value, plus the toggle trait where the platform
///   has it (iOS 17, macOS 14 and later).
/// - A radio option (`ChoicePicker` options with `mutuallyExclusive`) and a tab header (`Tabs`)
///   carry the selected trait while they are selected.
public struct A2UISelectionAccessibility: ViewModifier, Equatable, Sendable {
  /// The kind of control, which decides how its state is reported.
  public enum Role: Equatable, Sendable {
    case checkbox
    case radio
    case tab
  }

  public let role: Role
  public let isSelected: Bool

  public init(role: Role, isSelected: Bool) {
    self.role = role
    self.isSelected = isSelected
  }

  /// The traits added to the control.
  public var traits: AccessibilityTraits {
    switch role {
    case .checkbox:
      if #available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *) {
        return .isToggle
      }
      return []
    case .radio, .tab:
      return isSelected ? .isSelected : []
    }
  }

  /// The accessibility value of the control, used as a localization key so host apps can
  /// translate it. `nil` when the state is carried by its traits.
  public var value: String? {
    switch role {
    case .checkbox:
      return isSelected ? "checked" : "unchecked"
    case .radio, .tab:
      return nil
    }
  }

  @ViewBuilder
  public func body(content: Content) -> some View {
    let traited = content.accessibilityAddTraits(traits)
    if let value {
      traited.accessibilityValue(LocalizedStringKey(value))
    } else {
      traited
    }
  }
}
