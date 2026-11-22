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
import SwiftUI

/// The properties of an A2UI `TextField` component passed to an A2UITextFieldStyle.
public struct A2UITextFieldStyleConfiguration {
  /// The kind of input an A2UI text field collects.
  public enum Variant: String, Sendable, Equatable {
    case shortText
    case longText
    case number
    case obscured
  }

  /// A view showing the text of the field's `label` property.
  ///
  /// The field itself carries the label for assistive technologies, so this view is hidden from
  /// them.
  public struct Label: View {
    private let text: String

    init(_ text: String) {
      self.text = text
    }

    public var body: some View {
      Text(text)
        .accessibilityHidden(true)
    }
  }

  /// The input control for the field's variant, bound to its `value` property.
  ///
  /// It carries the component's accessibility identifier, label and hint.
  public struct Field: View {
    private let node: Node
    private let variant: Variant

    init(node: Node, variant: Variant) {
      self.node = node
      self.variant = variant
    }

    private var labelText: String {
      node.string(for: "label") ?? ""
    }

    /// The prompt shown inside fields; when `nil`, SwiftUI falls back to the label.
    private var prompt: Text? {
      node.string(for: "placeholder").map { Text($0) }
    }

    private var value: Binding<String> {
      node.binding(for: "value", default: "")
    }

    public var body: some View {
      input
        .accessibilityIdentifier("a2ui-\(node.id)")
        .a2uiAccessibilityControl(for: node, defaultLabel: labelText)
    }

    @ViewBuilder
    private var input: some View {
      switch variant {
      case .obscured:
        SecureField(labelText, text: value, prompt: prompt)
          .accessibilityIdentifier("a2ui-\(node.id)")
      case .longText:
        TextField(labelText, text: value, prompt: prompt, axis: .vertical)
          .lineLimit(3...8)
          .accessibilityIdentifier("a2ui-\(node.id)")
      case .number:
        #if os(iOS)
          TextField(labelText, text: value, prompt: prompt)
            .keyboardType(.decimalPad)
            .accessibilityIdentifier("a2ui-\(node.id)")
        #else
          TextField(labelText, text: value, prompt: prompt)
            .accessibilityIdentifier("a2ui-\(node.id)")
        #endif
      case .shortText:
        TextField(labelText, text: value, prompt: prompt)
          .accessibilityIdentifier("a2ui-\(node.id)")
      }
    }
  }

  /// The field's label, or `nil` when its `label` property is empty.
  public let label: Label?

  /// The input control. Render it once so the component keeps its data binding and accessibility.
  public let field: Field

  /// The resolved variant. An unknown or missing `variant` property resolves to `shortText`.
  public let variant: Variant

  /// The message of the first failing `error` check, or `nil` when none fails.
  public let errorMessage: String?

  /// Whether the field is disabled, for example by an ancestor's `disabled(_:)` modifier.
  public let isDisabled: Bool

  /// The underlying A2UI component node for the text field.
  public let node: Node

  /// Whether a blocking `error` check is failing.
  public var hasError: Bool {
    errorMessage != nil
  }
}
