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
@_spi(Testing) import BasicCatalogSwiftUI
import Foundation
import OrderedJSON
import Testing
import Yams

/// Runs `conformance/adapter/markdown_subset.yaml` against `A2UISwiftUI.Surface`,
/// `HostedViewDriver`, and `A2UIText`.
@Suite(.serialized)
@MainActor
struct MarkdownSubsetConformanceTests {
  /// Parameterized test case loaded from `conformance/adapter/markdown_subset.yaml`.
  struct MarkdownSubsetCase: CustomTestStringConvertible, Sendable {
    nonisolated static let suite = "adapter/markdown_subset.yaml"
    nonisolated static let loadedResult: Result<[MarkdownSubsetCase], Error> = Result {
      try loadCases()
    }
    nonisolated static var all: [MarkdownSubsetCase] {
      (try? loadedResult.get()) ?? []
    }

    let name: String
    let specJSON: JSONValue

    nonisolated var testDescription: String { name }

    nonisolated func makeSpec() -> [String: Any] {
      (AdapterHarness.fromJSONValue(specJSON) as? [String: Any]) ?? [:]
    }

    nonisolated private static func loadCases() throws -> [MarkdownSubsetCase] {
      let conformanceDir: URL
      if let envDir = ProcessInfo.processInfo.environment["A2UI_CONFORMANCE_DIR"], !envDir.isEmpty {
        let envURL = URL(fileURLWithPath: envDir)
        conformanceDir =
          envURL.lastPathComponent == "conformance"
          ? envURL
          : envURL.appendingPathComponent("conformance")
      } else {
        let repoRoot = URL(fileURLWithPath: #filePath)
          .deletingLastPathComponent()
          .deletingLastPathComponent()
          .deletingLastPathComponent()
          .deletingLastPathComponent()
          .deletingLastPathComponent()
        conformanceDir = repoRoot.appendingPathComponent("conformance")
      }
      let fileURL = conformanceDir.appendingPathComponent(suite)
      let yamlText: String
      do {
        yamlText = try String(contentsOf: fileURL, encoding: .utf8)
      } catch {
        throw AdapterHarness.ConformanceError(
          "Failed to read '\(suite)' at \(fileURL.path): \(error)"
        )
      }
      let loadedObject: Any?
      do {
        loadedObject = try Yams.load(yaml: yamlText)
      } catch {
        throw AdapterHarness.ConformanceError("Failed to parse YAML in '\(suite)': \(error)")
      }
      guard let rawCases = loadedObject as? [[String: Any]], !rawCases.isEmpty else {
        throw AdapterHarness.ConformanceError(
          "Expected non-empty top-level YAML sequence of mappings in '\(suite)'"
        )
      }
      return rawCases.map { rawCase in
        let caseName = rawCase["name"] as? String ?? "<unnamed>"
        return MarkdownSubsetCase(name: caseName, specJSON: AdapterHarness.toJSONValue(rawCase))
      }
    }
  }

  private static let knownCaseKeys: Set<String> = [
    "name",
    "description",
    "action",
    "features",
    "markdown",
    "expectPresent",
    "expectAbsent",
    "expectVisibleText",
  ]

  private static let knownSemanticTokens: Set<String> = [
    "strong",
    "emphasis",
    "heading",
    "list_item",
    "code",
    "html",
    "image",
    "link",
  ]

  @Test func suiteCasesLoaded() throws {
    let cases = try MarkdownSubsetCase.loadedResult.get()
    #expect(!cases.isEmpty)
  }

