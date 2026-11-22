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

/// The default A2UITextFieldStyle: a label above a filled, rounded input whose border and
/// label turn red while a check fails.
public struct DefaultA2UITextFieldStyle: A2UITextFieldStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      if let label = configuration.label {
        label
          .font(.subheadline.weight(.medium))
          .foregroundStyle(configuration.hasError ? Color.red : Color.secondary)
      }

      configuration.field
        .padding(10)
        .background(Color.gray.opacity(0.12))
        .clipShape(.rect(cornerRadius: 8))
        .overlay(
          RoundedRectangle(cornerRadius: 8)
            .stroke(
              configuration.hasError ? Color.red : Color.primary.opacity(0.1),
              lineWidth: configuration.hasError ? 1.5 : 1
            )
        )
    }
  }
}

extension A2UITextFieldStyle where Self == DefaultA2UITextFieldStyle {
  /// The default text field style.
  public static var automatic: DefaultA2UITextFieldStyle { DefaultA2UITextFieldStyle() }
}
