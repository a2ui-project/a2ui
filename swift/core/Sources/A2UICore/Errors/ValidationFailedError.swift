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

/// Represents a structured validation failure.
public struct ValidationFailedError: Error, Equatable, Codable, Sendable, ProtocolVersioned {
  public enum Code: String, Codable, Sendable, CaseIterable {
    case validationFailed = "VALIDATION_FAILED"
    case unallowedParent = "UNALLOWED_PARENT"
    case unallowedChild = "UNALLOWED_CHILD"
  }

  public let code: Code
  public let surfaceID: String
  public let path: String
  public let message: String
  public var version: A2UIProtocolVersion

  private enum CodingKeys: String, CodingKey {
    case code
    case surfaceID = "surfaceId"
    case path
    case message
  }

  public init(
    code: Code = .validationFailed,
    surfaceID: String,
    path: String,
    message: String,
    version: A2UIProtocolVersion
  ) {
    self.code = code
    self.surfaceID = surfaceID
    self.path = path
    self.message = message
    self.version = version
  }

  public init(from decoder: Decoder, version: A2UIProtocolVersion) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    code = try container.decode(Code.self, forKey: .code)
    surfaceID = try container.decode(String.self, forKey: .surfaceID)
    path = try container.decode(String.self, forKey: .path)
    message = try container.decode(String.self, forKey: .message)
    self.version = version
  }
}
