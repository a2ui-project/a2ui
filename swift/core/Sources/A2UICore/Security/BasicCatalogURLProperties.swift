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

/// URL properties of the basic catalogs, whose published documents carry no
/// `x-a2ui-url-context` annotations.
enum BasicCatalogURLProperties {
  /// Identifiers of the basic catalogs. The v0.9 and v0.9.1 catalogs also share the theme's
  /// `iconUrl`.
  static let catalogIDs: Set<String> = [
    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json",
    "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
  ]

  /// URL properties of the basic catalog components, by component type.
  static let components: [String: [String: URLContextAnnotation]] = [
    "Image": ["url": .media],
    "Video": ["url": .media, "posterUrl": .media],
    "AudioPlayer": ["url": .media],
  ]

  /// Returns the annotation of a basic catalog component property, or `nil` when `catalogID` is
  /// not a basic catalog or the property is not a URL.
  static func annotation(
    catalogID: String?,
    componentType: String,
    property: String
  ) -> URLContextAnnotation? {
    guard let catalogID, catalogIDs.contains(catalogID) else { return nil }
    return components[componentType]?[property]
  }
}
