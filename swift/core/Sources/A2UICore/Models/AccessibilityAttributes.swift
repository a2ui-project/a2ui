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

/// Resolved accessibility attributes for a UI component node.
public struct AccessibilityAttributes: Equatable, Sendable {
  /// The primary accessibility label for assistive technologies.
  public let label: String?

  /// Detailed description or hint for the element.
  public let description: String?

  /// Politeness level for dynamic live updates (`"off"`, `"polite"`, `"assertive"`).
  public let live: String?

  /// Whether the element should be hidden from assistive technologies.
  public let hidden: Bool?

  /// Creates accessibility attributes.
  public init(
    label: String? = nil,
    description: String? = nil,
    live: String? = nil,
    hidden: Bool? = nil
  ) {
    self.label = label
    self.description = description
    self.live = live
    self.hidden = hidden
  }
}
