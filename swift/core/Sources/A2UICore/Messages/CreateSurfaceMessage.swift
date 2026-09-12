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

import OrderedJSON

/// A message commanding the renderer to initialize a new active surface.
public struct CreateSurfaceMessage: Codable, Sendable, Equatable {
  public let surfaceID: String
  public let catalogID: String?
  public let theme: [String: JSONValue]?
  public let shouldSendDataModel: Bool
  public let components: [[String: JSONValue]]?
  public let dataModel: [String: JSONValue]?
  public let metadata: [String: JSONValue]?

  private enum CodingKeys: String, CodingKey {
    case surfaceID = "surfaceId"
    case catalogID = "catalogId"
    case theme
    case shouldSendDataModel = "sendDataModel"
    case components
    case dataModel
    case metadata
  }

  public init(
    surfaceID: String,
    catalogID: String? = nil,
    theme: [String: JSONValue]? = nil,
    shouldSendDataModel: Bool? = nil,
    components: [[String: JSONValue]]? = nil,
    dataModel: [String: JSONValue]? = nil,
    metadata: [String: JSONValue]? = nil
  ) {
    self.surfaceID = surfaceID
    self.catalogID = catalogID
    self.theme = theme
    self.shouldSendDataModel = shouldSendDataModel ?? false
    self.components = components
    self.dataModel = dataModel
    self.metadata = metadata
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    surfaceID = try container.decode(String.self, forKey: .surfaceID)
    catalogID = try container.decodeIfPresent(String.self, forKey: .catalogID)
    theme = try container.decodeIfPresent([String: JSONValue].self, forKey: .theme)
    shouldSendDataModel =
      try container.decodeIfPresent(
        Bool.self,
        forKey: .shouldSendDataModel
      ) ?? false
    components = try container.decodeIfPresent([[String: JSONValue]].self, forKey: .components)
    dataModel = try container.decodeIfPresent([String: JSONValue].self, forKey: .dataModel)
    metadata = try container.decodeIfPresent([String: JSONValue].self, forKey: .metadata)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(surfaceID, forKey: .surfaceID)
    try container.encodeIfPresent(catalogID, forKey: .catalogID)
    try container.encodeIfPresent(theme, forKey: .theme)
    if shouldSendDataModel {
      try container.encode(shouldSendDataModel, forKey: .shouldSendDataModel)
    }
    try container.encodeIfPresent(components, forKey: .components)
    try container.encodeIfPresent(dataModel, forKey: .dataModel)
    try container.encodeIfPresent(metadata, forKey: .metadata)
  }
}
