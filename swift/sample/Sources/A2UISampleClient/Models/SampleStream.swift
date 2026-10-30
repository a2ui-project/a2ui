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
  public let fileName: String
  public let title: String
  public let description: String?
  public let protocolVersion: ProtocolVersion
  public let category: Category
  public let rawMessages: [String]

  /// Protocol version classification for bundled sample streams.
  public enum ProtocolVersion: String, CaseIterable, Identifiable, Sendable {
    case v091 = "v0.9.1"
    case v10 = "v1.0"

    public var id: String { rawValue }
  }

  /// Category classification based on source resource location.
  public enum Category: String, CaseIterable, Sendable {
    case basicCatalog = "Basic Catalog Examples"
    case testCases = "Test Cases & JSONL Streams"
  }

  public init(
    id: String,
    fileName: String = "",
    title: String,
    description: String? = nil,
    protocolVersion: ProtocolVersion = .v091,
    category: Category,
    rawMessages: [String]
  ) {
    self.id = id
    self.fileName = fileName
    self.title = title
    self.description = description
    self.protocolVersion = protocolVersion
    self.category = category
    self.rawMessages = rawMessages
  }
}
