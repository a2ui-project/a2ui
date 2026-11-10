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

/// Isolates protocol syntax differences across A2UI specification versions.
///
/// Validates incoming wire messages for a specific protocol version and normalizes
/// them into version-neutral ``InternalOperation`` values.
public protocol VersionAdapter: Sendable {
  /// Protocol version handled by this adapter.
  var version: A2UIProtocolVersion { get }

  /// Action keys supported by this protocol version.
  var validActions: Set<String> { get }

  /// Canonical catalog protocol versions compatible with this adapter.
  var compatibleCatalogVersions: Set<String> { get }

  /// Evaluates whether a catalog's declared protocol version is compatible with this adapter.
  func isCatalogCompatible(_ catalogVersion: String?) -> Bool

  /// Validates a raw JSON payload and normalizes it into version-neutral operations.
  func extractOperations(from payload: JSONValue) throws -> [InternalOperation]

  /// Normalizes a decoded ``AgentToRendererMessage`` into version-neutral operations.
  func adaptMessage(_ message: AgentToRendererMessage) throws -> [InternalOperation]
}

/// Evaluates whether a catalog's declared protocol version is compatible with an expected
/// message or surface protocol version.
///
/// Follows the A2UI Core blueprint rules:
/// - Leading `"v"` / `"V"` prefixes and `"_"` separators are normalized.
/// - `"0.9"` and `"0.9.1"` are mutually compatible.
/// - For SemVer >= 1.0, releases within the same major version are compatible.
/// - An absent (`nil` or empty) catalog version is accepted for pre-v1.0 (`v0.9` / `v0.9.1`)
///   and rejected for `v1.0` and later.
public func isCatalogVersionCompatible(
  catalogVersion: String?,
  expectedVersion: String?
) -> Bool {
  guard let expectedVersion, !expectedVersion.isEmpty else {
    return false
  }
  let expectedCanonical = canonicalizeVersionString(expectedVersion)
  guard !expectedCanonical.isEmpty else {
    return false
  }

  guard let catalogVersion, !catalogVersion.isEmpty else {
    return expectedCanonical == "0.9" || expectedCanonical == "0.9.1"
  }

  let catalogCanonical = canonicalizeVersionString(catalogVersion)
  guard !catalogCanonical.isEmpty else {
    return false
  }

  if catalogCanonical == expectedCanonical {
    return true
  }

  if expectedCanonical == "0.9" || expectedCanonical == "0.9.1" {
    return catalogCanonical == "0.9" || catalogCanonical == "0.9.1"
  }

  if let catMajor = parseMajorVersion(catalogCanonical),
    let expMajor = parseMajorVersion(expectedCanonical),
    catMajor >= 1,
    catMajor == expMajor
  {
    return true
  }

  return false
}

internal func canonicalizeVersionString(_ raw: String) -> String {
  var cleaned = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  if cleaned.hasPrefix("v") || cleaned.hasPrefix("V") {
    cleaned = String(cleaned.dropFirst())
  }
  cleaned = cleaned.replacingOccurrences(of: "_", with: ".")
  if let dashIndex = cleaned.firstIndex(of: "-") {
    cleaned = String(cleaned[..<dashIndex])
  }
  if let plusIndex = cleaned.firstIndex(of: "+") {
    cleaned = String(cleaned[..<plusIndex])
  }
  let parts = cleaned.split(separator: ".").map(String.init)
  if parts.count == 3, parts[2] == "0" {
    return "\(parts[0]).\(parts[1])"
  }
  return cleaned
}

private func parseMajorVersion(_ canonical: String) -> Int? {
  let parts = canonical.split(separator: ".")
  guard parts.count >= 2,
    let major = Int(parts[0]),
    Int(parts[1]) != nil
  else {
    return nil
  }
  return major
}
