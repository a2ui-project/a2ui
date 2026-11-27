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

/// Canonical definition of surface-level data properties (maps to v0.9 `theme`).
public struct SurfacePropertiesDefinition: Sendable, Equatable {
  /// Optional human-readable description of surface properties.
  public var description: String?

  /// Ordered list of declared surface property definitions (data types only).
  public var properties: [ParameterDefinition]

  /// Whether undeclared extra surface properties are accepted (defaults to `.disallowed`).
  public var additionalProperties: AdditionalProperties

  /// Optional legacy escape hatch holding an untranslatable theme JSON Schema.
  internal var rawJSONSchema: JSONValue?

  public init(
    description: String? = nil,
    properties: [ParameterDefinition] = [],
    additionalProperties: AdditionalProperties = .disallowed
  ) {
    self.description = description
    self.properties = properties
    self.additionalProperties = additionalProperties
    self.rawJSONSchema = nil
  }

  internal init(
    description: String? = nil,
    properties: [ParameterDefinition] = [],
    additionalProperties: AdditionalProperties = .disallowed,
    rawJSONSchema: JSONValue?
  ) {
    self.description = description
    self.properties = properties
    self.additionalProperties = additionalProperties
    self.rawJSONSchema = rawJSONSchema
  }

  /// Looks up a declared surface property by name.
  public func property(named name: String) -> ParameterDefinition? {
    properties.first { $0.name == name }
  }

  /// Whether this surface properties definition is fully represented by canonical types.
  public var isCanonical: Bool {
    rawJSONSchema == nil
      && additionalProperties.isCanonical
      && !properties.contains { $0.type.containsRawJSONSchema }
  }
}
