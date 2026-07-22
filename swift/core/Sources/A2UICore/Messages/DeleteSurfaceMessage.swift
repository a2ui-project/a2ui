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

/// A message commanding the client to dismantle and delete an active
/// surface.
public struct DeleteSurfaceMessage: Codable, Sendable, Equatable {
  public let surfaceID: String

  private enum CodingKeys: String, CodingKey {
    case surfaceID = "surfaceId"
  }

  public init(surfaceID: String) {
    self.surfaceID = surfaceID
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    surfaceID = try container.decode(String.self, forKey: .surfaceID)
  }
}
