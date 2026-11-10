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

/// Version-neutral internal operation for creating a surface.
public struct InternalCreateSurfaceOp: Sendable, Equatable {
  public let surfaceID: String
  public let catalogID: String?
  public let theme: [String: JSONValue]?
  public let sendDataModel: Bool
  public let components: [[String: JSONValue]]?
  public let dataModel: [String: JSONValue]?
  public let metadata: [String: JSONValue]?
  public let version: A2UIProtocolVersion?

  /// Blueprint-compatible camelCase alias for `surfaceID`.
  public var surfaceId: String { surfaceID }

  /// Blueprint-compatible camelCase alias for `catalogID`.
  public var catalogId: String? { catalogID }

  public init(
    surfaceID: String,
    catalogID: String? = nil,
    theme: [String: JSONValue]? = nil,
    sendDataModel: Bool = false,
    components: [[String: JSONValue]]? = nil,
    dataModel: [String: JSONValue]? = nil,
    metadata: [String: JSONValue]? = nil,
    version: A2UIProtocolVersion? = nil
  ) {
    self.surfaceID = surfaceID
    self.catalogID = catalogID
    self.theme = theme
    self.sendDataModel = sendDataModel
    self.components = components
    self.dataModel = dataModel
    self.metadata = metadata
    self.version = version
  }
}
