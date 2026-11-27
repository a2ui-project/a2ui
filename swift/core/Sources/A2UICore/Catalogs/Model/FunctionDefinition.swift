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

/// Canonical in-memory definition of a catalog function signature, return type, and caller
/// authorization policy.
public struct FunctionDefinition: Sendable, Equatable {
  /// Function identifier as it appears in `FunctionCall` payloads (cannot start with `"@"` in
  /// user-declared catalogs).
  public var name: String

  /// Human- and LLM-readable description of function behavior.
  public var description: String?

  /// Declared return type of the function.
  public var returnType: FunctionReturnDefinition

  /// Roles authorized to invoke this function.
  public var allowedCallers: AllowedCallers

  /// Whether executing this function requires an active user gesture.
  public var requiresUserActivation: Bool

  /// Ordered list of data-only function argument definitions.
  public var parameters: [ParameterDefinition]

  /// Cross-parameter groups where at least one argument in each group must be supplied.
  public var atLeastOneOf: [[String]]

  /// Whether undeclared extra arguments are accepted (defaults to `.disallowed`).
  public var additionalParameters: AdditionalProperties

  /// Whether this function is deprecated.
  public var deprecated: Bool

  /// Optional deprecation explanation and migration hint.
  public var deprecatedReason: String?

  /// Optional legacy escape hatch holding an untranslatable function argument JSON Schema.
  internal var rawJSONSchema: JSONValue?

  public init(
    name: String,
    description: String? = nil,
    returnType: FunctionReturnDefinition,
    allowedCallers: AllowedCallers = .rendererOnly,
    requiresUserActivation: Bool = false,
    parameters: [ParameterDefinition] = [],
    atLeastOneOf: [[String]] = [],
    additionalParameters: AdditionalProperties = .disallowed,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) {
    self.name = name
    self.description = description
    self.returnType = returnType
    self.allowedCallers = allowedCallers
    self.requiresUserActivation = requiresUserActivation
    self.parameters = parameters
    self.atLeastOneOf = atLeastOneOf
    self.additionalParameters = additionalParameters
    self.deprecated = deprecated
    self.deprecatedReason = deprecatedReason
    self.rawJSONSchema = nil
  }

  internal init(
    name: String,
    description: String? = nil,
    returnType: FunctionReturnDefinition,
    allowedCallers: AllowedCallers = .rendererOnly,
    requiresUserActivation: Bool = false,
    parameters: [ParameterDefinition] = [],
    atLeastOneOf: [[String]] = [],
    additionalParameters: AdditionalProperties = .disallowed,
    deprecated: Bool = false,
    deprecatedReason: String? = nil,
    rawJSONSchema: JSONValue?
  ) {
    self.name = name
    self.description = description
    self.returnType = returnType
    self.allowedCallers = allowedCallers
    self.requiresUserActivation = requiresUserActivation
    self.parameters = parameters
    self.atLeastOneOf = atLeastOneOf
    self.additionalParameters = additionalParameters
    self.deprecated = deprecated
    self.deprecatedReason = deprecatedReason
    self.rawJSONSchema = rawJSONSchema
  }

  /// Looks up a declared parameter by name.
  public func parameter(named name: String) -> ParameterDefinition? {
    parameters.first { $0.name == name }
  }

  /// Whether this function definition is fully represented by canonical types.
  public var isCanonical: Bool {
    rawJSONSchema == nil
      && returnType.isCanonical
      && additionalParameters.isCanonical
      && !parameters.contains { $0.type.containsRawJSONSchema }
  }

  /// Validates that `requiresUserActivation` is only enabled when `allowedCallers` is
  /// `.rendererOnly`.
  ///
  /// - Throws: ``A2UICatalogError`` when the caller policy is inconsistent.
  public func validateCallerConstraints() throws {
    if requiresUserActivation && allowedCallers != .rendererOnly {
      throw A2UICatalogError(
        """
        Function '\(name)' cannot set requiresUserActivation to true when allowedCallers is \
        '\(allowedCallers.rawValue)'; requiresUserActivation is only valid with rendererOnly.
        """
      )
    }
  }
}
