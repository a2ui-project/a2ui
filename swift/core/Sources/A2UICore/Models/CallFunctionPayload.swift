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
public struct CallFunctionPayload: Codable, Sendable, Equatable {
  public let call: String
  public let catalogID: String?
  public let args: [String: JSONValue]?
  public let returnType: String?

  private enum CodingKeys: String, CodingKey {
    case call
    case catalogID = "catalogId"
    case args
    case returnType
  }

  public init(
    call: String,
    catalogID: String? = nil,
    args: [String: JSONValue]? = nil,
    returnType: String? = nil
  ) {
    self.call = call
    self.catalogID = catalogID
    self.args = args
    self.returnType = returnType
  }
}
