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

import OrderedJSON

/// A generic array of heterogeneous resolved values.
public struct ResolvedArray: Resolved, Equatable, Sendable {
  public var elements: [any Resolved]

  public init(_ elements: [any Resolved] = []) {
    self.elements = elements
  }

  public static func == (lhs: ResolvedArray, rhs: ResolvedArray) -> Bool {
    guard lhs.elements.count == rhs.elements.count else { return false }
    for (left, right) in zip(lhs.elements, rhs.elements) {
      guard left.isEqual(to: right) else { return false }
    }
    return true
  }
}
