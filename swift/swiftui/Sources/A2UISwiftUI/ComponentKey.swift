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

/// A lookup key for resolving component view builders by optional catalog ID and component type.
public struct ComponentKey: Hashable, Equatable, Sendable {
  public let catalogID: String?
  public let type: String

  public init(
    catalogID: String? = nil,
    type: String
  ) {
    self.catalogID = catalogID
    self.type = type
  }
}
