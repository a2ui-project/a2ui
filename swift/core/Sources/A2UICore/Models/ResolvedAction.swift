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

/// An action trigger wrapper that exposes a parameter-free trigger method.
public struct ResolvedAction: Sendable {
  /// Defines the identity of the action for structural equality.
  public enum Identity: Equatable, Sendable {
    case event(name: String, context: [String: JSONValue]?)
    case function(call: String, args: [String: JSONValue]?)
  }

  /// The identity of this resolved action.
  public let identity: Identity

  private let triggerClosure: @Sendable () -> Void

  /// Creates a new resolved action with the specified identity and
  /// trigger closure.
  public init(
    identity: Identity,
    trigger: @escaping @Sendable () -> Void
  ) {
    self.identity = identity
    self.triggerClosure = trigger
  }

  /// Triggers the action using function-call syntax.
  public func callAsFunction() {
    triggerClosure()
  }
}

extension ResolvedAction: Equatable {
  public static func == (lhs: ResolvedAction, rhs: ResolvedAction) -> Bool {
    lhs.identity == rhs.identity
  }
}

extension ResolvedAction: Resolved {}
