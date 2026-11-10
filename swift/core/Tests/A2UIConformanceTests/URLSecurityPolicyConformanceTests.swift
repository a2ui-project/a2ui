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
import Foundation
import OrderedCollections
import OrderedJSON
import Testing

/// Records the errors a processor reports.
private final class URLPolicyErrorRecorder: ActionHandling, @unchecked Sendable {
  var errors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: RendererError, from surfaceID: String) {
    errors.append(error)
  }
}

/// Records the URLs that reach the host's open-URL handler.
private final class URLPolicyOpenedURLRecorder: OpenURLHandler, @unchecked Sendable {
  var openedURLs: [String] = []

  func open(_ url: URL) {
    openedURLs.append(url.absoluteString)
  }
}

/// Runs the shared `conformance/core/url_security_policy.yaml` suite.
@MainActor
struct URLSecurityPolicyConformanceTests {
  private static let checkCaseKeys: Set<String> = ["action", "policy", "steps"]
  private static let checkStepKeys: Set<String> = ["url", "context", "expect"]
  private static let policyKeys: Set<String> = [
    "type", "media", "navigation", "iframe", "allowRelative", "allowSvgDataUrls", "rewrite",
  ]
  private static let resolutionCaseKeys: Set<String> = [
    "action", "protocolVersion", "catalogPaths", "catalogs", "policy", "messages", "expect",
    "steps",
  ]
  private static let resolutionStepKeys: Set<String> = ["messages", "dispatchAction", "expect"]
  private static let dispatchActionKeys: Set<String> = [
    "surfaceId", "componentId", "userActivation",
  ]
  private static let expectKeys: Set<String> = ["components", "openedUrls", "errors"]
  private static let errorKeys: Set<String> = ["code", "surfaceId", "message"]

