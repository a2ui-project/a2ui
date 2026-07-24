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

/// A thread-safe, generic two-way data binding.
///
/// `DataBinding` connects a component property to a value in the data
/// model via a JSON Pointer path, or wraps a literal value. It provides
/// get/set closures for reading and writing the bound value.
public struct DataBinding<Value: Sendable>: Sendable {
  /// Defines the identity of the binding source for structural equality.
  public enum Identity: Equatable, Sendable {
    case path(String)
    case literal(JSONValue)
  }

  /// The unique identity of this binding.
  public let identity: Identity

  private let getter: @Sendable () -> Value
  private let setter: @Sendable (Value) -> Void

  /// Creates a new data binding with the specified identity, getter,
  /// and setter.
  public init(
    identity: Identity,
    get: @escaping @Sendable () -> Value,
    set: @escaping @Sendable (Value) -> Void
  ) {
    self.identity = identity
    self.getter = get
    self.setter = set
  }

  /// Retrieves the current bound value.
  public func get() -> Value {
    getter()
  }

  /// Updates the bound value.
  public func set(_ value: Value) {
    setter(value)
  }
}

extension DataBinding: Equatable {
  public static func == (lhs: DataBinding<Value>, rhs: DataBinding<Value>) -> Bool {
    lhs.identity == rhs.identity
  }
}

extension DataBinding: Resolved {}
