// Copyright 2026 Google LLC
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
/// Pairs a function name, its declared return type, and the JSON
/// Schema that validates the function's arguments. This is a pure data
/// type; execution logic lives in ``FunctionImplementation``.
///
/// Mirrors `FunctionApi` in the core blueprint.
public struct FunctionAPI: Sendable, Equatable {
  /// The function name as it appears in `FunctionCall` JSON.
  public var name: String

  /// The declared return type of the function.
  public var returnType: FunctionReturnType

  /// The JSON Schema for the function's arguments.
  public var schema: Schema

  public init(
    name: String,
    returnType: FunctionReturnType,
    schema: Schema
  ) {
    self.name = name
    self.returnType = returnType
    self.schema = schema
  }
}
