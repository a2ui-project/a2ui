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
import OrderedJSON

/// The framework-agnostic definition contract of a UI component.
///
/// Pairs a component name (as it appears in A2UI JSON) with its canonical ``ComponentDefinition``
/// and backward-compatible JSON ``Schema``. Conforming types may implement either ``definition``
/// (preferred; requires no `JSONSchema` import) or ``schema`` (legacy); default implementations
/// synthesize the other via ``CatalogJSONSchemaCodec``.
public protocol ComponentAPI: Sendable {
  /// The component name as it appears in A2UI JSON (e.g., "Button").
  var name: String { get }

  /// Canonical JSON-Schema-independent component definition.
  var definition: ComponentDefinition { get }

  /// Whether this component is backed directly by a canonical ``ComponentDefinition`` with no
  /// untranslatable raw JSON Schema escape hatch.
  var hasCanonicalDefinition: Bool { get }

  /// The compiled JSON Schema used for legacy validation and capability generation.
  var schema: Schema { get }

  /// Allowed parent component names. If nil, any parent is allowed.
  var allowedParents: [String]? { get }

  /// Allowed child component names. If nil, any child is allowed.
  var allowedChildren: [String]? { get }

  /// Optional component metadata.
  var metadata: [String: JSONValue]? { get }
}

extension ComponentAPI {
  public var allowedParents: [String]? { nil }
  public var allowedChildren: [String]? { nil }
  public var metadata: [String: JSONValue]? { nil }
  public var hasCanonicalDefinition: Bool { false }

  public var definition: ComponentDefinition {
    CatalogJSONSchemaCodec.componentDefinition(
      from: name,
      schema: schema.jsonValue,
      allowedParents: allowedParents,
      allowedChildren: allowedChildren,
      metadata: metadata
    )
  }

  public var schema: Schema {
    CatalogJSONSchemaCodec.compileComponentSchemaOrEmpty(definition)
  }
}

/// A standard value type conforming to ``ComponentAPI`` for schema- or definition-only components.
public struct AnyComponentAPI: ComponentAPI, Sendable, Equatable {
  /// The component name as it appears in A2UI JSON (e.g., "Button").
  public var name: String

  /// Allowed parent component names. If nil, any parent is allowed.
  public var allowedParents: [String]?

  /// Allowed child component names. If nil, any child is allowed.
  public var allowedChildren: [String]?

  /// Optional component metadata.
  public var metadata: [String: JSONValue]?

  private var storedSchema: Schema?
  private var storedDefinition: ComponentDefinition?

  /// Canonical JSON-Schema-independent component definition.
  public var definition: ComponentDefinition {
    get {
      var def =
        storedDefinition
        ?? CatalogJSONSchemaCodec.componentDefinition(
          from: name,
          schema: storedSchema?.jsonValue ?? .object([:]),
          allowedParents: allowedParents,
          allowedChildren: allowedChildren,
          metadata: metadata
        )
      def.name = name
      def.allowedParents = allowedParents
      def.allowedChildren = allowedChildren
      def.metadata = metadata
      return def
    }
    set {
      storedDefinition = newValue
      storedSchema = nil
      name = newValue.name
      allowedParents = newValue.allowedParents
      allowedChildren = newValue.allowedChildren
      metadata = newValue.metadata
    }
  }

  /// Whether this component is backed directly by a canonical ``ComponentDefinition``.
  public var hasCanonicalDefinition: Bool {
    guard let storedDefinition, storedSchema == nil else { return false }
    return storedDefinition.isCanonical
  }

  /// The compiled JSON Schema used for legacy validation and capability generation.
  public var schema: Schema {
    get {
      if let storedSchema {
        return storedSchema
      }
      return CatalogJSONSchemaCodec.compileComponentSchemaOrEmpty(definition)
    }
    set {
      storedSchema = newValue
      storedDefinition = nil
    }
  }

  /// Creates a component API purely from a canonical ``ComponentDefinition`` without requiring
  /// `JSONSchema`.
  public init(definition: ComponentDefinition) {
    self.name = definition.name
    self.allowedParents = definition.allowedParents
    self.allowedChildren = definition.allowedChildren
    self.metadata = definition.metadata
    self.storedDefinition = definition
    self.storedSchema = nil
  }

  /// Creates a component API from a compiled `JSONSchema.Schema`.
  public init(
    name: String,
    schema: Schema,
    allowedParents: [String]? = nil,
    allowedChildren: [String]? = nil,
    metadata: [String: JSONValue]? = nil
  ) {
    self.name = name
    self.allowedParents = allowedParents
    self.allowedChildren = allowedChildren
    self.metadata = metadata
    self.storedSchema = schema
    self.storedDefinition = nil
  }

  public static func == (lhs: AnyComponentAPI, rhs: AnyComponentAPI) -> Bool {
    guard lhs.name == rhs.name,
      lhs.allowedParents == rhs.allowedParents,
      lhs.allowedChildren == rhs.allowedChildren,
      lhs.metadata == rhs.metadata
    else {
      return false
    }
    if let lhsDef = lhs.storedDefinition, let rhsDef = rhs.storedDefinition,
      lhs.storedSchema == nil, rhs.storedSchema == nil
    {
      return lhsDef == rhsDef
    }
    if let lhsSchema = lhs.storedSchema, let rhsSchema = rhs.storedSchema,
      lhs.storedDefinition == nil, rhs.storedDefinition == nil
    {
      return lhsSchema == rhsSchema
    }
    return lhs.definition == rhs.definition
  }
}
