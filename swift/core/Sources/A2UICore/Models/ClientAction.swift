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

/// Reports a user-initiated action from a component.
///
/// Matches the `action` property in
/// `specification/v0_9_1/json/client_to_server.json`.
public struct ClientAction: Equatable, Codable, Sendable {
  /// The name of the action, taken from the component's
  /// `action.event.name` property.
  public let name: String

  /// The id of the surface where the event originated.
  public let surfaceID: String

  /// The id of the component that triggered the event.
  public let sourceComponentID: String

  /// An ISO 8601 timestamp of when the event occurred.
  public let timestamp: String

  /// A JSON object containing the key-value pairs from the component's
  /// `action.event.context`, after resolving all data bindings.
  public let context: [String: JSONValue]

  private enum CodingKeys: String, CodingKey {
    case name
    case surfaceID = "surfaceId"
    case sourceComponentID = "sourceComponentId"
    case timestamp
    case context
  }

  /// Creates a new client action.
  public init(
    name: String,
    surfaceID: String,
    sourceComponentID: String,
    timestamp: String,
    context: [String: JSONValue]
  ) {
    self.name = name
    self.surfaceID = surfaceID
    self.sourceComponentID = sourceComponentID
    self.timestamp = timestamp
    self.context = context
  }
}
