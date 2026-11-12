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

/// The properties of an A2UI `Button` component passed to an ``A2UIButtonStyle``.
public struct A2UIButtonStyleConfiguration {
  /// The semantic visual variant of an A2UI button.
  public enum Variant: String, Sendable, Equatable {
    case standard = "default"
    case primary
    case borderless
  }

  /// A view representing the label content of the button.
  public struct Label: View {
    private let base: ButtonStyleConfiguration.Label

    init(_ base: ButtonStyleConfiguration.Label) {
      self.base = base
    }

    public var body: some View {
      base
    }
  }

  /// The child view rendered inside the button.
  public let label: Label

  /// The resolved semantic variant (`standard`, `primary`, or `borderless`).
  public let variant: Variant

  /// Whether the user is currently pressing the button.
  public let isPressed: Bool

  /// Whether the button is disabled due to validation errors or an explicit `disabled` property.
  public let isDisabled: Bool

  /// The underlying A2UI component node for the button.
  public let node: Node
}
