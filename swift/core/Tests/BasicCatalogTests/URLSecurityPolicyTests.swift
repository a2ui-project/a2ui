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
import BasicCatalog
import Combine
import Foundation
import OrderedJSON
import Testing

private final class RecordingActionHandler: ActionHandling, @unchecked Sendable {
  var errors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: RendererError, from surfaceID: String) {
    errors.append(error)
  }
}

private final class RecordingOpenURLHandler: OpenURLHandler, @unchecked Sendable {
  var openedURLs: [URL] = []

  func open(_ url: URL) {
    openedURLs.append(url)
  }
}

@MainActor
private final class WarningRecorder {
  var warnings: [URLBlockedWarning] = []
  private var cancellable: AnyCancellable?

  init(_ publisher: AnyPublisher<URLBlockedWarning, Never>) {
    cancellable = publisher.sink { [weak self] warning in
      self?.warnings.append(warning)
    }
  }
}

@MainActor
private final class EmptyFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    nil
  }
}

/// Covers the parts of the URL security policy that the shared conformance suite doesn't: host
/// entry validation, warnings, the theme icon, the host's property map, and rewritten links.
@MainActor
struct URLSecurityPolicyTests {
  private static let v10CatalogID = BasicCatalog.catalogURI(version: .v10)
  private static let v09CatalogID = BasicCatalog.catalogURI(version: .v09)

  private func messages(_ json: String) throws -> JSONValue {
    try JSONValue.parse(Data(json.utf8))
  }

  private func createV10Surface(components: String) throws -> JSONValue {
    try messages(
      """
      [{"version": "1.0", "createSurface": {"surfaceId": "main",
        "catalogId": "\(Self.v10CatalogID)", "components": \(components)}}]
      """
    )
  }

