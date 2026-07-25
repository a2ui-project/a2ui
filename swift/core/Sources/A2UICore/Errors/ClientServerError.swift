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

/// Encapsulates all client-to-server error types.
public enum ClientServerError: Equatable, Codable, Sendable {
  case validationFailed(ValidationFailedError)
  case generic(GenericError)

  private struct Discriminator: Decodable {
    let code: String
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    let discriminator = try container.decode(Discriminator.self)
    if discriminator.code == ValidationFailedError.errorCode {
      self = .validationFailed(try container.decode(ValidationFailedError.self))
    } else {
      self = .generic(try container.decode(GenericError.self))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .validationFailed(let validation):
      try container.encode(validation)
    case .generic(let generic):
      try container.encode(generic)
    }
  }
}
