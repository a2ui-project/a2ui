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

  public static func < (lhs: A2UIProtocolVersion, rhs: A2UIProtocolVersion) -> Bool {
    guard let lhsIndex = allCases.firstIndex(of: lhs),
      let rhsIndex = allCases.firstIndex(of: rhs)
    else {
      return false
    }
    return lhsIndex < rhsIndex
  }
}
