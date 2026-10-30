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

/// An action trigger wrapper that exposes a parameter-free trigger method.
public struct ResolvedAction: Sendable {
  /// Defines the identity of the action for structural equality.
  public enum Identity: Equatable, Sendable {
    case event(name: String, context: [String: JSONValue]?, userMessage: String? = nil)
    case function(call: String, args: [String: JSONValue]?)
  }

  /// The identity of this resolved action.
  public let identity: Identity

  /// The ID of the component that originated this action, if known.
  public let sourceComponentID: String?

  /// The data model path that relative paths in this action resolve against when triggered,
  /// or `nil` for the root scope.
  ///
  /// Part of equality: the same action definition instantiated by a template for different
  /// data items has an identical ``identity`` but dispatches values from a different scope.
  public let dataContextPath: String?

  /// Optional metadata envelope (`["extensions": .object(...)]`) attached to the action.
  public let metadata: [String: JSONValue]?

  package let rawUserMessage: JSONValue?

  private let triggerClosure: @Sendable @MainActor ([String: JSONValue]?) throws -> Void

  /// Creates a new resolved action with the specified identity and
  /// trigger closure.
  public init(
    identity: Identity,
    sourceComponentID: String? = nil,
    dataContextPath: String? = nil,
    rawUserMessage: JSONValue? = nil,
    metadata: [String: JSONValue]? = nil,
    trigger: @escaping @Sendable @MainActor () -> Void
  ) {
    self.identity = identity
    self.sourceComponentID = sourceComponentID
    self.dataContextPath = dataContextPath
    self.rawUserMessage = rawUserMessage
    self.metadata = metadata
    self.triggerClosure = { _ in trigger() }
  }

  /// Creates a new resolved action with a trigger closure that accepts optional call-time metadata.
  public init(
    identity: Identity,
    sourceComponentID: String? = nil,
    dataContextPath: String? = nil,
    rawUserMessage: JSONValue? = nil,
    metadata: [String: JSONValue]? = nil,
    triggerWithMetadata: @escaping @Sendable @MainActor ([String: JSONValue]?) throws -> Void
  ) {
    self.identity = identity
    self.sourceComponentID = sourceComponentID
    self.dataContextPath = dataContextPath
    self.rawUserMessage = rawUserMessage
    self.metadata = metadata
    self.triggerClosure = triggerWithMetadata
  }

  /// Triggers the action using parameter-free function-call syntax.
  @MainActor
  public func callAsFunction() {
    try? triggerClosure(nil)
  }

  /// Triggers the action using function-call syntax, validating and merging call-site metadata.
  @MainActor
  public func callAsFunction(metadata: [String: JSONValue]?) throws {
    try triggerClosure(metadata)
  }
}

extension ResolvedAction: Equatable {
  public static func == (lhs: ResolvedAction, rhs: ResolvedAction) -> Bool {
    lhs.identity == rhs.identity
      && lhs.dataContextPath == rhs.dataContextPath
      && lhs.rawUserMessage == rhs.rawUserMessage
      && MetadataValidator.areEqual(lhs.metadata, rhs.metadata)
  }
}

extension ResolvedAction: Resolved {}
