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
import OrderedJSON
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
  @Environment(\.a2uiTheme) private var theme

  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  private var childNode: Node? {
    node.child(for: "child")
  }

  private var variant: String {
    node.string(for: "variant") ?? "default"
  }

  private var action: ResolvedAction? {
    node.action(for: "action")
  }

  public var body: some View {
    Button(action: { action?() }) {
      Group {
        if let childNode {
          ComponentNodeView(node: childNode)
        }
      }
      .padding(.horizontal, variant == "borderless" ? 0 : 16)
      .padding(.vertical, variant == "borderless" ? 0 : 10)
      .frame(minHeight: variant == "borderless" ? nil : 40)
      .background(backgroundView)
      .foregroundStyle(foregroundStyle)
      .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .stroke(borderColor, lineWidth: variant == "default" ? 1 : 0)
      )
      .opacity(node.isValid ? 1.0 : 0.5)
    }
    .buttonStyle(.plain)
    .disabled(!node.isValid)
    .accessibilityIdentifier("A2UIButton_\(node.id)")
  }

  @ViewBuilder
  private var backgroundView: some View {
    switch variant {
    case "primary":
      Color.a2uiPrimary(from: theme)
    case "borderless":
      Color.clear
    default:
      Color.gray.opacity(0.12)
    }
  }

  private var foregroundStyle: AnyShapeStyle {
    switch variant {
    case "primary":
      return AnyShapeStyle(Color.white)
    case "borderless":
      return AnyShapeStyle(Color.a2uiPrimary(from: theme))
    default:
      return AnyShapeStyle(Color.primary)
    }
  }

  private var borderColor: Color {
    Color.primary.opacity(0.12)
  }
}
