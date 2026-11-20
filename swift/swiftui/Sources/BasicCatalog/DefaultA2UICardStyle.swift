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

/// The default ``A2UICardStyle`` with subtle secondary fill, hairline border, and soft shadow.
public struct DefaultA2UICardStyle: A2UICardStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    configuration.content
      .padding(16)
      .background(Color.gray.opacity(0.1))
      .clipShape(.rect(cornerRadius: 12))
      .overlay(
        Color.primary.opacity(0.08),
        in: .rect(cornerRadius: 12).stroke(lineWidth: 1)
      )
      .shadow(color: Color.black.opacity(0.04), radius: 6, x: 0, y: 2)
  }
}

extension A2UICardStyle where Self == DefaultA2UICardStyle {
  /// The default card style.
  public static var automatic: DefaultA2UICardStyle { DefaultA2UICardStyle() }
}
