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

/// Represents a generic processing or runtime client error.
public struct GenericError: Error, Equatable, Codable, Sendable {
  public let code: String
  public let surfaceID: String
  public let message: String
  /// The expression that failed, e.g. the function name of an `EXPRESSION_ERROR`.
  public let expression: String?

  private enum CodingKeys: String, CodingKey {
    case code
    case surfaceID = "surfaceId"
    case message
    case expression
  }

  public init(code: String, surfaceID: String, message: String, expression: String? = nil) {
    self.code = code
    self.surfaceID = surfaceID
    self.message = message
    self.expression = expression
  }
}
