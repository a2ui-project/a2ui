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
  public static let textField = ComponentImplementation(
    api: BasicCatalogComponents.textField
  ) { node in
    A2UITextField(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `TextField` input component.
public struct A2UITextField: View {
  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  private var labelText: String {
    node.string(for: "label") ?? ""
  }

  private var variant: String {
    node.string(for: "variant") ?? "shortText"
  }

  private var valueBinding: Binding<String> {
    node.binding(for: "value", default: "")
  }

  private var validationErrors: [String] {
    node.validationErrors
  }

  private var hasError: Bool {
    !validationErrors.isEmpty
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if !labelText.isEmpty {
        Text(labelText)
          .font(.subheadline.weight(.medium))
          .foregroundStyle(hasError ? Color.red : Color.secondary)
      }

      inputFieldForVariant
        .padding(10)
        .background(Color.gray.opacity(0.12))
        .cornerRadius(8)
        .overlay(
          RoundedRectangle(cornerRadius: 8)
            .stroke(
              hasError ? Color.red : Color.primary.opacity(0.1), lineWidth: hasError ? 1.5 : 1)
        )
        .accessibilityIdentifier("A2UITextField_\(node.id)")

      if let firstError = validationErrors.first {
        Text(firstError)
          .font(.caption)
          .foregroundStyle(Color.red)
          .accessibilityIdentifier("A2UITextField_Error_\(node.id)")
      }
    }
  }

  @ViewBuilder
  private var inputFieldForVariant: some View {
    switch variant {
    case "obscured":
      SecureField(labelText, text: valueBinding)
        .accessibilityIdentifier("A2UITextField_\(node.id)")
    case "longText":
      TextEditor(text: valueBinding)
        .scrollContentBackground(.hidden)
        .frame(minHeight: 80)
        .accessibilityIdentifier("A2UITextField_\(node.id)")
    case "number":
      #if os(iOS)
        TextField(labelText, text: valueBinding)
          .keyboardType(.decimalPad)
          .accessibilityIdentifier("A2UITextField_\(node.id)")
      #else
        TextField(labelText, text: valueBinding)
          .accessibilityIdentifier("A2UITextField_\(node.id)")
      #endif
    default:
      TextField(labelText, text: valueBinding)
        .accessibilityIdentifier("A2UITextField_\(node.id)")
    }
  }
}
