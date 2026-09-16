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

import Foundation

/// Represents a selectable A2UI sample stream and its sequential messages.
public struct SampleStream: Identifiable, Hashable, Sendable {
  public let id: String
  public let title: String
  public let description: String?
  public let category: Category
  public let rawMessages: [String]

  /// Category classification based on source resource location.
  public enum Category: String, CaseIterable, Sendable {
    case basicCatalog = "Basic Catalog Examples (v0.9.1)"
    case testCases = "Test Cases & JSONL Streams"
  }

  public init(
    id: String,
    title: String,
    description: String? = nil,
    category: Category,
    rawMessages: [String]
  ) {
    self.id = id
    self.title = title
    self.description = description
    self.category = category
    self.rawMessages = rawMessages
  }
}
