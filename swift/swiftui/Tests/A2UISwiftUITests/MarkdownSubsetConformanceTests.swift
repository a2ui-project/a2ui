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
import A2UISwiftUI
import BasicCatalog
import Foundation
import OrderedJSON
import Testing
import Yams

@testable import BasicCatalogSwiftUI

/// Parameterized test case loaded from `conformance/adapter/markdown_subset.yaml`.
struct MarkdownSubsetCase: CustomTestStringConvertible, Sendable {
  static let suite = "adapter/markdown_subset.yaml"
  static let all: [MarkdownSubsetCase] = loadCases()

  let name: String
  let specJSON: JSONValue

  var testDescription: String { name }

  func makeSpec() -> [String: Any] {
    (AdapterHarness.fromJSONValue(specJSON) as? [String: Any]) ?? [:]
  }

  nonisolated private static func loadCases() -> [MarkdownSubsetCase] {
    let repoRoot = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let url = repoRoot.appendingPathComponent("conformance").appendingPathComponent(suite)
    guard
      let text = try? String(contentsOf: url, encoding: .utf8),
      let rawCases = try? Yams.load(yaml: text) as? [[String: Any]]
    else {
      return []
    }
    return rawCases.map { rawCase in
      let name = rawCase["name"] as? String ?? "<unnamed>"
      return MarkdownSubsetCase(name: name, specJSON: AdapterHarness.toJSONValue(rawCase))
    }
  }
}

@Suite(.serialized)
@MainActor
struct MarkdownSubsetConformanceTests {
  @Test(arguments: MarkdownSubsetCase.all)
  func markdownSubsetCase(_ c: MarkdownSubsetCase) throws {
    let suite = MarkdownSubsetCase.suite
    let name = c.name
    let spec = c.makeSpec()
    let markdown = (spec["markdown"] as? String) ?? ""
    let expectVisibleText = spec["expectVisibleText"] as? String

    let plainString = markdownVisibleText(markdown)
    let visibleText =
      plainString
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")

    if let expectVisibleText = expectVisibleText {
      let expected =
        expectVisibleText
        .components(separatedBy: .whitespacesAndNewlines)
        .filter { !$0.isEmpty }
        .joined(separator: " ")
      #expect(visibleText == expected)
    }

    AdapterHarness.writeManifestRecord(
      AdapterManifestRecord(
        harness: "swiftui",
        suite: suite,
        caseName: name,
        status: "passed"
      )
    )
  }
}
