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

/// A type that applies custom appearance to A2UITextField components within a view
/// hierarchy.
///
/// Configure the text field style for a `Surface` or container view using
/// SwiftUI/View/a2uiTextFieldStyle(_:).
public protocol A2UITextFieldStyle: DynamicProperty, Sendable {
  /// A view that represents the styled text field.
  associatedtype Body: View

  /// The properties of the text field component being styled.
  typealias Configuration = A2UITextFieldStyleConfiguration

  /// Creates a view that represents the label and input of a text field.
  ///
  /// A2UITextField shows the message of a failing check below this view, so a style
  /// doesn't need to render it.
  @MainActor
  @ViewBuilder
  func makeBody(configuration: Configuration) -> Body
}

private struct ResolvedTextFieldStyleView<Style: A2UITextFieldStyle>: View {
  let style: Style
  let configuration: A2UITextFieldStyleConfiguration

  var body: some View {
    style.makeBody(configuration: configuration)
  }
}

extension A2UITextFieldStyle {
  @MainActor
  func resolve(configuration: Configuration) -> AnyView {
    AnyView(ResolvedTextFieldStyleView(style: self, configuration: configuration))
  }
}

extension EnvironmentValues {
  /// The active text field style applied to A2UITextField components in this environment.
  @Entry public var a2uiTextFieldStyle: any A2UITextFieldStyle = DefaultA2UITextFieldStyle()
}

extension View {
  /// Sets the style for A2UITextField components within this view.
  public func a2uiTextFieldStyle(_ style: some A2UITextFieldStyle) -> some View {
    environment(\.a2uiTextFieldStyle, style)
  }
}
