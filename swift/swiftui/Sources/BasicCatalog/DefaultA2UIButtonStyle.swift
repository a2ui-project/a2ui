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

import A2UISwiftUI
import OrderedJSON
import SwiftUI

/// The default ``A2UIButtonStyle`` with theme-aware primary colors, a 44pt minimum tap target,
/// and interactive pressed-state feedback.
public struct DefaultA2UIButtonStyle: A2UIButtonStyle {
  @Environment(\.a2uiTheme) private var theme

  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    let isBorderless = configuration.variant == .borderless
    configuration.label
      .padding(.horizontal, isBorderless ? 0 : 16)
      .padding(.vertical, isBorderless ? 0 : 10)
      .frame(minHeight: isBorderless ? nil : 44)
      .background(backgroundColor(for: configuration.variant))
      .foregroundStyle(foregroundColor(for: configuration.variant))
      .clipShape(.rect(cornerRadius: 8))
      .overlay(
        Color.primary.opacity(0.12),
        in: .rect(cornerRadius: 8).stroke(lineWidth: configuration.variant == .standard ? 1 : 0)
      )
      .opacity(opacity(for: configuration))
  }

  private func opacity(for configuration: Configuration) -> Double {
    if configuration.isDisabled {
      return 0.5
    }
    return configuration.isPressed ? 0.75 : 1.0
  }

  private func backgroundColor(for variant: Configuration.Variant) -> Color {
    switch variant {
    case .primary:
      .a2uiPrimary(from: theme)
    case .borderless:
      .clear
    case .standard:
      .gray.opacity(0.12)
    }
  }

  private func foregroundColor(for variant: Configuration.Variant) -> Color {
    switch variant {
    case .primary:
      .white
    case .borderless:
      .a2uiPrimary(from: theme)
    case .standard:
      .primary
    }
  }
}

extension A2UIButtonStyle where Self == DefaultA2UIButtonStyle {
  /// The default theme-aware button style.
  public static var automatic: DefaultA2UIButtonStyle { DefaultA2UIButtonStyle() }
}
