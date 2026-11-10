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
import JSONSchema

/// A protocol for handling URLs opened by the `openUrl` function.
public protocol OpenURLHandler: AnyObject, Sendable {
  /// Opens the specified URL.
  func open(_ url: URL)
}

/// Opens a URL using a registered handler, once the surface's URL security policy allows it.
///
/// The URL is checked as ``URLContext/navigation`` against the policy of the surface the
/// function runs on (see ``DataContext/sanitizeURL(_:context:info:)``). The baseline allows only
/// `http(s)` URLs with a host, `mailto:`, `tel:`, and relative URLs, so `javascript:` and `data:`
/// URLs never open. A blocked URL fails with ``URLBlockedError`` (reported as `URL_BLOCKED`) and
/// never reaches the handler. The handler only sees allowed URLs, possibly rewritten by the
/// policy and resolved against `baseURL`; it is the place for presentation, such as a
/// confirmation, not for security decisions.
///
/// The handler is held weakly, so the function never keeps it alive. Keep a strong reference to it
/// outside the catalog, for example in the view model that owns the `MessageProcessor`, or the
/// function only validates the URL and opens nothing.
public final class OpenURLFunction: FunctionImplementation, @unchecked Sendable {
  public let api: FunctionAPI
  /// The handler that opens the URL on the host platform, held weakly.
  public weak var handler: (any OpenURLHandler)?
  public let baseURL: URL?

  /// Initializes a new openUrl function.
  ///
  /// - Parameters:
  ///   - handler: An optional handler that opens the URL on the host platform. It is held weakly,
  ///     so the caller must keep it alive.
  ///   - baseURL: An optional base URL to resolve relative URLs against.
  ///   - requiresUserActivation: Whether this function requires user activation (true in v1.0).
  public init(
    handler: (any OpenURLHandler)? = nil,
    baseURL: URL? = nil,
    requiresUserActivation: Bool = false
  ) {
    self.handler = handler
    self.baseURL = baseURL
    self.api = FunctionAPI(
      name: "openUrl",
      returnType: .void,
      schema: try! Schema(
        instance: """
          {
            "type": "object",
            "properties": {
              "url": { "type": "string" }
            },
            "required": ["url"]
          }
          """
      ),
      requiresUserActivation: requiresUserActivation
    )
  }

  /// Evaluates the openUrl function by checking the URL against the URL security policy and
  /// passing the allowed URL to the handler.
  ///
  /// - Parameters:
  ///   - arguments: The dictionary of arguments provided to the function.
  ///   - context: The current data context, which supplies the surface's URL security policy.
  /// - Returns: `JSONValue.null`, since this function is executed purely for its side effects.
  /// - Throws: ``URLBlockedError`` if the policy blocks the URL, or `FunctionError` if the
  ///   argument is missing or the URL can't be resolved to an absolute URL.
  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let urlString = arguments["url"]?.stringValue else {
      throw FunctionError.missingArgument("url")
    }

    let info = URLCheckInfo(functionName: api.name)
    guard let allowed = context.sanitizeURL(urlString, context: .navigation, info: info) else {
      throw URLBlockedError(
        "The URL security policy blocked the URL passed to openUrl.",
        functionName: api.name
      )
    }

    guard let url = URL(string: allowed, relativeTo: baseURL) else {
      throw FunctionError.invalidArgumentType(
        expected: "valid URL string", actual: "invalid format")
    }

    // A relative URL needs a base URL to open.
    let resolvedURL = url.absoluteURL
    guard resolvedURL.scheme != nil else {
      throw FunctionError.invalidArgumentType(
        expected: "absolute URL, or a relative URL with a base URL", actual: "relative URL")
    }

    handler?.open(resolvedURL)

    return .null
  }
}
