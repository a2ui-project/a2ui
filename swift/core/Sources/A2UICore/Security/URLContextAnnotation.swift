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

/// The value a catalog property declares with the `x-a2ui-url-context` keyword.
///
/// ``notURL`` (written `"none"` in a catalog) states that a property is not a URL, even if its
/// name looks like one or a built-in list would treat it as one.
public enum URLContextAnnotation: String, CaseIterable, Hashable, Sendable {
  /// The property holds a URL loaded automatically. See ``URLContext/media``.
  case media
  /// The property holds a URL opened after a user action. See ``URLContext/navigation``.
  case navigation
  /// The property holds a URL embedded in a frame. See ``URLContext/iframe``.
  case iframe
  /// The property is not a URL.
  case notURL = "none"

  /// Creates the annotation for a URL context.
  public init(_ context: URLContext) {
    switch context {
    case .media: self = .media
    case .navigation: self = .navigation
    case .iframe: self = .iframe
    }
  }

  /// The URL context the annotation names, or `nil` for ``notURL``.
  public var urlContext: URLContext? {
    URLContext(rawValue: rawValue)
  }
}
