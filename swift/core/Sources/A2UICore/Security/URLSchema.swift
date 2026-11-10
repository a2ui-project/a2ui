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

import A2UIJSON
import OrderedJSON

/// Helpers that mark catalog properties as URLs with the `x-a2ui-url-context` keyword.
///
/// The resolver passes every resolved value of a marked property through the surface's
/// ``URLSecurityPolicy`` before the component sees it, including values built from data
/// bindings or `formatString`. A blocked value resolves to `null`. Properties nested in objects
/// and lists can be marked too.
///
/// ```swift
/// let productCard = AnyComponentAPI(
///   name: "ProductCard",
///   schema: try Schema(
///     rawSchema: [
///       "type": "object",
///       "properties": [
///         "imageUrl": URLSchema.dynamicString(.media),
///         "productPageUrl": URLSchema.dynamicString(.navigation),
///       ],
///     ],
///     context: context
///   )
/// )
/// ```
public enum URLSchema {
  /// The JSON Schema keyword that marks a property as a URL: `x-a2ui-url-context`.
  public static let keyword = "x-a2ui-url-context"

  /// Returns a v1.0 `DynamicString` property schema marked with `annotation`.
  ///
  /// - Parameter annotation: How the renderer uses the URL, or ``URLContextAnnotation/notURL``
  ///   for a property whose name looks like a URL but whose value isn't one.
  public static func dynamicString(_ annotation: URLContextAnnotation) -> JSONValue {
    marking(.object(["$ref": .string(A2UICommonSchema.v10URI(for: "DynamicString"))]), annotation)
  }

  /// Returns a copy of a property schema marked with `annotation`.
  ///
  /// - Parameters:
  ///   - schema: The property schema, which must be a JSON object.
  ///   - annotation: How the renderer uses the URL.
  /// - Returns: The marked schema, or `schema` unchanged if it isn't an object.
  public static func marking(_ schema: JSONValue, _ annotation: URLContextAnnotation) -> JSONValue {
    guard var object = schema.objectValue else { return schema }
    object[keyword] = .string(annotation.rawValue)
    return .object(object)
  }

  /// Returns the annotation a property schema declares with `x-a2ui-url-context`, or `nil` when
  /// it declares none or an unknown value.
  public static func annotation(of schema: JSONValue) -> URLContextAnnotation? {
    schema.objectValue?[keyword]?.stringValue.flatMap(URLContextAnnotation.init(rawValue:))
  }
}
