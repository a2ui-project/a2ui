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

/// The Markdown URL constructs that ``A2UIText`` renders. Empty by default, so link syntax
/// renders as plain text.
public struct A2UIMarkdownURLOptions: OptionSet, Hashable, Sendable {
  public let rawValue: Int

  public init(rawValue: Int) {
    self.rawValue = rawValue
  }

  /// Renders Markdown links whose targets the surface's URL security policy allows as
  /// navigation. A blocked target renders as plain text, and the surface reports it.
  public static let links = A2UIMarkdownURLOptions(rawValue: 1 << 0)
}
