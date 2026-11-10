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

/// Environment key for the ``A2UIMarkdownURLOptions`` that ``A2UIText`` uses.
public struct A2UIMarkdownURLOptionsKey: EnvironmentKey {
  public static let defaultValue: A2UIMarkdownURLOptions = []
}

extension EnvironmentValues {
  /// The Markdown URL constructs that ``A2UIText`` renders, such as
  /// ``A2UIMarkdownURLOptions/links``. Empty by default.
  ///
  /// ```swift
  /// Surface(viewModel: surface, catalog: catalog)
  ///   .environment(\.a2uiMarkdownURLOptions, .links)
  /// ```
  public var a2uiMarkdownURLOptions: A2UIMarkdownURLOptions {
    get { self[A2UIMarkdownURLOptionsKey.self] }
    set { self[A2UIMarkdownURLOptionsKey.self] = newValue }
  }
}
