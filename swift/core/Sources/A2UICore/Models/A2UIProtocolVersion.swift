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

/// Supported A2UI protocol versions.
public enum A2UIProtocolVersion: String, Codable, Sendable, CaseIterable, Comparable {
  case v09 = "v0.9"
  case v091 = "v0.9.1"
  case v10 = "v1.0"

  /// The default active protocol version for outgoing messages.
  public static let `default`: A2UIProtocolVersion = .v10

  /// Initializes from a version string, loosely accepting strings without a leading "v".
  public init?(loose raw: String) {
    if let exact = A2UIProtocolVersion(rawValue: raw) {
      self = exact
      return
    }
    let withV = raw.hasPrefix("v") ? raw : "v\(raw)"
    if let match = A2UIProtocolVersion(rawValue: withV) {
      self = match
      return
    }
    return nil
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    let raw = try container.decode(String.self)
    guard let version = A2UIProtocolVersion(loose: raw) else {
      throw DecodingError.dataCorruptedError(
        in: container,
        debugDescription: "Unsupported protocol version: \(raw)"
      )
    }
    self = version
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(rawValue)
  }

  public static func < (lhs: A2UIProtocolVersion, rhs: A2UIProtocolVersion) -> Bool {
    guard let lhsIndex = allCases.firstIndex(of: lhs),
      let rhsIndex = allCases.firstIndex(of: rhs)
    else {
      return false
    }
    return lhsIndex < rhsIndex
  }
}
