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

/// Details about where a URL comes from, for logging and per-component rules.
///
/// Each caller fills in what it knows: a surface adds its identifier, and the resolver adds the
/// catalog, component type, component identifier, and property name.
public struct URLCheckInfo: Hashable, Sendable {
  /// Identifier of the surface the URL appears on.
  public var surfaceID: String?
  /// Identifier of the catalog of the component or function using the URL.
  public var catalogID: String?
  /// Type of the component using the URL, such as `"Image"`.
  public var componentType: String?
  /// Identifier of the component instance using the URL.
  public var componentID: String?
  /// Name of the property holding the URL. Nested properties are written as a path, with `[]`
  /// for list items, such as `"items[].imageUrl"`.
  public var propertyName: String?
  /// Name of the function using the URL, such as `"openUrl"`.
  public var functionName: String?

  /// Creates check details. Every field is optional.
  public init(
    surfaceID: String? = nil,
    catalogID: String? = nil,
    componentType: String? = nil,
    componentID: String? = nil,
    propertyName: String? = nil,
    functionName: String? = nil
  ) {
    self.surfaceID = surfaceID
    self.catalogID = catalogID
    self.componentType = componentType
    self.componentID = componentID
    self.propertyName = propertyName
    self.functionName = functionName
  }
}
