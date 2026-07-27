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

import Foundation

/// A thread-safe parser for decoding A2UI server-to-client messages.
public final class MessageParser: Sendable {
  private let decoder: JSONDecoder

  public init(decoder: JSONDecoder = JSONDecoder()) {
    self.decoder = decoder
  }

  /// Parses a `ServerToClientMessage` from a JSON-encoded string.
  public func parse(jsonString: String) throws -> ServerToClientMessage {
    let data = Data(jsonString.utf8)
    return try decode(jsonData: data)
  }

  /// Decodes a `ServerToClientMessage` from raw JSON data.
  public func decode(jsonData: Data) throws -> ServerToClientMessage {
    try decoder.decode(ServerToClientMessage.self, from: jsonData)
  }

  /// Best-effort extraction of a `surfaceId` from a raw JSON line.
  ///
  /// This is used as a fallback when `parse(jsonString:)` fails, so
  /// the caller can still attribute the error to the correct
  /// surface. Returns `nil` if the JSON is malformed or contains no
  /// `surfaceId` field.
  public func extractSurfaceID(fromLine line: String) -> String? {
    guard let data = line.data(using: .utf8),
      let dict = try? JSONSerialization.jsonObject(with: data)
        as? [String: Any]
    else {
      return nil
    }

    for value in dict.values {
      guard let subDict = value as? [String: Any],
        let rawID = subDict["surfaceId"]
      else { continue }

      if let strID = rawID as? String {
        return strID
      } else if let numID = rawID as? NSNumber {
        return numID.stringValue
      }
    }
    return nil
  }
}
