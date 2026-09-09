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

/// A protocol representing a catalog containing component schemas, functions, and an
/// optional theme schema.
///
/// `CatalogProtocol` exists primarily to support Swift existentials (e.g., `any CatalogProtocol`)
/// in heterogeneous collections. Because ``Catalog`` is generic over its component type
/// (`Catalog<Component>`), Swift does not allow heterogeneous arrays like `[Catalog<Component>]`
/// when elements have different generic types (such as mixing
/// ``Catalog<ComponentImplementation>`` with schema-only ``Catalog<AnyComponentAPI>``).
///
/// By conforming ``Catalog`` to `CatalogProtocol`, framework APIs like `MessageProcessor` and
/// `SurfaceViewModel` can accept `[any CatalogProtocol]` and erase them to ``AnyCatalog`` without
/// requiring generic type parameters or forcing callers into complex type-erasure acrobatics.
public protocol CatalogProtocol: Sendable {
  /// Unique catalog identifier (conventionally a URI string).
  var id: String { get }

  /// Optional protocol version this catalog conforms to (e.g. "v1.0" or "v0.9.1").
  var protocolVersion: String? { get }

  /// Optional theme schema for this catalog.
  var themeSchema: Schema? { get }

  /// Map of function name → ``FunctionImplementation``.
  var functions: [String: any FunctionImplementation] { get }

  /// Converts this catalog to a schema-only representation.
  func eraseToAnyCatalog() -> AnyCatalog
}

/// A collection of component definitions, function implementations,
/// and an optional theme schema.
///
/// Mirrors `Catalog<T>` in the core blueprint and `web_core`.
public struct Catalog<Component: ComponentAPI>: CatalogProtocol, Sendable {
  /// Unique catalog identifier (conventionally a URI string).
  public var id: String

  /// Optional protocol version this catalog conforms to.
  public var protocolVersion: String?

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
  ///   - protocolVersion: Optional protocol version this catalog conforms to.
  ///   - components: Array of component definitions conforming to ``ComponentAPI``.
  ///   - functions: Array of function implementations (defaults to empty).
  ///   - themeSchema: Optional theme schema (defaults to nil).
  public init(
    id: String,
    protocolVersion: String? = nil,
    components: [Component],
    functions: [any FunctionImplementation] = [],
    themeSchema: Schema? = nil
  ) {
    self.id = id
    self.protocolVersion = protocolVersion
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

  /// Converts this catalog to a schema-only representation.
  public func eraseToAnyCatalog() -> Catalog<AnyComponentAPI> {
    Catalog<AnyComponentAPI>(
      id: id,
      protocolVersion: protocolVersion,
      components: components.values.map {
        AnyComponentAPI(
          name: $0.name,
          schema: $0.schema,
          allowedParents: $0.allowedParents,
          allowedChildren: $0.allowedChildren,
          metadata: $0.metadata
        )
      },
      functions: Array(functions.values),
      themeSchema: themeSchema
    )
  }

  /// Creates a catalog with an `A2UIProtocolVersion` enum.
  public init(
    id: String,
    protocolVersion: A2UIProtocolVersion,
    components: [Component],
    functions: [any FunctionImplementation] = [],
    themeSchema: Schema? = nil
  ) {
    self.init(
      id: id,
      protocolVersion: protocolVersion.rawValue,
      components: components,
      functions: functions,
      themeSchema: themeSchema
    )
  }
}

extension CatalogProtocol {
  /// The protocol version of this catalog as an `A2UIProtocolVersion` enum, if recognized.
  public var a2uiProtocolVersion: A2UIProtocolVersion? {
    protocolVersion.flatMap(A2UIProtocolVersion.init(rawValue:))
  }

  /// Whether this catalog conforms to A2UI Protocol v1.0 or later.
  public var isAtLeastV10: Bool {
    if let a2uiProtocolVersion {
      return a2uiProtocolVersion >= .v10
    }
    guard let protocolVersion else { return false }
    let cleanVersion =
      protocolVersion.hasPrefix("v") ? String(protocolVersion.dropFirst()) : protocolVersion
    return cleanVersion.compare("1.0", options: .numeric) != .orderedAscending
  }

  /// Whether this catalog conforms to A2UI Protocol v1.0 or later.
  public var isV10: Bool {
    isAtLeastV10
  }
}

/// Convenience typealias for a schema-only catalog.
public typealias AnyCatalog = Catalog<AnyComponentAPI>
