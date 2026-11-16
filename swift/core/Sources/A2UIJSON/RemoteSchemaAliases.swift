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

import Foundation
import OrderedJSON

/// Gives each schema document registered under an alias URL an `$id` equal to that alias.
///
/// swift-json-schema caches a remote document under its `$id`, but looks the cache up by the
/// URL a `$ref` names. A document registered under an alias, such as the v1.0 common types
/// reached as `common_types.json` from a catalog without an `$id`, would otherwise be built
/// again for every `$ref` through the alias. The relative `$ref`s of each copy are resolved
/// against the document's own `$id` first, so they keep pointing where they did.
package enum RemoteSchemaAliases {
  /// Returns `schemas` with each document under an absolute key other than its `$id` replaced
  /// by a copy identified by that key.
  package static func identifyingAliases(in schemas: [String: JSONValue]) -> [String: JSONValue] {
    var result = schemas
    for (key, document) in schemas {
      guard case .object(var object) = document,
        let identifier = object["$id"]?.string, identifier != key,
        let identifierURL = URL(string: identifier), identifierURL.scheme != nil,
        URL(string: key)?.scheme != nil
      else {
        continue
      }
      object["$id"] = .string(key)
      result[key] = resolvingRelativeRefs(in: .object(object), against: identifierURL)
    }
    return result
  }

  private static let instanceDataKeywords: Set<String> = ["const", "default", "enum", "examples"]
  private static let subschemaMapKeywords: Set<String> = [
    "$defs", "definitions", "dependentSchemas", "patternProperties", "properties",
  ]

  /// Rewrites every `$ref` and `$dynamicRef` that names another document as an absolute URL. A
  /// reference that holds only a fragment points into the same document, so it is left as it is.
  /// Keywords whose values are instance data rather than subschemas are not walked.
  private static func resolvingRelativeRefs(in value: JSONValue, against base: URL) -> JSONValue {
    switch value {
    case .object(let object):
      var resolved = object
      for (key, child) in object {
        if key == "$ref" || key == "$dynamicRef",
          let ref = child.string, !ref.hasPrefix("#"),
          let absolute = URL(string: ref, relativeTo: base)?.absoluteString
        {
          resolved[key] = .string(absolute)
        } else if subschemaMapKeywords.contains(key), case .object(let entries) = child {
          resolved[key] = .object(
            entries.mapValues { resolvingRelativeRefs(in: $0, against: base) }
          )
        } else if !instanceDataKeywords.contains(key) {
          resolved[key] = resolvingRelativeRefs(in: child, against: base)
        }
      }
      return .object(resolved)
    case .array(let items):
      return .array(items.map { resolvingRelativeRefs(in: $0, against: base) })
    default:
      return value
    }
  }
}
