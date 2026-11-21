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

/// An ``A2UICardStyle`` that renders cards with a crisp stroke border and transparent background.
public struct OutlinedA2UICardStyle: A2UICardStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    configuration.content
      .padding(16)
      .overlay(
        Color.primary.opacity(0.16),
        in: .rect(cornerRadius: 12).stroke(lineWidth: 1)
      )
  }
}

extension A2UICardStyle where Self == OutlinedA2UICardStyle {
  /// An outlined card style with a stroke border and no drop shadow.
  public static var outlined: OutlinedA2UICardStyle { OutlinedA2UICardStyle() }
}