  /// The characters JavaScript's `encodeURIComponent` leaves unencoded.
  private static let uriComponentAllowed = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
  )

  @Test(arguments: ConformanceTestHelper.cases("core/url_security_policy.yaml"))
  func urlSecurityPolicyConformance(_ conformanceCase: ConformanceCase) throws {
    try ConformanceManifest.run(conformanceCase) {
      let testCase = conformanceCase.rawDictionary
      let action = testCase["action"] as? String ?? ""
      switch action {
      case "url_policy_check":
        try runCheckCase(testCase, name: conformanceCase.name)
      case "url_policy_resolution":
        try runResolutionCase(testCase, name: conformanceCase.name)
      default:
        throw UnknownConformanceKeyError(
          "[\(conformanceCase.name)] Unknown url_security_policy.yaml action '\(action)'"
        )
      }
    }
  }

  // MARK: - url_policy_check

  private func runCheckCase(_ testCase: [String: Any], name: String) throws {
    try ConformanceTestHelper.assertKnownKeys(testCase, Self.checkCaseKeys, "case '\(name)'")
    let policy = try buildPolicy(testCase["policy"], name: name)
    // A resolver applies the policy the way surfaces do: the baseline, the policy, and the
    // baseline again on a rewritten URL.
    let resolver = NodeResolver(surfaceID: "check", catalogs: [:], urlSecurityPolicy: policy)
    let steps = testCase["steps"] as? [[String: Any]] ?? []
    #expect(!steps.isEmpty, "[\(name)] has no steps")
    for (index, step) in steps.enumerated() {
      try ConformanceTestHelper.assertKnownKeys(
        step, Self.checkStepKeys, "step \(index) of '\(name)'", allowMetadata: false)
      let url = try #require(step["url"] as? String, "[\(name)] step \(index) has no url")
      let contextName = step["context"] as? String ?? ""
      guard let context = URLContext(rawValue: contextName) else {
        throw UnknownConformanceKeyError("[\(name)] Unknown URL context '\(contextName)'")
      }
      let expected = step["expect"] as? String
      let actual = resolver.sanitizeURL(url, context: context, info: nil)
      #expect(
        actual == expected,
        "[\(name)] step \(index): \(url.debugDescription) as \(contextName)"
      )
    }
  }

  private func buildPolicy(_ rawSpec: Any?, name: String) throws -> any URLSecurityPolicy {
    let spec = try #require(rawSpec as? [String: Any], "[\(name)] has no policy")
    try ConformanceTestHelper.assertKnownKeys(
      spec, Self.policyKeys, "policy of '\(name)'", allowMetadata: false)
    let allowSVG = spec["allowSvgDataUrls"] as? Bool ?? false
    switch spec["type"] as? String {
    case "permissive":
      return PermissiveURLSecurityPolicy(allowSVGDataURLs: allowSVG)
    case "allowlist":
      var rewrite: [URLContext: URLRewriteHook] = [:]
      let uriComponentAllowed = Self.uriComponentAllowed
      for (contextName, rawHook) in spec["rewrite"] as? [String: Any] ?? [:] {
        guard let context = URLContext(rawValue: contextName),
          let hook = rawHook as? [String: Any],
          let prefix = hook["prefix"] as? String
        else {
          throw UnknownConformanceKeyError("[\(name)] Unknown rewrite '\(contextName)'")
        }
        // Only absolute http(s) URLs are proxied; others pass unchanged.
        rewrite[context] = { url, _, _ in
          let lowercased = url.lowercased()
          guard lowercased.hasPrefix("http://") || lowercased.hasPrefix("https://") else {
            return url
          }
          let encoded = url.addingPercentEncoding(withAllowedCharacters: uriComponentAllowed)
          return prefix + (encoded ?? url)
        }
      }
      let relativeNames = spec["allowRelative"] as? [String] ?? []
      let allowRelative = try relativeNames.map { contextName -> URLContext in
        guard let context = URLContext(rawValue: contextName) else {
          throw UnknownConformanceKeyError("[\(name)] Unknown URL context '\(contextName)'")
        }
        return context
      }
      return try AllowlistURLSecurityPolicy(
        media: spec["media"] as? [String],
        navigation: spec["navigation"] as? [String],
        iframe: spec["iframe"] as? [String],
        allowRelative: Set(allowRelative),
        rewrite: rewrite,
        allowSVGDataURLs: allowSVG
      )
    default:
      throw UnknownConformanceKeyError(
        "[\(name)] Unknown policy type '\(String(describing: spec["type"]))'")
    }
  }

  // MARK: - url_policy_resolution

  private func runResolutionCase(_ testCase: [String: Any], name: String) throws {
    try ConformanceTestHelper.assertKnownKeys(
      testCase, Self.resolutionCaseKeys, "case '\(name)'")
    let openedURLRecorder = URLPolicyOpenedURLRecorder()
    let errorRecorder = URLPolicyErrorRecorder()
    let processor = MessageProcessor(
      catalogs: try loadCatalogs(testCase, openURLHandler: openedURLRecorder),
      actionHandler: errorRecorder,
      urlSecurityPolicy: try buildPolicy(testCase["policy"], name: name)
    )
    defer { processor.dispose() }

    let initialMessages = testCase["messages"] ?? [Any]()
    try processor.processMessages(ConformanceTestHelper.toJSONValue(initialMessages))
    try check(
      testCase["expect"],
      processor: processor,
      where: "[\(name)] expect",
      afterAction: nil
    )

    for (index, step) in (testCase["steps"] as? [[String: Any]] ?? []).enumerated() {
      let location = "[\(name)] steps[\(index)]"
      try ConformanceTestHelper.assertKnownKeys(
        step, Self.resolutionStepKeys, location, allowMetadata: false)
      let messages = step["messages"]
      let rawDispatch = step["dispatchAction"]
      #expect(
        (messages == nil) != (rawDispatch == nil),
        "\(location): a step has exactly one of messages and dispatchAction"
      )
      openedURLRecorder.openedURLs.removeAll()
      errorRecorder.errors.removeAll()
      if let messages {
        try processor.processMessages(ConformanceTestHelper.toJSONValue(messages))
        try check(step["expect"], processor: processor, where: location, afterAction: nil)
        continue
      }
      let dispatch = try #require(rawDispatch as? [String: Any], "\(location): no dispatchAction")
      try ConformanceTestHelper.assertKnownKeys(
        dispatch, Self.dispatchActionKeys, "\(location).dispatchAction", allowMetadata: false)
      let surfaceID = try #require(dispatch["surfaceId"] as? String)
      let componentID = try #require(dispatch["componentId"] as? String)
      let surface = try #require(
        processor.surfaceGroupModel[surfaceID], "\(location): no surface '\(surfaceID)'")
      let node = try #require(
        findNode(componentID, in: surface.rootNode), "\(location): no node '\(componentID)'")
      let action = try #require(
        node.action(for: "action", userActivation: dispatch["userActivation"] as? Bool ?? true),
        "\(location): '\(componentID)' has no action"
      )
      action()
      try check(
        step["expect"],
        processor: processor,
        where: location,
        afterAction: (openedURLRecorder.openedURLs, errorRecorder.errors)
      )
    }
  }

  private func loadCatalogs(
    _ testCase: [String: Any],
    openURLHandler: any OpenURLHandler
  ) throws -> [AnyCatalog] {
    var catalogs: [AnyCatalog] = []
    for path in testCase["catalogPaths"] as? [String] ?? [] {
      if path == "catalogs/basic/v1/catalog.json" {
        // The SDK's basic catalog carries the function implementations, including openUrl.
        catalogs.append(BasicCatalog.makeCatalog(version: .v10, openURLHandler: openURLHandler))
      } else {
        catalogs.append(
          ConformanceTestHelper.buildCatalog(
            catalogSchema: try ConformanceTestHelper.loadRepositoryJSON(path: path),
            commonTypes: try ConformanceTestHelper.commonTypesSchema(forCatalogPath: path)
          )
        )
      }
    }
    for rawCatalog in testCase["catalogs"] as? [[String: Any]] ?? [] {
      let catalogSchema = ConformanceTestHelper.toJSONValue(rawCatalog)
      let version = catalogSchema["protocolVersion"]?.stringValue ?? "1.0"
      catalogs.append(
        ConformanceTestHelper.buildCatalog(
          catalogSchema: catalogSchema,
          commonTypes: try ConformanceTestHelper.commonTypesSchema(forProtocolVersion: version),
          protocolVersion: version
        )
      )
    }
    return catalogs
  }

  /// Checks a step's `expect`. `afterAction` holds the opened URLs and errors after a
  /// `dispatchAction`, the only time they are checked.
  private func check(
    _ rawExpect: Any?,
    processor: MessageProcessor,
    where location: String,
    afterAction: ([String], [RendererError])?
  ) throws {
    let expect = rawExpect as? [String: Any] ?? [:]
    try ConformanceTestHelper.assertKnownKeys(
      expect, Self.expectKeys, "\(location).expect", allowMetadata: false)
    for (componentID, rawProps) in expect["components"] as? [String: Any] ?? [:] {
      let node = try #require(
        processor.surfaceGroupModel.surfacesMap.values.lazy
          .compactMap { findNode(componentID, in: $0.rootNode) }.first,
        "\(location): no surface has component '\(componentID)'"
      )
      assertMatches(
        props(of: node),
        ConformanceTestHelper.toJSONValue(rawProps),
        "\(location).components.\(componentID)"
      )
    }
    guard let afterAction else {
      #expect(
        expect["openedUrls"] == nil && expect["errors"] == nil,
        "\(location): openedUrls and errors are only checked after dispatchAction"
      )
      return
    }
    let (openedURLs, errors) = afterAction
    let expectedURLs = expect["openedUrls"] as? [String] ?? []
    #expect(openedURLs == expectedURLs, "\(location).openedUrls")
    let expectedErrors = expect["errors"] as? [[String: Any]] ?? []
    #expect(
      errors.count == expectedErrors.count,
      "\(location).errors: \(errors.map { errorFields($0).code })"
    )
    for (index, expectedError) in expectedErrors.enumerated() where index < errors.count {
      try ConformanceTestHelper.assertKnownKeys(
        expectedError, Self.errorKeys, "\(location).errors[\(index)]", allowMetadata: false)
      let actual = errorFields(errors[index])
      if let code = expectedError["code"] as? String {
        #expect(actual.code == code, "\(location).errors[\(index)].code")
      }
      if let surfaceID = expectedError["surfaceId"] as? String {
        #expect(actual.surfaceID == surfaceID, "\(location).errors[\(index)].surfaceId")
      }
      if let pattern = expectedError["message"] as? String {
        #expect(
          actual.message.range(of: pattern, options: .regularExpression) != nil,
          "\(location).errors[\(index)].message"
        )
      }
    }
  }

  private func errorFields(
    _ error: RendererError
  ) -> (code: String, surfaceID: String?, message: String) {
    switch error {
    case .generic(let generic):
      return (generic.code, generic.surfaceID, generic.message)
    case .validationFailed(let validation):
      return (validation.code.rawValue, validation.surfaceID, validation.message)
    }
  }

  /// Finds the node of a component by its identifier, depth first.
  private func findNode(_ componentID: String, in root: Node?) -> Node? {
    guard let root else { return nil }
    if root.id == componentID { return root }
    for child in root.allChildNodes {
      if let found = findNode(componentID, in: child) { return found }
    }
    return nil
  }

  /// The resolved properties of a node as JSON.
  private func props(of node: Node) -> JSONValue {
    var object = OrderedDictionary<String, JSONValue>()
    for (key, value) in node.properties.sorted(by: { $0.key < $1.key }) {
      if let json = json(of: value) {
        object[key] = json
      }
    }
    return .object(object)
  }

  private func json(of value: any Resolved) -> JSONValue? {
    switch value {
    case let string as String:
      return .string(string)
    case let bool as Bool:
      return .boolean(bool)
    case let int as Int:
      return .integer(int)
    case let double as Double:
      return .number(double)
    case let json as JSONValue:
      return json
    case let binding as DataBinding<String>:
      return binding.value.map { .string($0) }
    case let binding as DataBinding<JSONValue>:
      return binding.value
    case let binding as DataBinding<Bool>:
      return binding.value.map { .boolean($0) }
    case let binding as DataBinding<Double>:
      return binding.value.map { .number($0) }
    case let binding as DataBinding<[String]>:
      return binding.value.map { .array($0.map { .string($0) }) }
    case let array as ResolvedArray:
      return .array(array.elements.map { json(of: $0) ?? .null })
    case let dictionary as ResolvedDictionary:
      var object = OrderedDictionary<String, JSONValue>()
      for (key, nested) in dictionary.storage.sorted(by: { $0.key < $1.key }) {
        if let json = json(of: nested) {
          object[key] = json
        }
      }
      return .object(object)
    case let node as Node:
      return .string(node.id)
    default:
      return nil
    }
  }

  /// Checks `actual` against `expected`: `null` matches an absent or null value at any depth,
  /// objects check only the keys `expected` names, and everything else compares as JSON.
  private func assertMatches(_ actual: JSONValue?, _ expected: JSONValue, _ location: String) {
    switch expected {
    case .null:
      #expect(
        actual == nil || actual == .null,
        "\(location): expected null, got \(String(describing: actual))"
      )
    case .array(let expectedItems):
      guard case .array(let actualItems) = actual else {
        Issue.record("\(location): expected an array, got \(String(describing: actual))")
        return
      }
      #expect(actualItems.count == expectedItems.count, "\(location): length")
      for (index, item) in expectedItems.enumerated() where index < actualItems.count {
        assertMatches(actualItems[index], item, "\(location)[\(index)]")
      }
    case .object(let expectedObject):
      guard case .object(let actualObject) = actual else {
        Issue.record("\(location): expected an object, got \(String(describing: actual))")
        return
      }
      for (key, value) in expectedObject {
        assertMatches(actualObject[key], value, "\(location).\(key)")
      }
    default:
      #expect(actual == expected, "\(location): got \(String(describing: actual))")
    }
  }
}
