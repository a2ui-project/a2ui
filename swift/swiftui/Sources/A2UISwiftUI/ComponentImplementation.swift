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
/// Combines the component type name, JSON Schema, and SwiftUI view builder into a single
/// self-contained object that can be exported by component packages and registered into a
/// ``Catalog``.
public struct ComponentImplementation: ComponentAPI, @unchecked Sendable {
  /// The component type name as it appears in A2UI JSON (e.g., "Button", "Map").
  public let name: String

  /// The JSON Schema validating the component's properties.
  public let schema: Schema

  /// Allowed parent component names. If nil, any parent is allowed.
  public let allowedParents: [String]?

  /// Allowed child component names. If nil, any child is allowed.
  public let allowedChildren: [String]?

  /// Optional component metadata.
  public let metadata: [String: JSONValue]?

  /// The closure that constructs a SwiftUI view from a resolved engine node.
  public let builder: ComponentViewBuilder

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
    self.schema = schema
    self.allowedParents = allowedParents
    self.allowedChildren = allowedChildren
    self.metadata = metadata
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
    self.init(
      name: api.name,
      schema: api.schema,
      allowedParents: api.allowedParents,
      allowedChildren: api.allowedChildren,
      metadata: api.metadata,
      builder: builder
    )
  }

  /// Creates a new component implementation from an existing API definition and erased view builder.
  ///
  /// - Parameters:
  ///   - api: The component API definition conforming to ``ComponentAPI``.
  ///   - builder: The type-erased view builder closure.
  public init(
    api: any ComponentAPI,
    builder: @escaping ComponentViewBuilder
  ) {
    self.name = api.name
    self.schema = api.schema
    self.allowedParents = api.allowedParents
    self.allowedChildren = api.allowedChildren
    self.metadata = api.metadata
    self.builder = builder
  }
}
