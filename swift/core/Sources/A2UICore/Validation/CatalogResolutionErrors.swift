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

/// Builds the errors raised while resolving the catalog of a v1.0 component or function call,
/// so that the message processor, payload validator, and node resolver report them alike.
///
/// Detail paths use the dotted style of the other validation errors: `catalogId` for a
/// component's own `catalogId`, and `functions.<name>.catalogId` for a function call's.
enum CatalogResolutionErrors {
  /// The detail code of a catalog that can't be resolved while evaluating an expression.
  static let runtimeCatalogErrorCode = "CATALOG_ERROR"

  /// The detail path of a component's `catalogId`.
  static let componentCatalogIDPath = "catalogId"

  /// The detail path of a function call's `catalogId`.
  static func callCatalogIDPath(functionName: String) -> String {
    "functions.\(functionName).catalogId"
  }

  /// A `catalogId` that is present but not a string.
  static func nonStringCatalogID(path: String) -> A2UIValidationError {
    let msg = "Field 'catalogId' must be a string"
    return A2UIValidationError(
      msg,
      details: [A2UIErrorDetail(path: path, code: "type_mismatch", message: msg)]
    )
  }

  /// Function call `args` that are present but not an object.
  static func nonObjectArguments(functionName: String) -> A2UIValidationError {
    let msg = "Function arguments for '\(functionName)' must be an object"
    return A2UIValidationError(
      msg,
      details: [
        A2UIErrorDetail(path: "functions.\(functionName).args", code: "type_mismatch", message: msg)
      ]
    )
  }

  /// A named catalog that is not available on the surface.
  static func catalogNotFound(
    _ catalogID: String,
    path: String,
    code: String = "CATALOG_NOT_FOUND"
  ) -> A2UICatalogError {
    let msg = "Catalog not found: \(catalogID)"
    return A2UICatalogError(msg, details: [A2UIErrorDetail(path: path, code: code, message: msg)])
  }

  /// An item that names no catalog on a surface without a default catalog.
  ///
  /// - Parameter subject: Describes the item, e.g. `Component 'root'`.
  static func noDefaultCatalog(
    subject: String,
    surfaceID: String,
    path: String,
    code: String = "CATALOG_NOT_FOUND"
  ) -> A2UICatalogError {
    let msg = "\(subject) names no catalogId and surface '\(surfaceID)' has no default catalogId."
    return A2UICatalogError(msg, details: [A2UIErrorDetail(path: path, code: code, message: msg)])
  }

  /// A catalog whose protocol version doesn't match the surface's.
  static func incompatibleCatalog(
    _ catalogID: String,
    catalog: AnyCatalog,
    surfaceVersion: A2UIProtocolVersion,
    path: String
  ) -> A2UICatalogError {
    let catalogVersion = catalog.protocolVersion ?? "v0.9"
    let msg =
      "Catalog '\(catalogID)' (version \(catalogVersion)) is incompatible with "
      + "surface version \(surfaceVersion.rawValue)."
    return A2UICatalogError(
      msg,
      details: [A2UIErrorDetail(path: path, code: "INCOMPATIBLE_CATALOG_VERSION", message: msg)]
    )
  }
}
