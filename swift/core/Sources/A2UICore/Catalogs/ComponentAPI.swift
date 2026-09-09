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
/// Pairs a component name (as it appears in A2UI JSON) with the
/// JSON Schema that validates the component's properties.
/// Mirrors `ComponentApi` in the core blueprint.
public protocol ComponentAPI: Sendable {
  /// The component name as it appears in A2UI JSON (e.g., "Button").
  var name: String { get }

  /// The compiled JSON Schema used for validation and capability
  /// generation.
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
}

/// A standard value type conforming to ``ComponentAPI`` for schema-only components.
public struct AnyComponentAPI: ComponentAPI, Sendable, Equatable {
  /// The component name as it appears in A2UI JSON (e.g., "Button").
  public var name: String

  /// The compiled JSON Schema used for validation and capability
  /// generation.
  public var schema: Schema

  /// Allowed parent component names. If nil, any parent is allowed.
  public var allowedParents: [String]?

  /// Allowed child component names. If nil, any child is allowed.
  public var allowedChildren: [String]?

  /// Optional component metadata.
  public var metadata: [String: JSONValue]?

  public init(
    name: String,
    schema: Schema,
    allowedParents: [String]? = nil,
    allowedChildren: [String]? = nil,
    metadata: [String: JSONValue]? = nil
  ) {
    self.name = name
    self.schema = schema
    self.allowedParents = allowedParents
    self.allowedChildren = allowedChildren
    self.metadata = metadata
  }
}
