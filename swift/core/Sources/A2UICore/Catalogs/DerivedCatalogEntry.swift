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

/// A component or function of a catalog made with ``Catalog/derive(id:components:functions:)``.
///
/// A string literal names an entry of the source catalog to keep, so a list of entries reads
/// `["Text", "Image", .add(MyCarousel())]`.
public enum DerivedCatalogEntry<Entry>: ExpressibleByStringLiteral {
  /// Keeps the source catalog's entry of this name.
  case keep(String)

  /// Adds this entry, in place of the source's entry of the same name if it has one.
  case add(Entry)

  public init(stringLiteral name: String) {
    self = .keep(name)
  }
}

extension DerivedCatalogEntry: Sendable where Entry: Sendable {}
