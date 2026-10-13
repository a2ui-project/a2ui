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

/// Configuration parameters controlling the strictness and behavior of A2UI validation.
public struct ValidationConfig: Sendable, Equatable {
  /// Whether components not reachable from the root component are permitted.
  public var allowOrphanComponents: Bool

  /// Whether references to components that have not yet been defined are permitted.
  public var allowDanglingReferences: Bool

  /// Whether missing a component with `id="root"` is permitted.
  public var allowMissingRoot: Bool

  /// Whether unrecognized component types or function names are permitted.
  public var allowUnknownElements: Bool

  /// Whether calls to functions that the resolved catalog does not declare are permitted.
  ///
  /// Such a call is accepted at processing time so that a renderer can forward it to the agent
  /// (for example through `callAgentFunction`); it reports an error only if it is evaluated
  /// locally. Unknown reserved `@` system functions are always rejected from v1.0, and a
  /// call's catalog must still resolve. `allowUnknownElements` also permits unknown functions.
  public var allowUnknownFunctions: Bool

  /// The target protocol version (e.g. `"v0.9.1"`), or `nil` when unspecified.
  public var targetVersion: String?

  /// The target protocol version as an `A2UIProtocolVersion` enum, if specified.
  public var protocolVersion: A2UIProtocolVersion? {
    get {
      guard let targetVersion else { return nil }
      return A2UIProtocolVersion(lenientRawValue: targetVersion)
    }
    set { targetVersion = newValue?.rawValue }
  }

  /// Creates a validation configuration.
  public init(
    allowOrphanComponents: Bool = false,
    allowDanglingReferences: Bool = false,
    allowMissingRoot: Bool = false,
    allowUnknownElements: Bool = false,
    allowUnknownFunctions: Bool = false,
    targetVersion: String? = nil
  ) {
    self.allowOrphanComponents = allowOrphanComponents
    self.allowDanglingReferences = allowDanglingReferences
    self.allowMissingRoot = allowMissingRoot
    self.allowUnknownElements = allowUnknownElements
    self.allowUnknownFunctions = allowUnknownFunctions
    self.targetVersion = targetVersion
  }

  /// Creates a validation configuration with a typed `A2UIProtocolVersion`.
  public init(
    allowOrphanComponents: Bool = false,
    allowDanglingReferences: Bool = false,
    allowMissingRoot: Bool = false,
    allowUnknownElements: Bool = false,
    allowUnknownFunctions: Bool = false,
    protocolVersion: A2UIProtocolVersion
  ) {
    self.allowOrphanComponents = allowOrphanComponents
    self.allowDanglingReferences = allowDanglingReferences
    self.allowMissingRoot = allowMissingRoot
    self.allowUnknownElements = allowUnknownElements
    self.allowUnknownFunctions = allowUnknownFunctions
    self.targetVersion = protocolVersion.rawValue
  }

  /// Default strict validation rules for complete message trees.
  public static let strict = ValidationConfig()

  /// Relaxed validation rules suitable for streaming or incremental component updates.
  ///
  /// This is the default processing mode of ``MessageProcessor``. It accepts calls to functions
  /// that the resolved catalog does not declare, so the renderer can forward them to the agent.
  public static let relaxed = ValidationConfig(
    allowOrphanComponents: true,
    allowDanglingReferences: true,
    allowMissingRoot: true,
    allowUnknownFunctions: true
  )
}
