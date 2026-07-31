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

import JSONSchema

/// A collection of component definitions, function implementations,
/// and an optional theme schema.
///
/// Mirrors `Catalog<T>` in the core blueprint and `web_core`. Unlike
/// the TypeScript implementation, this is a non-generic concrete struct
/// because Swift's `ComponentAPI` is already a concrete type.
public struct Catalog: Sendable {
  /// Unique catalog identifier (conventionally a URI string).
  public var id: String

  /// Map of component name → ``ComponentAPI``.
  public var components: [String: ComponentAPI]

  /// Map of function name → ``FunctionImplementation``.
  public var functions: [String: any FunctionImplementation]

  /// Optional theme schema for this catalog.
  public var themeSchema: Schema?

  /// Creates a catalog from arrays of components and functions.
  ///
  /// - Parameters:
  ///   - id: Unique catalog identifier.
  ///   - components: Array of component API definitions.
  ///   - functions: Array of function implementations (defaults to empty).
  ///   - themeSchema: Optional theme schema (defaults to nil).
  public init(
    id: String,
    components: [ComponentAPI],
    functions: [any FunctionImplementation] = [],
    themeSchema: Schema? = nil
  ) {
    self.id = id
    self.components = Dictionary(
      components.map { ($0.name, $0) },
      uniquingKeysWith: { _, last in last }
    )
    self.functions = Dictionary(
      functions.map { ($0.api.name, $0) },
      uniquingKeysWith: { _, last in last }
    )
    self.themeSchema = themeSchema
  }
}
