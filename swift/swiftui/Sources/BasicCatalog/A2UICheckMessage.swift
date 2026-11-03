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

import A2UICore
import SwiftUI

/// The validation message shown under a Basic Catalog input.
///
/// Shows the first failing `error` check in red. Without one, shows the first failing `warning`
/// or `info` check as a non-blocking hint in orange, so the control stays usable.
public struct A2UICheckMessage: View {
  public let node: Node

  /// The prefix of the message's accessibility identifiers, such as `A2UICheckBox`.
  public let identifierPrefix: String

  public init(node: Node, identifierPrefix: String) {
    self.node = node
    self.identifierPrefix = identifierPrefix
  }

  /// The message of the first failing `error` check.
  public var errorText: String? {
    node.validationErrors.first
  }

  /// The message of the first failing `warning` or `info` check, or `nil` while an error shows.
  public var hintText: String? {
    guard errorText == nil else { return nil }
    return node.validationResults.lazy
      .filter { $0.severity == .warning || $0.severity == .info }
      .compactMap(\.message)
      .first
  }

  public var body: some View {
    if let errorText {
      Text(errorText)
        .font(.caption)
        .foregroundStyle(Color.red)
        .accessibilityIdentifier("\(identifierPrefix)_Error_\(node.id)")
    } else if let hintText {
      Text(hintText)
        .font(.caption)
        .foregroundStyle(Color.orange)
        .accessibilityIdentifier("\(identifierPrefix)_Warning_\(node.id)")
    }
  }
}
