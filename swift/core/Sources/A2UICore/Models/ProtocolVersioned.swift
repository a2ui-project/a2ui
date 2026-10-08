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

/// A message or payload type associated with a specific A2UI protocol version.
public protocol ProtocolVersioned: Sendable {
  /// The A2UI protocol version associated with this value.
  var version: A2UIProtocolVersion { get set }

  /// Decodes the payload from a decoder using an explicit protocol version from the envelope.
  init(from decoder: Decoder, version: A2UIProtocolVersion) throws
}

extension ProtocolVersioned {
  public init(from decoder: Decoder) throws {
    guard let version = decoder.userInfo[.a2uiProtocolVersion] as? A2UIProtocolVersion else {
      throw DecodingError.dataCorrupted(
        DecodingError.Context(
          codingPath: decoder.codingPath,
          debugDescription:
            "Decoding \(Self.self) directly requires CodingUserInfoKey.a2uiProtocolVersion "
            + "to be set on the decoder, or decoding via the outer message envelope."
        )
      )
    }
    try self.init(from: decoder, version: version)
  }
}
