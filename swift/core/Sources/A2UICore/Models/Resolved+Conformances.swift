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

/// Conformances to `Resolved` for primitive types that are safe to pass
/// across threads as resolved property values.
extension String: Resolved {}
extension Double: Resolved {}
extension Int: Resolved {}
extension Bool: Resolved {}
extension JSONValue: Resolved {}

/// Arrays whose elements are Resolved are also Resolved.
extension Array: Resolved where Element: Resolved {
  public func isEqual(to other: any Resolved) -> Bool {
    guard let otherArray = other as? [Element] else { return false }
    guard count == otherArray.count else { return false }
    for (lhs, rhs) in zip(self, otherArray) {
      guard lhs.isEqual(to: rhs) else { return false }
    }
    return true
  }
}

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
    for (k, lVal) in lhs.storage {
      guard let rVal = rhs.storage[k] else { return false }
      guard lVal.isEqual(to: rVal) else { return false }
    }
    return true
  }
}

/// A generic array of heterogeneous resolved values.
public struct ResolvedArray: Resolved, Equatable, Sendable {
  public var elements: [any Resolved]

  public init(_ elements: [any Resolved] = []) {
    self.elements = elements
  }

  public static func == (lhs: ResolvedArray, rhs: ResolvedArray) -> Bool {
    guard lhs.elements.count == rhs.elements.count else { return false }
    for (l, r) in zip(lhs.elements, rhs.elements) {
      guard l.isEqual(to: r) else { return false }
    }
    return true
  }
}

