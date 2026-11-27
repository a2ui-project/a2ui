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

import A2UICore
import JSONSchema
import OrderedJSON
import SwiftUI

/// A closure that constructs a SwiftUI view from a resolved engine node.
public typealias ComponentViewBuilder = @MainActor (Node) -> AnyView

/// A concrete component implementation for SwiftUI rendering.
///
/// Combines the component's canonical ``ComponentDefinition`` (or legacy JSON ``Schema``) and
/// SwiftUI view builder into a single self-contained value that can be exported by component
/// packages and registered into a ``Catalog``.
public struct ComponentImplementation: ComponentAPI, @unchecked Sendable {
  /// The component type name as it appears in A2UI JSON (e.g., "Button", "Map").
  public let name: String

  /// Allowed parent component names. If nil, any parent is allowed.
  public let allowedParents: [String]?

  /// Allowed child component names. If nil, any child is allowed.
  public let allowedChildren: [String]?

  /// Optional component metadata.
  public let metadata: [String: JSONValue]?

  /// The closure that constructs a SwiftUI view from a resolved engine node.
  public let builder: ComponentViewBuilder

  private let storedSchema: Schema?
  private let storedDefinition: ComponentDefinition?

  /// Canonical JSON-Schema-independent component definition.
  public var definition: ComponentDefinition {
    if let storedDefinition {
      return storedDefinition
    }
    return CatalogJSONSchemaCodec.componentDefinition(
      from: name,
      schema: storedSchema?.jsonValue ?? .object([:]),
      allowedParents: allowedParents,
      allowedChildren: allowedChildren,
      metadata: metadata
    )
  }

  /// Whether this component implementation is backed directly by a canonical
  /// ``ComponentDefinition``.
  public var hasCanonicalDefinition: Bool {
    guard let storedDefinition, storedSchema == nil else { return false }
    return storedDefinition.isCanonical
  }

  /// The JSON Schema validating the component's properties.
  public var schema: Schema {
    if let storedSchema {
      return storedSchema
    }
    return CatalogJSONSchemaCodec.compileComponentSchemaOrEmpty(definition)
  }

  /// Creates a new component implementation purely from a canonical ``ComponentDefinition`` and
  /// SwiftUI view builder without requiring `import JSONSchema`.
  ///
  /// - Parameters:
  ///   - definition: The canonical component definition.
  ///   - builder: The view builder closure constructing the component's SwiftUI view.
  public init<Content: View>(
    definition: ComponentDefinition,
    builder: @escaping @MainActor (Node) -> Content
  ) {
    self.name = definition.name
    self.allowedParents = definition.allowedParents
    self.allowedChildren = definition.allowedChildren
    self.metadata = definition.metadata
    self.storedDefinition = definition
    self.storedSchema = nil
    self.builder = { node in AnyView(builder(node)) }
  }

  /// Creates a new component implementation from a canonical ``ComponentDefinition`` and
  /// type-erased view builder.
  ///
  /// - Parameters:
  ///   - definition: The canonical component definition.
  ///   - builder: The type-erased view builder closure.
  public init(
    definition: ComponentDefinition,
    builder: @escaping ComponentViewBuilder
  ) {
    self.name = definition.name
    self.allowedParents = definition.allowedParents
    self.allowedChildren = definition.allowedChildren
    self.metadata = definition.metadata
    self.storedDefinition = definition
    self.storedSchema = nil
    self.builder = builder
  }

  /// Creates a new component implementation with a type name, schema, and view builder.
  ///
  /// - Parameters:
  ///   - name: The component type name.
  ///   - schema: The JSON Schema validating the component's properties.
  ///   - allowedParents: Optional list of allowed parent component names.
  ///   - allowedChildren: Optional list of allowed child component names.
  ///   - metadata: Optional component metadata dictionary.
  ///   - builder: The view builder closure constructing the component's SwiftUI view.
  public init<Content: View>(
    name: String,
    schema: Schema,
    allowedParents: [String]? = nil,
    allowedChildren: [String]? = nil,
    metadata: [String: JSONValue]? = nil,
    builder: @escaping @MainActor (Node) -> Content
  ) {
    self.name = name
    self.allowedParents = allowedParents
    self.allowedChildren = allowedChildren
    self.metadata = metadata
    self.storedSchema = schema
    self.storedDefinition = nil
    self.builder = { node in AnyView(builder(node)) }
  }

  /// Creates a new component implementation from an existing API definition and view builder.
  ///
  /// - Parameters:
  ///   - api: The component API definition conforming to ``ComponentAPI``.
  ///   - builder: The view builder closure constructing the component's SwiftUI view.
  public init<Content: View>(
    api: any ComponentAPI,
    builder: @escaping @MainActor (Node) -> Content
  ) {
    if api.hasCanonicalDefinition {
      self.init(definition: api.definition, builder: builder)
    } else {
      self.init(
        name: api.name,
        schema: api.schema,
        allowedParents: api.allowedParents,
        allowedChildren: api.allowedChildren,
        metadata: api.metadata,
        builder: builder
      )
    }
  }

  /// Creates a new component implementation from an existing API definition and erased view
  /// builder.
  ///
  /// - Parameters:
  ///   - api: The component API definition conforming to ``ComponentAPI``.
  ///   - builder: The type-erased view builder closure.
  public init(
    api: any ComponentAPI,
    builder: @escaping ComponentViewBuilder
  ) {
    if api.hasCanonicalDefinition {
      self.init(definition: api.definition, builder: builder)
    } else {
      self.name = api.name
      self.allowedParents = api.allowedParents
      self.allowedChildren = api.allowedChildren
      self.metadata = api.metadata
      self.storedSchema = api.schema
      self.storedDefinition = nil
      self.builder = builder
    }
  }
}
