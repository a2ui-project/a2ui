// Copyright 2026 Google LLC
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
public struct ValidationFailedError: Error, Equatable, Codable, Sendable {
  public static let errorCode = "VALIDATION_FAILED"

  public let code: String = errorCode
  public let surfaceID: String
  public let path: String
  public let message: String

  private enum CodingKeys: String, CodingKey {
    case code
    case surfaceID = "surfaceId"
    case path
    case message
  }

  public init(surfaceID: String, path: String, message: String) {
    self.surfaceID = surfaceID
    self.path = path
    self.message = message
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let decodedCode = try container.decode(String.self, forKey: .code)
    guard decodedCode == Self.errorCode else {
      throw DecodingError.dataCorruptedError(
        forKey: .code,
        in: container,
        debugDescription: "Invalid error code: \(decodedCode)"
      )
    }
    surfaceID = try container.decode(String.self, forKey: .surfaceID)
    path = try container.decode(String.self, forKey: .path)
    message = try container.decode(String.self, forKey: .message)
  }
}
