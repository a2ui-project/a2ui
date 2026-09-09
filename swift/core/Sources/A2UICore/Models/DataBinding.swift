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

/// A thread-safe, generic two-way data binding.
///
/// `DataBinding` connects a component property to a value in the data
/// model via a JSON Pointer path, or wraps a literal value. It holds
/// the resolved value at the time the node was resolved, and provides
/// a `set` method for updating the underlying data model.
public struct DataBinding<Value: Sendable>: Sendable {
  /// Defines the identity of the binding source for structural equality.
  public enum Identity: Equatable, Sendable {
    case path(String)
    case literal(JSONValue)
  }

  /// The unique identity of this binding.
  public let identity: Identity

  /// The resolved value at the time the Node was resolved.
  public let value: Value?
  private let setter: @Sendable @MainActor (Value) -> Void

  /// Creates a new data binding with the specified identity, resolved value,
  /// and setter.
  public init(
    identity: Identity,
    value: Value? = nil,
    set: @escaping @Sendable @MainActor (Value) -> Void = { _ in }
  ) {
    self.identity = identity
    self.value = value
    self.setter = set
  }

  /// Updates the bound value.
  @MainActor
  public func set(_ value: Value) {
    setter(value)
  }
}

extension DataBinding: Equatable where Value: Equatable {
  public static func == (lhs: DataBinding<Value>, rhs: DataBinding<Value>) -> Bool {
    lhs.identity == rhs.identity && lhs.value == rhs.value
  }
}

extension DataBinding: Resolved where Value: Equatable {}
