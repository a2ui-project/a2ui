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

extension BasicCatalog {
  private static let mediaURLTrimmingSet = CharacterSet.whitespacesAndNewlines.union(
    .controlCharacters)

  /// Validates a media URL from an `Image`, `Video` or `AudioPlayer` component.
  ///
  /// Only `http:`, `https:` and `data:` URLs and genuine relative paths are accepted, matching
  /// `sanitizeMediaUrl` in `@a2ui/web_core`. Anything else (`javascript:`, `file:`, `blob:`,
  /// protocol-relative `//host` and look-alike forms such as `/\host` or `https:host`) is
  /// rejected.
  ///
  /// - Parameter urlString: The URL string supplied by the agent.
  /// - Returns: The URL parsed from the trimmed string, or `nil` if it is empty, malformed or not
  ///   allowed.
  public static func sanitizeMediaURL(_ urlString: String?) -> URL? {
    guard
      let trimmed = urlString?.trimmingCharacters(in: mediaURLTrimmingSet),
      !trimmed.isEmpty
    else {
      return nil
    }

    // URL parsers in browsers drop tabs and newlines anywhere in the string and read `\` as `/`,
    // so check the scheme and the leading slashes on that normalized form.
    let normalized = String(
      trimmed.unicodeScalars
        .filter { $0 != "\t" && $0 != "\n" && $0 != "\r" }
        .map { $0 == "\\" ? "/" : Character($0) })

    guard let url = URL(string: trimmed) else {
      return nil
    }

    guard let scheme = mediaURLScheme(of: normalized) else {
      // A relative path must not reach another host.
      guard !normalized.hasPrefix("//"), url.scheme == nil, url.host == nil else {
        return nil
      }
      return url
    }

    switch scheme {
    case "data":
      return url.scheme?.lowercased() == "data" ? url : nil
    case "http", "https":
      // Require the `scheme://` form as written, so `https:host` and `ht\ttps://host` are
      // rejected the same way the web renderers reject them.
      let lowered = trimmed.lowercased()
      guard lowered.hasPrefix("http://") || lowered.hasPrefix("https://"),
        url.scheme?.lowercased() == scheme,
        let host = url.host, !host.isEmpty
      else {
        return nil
      }
      return url
    default:
      return nil
    }
  }

  /// Returns the lowercased scheme of `urlString`, or `nil` if it has none (a relative URL).
  private static func mediaURLScheme(of urlString: String) -> String? {
    guard let colon = urlString.firstIndex(of: ":") else {
      return nil
    }
    let candidate = urlString[..<colon]
    guard let first = candidate.unicodeScalars.first, isASCIILetter(first),
      candidate.unicodeScalars.allSatisfy({
        isASCIILetter($0) || ("0"..."9").contains($0) || $0 == "+" || $0 == "-" || $0 == "."
      })
    else {
      return nil
    }
    return candidate.lowercased()
  }

  private static func isASCIILetter(_ scalar: Unicode.Scalar) -> Bool {
    ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar)
  }
}
