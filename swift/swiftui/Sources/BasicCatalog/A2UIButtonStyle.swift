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

/// A type that applies custom appearance and interaction feedback to ``A2UIButton`` components
/// within a view hierarchy.
///
/// Configure the button style for a `Surface` or container view using
/// ``SwiftUI/View/a2uiButtonStyle(_:)``.
public protocol A2UIButtonStyle: DynamicProperty, Sendable {
  /// A view that represents the styled button.
  associatedtype Body: View

  /// The properties of the button component being styled.
  typealias Configuration = A2UIButtonStyleConfiguration

  /// Creates a view that represents the body of a button.
  @MainActor
  @ViewBuilder
  func makeBody(configuration: Configuration) -> Body
}

private struct ResolvedButtonStyleView<Style: A2UIButtonStyle>: View {
  let style: Style
  let configuration: A2UIButtonStyleConfiguration

  var body: some View {
    style.makeBody(configuration: configuration)
  }
}

extension A2UIButtonStyle {
  @MainActor
  func resolve(configuration: Configuration) -> AnyView {
    AnyView(ResolvedButtonStyleView(style: self, configuration: configuration))
  }
}

extension EnvironmentValues {
  /// The active button style applied to ``A2UIButton`` components in this environment.
  @Entry public var a2uiButtonStyle: any A2UIButtonStyle = DefaultA2UIButtonStyle()
}

extension View {
  /// Sets the style for ``A2UIButton`` components within this view.
  public func a2uiButtonStyle(_ style: some A2UIButtonStyle) -> some View {
    environment(\.a2uiButtonStyle, style)
  }
}
