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

/// Opens a URL using a registered handler, ensuring it has an `http` or `https` scheme.
public final class OpenURLFunction: FunctionImplementation, @unchecked Sendable {
  public let api = FunctionAPI(
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
    )
  )

  public weak var handler: (any OpenURLHandler)?
  public let baseURL: URL?

  /// Initializes a new openUrl function.
  ///
  /// - Parameters:
  ///   - handler: An optional weak reference to a handler that actually opens the URL on the host platform.
  ///   - baseURL: An optional base URL to resolve relative URLs against.
  public init(handler: (any OpenURLHandler)? = nil, baseURL: URL? = nil) {
    self.handler = handler
    self.baseURL = baseURL
  }

  /// Evaluates the openUrl function by resolving the URL and invoking the handler.
  ///
  /// The resolved URL is checked against a strict allowlist of schemes (`http` and `https`)
  /// to prevent security issues such as XSS via `javascript:` or `data:`.
  ///
  /// - Parameters:
  ///   - arguments: The dictionary of arguments provided to the function.
  ///   - context: The current data context.
  /// - Returns: `JSONValue.null`, since this function is executed purely for its side effects.
  /// - Throws: `FunctionError.securityConstraintViolation` if the scheme is not allowed.
  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let urlString = arguments["url"]?.stringValue else {
      throw FunctionError.missingArgument("url")
    }

    guard let url = URL(string: urlString, relativeTo: baseURL) else {
      throw FunctionError.invalidArgumentType(
        expected: "valid URL string", actual: "invalid format")
    }

    // Resolve relative paths
    let resolvedURL = url.absoluteURL

    // Enforce scheme allowlist (prevent javascript:, data:, etc.)
    let scheme = resolvedURL.scheme?.lowercased()
    guard scheme == "https" || scheme == "http" else {
      throw FunctionError.securityConstraintViolation(
        "URL scheme must be http or https. Found: \(scheme ?? "none")")
    }

    // Delegate to the handler
    handler?.open(resolvedURL)

    return .null
  }
}
