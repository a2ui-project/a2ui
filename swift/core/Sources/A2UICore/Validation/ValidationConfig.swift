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

  /// The target protocol version (e.g. `"v0.9.1"`).
  public var targetVersion: String

  /// Creates a validation configuration.
  public init(
    allowOrphanComponents: Bool = false,
    allowDanglingReferences: Bool = false,
    allowMissingRoot: Bool = false,
    targetVersion: String = "v0.9.1"
  ) {
    self.allowOrphanComponents = allowOrphanComponents
    self.allowDanglingReferences = allowDanglingReferences
    self.allowMissingRoot = allowMissingRoot
    self.targetVersion = targetVersion
  }

  /// Default strict validation rules for complete message trees.
  public static let strict = ValidationConfig()

  /// Relaxed validation rules suitable for streaming or incremental component updates.
  public static let relaxed = ValidationConfig(
    allowOrphanComponents: true,
    allowDanglingReferences: true,
    allowMissingRoot: true
  )
}
