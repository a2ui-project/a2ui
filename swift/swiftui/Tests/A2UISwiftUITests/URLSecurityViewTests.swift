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
@_spi(Testing) import BasicCatalogSwiftUI
import Combine
import Foundation
import Testing

/// Covers how the SwiftUI views use the URL security policy: media views load only the resolved
/// URL, Markdown links are opt-in and checked, and the environment sanitizer reports to the
/// surface.
@MainActor
struct URLSecurityViewTests {
  private func textNode(_ text: String) -> Node {
    Node(id: "text", type: "Text", properties: ["text": text])
  }

  @Test func markdownLinksRenderAsPlainTextByDefault() {
    let rendered = A2UIText(node: textNode("[Docs](https://example.com/docs)")).renderedMarkdown

    #expect(rendered.visibleText == "Docs")
    #expect(!rendered.presentSemantics.contains("link"))
  }

  @Test func optedInMarkdownLinksKeepAllowedTargets() {
    let node = textNode("Read [Docs](https://example.com/docs)")
    let rendered = A2UIText(node: node, markdownURLOptions: .links).renderedMarkdown

    #expect(rendered.visibleText == "Read Docs")
    #expect(rendered.presentSemantics.contains("link"))
  }

  @Test(arguments: ["javascript:alert(1)", "data:text/html,hi", "//evil.example/page"])
  func optedInMarkdownLinksDropBlockedTargets(target: String) {
    let node = textNode("[Click](\(target))")
    let rendered = A2UIText(node: node, markdownURLOptions: .links).renderedMarkdown

    #expect(rendered.visibleText == "Click")
    #expect(!rendered.presentSemantics.contains("link"))
  }

  @Test func surfaceSanitizerAppliesThePolicyAndReports() throws {
    let surface = SurfaceViewModel(
      surfaceID: "main",
      catalogs: [String: AnyCatalog](),
      urlSecurityPolicy: try AllowlistURLSecurityPolicy(navigation: ["example.com"])
    )
    var warnings: [URLBlockedWarning] = []
    let cancellable = surface.urlBlockedPublisher.sink { warnings.append($0) }
    defer { cancellable.cancel() }
    let sanitize = A2UIURLSanitizer(surface: surface)
    let info = URLCheckInfo(componentID: "text", propertyName: "text")

    #expect(sanitize("https://example.com/a", context: .navigation, info: info) != nil)
    #expect(sanitize("https://evil.example/?d=1", context: .navigation, info: info) == nil)
    #expect(warnings.map(\.redactedURL) == ["https://evil.example"])
  }

  @Test func baselineSanitizerBlocksScriptURLs() {
    let sanitize = A2UIURLSanitizer.baseline

    #expect(sanitize("https://any.example.org/", context: .navigation) != nil)
    #expect(sanitize("javascript:alert(1)", context: .navigation) == nil)
  }

  @Test func audioPlayerLoadsOnlyURLsThatPassTheBaseline() {
    let model = A2UIAudioPlayerModel()

    model.load(urlString: "javascript:alert(1)")
    #expect(model.player == nil)

    model.load(urlString: " https://example.com/a.mp3")
    #expect(model.player == nil)

    model.load(urlString: "https://example.com/a.mp3")
    #expect(model.player != nil)
    model.cleanUp()
  }
}
