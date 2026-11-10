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

/// A warning that the URL security policy blocked a URL on a surface.
///
/// Surfaces publish it on ``SurfaceViewModel/urlBlockedPublisher`` and processors on
/// ``MessageProcessor/urlBlockedPublisher``, once per URL and place it appears. It carries a
/// redacted form of the URL, never the full URL, since the path or query may hold the data
/// being exfiltrated.
public struct URLBlockedWarning: Hashable, Sendable {
  /// The code of this warning, `URL_BLOCKED`.
  public static let code = "URL_BLOCKED"

  /// The identifier of the surface the URL was blocked on.
  public let surfaceID: String
  /// How the URL would have been used.
  public let context: URLContext
  /// A form of the URL that is safe to log: `scheme://host[:port]` for a URL with a host,
  /// `data:<media type>` for a `data:` URL, `relative` for a relative URL, and `<scheme>:`
  /// otherwise.
  public let redactedURL: String
  /// Where the URL comes from.
  public let info: URLCheckInfo
  /// A description of the warning, which includes ``redactedURL`` and where the URL appeared.
  public let message: String

  /// The code of this warning, `URL_BLOCKED`.
  public var code: String { Self.code }

  /// Creates a warning.
  public init(
    surfaceID: String,
    context: URLContext,
    redactedURL: String,
    info: URLCheckInfo,
    message: String
  ) {
    self.surfaceID = surfaceID
    self.context = context
    self.redactedURL = redactedURL
    self.info = info
    self.message = message
  }
}
