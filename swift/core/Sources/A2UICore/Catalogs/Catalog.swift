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

import JSONSchema

/// A protocol representing a catalog containing component schemas, functions, and an optional theme schema.
///
/// `CatalogProtocol` exists primarily to support Swift existentials (e.g., `any CatalogProtocol`) in heterogeneous
/// collections. Because ``Catalog`` is generic over its component type (`Catalog<Component>`), Swift does not
/// allow heterogeneous arrays like `[Catalog<Component>]` when elements have different generic types
/// (such as mixing ``Catalog<ComponentImplementation>`` with type-erased ``Catalog<AnyComponentAPI>``).
///
/// By conforming ``Catalog`` to `CatalogProtocol`, framework APIs like `MessageProcessor` and `SurfaceViewModel`
/// can accept `[any CatalogProtocol]` and erase them to ``AnyCatalog`` without requiring generic type parameters
/// or forcing callers into complex type-erasure acrobatics.
public protocol CatalogProtocol: Sendable {
  /// Unique catalog identifier (conventionally a URI string).
  var id: String { get }

  /// Optional theme schema for this catalog.
  var themeSchema: Schema? { get }

  /// Map of function name → ``FunctionImplementation``.
  var functions: [String: any FunctionImplementation] { get }

  /// Erases this catalog's components to their name and schema.
  func eraseToAnyCatalog() -> AnyCatalog
}

/// A collection of component definitions, function implementations,
/// and an optional theme schema.
///
/// Mirrors `Catalog<T>` in the core blueprint and `web_core`.
public struct Catalog<Component: ComponentAPI>: CatalogProtocol, Sendable {
  /// Unique catalog identifier (conventionally a URI string).
  public var id: String

  /// Map of component name → component implementation conforming to ``ComponentAPI``.
  public var components: [String: Component]

  /// Map of function name → ``FunctionImplementation``.
  public var functions: [String: any FunctionImplementation]

  /// Optional theme schema for this catalog.
  public var themeSchema: Schema?

  /// Creates a catalog from arrays of components and functions.
  ///
  /// - Parameters:
  ///   - id: Unique catalog identifier.
  ///   - components: Array of component definitions conforming to ``ComponentAPI``.
  ///   - functions: Array of function implementations (defaults to empty).
  ///   - themeSchema: Optional theme schema (defaults to nil).
  public init(
    id: String,
    components: [Component],
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

  /// Erases this catalog's components to their name and schema.
  public func eraseToAnyCatalog() -> Catalog<AnyComponentAPI> {
    Catalog<AnyComponentAPI>(
      id: id,
      components: components.values.map { AnyComponentAPI(name: $0.name, schema: $0.schema) },
      functions: Array(functions.values),
      themeSchema: themeSchema
    )
  }
}

/// A catalog whose components are erased to their name and schema.
///
/// Its functions keep their implementations, so this is not the schema-only `CatalogApi` of the
/// core blueprint. Swift's ``Catalog`` is not generic over its function type, and nothing here
/// builds a catalog without implementations, so the Swift SDK has no `CatalogApi`.
public typealias AnyCatalog = Catalog<AnyComponentAPI>