  @Test(
    arguments: [
      "", "https://cdn.example.com", "cdn.example.com/a", "*.*.example.com",
      "user@cdn.example.com", "exa mple.com", "m\u{FC}nchen.example", "*.", "cdn.example.com:x",
    ])
  func allowlistRejectsInvalidHostEntries(entry: String) {
    #expect(throws: A2UIValidationError.self) {
      try AllowlistURLSecurityPolicy(media: [entry])
    }
  }

  @Test func blockedURLIsReportedOnceAndRedacted() throws {
    let processor = MessageProcessor(
      catalogs: [BasicCatalog.makeCatalog(version: .v10)],
      urlSecurityPolicy: try AllowlistURLSecurityPolicy(media: ["cdn.example.com"])
    )
    let recorder = WarningRecorder(processor.urlBlockedPublisher)
    let image = """
      [{"id": "root", "component": "Image",
        "url": "https://evil.example/collect?d=s3cr3t#frag"}]
      """
    try processor.processMessages(try createV10Surface(components: image))
    try processor.processMessages(
      try messages(
        """
        [{"version": "1.0", "updateComponents": {"surfaceId": "main", "components": \(image)}}]
        """
      )
    )

    let surface = try #require(processor.surfaceGroupModel["main"])
    #expect(surface.rootNode?.string(for: "url") == nil)
    #expect(recorder.warnings.count == 1)
    let warning = try #require(recorder.warnings.first)
    #expect(warning.code == "URL_BLOCKED")
    #expect(warning.surfaceID == "main")
    #expect(warning.context == .media)
    #expect(warning.redactedURL == "https://evil.example")
    #expect(
      warning.info
        == URLCheckInfo(
          surfaceID: "main",
          catalogID: Self.v10CatalogID,
          componentType: "Image",
          componentID: "root",
          propertyName: "url"
        )
    )
    #expect(warning.message.contains("https://evil.example"))
    #expect(!warning.message.contains("s3cr3t"))
    #expect(!warning.message.contains("frag"))
  }

  @Test func hostPropertyMapOverridesSchemaAndBuiltInList() throws {
    let policy = try AllowlistURLSecurityPolicy(
      media: ["cdn.example.com"],
      urlProperties: [Self.v10CatalogID: ["Text": ["text": .media], "Image": ["url": .notURL]]]
    )
    let processor = MessageProcessor(
      catalogs: [BasicCatalog.makeCatalog(version: .v10)],
      urlSecurityPolicy: policy
    )
    try processor.processMessages(
      try createV10Surface(
        components: """
          [{"id": "root", "component": "Column", "children": ["text", "image"]},
           {"id": "text", "component": "Text", "text": "https://evil.example/a.png"},
           {"id": "image", "component": "Image", "url": "https://evil.example/b.png"}]
          """
      )
    )

    let root = try #require(processor.surfaceGroupModel["main"]?.rootNode)
    let children = root.children(for: "children")
    let text = try #require(children.first { $0.id == "text" })
    let image = try #require(children.first { $0.id == "image" })
    #expect(text.string(for: "text") == nil)
    #expect(image.string(for: "url") == "https://evil.example/b.png")
  }

  @Test func blockedThemeIconIsRemovedAndReported() throws {
    let processor = MessageProcessor(
      catalogs: [BasicCatalog.makeCatalog(version: .v09)],
      urlSecurityPolicy: try AllowlistURLSecurityPolicy(media: ["cdn.example.com"])
    )
    let recorder = WarningRecorder(processor.urlBlockedPublisher)
    try processor.processMessages(
      try messages(
        """
        [{"version": "v0.9", "createSurface": {"surfaceId": "main",
          "catalogId": "\(Self.v09CatalogID)",
          "theme": {"iconUrl": "https://evil.example/i.png", "agentDisplayName": "Agent"}}}]
        """
      )
    )

    let surface = try #require(processor.surfaceGroupModel["main"])
    #expect(surface.theme?["iconUrl"] == nil)
    #expect(surface.theme?["agentDisplayName"] == .string("Agent"))
    #expect(recorder.warnings.map(\.info.propertyName) == ["theme.iconUrl"])
  }

  @Test func rewrittenThemeIconReplacesTheOriginal() throws {
    let policy = try AllowlistURLSecurityPolicy(
      media: ["cdn.example.com"],
      rewrite: [.media: { url, _, _ in "https://proxy.example.com/?u=\(url.count)" }]
    )
    let processor = MessageProcessor(
      catalogs: [BasicCatalog.makeCatalog(version: .v09)],
      urlSecurityPolicy: policy
    )
    try processor.processMessages(
      try messages(
        """
        [{"version": "v0.9", "createSurface": {"surfaceId": "main",
          "catalogId": "\(Self.v09CatalogID)",
          "theme": {"iconUrl": "https://cdn.example.com/i.png"}}}]
        """
      )
    )

    let surface = try #require(processor.surfaceGroupModel["main"])
    #expect(surface.theme?["iconUrl"] == .string("https://proxy.example.com/?u=29"))
  }

  @Test func openURLPassesTheRewrittenURLToTheHandler() throws {
    let opener = RecordingOpenURLHandler()
    let errors = RecordingActionHandler()
    let policy = try AllowlistURLSecurityPolicy(
      navigation: ["shop.example.com"],
      rewrite: [.navigation: { _, _, _ in "https://shop.example.com/redirect" }]
    )
    let processor = MessageProcessor(
      catalogs: [BasicCatalog.makeCatalog(version: .v10, openURLHandler: opener)],
      actionHandler: errors,
      urlSecurityPolicy: policy
    )
    try processor.processMessages(
      try createV10Surface(
        components: """
          [{"id": "root", "component": "Button", "child": "label",
            "action": {"functionCall": {"@call": "openUrl",
              "args": {"url": "https://shop.example.com/p/1"}}}},
           {"id": "label", "component": "Text", "text": "Shop"}]
          """
      )
    )

    let root = try #require(processor.surfaceGroupModel["main"]?.rootNode)
    let action = try #require(root.action(for: "action", userActivation: true))
    action()

    #expect(opener.openedURLs.map(\.absoluteString) == ["https://shop.example.com/redirect"])
    #expect(errors.errors.isEmpty)
  }

  @Test func blockedOpenURLReportsURLBlockedWithoutTheURL() throws {
    let opener = RecordingOpenURLHandler()
    let errors = RecordingActionHandler()
    let processor = MessageProcessor(
      catalogs: [BasicCatalog.makeCatalog(version: .v10, openURLHandler: opener)],
      actionHandler: errors,
      urlSecurityPolicy: try AllowlistURLSecurityPolicy(navigation: ["shop.example.com"])
    )
    let recorder = WarningRecorder(processor.urlBlockedPublisher)
    try processor.processMessages(
      try createV10Surface(
        components: """
          [{"id": "root", "component": "Button", "child": "label",
            "action": {"functionCall": {"@call": "openUrl",
              "args": {"url": "https://evil.example/?d=s3cr3t"}}}},
           {"id": "label", "component": "Text", "text": "Go"}]
          """
      )
    )

    let root = try #require(processor.surfaceGroupModel["main"]?.rootNode)
    let action = try #require(root.action(for: "action", userActivation: true))
    action()

    #expect(opener.openedURLs.isEmpty)
    guard case .generic(let error) = try #require(errors.errors.first) else {
      Issue.record("expected a generic error, got \(errors.errors)")
      return
    }
    #expect(errors.errors.count == 1)
    #expect(error.code == "URL_BLOCKED")
    #expect(error.surfaceID == "main")
    #expect(!error.message.contains("s3cr3t"))
    #expect(recorder.warnings.map(\.info.functionName) == ["openUrl"])
  }

  @Test func dataContextWithoutASurfaceRunsTheBaseline() {
    let context = DataContext(
      dataModel: DataModel(), path: "", functionHandler: EmptyFunctionHandler())

    #expect(context.sanitizeURL("https://any.example.org/a", context: .navigation) != nil)
    #expect(context.sanitizeURL("javascript:alert(1)", context: .navigation) == nil)
    #expect(context.sanitizeURL("data:image/svg+xml;base64,PHN2Zz4=", context: .media) == nil)
  }
}
