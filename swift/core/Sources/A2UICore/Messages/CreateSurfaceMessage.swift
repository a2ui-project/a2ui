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

import OrderedJSON

/// A message commanding the client to initialize a new active surface.
public struct CreateSurfaceMessage: Codable, Sendable, Equatable {
  public let surfaceID: String
  public let catalogID: String
  public let theme: [String: JSONValue]?
  public let shouldSendDataModel: Bool

  private enum CodingKeys: String, CodingKey {
    case surfaceID = "surfaceId"
    case catalogID = "catalogId"
    case theme
    case shouldSendDataModel = "sendDataModel"
  }

  public init(
    surfaceID: String,
    catalogID: String,
    theme: [String: JSONValue]? = nil,
    shouldSendDataModel: Bool? = nil
  ) {
    self.surfaceID = surfaceID
    self.catalogID = catalogID
    self.theme = theme
    self.shouldSendDataModel = shouldSendDataModel ?? false
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    surfaceID = try container.decode(String.self, forKey: .surfaceID)
    catalogID = try container.decode(String.self, forKey: .catalogID)
    theme = try container.decodeIfPresent([String: JSONValue].self, forKey: .theme)
    shouldSendDataModel =
      try container.decodeIfPresent(
        Bool.self,
        forKey: .shouldSendDataModel
      ) ?? false
  }
}
