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

/// Converts internal Swift errors (e.g. `DecodingError`) into
/// spec-compliant `ClientServerError` values suitable for sending
/// to the server.
///
/// This type encapsulates the mapping logic that was previously
/// inlined in `MessageProcessor.handleError`. It is a value type
/// with no mutable state, making it safe to share across threads.
public struct MessageErrorMapper: Sendable {
  public init() {}

  /// Maps an error to a `ClientServerError` suitable for the
  /// client-to-server `error` message.
  ///
  /// - Parameters:
  ///   - error: The internal error to convert.
  ///   - surfaceID: The surface ID to attribute the error to.
  /// - Returns: A `ClientServerError` matching the v0.9.1 wire
  ///   format.
  public func map(
    _ error: Error,
    surfaceID: String
  ) -> ClientServerError {
    if let genericError = error as? GenericError {
      return .generic(genericError)
    }

    if let decodingError = error as? DecodingError {
      return mapDecodingError(decodingError, surfaceID: surfaceID)
    }

    return .generic(
      GenericError(
        code: "PARSING_FAILED",
        surfaceID: surfaceID,
        message: error.localizedDescription
      )
    )
  }

  // MARK: - DecodingError Mapping

  private func mapDecodingError(
    _ error: DecodingError,
    surfaceID: String
  ) -> ClientServerError {
    let codingPath = resolveCodingPath(from: error)
    let description = resolveDecodingErrorDescription(error)

    switch error {
    case .typeMismatch, .valueNotFound, .keyNotFound:
      return .validationFailed(
        ValidationFailedError(
          surfaceID: surfaceID,
          path: codingPath,
          message: description
        )
      )
    case .dataCorrupted:
      return .generic(
        GenericError(
          code: "PARSING_FAILED",
          surfaceID: surfaceID,
          message: description
        )
      )
    @unknown default:
      return .generic(
        GenericError(
          code: "PARSING_FAILED",
          surfaceID: surfaceID,
          message: description
        )
      )
    }
  }

  private func resolveCodingPath(
    from error: DecodingError
  ) -> String {
    let codingPath: [CodingKey]
    switch error {
    case .typeMismatch(_, let context),
      .valueNotFound(_, let context),
      .keyNotFound(_, let context),
      .dataCorrupted(let context):
      codingPath = context.codingPath
    @unknown default:
      codingPath = []
    }

    guard !codingPath.isEmpty else { return "" }
    let pointer = codingPath.map { key in
      if let intVal = key.intValue {
        return String(intVal)
      } else {
        return key.stringValue
          .replacingOccurrences(of: "~", with: "~0")
          .replacingOccurrences(of: "/", with: "~1")
      }
    }.joined(separator: "/")
    return "/" + pointer
  }

  private func resolveDecodingErrorDescription(
    _ error: DecodingError
  ) -> String {
    switch error {
    case .typeMismatch(let type, let context):
      return "Type mismatch: expected type '\(type)', got '\(context.debugDescription)'"
    case .valueNotFound(let type, let context):
      return "Missing value: expected non-nil '\(type)', got '\(context.debugDescription)'"
    case .keyNotFound(let key, let context):
      return "Missing required key '\(key.stringValue)': \(context.debugDescription)"
    case .dataCorrupted(let context):
      return "JSON syntax error: \(context.debugDescription)"
    @unknown default:
      return "Unknown decoding error"
    }
  }
}
