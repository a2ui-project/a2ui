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
import SwiftUI

/// The properties of an A2UI `Card` component passed to an ``A2UICardStyle``.
public struct A2UICardStyleConfiguration {
  /// A type-erased view representing the child content of the card.
  public struct Content: View {
    private let base: AnyView

    init(_ view: some View) {
      self.base = AnyView(view)
    }

    public var body: some View {
      base
    }
  }

  /// The resolved child view of the card.
  public let content: Content

  /// The underlying A2UI component node for the card.
  public let node: Node
}
