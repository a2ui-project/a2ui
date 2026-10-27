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

/// Describes a function call invocation envelope.
///
/// Encodes as a v1.0 `FunctionCall`: the function name goes under `@call`. Decoding also accepts
/// the legacy `call` key. v1.0 `FunctionCall` has no `returnType`; it lives only on the catalog's
/// `FunctionAPI`.
public struct CallFunctionPayload: Codable, Sendable, Equatable {
  public let call: String
  public let catalogID: String?
  public let args: [String: JSONValue]?

  private enum CodingKeys: String, CodingKey {
    case atCall = "@call"
    case call
    case catalogID = "catalogId"
    case args
  }

  public init(
    call: String,
    catalogID: String? = nil,
    args: [String: JSONValue]? = nil
  ) {
    self.call = call
    self.catalogID = catalogID
    self.args = args
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let atCall = try container.decodeIfPresent(String.self, forKey: .atCall) {
      call = atCall
    } else {
      call = try container.decode(String.self, forKey: .call)
    }
    catalogID = try container.decodeIfPresent(String.self, forKey: .catalogID)
    args = try container.decodeIfPresent([String: JSONValue].self, forKey: .args)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(call, forKey: .atCall)
    try container.encodeIfPresent(catalogID, forKey: .catalogID)
    try container.encodeIfPresent(args, forKey: .args)
  }
}
