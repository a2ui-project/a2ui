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
  public static let checkBox = ComponentImplementation(
    api: BasicCatalogComponents.checkBox
  ) { node in
    A2UICheckBox(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `CheckBox` component.
public struct A2UICheckBox: View {
  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  private var labelText: String {
    node.string(for: "label") ?? ""
  }

  private var boolBinding: Binding<Bool> {
    node.binding(for: "value", default: false)
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Button(action: {
        boolBinding.wrappedValue.toggle()
      }) {
        HStack(spacing: 10) {
          Image(systemName: boolBinding.wrappedValue ? "checkmark.square.fill" : "square")
            .font(.system(size: 20))
            .foregroundStyle(boolBinding.wrappedValue ? Color.accentColor : Color.secondary)

          if !labelText.isEmpty {
            Text(labelText)
              .font(.body)
              .foregroundStyle(!node.isValid ? Color.red : Color.primary)
          }
        }
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("A2UICheckBox_\(node.id)")

      if let firstError = node.validationErrors.first {
        Text(firstError)
          .font(.caption)
          .foregroundStyle(Color.red)
          .accessibilityIdentifier("A2UICheckBox_Error_\(node.id)")
      }
    }
  }
}
