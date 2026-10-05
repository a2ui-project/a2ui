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
import Foundation
import OrderedJSON
import Testing

@testable import BasicCatalog

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    return nil
  }
}

private final class MockOpenURLHandler: OpenURLHandler, @unchecked Sendable {
  var openedURL: URL?

  func open(_ url: URL) {
    self.openedURL = url
  }
}

@MainActor
struct OpenURLFunctionTests {

  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    let function = OpenURLFunction()
    #expect(function.api.name == "openUrl")
    #expect(function.api.returnType == .void)
    #expect(function.api.requiresUserActivation == false)
  }

  @Test func v10CatalogSetsRequiresUserActivationTrueOnOpenURL() throws {
    let v09OpenURL = try #require(BasicCatalog.makeCatalog(version: .v09).functions["openUrl"])
    #expect(v09OpenURL.api.requiresUserActivation == false)

    let v10OpenURL = try #require(BasicCatalog.makeCatalog(version: .v10).functions["openUrl"])
    #expect(v10OpenURL.api.requiresUserActivation == true)
  }

  @Test func v10CatalogComponentSchemasMatchV10Specification() throws {
    let v09 = BasicCatalog.makeCatalog(version: .v09)
    let v10 = BasicCatalog.makeCatalog(version: .v10)

    // 1. Slider: v1.0 supports `steps` (integer >= 1) and `catalogId`/`metadata`
    let v10Slider = try #require(v10.components["Slider"])
    let validSlider: OrderedJSON.JSONValue = [
      "id": "s1",
      "component": "Slider",
      "value": ["@path": "/val"],
      "min": 0,
      "max": 100,
      "steps": 10,
      "catalogId": "custom",
    ]
    #expect(v10Slider.schema.validate(validSlider).isValid)

    let invalidSliderSteps: OrderedJSON.JSONValue = [
      "id": "s1",
      "component": "Slider",
      "value": ["@path": "/val"],
      "min": 0,
      "max": 100,
      "steps": 0,
    ]
    #expect(!v10Slider.schema.validate(invalidSliderSteps).isValid)

    let v09Slider = try #require(v09.components["Slider"])
    #expect(!v09Slider.schema.validate(validSlider).isValid)

    // 2. TextField: v1.0 adds `placeholder` and removes `validationRegexp`
    let v10TextField = try #require(v10.components["TextField"])
    let validTextField: OrderedJSON.JSONValue = [
      "id": "tf1",
      "component": "TextField",
      "label": "Name",
      "placeholder": "Jane Doe",
    ]
    #expect(v10TextField.schema.validate(validTextField).isValid)

    let legacyRegexTextField: OrderedJSON.JSONValue = [
      "id": "tf1",
      "component": "TextField",
      "label": "Name",
      "validationRegexp": ".*",
    ]
    #expect(!v10TextField.schema.validate(legacyRegexTextField).isValid)

    // 3. Icon: v1.0 allows DynamicString (e.g. DataBinding) for `svgPath`, while v0.9 requires literal string
    let v09Icon = try #require(v09.components["Icon"])
    let v10Icon = try #require(v10.components["Icon"])
    let dynamicSvgIcon: OrderedJSON.JSONValue = [
      "id": "ic1",
      "component": "Icon",
      "name": ["svgPath": ["@path": "/icons/home"]],
    ]
    #expect(!v09Icon.schema.validate(dynamicSvgIcon).isValid)
    #expect(v10Icon.schema.validate(dynamicSvgIcon).isValid)

    // 4. Video: v1.0 supports `posterUrl`, while v0.9 rejects it
    let v09Video = try #require(v09.components["Video"])
    let v10Video = try #require(v10.components["Video"])
    let videoWithPoster: OrderedJSON.JSONValue = [
      "id": "v1",
      "component": "Video",
      "url": "https://example.com/video.mp4",
      "posterUrl": "https://example.com/poster.jpg",
    ]
    #expect(!v09Video.schema.validate(videoWithPoster).isValid)
    #expect(v10Video.schema.validate(videoWithPoster).isValid)
  }

  // MARK: - Evaluation

  @Test func opensValidHTTPSURL() throws {
    let handler = MockOpenURLHandler()
    let function = OpenURLFunction(handler: handler)

    let result = try function.evaluate(
      arguments: ["url": .string("https://example.com/foo?bar=baz")],
      context: context
    )

    #expect(result == .null)
    #expect(handler.openedURL?.absoluteString == "https://example.com/foo?bar=baz")
  }

  @Test func opensValidHTTPURL() throws {
    let handler = MockOpenURLHandler()
    let function = OpenURLFunction(handler: handler)

    _ = try function.evaluate(
      arguments: ["url": .string("http://insecure.com")],
      context: context
    )

    #expect(handler.openedURL?.absoluteString == "http://insecure.com")
  }

  @Test func resolvesRelativeURLWhenBaseURLIsProvided() throws {
    let handler = MockOpenURLHandler()
    let baseURL = try #require(URL(string: "https://google.com/search"))
    let function = OpenURLFunction(handler: handler, baseURL: baseURL)

    _ = try function.evaluate(
      arguments: ["url": .string("?q=swift")],
      context: context
    )

    #expect(handler.openedURL?.absoluteString == "https://google.com/search?q=swift")
  }

  @Test func throwsErrorWhenMissingURLArgument() {
    let function = OpenURLFunction()

    #expect(throws: FunctionError.self) {
      try function.evaluate(arguments: [:], context: context)
    }
  }

  // MARK: - Security Constraints

  @Test func throwsErrorWhenUsingJavascriptScheme() {
    let function = OpenURLFunction()

    #expect(throws: FunctionError.self) {
      try function.evaluate(
        arguments: ["url": .string("javascript:alert('xss')")],
        context: context
      )
    }
  }

  @Test func throwsErrorWhenUsingDataScheme() {
    let function = OpenURLFunction()

    #expect(throws: FunctionError.self) {
      try function.evaluate(
        arguments: ["url": .string("data:text/html,<h1>hello</h1>")],
        context: context
      )
    }
  }

  @Test func throwsErrorWhenRelativeURLHasNoSchemeAndNoBaseURL() {
    let function = OpenURLFunction()

    #expect(throws: FunctionError.self) {
      try function.evaluate(
        arguments: ["url": .string("/some/path")],
        context: context
      )
    }
  }
}
