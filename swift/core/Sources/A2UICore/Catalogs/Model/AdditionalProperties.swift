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

/// Controls whether undeclared keys are accepted on an object, function, or surface properties
/// definition.
public indirect enum AdditionalProperties: Sendable, Equatable, ExpressibleByBooleanLiteral {
  /// Undeclared keys are rejected.
  case disallowed

  /// Any undeclared key with any JSON value is accepted.
  case allowed

  /// Undeclared keys are accepted when their values match the given type.
  case typed(TypeDefinition)

  public init(booleanLiteral value: Bool) {
    self = value ? .allowed : .disallowed
  }

  /// Whether this constraint contains only canonical data types (no component-only variants).
  public var isDataType: Bool {
    switch self {
    case .disallowed, .allowed:
      return true
    case .typed(let type):
      return type.isDataType
    }
  }

  /// Whether this constraint is free of legacy raw JSON Schema escape hatches.
  public var isCanonical: Bool {
    switch self {
    case .disallowed, .allowed:
      return true
    case .typed(let type):
      return !type.containsRawJSONSchema
    }
  }
}
