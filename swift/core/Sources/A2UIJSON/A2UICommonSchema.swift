// Copyright 2026 Google LLC
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

import JSONSchema
import OrderedJSON

/// Namespace for A2UI common type schema URIs and schema registration.
///
/// This enum provides the base URI for all A2UI v0.9.1 common type schemas
/// and utilities for registering them into a ``JSONSchema.Context`` so that
/// `$ref` references to A2UI common types resolve correctly during validation.
public enum A2UICommonSchema {
  /// The base URI for all A2UI v0.9.1 common type schemas.
  public static let baseURI =
    "https://a2ui.org/schemas/v0_9_1/common.json"

  /// Returns the full URI for a named A2UI common type schema definition.
  ///
  /// - Parameter name: The name of the common type (e.g., `"DataBinding"`).
  /// - Returns: The full URI (e.g.,
  ///   `https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DataBinding`).
  public static func uri(for name: String) -> String {
    "\(baseURI)#/$defs/\(name)"
  }
}
