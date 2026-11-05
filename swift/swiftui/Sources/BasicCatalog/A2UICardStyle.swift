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

/// A type that applies custom appearance and chrome to ``A2UICard`` components within a view
/// hierarchy.
///
/// Configure the card style for a ``Surface`` or container view using `` SwiftUICore/View/a2uiCardStyle(_:) ``.
public protocol A2UICardStyle: Sendable {
  /// A view that represents the styled card.
  associatedtype Body: View

  /// The properties of the card component being styled.
  typealias Configuration = A2UICardStyleConfiguration

  /// Creates a view that represents the body of a card.
  @MainActor
  @ViewBuilder
  func makeBody(configuration: Configuration) -> Body
}

extension EnvironmentValues {
  /// The active card style applied to ``A2UICard`` components in this environment.
  @Entry public var a2uiCardStyle: any A2UICardStyle = DefaultA2UICardStyle()
}

extension View {
  /// Sets the style for ``A2UICard`` components within this view.
  public func a2uiCardStyle(_ style: some A2UICardStyle) -> some View {
    environment(\.a2uiCardStyle, style)
  }
}
