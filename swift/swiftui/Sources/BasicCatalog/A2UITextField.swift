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

  /// The optional hint text resolved from the v1.0 `placeholder` property.
  public var placeholderText: String? {
    node.string(for: "placeholder")
  }

  /// Two-way binding for the text field's `value` property.
  public var valueBinding: Binding<String> {
    node.binding(for: "value", default: "")
  }

  /// Whether all blocking (`severity == .error`) validation checks pass.
  public var isValid: Bool {
    node.isValid
  }

  /// Active blocking validation error messages.
  public var validationErrors: [String] {
    node.validationErrors
  }

  /// Structured validation results for all failing checks, including warnings and info.
  public var validationResults: [ValidationResult] {
    node.validationResults
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      A2UITextFieldStyleHost(node: node)
      A2UICheckMessage(node: node, identifierPrefix: "A2UITextField")
    }
  }
}

/// Resolves the environment's ``A2UITextFieldStyle`` inside the view tree, so reading
/// `A2UITextField.body` outside a hosted view doesn't read the environment.
private struct A2UITextFieldStyleHost: View {
  @Environment(\.a2uiTextFieldStyle) private var style
  @Environment(\.isEnabled) private var isEnabled

  let node: Node

  var body: some View {
    let labelText = node.string(for: "label") ?? ""
    let variant =
      A2UITextFieldStyleConfiguration.Variant(rawValue: node.string(for: "variant") ?? "")
      ?? .shortText
    let configuration = A2UITextFieldStyleConfiguration(
      label: labelText.isEmpty ? nil : A2UITextFieldStyleConfiguration.Label(labelText),
      field: A2UITextFieldStyleConfiguration.Field(node: node, variant: variant),
      variant: variant,
      errorMessage: node.validationErrors.first,
      isDisabled: !isEnabled,
      node: node
    )
    style.resolve(configuration: configuration)
  }
}
