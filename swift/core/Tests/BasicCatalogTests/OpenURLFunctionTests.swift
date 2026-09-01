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
import Testing

@testable import BasicCatalog

private final class MockFunctionHandler: FunctionHandler, @unchecked Sendable {
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

struct OpenURLFunctionTests {

  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    let function = OpenURLFunction()
    #expect(function.api.name == "openUrl")
    #expect(function.api.returnType == .void)
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
