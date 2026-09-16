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

/// A generic dictionary of resolved property values.
public struct ResolvedDictionary: Resolved, Equatable, Sendable {
  public var storage: [String: any Resolved]

  public init(_ storage: [String: any Resolved] = [:]) {
    self.storage = storage
  }

  public subscript(key: String) -> (any Resolved)? {
    get { storage[key] }
    set { storage[key] = newValue }
  }

  public var keys: Dictionary<String, any Resolved>.Keys {
    storage.keys
  }

  public var values: Dictionary<String, any Resolved>.Values {
    storage.values
  }

  public static func == (lhs: ResolvedDictionary, rhs: ResolvedDictionary) -> Bool {
    guard lhs.storage.count == rhs.storage.count else { return false }
    for (key, leftValue) in lhs.storage {
      guard let rightValue = rhs.storage[key] else { return false }
      guard leftValue.isEqual(to: rightValue) else { return false }
    }
    return true
  }

  /// Returns the resolved string value for the given property key.
  public func string(for key: String) -> String? {
    if let stringValue = storage[key] as? String { return stringValue }
    if let binding = storage[key] as? DataBinding<String> { return binding.value }
    if let jsonValue = storage[key] as? JSONValue { return jsonValue.stringValue }
    if let jsonBinding = storage[key] as? DataBinding<JSONValue> {
      return jsonBinding.value?.stringValue
    }
    return nil
  }

  /// Returns the resolved boolean value for the given property key.
  public func bool(for key: String) -> Bool? {
    if let booleanValue = storage[key] as? Bool { return booleanValue }
    if let binding = storage[key] as? DataBinding<Bool> { return binding.value }
    if let jsonValue = storage[key] as? JSONValue { return jsonValue.boolValue }
    if let jsonBinding = storage[key] as? DataBinding<JSONValue> {
      return jsonBinding.value?.boolValue
    }
    return nil
  }

  /// Returns the resolved double value for the given property key.
  public func double(for key: String) -> Double? {
    if let doubleValue = storage[key] as? Double { return doubleValue }
    if let binding = storage[key] as? DataBinding<Double> { return binding.value }
    if let jsonValue = storage[key] as? JSONValue { return jsonValue.doubleValue }
    if let jsonBinding = storage[key] as? DataBinding<JSONValue> {
      return jsonBinding.value?.doubleValue
    }
    if let intValue = storage[key] as? Int { return Double(intValue) }
    return nil
  }

  /// Returns the resolved integer value for the given property key.
  public func int(for key: String) -> Int? {
    if let intValue = storage[key] as? Int { return intValue }
    if let binding = storage[key] as? DataBinding<Int> { return binding.value }
    if let jsonValue = storage[key] as? JSONValue { return jsonValue.intValue }
    if let jsonBinding = storage[key] as? DataBinding<JSONValue> {
      return jsonBinding.value?.intValue
    }
    return nil
  }
}
