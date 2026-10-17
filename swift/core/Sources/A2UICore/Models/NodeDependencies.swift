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

/// The data a resolved node read while resolving its own properties.
///
/// A child node records its own dependencies, so they aren't included in its parent's.
public struct NodeDependencies: Sendable, Equatable {

  /// The data paths whose values the node read.
  public internal(set) var values: Set<String> = []

  /// The paths of arrays the node expanded into template children. Only an array's length
  /// affects the node; each item's contents are read by the item's own node.
  public internal(set) var lists: Set<String> = []

  /// The IDs of the component definitions the node looked up for its children, including ones
  /// that don't exist.
  public internal(set) var components: Set<String> = []

  /// Creates an empty set of dependencies.
  public init() {}
}
