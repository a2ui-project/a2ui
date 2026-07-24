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

import OrderedJSON

/// A concrete local function implementation.
///
/// Splits the API definition (``FunctionAPI``) from the execution logic,
/// mirroring `FunctionImplementation extends FunctionApi` in the core
/// blueprint. Implementations are registered in a ``Catalog`` and invoked
/// when evaluating `FunctionCall` dynamic values.
public protocol FunctionImplementation: Sendable {
  /// The API definition (name, returnType, schema).
  var api: FunctionAPI { get }

  /// Evaluates the function with the given arguments.
  ///
  /// - Parameter arguments: A dictionary of named arguments.
  /// - Returns: The result of the function evaluation.
  /// - Throws: ``FunctionError`` if evaluation fails.
  func evaluate(arguments: [String: JSONValue]) throws -> JSONValue
}