  @Test(arguments: MarkdownSubsetCase.all)
  func markdownSubsetCase(_ testCase: MarkdownSubsetCase) throws {
    let suite = MarkdownSubsetCase.suite
    let caseName = testCase.name
    let caseSpec = testCase.makeSpec()

    do {
      try AdapterHarness.assertDictionaryKeys(
        caseSpec,
        allowed: Self.knownCaseKeys,
        where: "markdown_subset(\(caseName))"
      )
      let action = caseSpec["action"] as? String
      #expect(action == "render_markdown", "\(caseName): expected action 'render_markdown'")
      guard action == "render_markdown" else {
        let actualAction = String(describing: caseSpec["action"])
        throw AdapterHarness.ConformanceError(
          "\(caseName): expected action 'render_markdown', got \(actualAction)"
        )
      }
      guard let markdown = caseSpec["markdown"] as? String else {
        throw AdapterHarness.ConformanceError("\(caseName): missing 'markdown' string")
      }

      let processor = MessageProcessor(
        catalogs: BasicCatalog.allCatalogs,
        validationConfig: .relaxed
      )
      let surfaceID = "markdown_surface"
      let createMessage: JSONValue = AdapterHarness.toJSONValue([
        [
          "version": "1.0",
          "createSurface": [
            "surfaceId": surfaceID,
            "catalogId": BasicCatalog.catalogURI(version: .v10),
            "components": [
              [
                "id": "root",
                "component": "Text",
                "text": markdown,
              ]
            ],
          ],
        ]
      ])
      try processor.processMessages(createMessage)

      let viewModel = try #require(processor.surfaceGroupModel.surfacesMap[surfaceID])
      let driver = HostedViewDriver(
        viewModel: viewModel,
        catalogs: BasicCatalogImplementation.allCatalogs,
        defaultCatalogID: BasicCatalog.catalogURI(version: .v10)
      )
      defer { driver.tearDown() }
      driver.flush()

      let rootNode = try #require(viewModel.rootNode)
      let renderedView = Surface.render(
        node: rootNode,
        using: driver.surface.catalogs,
        defaultCatalogID: driver.surface.defaultCatalogID
      )
      #expect(renderedView != nil, "\(caseName): expected Surface.render to build Text view")
      if renderedView == nil {
        throw AdapterHarness.ConformanceError(
          "\(caseName): Surface.render returned nil for Text component"
        )
      }

      let rendered = A2UIText(node: rootNode).renderedMarkdown
      let visibleText = Self.normalizeWhitespace(rendered.visibleText)

      if let expectedRawText = caseSpec["expectVisibleText"] as? String {
        let expectedText = Self.normalizeWhitespace(expectedRawText)
        #expect(visibleText == expectedText, "\(caseName): visible text mismatch")
        if visibleText != expectedText {
          throw AdapterHarness.ConformanceError(
            "\(caseName): visible text '\(visibleText)' != '\(expectedText)'"
          )
        }
      }

      if let rawPresent = caseSpec["expectPresent"] {
        guard let expectPresent = rawPresent as? [String] else {
          throw AdapterHarness.ConformanceError(
            "\(caseName): 'expectPresent' must be an array of strings"
          )
        }
        for token in expectPresent {
          try Self.validateSemanticToken(token, caseName: caseName, field: "expectPresent")
          let isPresent = rendered.presentSemantics.contains(token)
          #expect(isPresent, "\(caseName): expected '\(token)' to be present")
          if !isPresent {
            let present = rendered.presentSemantics.sorted()
            throw AdapterHarness.ConformanceError(
              "\(caseName): expected semantic '\(token)' to be present in \(present)"
            )
          }
        }
      }

      if let rawAbsent = caseSpec["expectAbsent"] {
        guard let expectAbsent = rawAbsent as? [String] else {
          throw AdapterHarness.ConformanceError(
            "\(caseName): 'expectAbsent' must be an array of strings"
          )
        }
        for token in expectAbsent {
          try Self.validateSemanticToken(token, caseName: caseName, field: "expectAbsent")
          let isAbsent = !rendered.presentSemantics.contains(token)
          #expect(isAbsent, "\(caseName): expected '\(token)' to be absent")
          if !isAbsent {
            let present = rendered.presentSemantics.sorted()
            throw AdapterHarness.ConformanceError(
              "\(caseName): expected semantic '\(token)' to be absent, got \(present)"
            )
          }
        }
      }

      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(suite: suite, caseName: caseName, status: "passed")
      )
    } catch {
      Issue.record(Comment(rawValue: "\(caseName): \(error)"))
      AdapterHarness.writeManifestRecord(
        AdapterHarness.ManifestRecord(
          suite: suite,
          caseName: caseName,
          status: "failed",
          reason: String(describing: error)
        )
      )
      throw error
    }
  }

  private static func normalizeWhitespace(_ text: String) -> String {
    text
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
  }

  private static func validateSemanticToken(
    _ token: String,
    caseName: String,
    field: String
  ) throws {
    guard knownSemanticTokens.contains(token) else {
      throw AdapterHarness.ConformanceError(
        "\(caseName): unknown semantic token '\(token)' in \(field)"
      )
    }
  }
}
