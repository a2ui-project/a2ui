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

/// The framework-agnostic definition of a local function's API.
///
/// Pairs a function name, its declared return type, and either a canonical ``FunctionDefinition``
/// (preferred; requires no `JSONSchema` import) or a legacy JSON ``Schema`` validating arguments.
/// Execution logic lives in ``FunctionImplementation``.
public struct FunctionAPI: Sendable, Equatable {
  /// The function name as it appears in `FunctionCall` JSON.
  public var name: String

  /// Optional human- and LLM-readable description of the function.
  public var description: String?

  /// The declared return type of the function.
  public var returnType: FunctionReturnType

  /// Specifies which roles are authorized to invoke this function.
  public var allowedCallers: AllowedCallers

  /// Specifies whether this function requires a user activation context to execute.
  public var requiresUserActivation: Bool

  private var storedSchema: Schema?
  private var storedDefinition: FunctionDefinition

  /// Canonical JSON-Schema-independent function definition.
  public var definition: FunctionDefinition {
    get {
      var def = storedDefinition
      def.name = name
      def.description = description
      if def.returnType.functionReturnType != returnType {
        def.returnType = FunctionReturnDefinition(returnType: returnType)
      }
      def.allowedCallers = allowedCallers
      def.requiresUserActivation = requiresUserActivation
      return def
    }
    set {
      storedDefinition = newValue
      storedSchema = nil
      name = newValue.name
      description = newValue.description
      returnType = newValue.returnType.functionReturnType
      allowedCallers = newValue.allowedCallers
      requiresUserActivation = newValue.requiresUserActivation
    }
  }

  /// The JSON Schema for the function's arguments.
  public var schema: Schema {
    get {
      if let storedSchema {
        return storedSchema
      }
      return CatalogJSONSchemaCodec.compileFunctionArgsSchemaOrEmpty(definition)
    }
    set {
      storedSchema = newValue
      storedDefinition = CatalogJSONSchemaCodec.functionDefinition(
        from: name,
        returnType: returnType,
        argsSchema: newValue.jsonValue,
        description: description,
        allowedCallers: allowedCallers,
        requiresUserActivation: requiresUserActivation
      )
    }
  }

  /// Creates a function API purely from a canonical ``FunctionDefinition`` without requiring
  /// `JSONSchema`.
  public init(definition: FunctionDefinition) {
    self.name = definition.name
    self.description = definition.description
    self.returnType = definition.returnType.functionReturnType
    self.allowedCallers = definition.allowedCallers
    self.requiresUserActivation = definition.requiresUserActivation
    self.storedDefinition = definition
    self.storedSchema = nil
  }

  /// Creates a function API from a compiled `JSONSchema.Schema`, precomputing its canonical
  /// ``FunctionDefinition`` once on initialization.
  public init(
    name: String,
    returnType: FunctionReturnType,
    schema: Schema,
    allowedCallers: AllowedCallers = .rendererOnly,
    requiresUserActivation: Bool = false
  ) {
    let resolvedDescription = schema.jsonValue["description"]?.stringValue
    self.name = name
    self.description = resolvedDescription
    self.returnType = returnType
    self.allowedCallers = allowedCallers
    self.requiresUserActivation = requiresUserActivation
    self.storedSchema = schema
    self.storedDefinition = CatalogJSONSchemaCodec.functionDefinition(
      from: name,
      returnType: returnType,
      argsSchema: schema.jsonValue,
      description: resolvedDescription,
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation
    )
  }

  /// Validates that a function requiring user activation is restricted to `rendererOnly`.
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

  public static func == (lhs: FunctionAPI, rhs: FunctionAPI) -> Bool {
    guard lhs.name == rhs.name,
      lhs.description == rhs.description,
      lhs.returnType == rhs.returnType,
      lhs.allowedCallers == rhs.allowedCallers,
      lhs.requiresUserActivation == rhs.requiresUserActivation
    else {
      return false
    }
    if let lhsSchema = lhs.storedSchema, let rhsSchema = rhs.storedSchema {
      return lhsSchema == rhsSchema
    }
    return lhs.definition == rhs.definition
  }
}
