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

/// Top-level envelope for client-to-server messages (actions or errors).
///
/// Matches `specification/v0_9_1/json/client_to_server.json`.
public enum ClientToServerMessage: Equatable, Codable, Sendable {
  case action(ClientAction)
  case error(ClientServerError)

  private enum CodingKeys: String, CodingKey {
    case version
    case action
    case error
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let version = try container.decode(String.self, forKey: .version)
    guard version == "v0.9" || version == "v0.9.1" else {
      throw DecodingError.dataCorruptedError(
        forKey: .version,
        in: container,
        debugDescription: "Unsupported version: \(version)"
      )
    }

    if let action = try container.decodeIfPresent(
      ClientAction.self,
      forKey: .action
    ) {
      self = .action(action)
    } else if let error = try container.decodeIfPresent(
      ClientServerError.self,
      forKey: .error
    ) {
      self = .error(error)
    } else {
      throw DecodingError.dataCorrupted(
        DecodingError.Context(
          codingPath: decoder.codingPath,
          debugDescription: "Message must contain either 'action' or 'error'"
        )
      )
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode("v0.9.1", forKey: .version)

    switch self {
    case .action(let action):
      try container.encode(action, forKey: .action)
    case .error(let error):
      try container.encode(error, forKey: .error)
    }
  }
}

