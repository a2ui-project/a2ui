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

/// Environment key for the view an app renders Markdown with, which component implementations
/// use for the Markdown they show.
public struct A2UIMarkdownKey: EnvironmentKey {
  public static let defaultValue: (@MainActor @Sendable (String) -> AnyView)? = nil
}

extension EnvironmentValues {
  /// Builds the view that renders a Markdown string, or `nil` to use the component's own
  /// rendering. Set it with ``SwiftUICore/View/a2uiMarkdown(_:)``.
  public var a2uiMarkdown: (@MainActor @Sendable (String) -> AnyView)? {
    get { self[A2UIMarkdownKey.self] }
    set { self[A2UIMarkdownKey.self] = newValue }
  }
}

extension View {
  /// Renders the Markdown of the A2UI components below this view with `content`, the view the
  /// app renders Markdown with elsewhere.
  ///
  /// The view is built inside the app's view hierarchy, so it reads the app's environment.
  public func a2uiMarkdown<Content: View>(
    @ViewBuilder _ content: @escaping @MainActor @Sendable (String) -> Content
  ) -> some View {
    environment(\.a2uiMarkdown) { markdown in AnyView(content(markdown)) }
  }
}
