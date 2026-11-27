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

/// Canonical return type specification for a catalog function.
///
/// Represents shorthand return types (`string`, `number`, `integer`, `boolean`, `array`, `object`,
/// `validationResult`, `any`, `void`), described `void` / `validationResult` objects, or structured
/// ``TypeDefinition`` data return types.
public struct FunctionReturnDefinition: Sendable, Equatable {
  /// Discriminator for a function's return value shape.
  public enum Kind: Sendable, Equatable {
    case void
    case validationResult
    case data(TypeDefinition)
  }

  /// The return value kind.
  public var kind: Kind

  /// Optional description for `void`, `validationResult`, or data return types.
  public var description: String?

  public init(kind: Kind, description: String? = nil) {
    self.kind = kind
    self.description = description
  }

  /// Creates a return definition from a legacy ``FunctionReturnType`` enum value.
  public init(returnType: FunctionReturnType) {
    switch returnType {
    case .string: self = .string
    case .number: self = .number
    case .boolean: self = .boolean
    case .array: self = .array
    case .object: self = .object
    case .validationResult: self = .validationResult
    case .any: self = .any
    case .void: self = .void
    }
  }

  // MARK: - Shorthand Constants & Factories

  public static let string = FunctionReturnDefinition(kind: .data(.string()))
  public static let number = FunctionReturnDefinition(kind: .data(.number()))
  public static let integer = FunctionReturnDefinition(kind: .data(.integer()))
  public static let boolean = FunctionReturnDefinition(kind: .data(.boolean()))
  public static let array = FunctionReturnDefinition(kind: .data(.array()))
  public static let object = FunctionReturnDefinition(
    kind: .data(.object(additionalProperties: .allowed))
  )
  public static let validationResult = FunctionReturnDefinition(kind: .validationResult)
  public static let any = FunctionReturnDefinition(kind: .data(.any()))
  public static let void = FunctionReturnDefinition(kind: .void)

  public static func data(_ type: TypeDefinition) -> FunctionReturnDefinition {
    FunctionReturnDefinition(kind: .data(type))
  }

  /// Maps this canonical return definition to the legacy ``FunctionReturnType`` summary.
  public var functionReturnType: FunctionReturnType {
    switch kind {
    case .void:
      return .void
    case .validationResult:
      return .validationResult
    case .data(let type):
      switch type.kind {
      case .string:
        return .string
      case .number, .integer:
        return .number
      case .boolean:
        return .boolean
      case .array:
        return .array
      case .object:
        return .object
      case .enum(_, let valueType, _, _):
        switch valueType {
        case .string: return .string
        case .number: return .number
        case .boolean: return .boolean
        }
      case .const(let value):
        switch value {
        case .string: return .string
        case .number, .integer: return .number
        case .boolean: return .boolean
        default: return .any
        }
      case .any, .union, .dataBinding, .functionCall, .ref, .child, .childList, .action,
        .checkRule, .accessibility, .rawJSONSchema:
        return .any
      }
    }
  }

  /// Shorthand string name when this return definition can be encoded compactly as a string.
  public var shorthandName: String? {
    guard description == nil else { return nil }
    switch kind {
    case .void:
      return "void"
    case .validationResult:
      return "validationResult"
    case .data(let type):
      guard type.description == nil, !type.deprecated, type.deprecatedReason == nil else {
        return nil
      }
      switch type.kind {
      case .string(false, nil, nil, nil, nil, nil):
        return "string"
      case .number(false, nil, nil, nil):
        return "number"
      case .integer(false, nil, nil, nil):
        return "integer"
      case .boolean(false, nil):
        return "boolean"
      case .array(false, nil, nil, nil, false, nil):
        return "array"
      case .object(false, let props, .allowed, let groups, nil)
      where props.isEmpty && groups.isEmpty:
        return "object"
      case .any(false, false, nil):
        return "any"
      default:
        return nil
      }
    }
  }

  /// Returns the effective data type with `self.description` merged when `kind` is `.data`.
  internal var effectiveDataType: TypeDefinition? {
    guard case .data(var type) = kind else { return nil }
    if type.description == nil, let description {
      type.description = description
    }
    return type
  }

  /// Whether the return type is free of legacy raw JSON Schema escape hatches.
  public var isCanonical: Bool {
    switch kind {
    case .void, .validationResult:
      return true
    case .data(let type):
      return !type.containsRawJSONSchema
    }
  }
}
