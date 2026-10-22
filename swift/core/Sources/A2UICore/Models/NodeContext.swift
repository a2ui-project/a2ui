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

/// The position of a resolved node in the component tree.
///
/// Holds what ``NodeResolver/resolveNode(_:)`` needs to resolve the node again on its own.
public struct NodeContext: Sendable, Equatable {

  /// The ID of the component definition the node was resolved from.
  public let componentID: String

  /// The instance ID of the node.
  public let instanceID: String

  /// The data path that relative paths resolve against, or `nil` for the root scope.
  public let dataPath: String?

  let index: Int?
  let instanceSuffix: String?
  let ancestors: Set<String>

  /// The context of a surface's root node.
  public static let root = NodeContext(
    componentID: "root", instanceID: "root", dataPath: nil, index: nil, instanceSuffix: nil,
    ancestors: [])
}
