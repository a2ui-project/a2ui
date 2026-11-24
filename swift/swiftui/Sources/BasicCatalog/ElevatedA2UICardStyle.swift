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

/// An ``A2UICardStyle`` that renders cards with an elevated material surface and deeper shadow.
public struct ElevatedA2UICardStyle: A2UICardStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    configuration.content
      .padding(16)
      .background(.regularMaterial, in: .rect(cornerRadius: 14))
      .shadow(color: Color.black.opacity(0.08), radius: 10, x: 0, y: 4)
  }
}

extension A2UICardStyle where Self == ElevatedA2UICardStyle {
  /// An elevated card style using system material and a deeper drop shadow.
  public static var elevated: ElevatedA2UICardStyle { ElevatedA2UICardStyle() }
}
