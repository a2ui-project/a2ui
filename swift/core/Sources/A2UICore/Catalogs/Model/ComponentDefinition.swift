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

import OrderedJSON

/// Canonical in-memory definition of a UI component in an A2UI catalog.
///
/// Captures the component's name, ordered parameter definitions, validation checkability,
/// parent/child composition constraints, and static metadata without requiring JSON Schema.
public struct ComponentDefinition: Sendable, Equatable {
  /// Component identifier as it appears in A2UI payloads (must not be `"Surface"`).
  public var name: String

  /// Human- and LLM-readable description of component usage and behavior.
  public var description: String?

  /// Whether this component accepts renderer-side validation checks (`@checks` / `checks`).
  public var isCheckable: Bool

  /// Ordered list of component-specific parameters (excluding protocol envelope keys).
  public var parameters: [ParameterDefinition]

  /// Cross-parameter groups where at least one parameter in each group must be present.
  public var atLeastOneOf: [[String]]

  /// Parent component names permitted to contain this component, or `nil` for any parent.
  public var allowedParents: [String]?

  /// Child component names permitted inside this component, or `nil` for any child.
  public var allowedChildren: [String]?

  /// Optional static component-level metadata and extensions.
  public var metadata: [String: JSONValue]?

  /// Whether this component is deprecated.
  public var deprecated: Bool

  /// Optional deprecation explanation and migration hint.
  public var deprecatedReason: String?

  /// Optional legacy escape hatch holding an untranslatable root JSON Schema fragment.
  internal var rawJSONSchema: JSONValue?

  /// Whether undeclared properties are permitted on legacy JSON Schema components.
  internal var allowsAdditionalProperties: Bool

  /// Whether a legacy pre-v1.0 component schema accepts the envelope `id` key (true for all
  /// canonical definitions and any schema that declares `id`, references `ComponentCommon`, or
  /// permits additional properties).
  internal var v09DeclaresID: Bool

  public init(
    name: String,
    description: String? = nil,
    isCheckable: Bool = false,
    parameters: [ParameterDefinition] = [],
    atLeastOneOf: [[String]] = [],
    allowedParents: [String]? = nil,
    allowedChildren: [String]? = nil,
    metadata: [String: JSONValue]? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) {
    self.name = name
    self.description = description
    self.isCheckable = isCheckable
    self.parameters = parameters
    self.atLeastOneOf = atLeastOneOf
    self.allowedParents = allowedParents
    self.allowedChildren = allowedChildren
    self.metadata = metadata
    self.deprecated = deprecated
    self.deprecatedReason = deprecatedReason
    self.rawJSONSchema = nil
    self.allowsAdditionalProperties = false
    self.v09DeclaresID = true
  }

  internal init(
    name: String,
    description: String? = nil,
    isCheckable: Bool = false,
    parameters: [ParameterDefinition] = [],
    atLeastOneOf: [[String]] = [],
    allowedParents: [String]? = nil,
    allowedChildren: [String]? = nil,
    metadata: [String: JSONValue]? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil,
    rawJSONSchema: JSONValue?,
    allowsAdditionalProperties: Bool,
    v09DeclaresID: Bool = true
  ) {
    self.name = name
    self.description = description
    self.isCheckable = isCheckable
    self.parameters = parameters
    self.atLeastOneOf = atLeastOneOf
    self.allowedParents = allowedParents
    self.allowedChildren = allowedChildren
    self.metadata = metadata
    self.deprecated = deprecated
    self.deprecatedReason = deprecatedReason
    self.rawJSONSchema = rawJSONSchema
    self.allowsAdditionalProperties = allowsAdditionalProperties
    self.v09DeclaresID = v09DeclaresID
  }

  /// Looks up a declared parameter by name.
  public func parameter(named name: String) -> ParameterDefinition? {
    parameters.first { $0.name == name }
  }

  /// Whether this component definition is fully represented by canonical types with no legacy raw
  /// JSON Schema escape hatch.
  public var isCanonical: Bool {
    rawJSONSchema == nil && !parameters.contains { $0.type.containsRawJSONSchema }
  }

  public static func == (lhs: ComponentDefinition, rhs: ComponentDefinition) -> Bool {
    lhs.name == rhs.name
      && lhs.description == rhs.description
      && lhs.isCheckable == rhs.isCheckable
      && lhs.parameters == rhs.parameters
      && lhs.atLeastOneOf == rhs.atLeastOneOf
      && lhs.allowedParents == rhs.allowedParents
      && lhs.allowedChildren == rhs.allowedChildren
      && lhs.metadata == rhs.metadata
      && lhs.deprecated == rhs.deprecated
      && lhs.deprecatedReason == rhs.deprecatedReason
      && lhs.rawJSONSchema == rhs.rawJSONSchema
  }
}
