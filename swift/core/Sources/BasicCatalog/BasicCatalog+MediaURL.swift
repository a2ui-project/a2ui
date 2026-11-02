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
    // so check the scheme and the leading slashes with those dropped. The scan is lazy and stops
    // at the first character that decides it, because this runs on every render and an inline
    // `data:` URL can be megabytes long.
    let scalars = trimmed.unicodeScalars.lazy.filter { $0 != "\t" && $0 != "\n" && $0 != "\r" }

    guard let url = URL(string: trimmed) else {
      return nil
    }

    guard let scheme = mediaURLScheme(of: scalars) else {
      // A relative path must not reach another host.
      guard !hasDoubleSlashPrefix(scalars), url.scheme == nil, url.host == nil else {
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
      let prefix = trimmed.prefix(8).lowercased()
      guard prefix.hasPrefix("http://") || prefix.hasPrefix("https://"),
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

  /// Returns the lowercased scheme that `scalars` start with, or `nil` if they have none (a
  /// relative URL). Stops at the first `:` or at the first character a scheme can't contain.
  private static func mediaURLScheme<S: Sequence>(of scalars: S) -> String?
  where S.Element == Unicode.Scalar {
    var candidate = String.UnicodeScalarView()
    for scalar in scalars {
      if scalar == ":" {
        return candidate.isEmpty ? nil : String(candidate).lowercased()
      }
      let isSchemeCharacter =
        candidate.isEmpty
        ? isASCIILetter(scalar)
        : isASCIILetter(scalar) || ("0"..."9").contains(scalar) || scalar == "+"
          || scalar == "-" || scalar == "."
      guard isSchemeCharacter else {
        return nil
      }
      candidate.append(scalar)
    }
    return nil
  }

  /// Returns whether `scalars` start with two slashes, reading `\` as `/` the way browsers do.
  private static func hasDoubleSlashPrefix<S: Sequence>(_ scalars: S) -> Bool
  where S.Element == Unicode.Scalar {
    var iterator = scalars.makeIterator()
    for _ in 0..<2 {
      guard let scalar = iterator.next(), scalar == "/" || scalar == "\\" else {
        return false
      }
    }
    return true
  }

  private static func isASCIILetter(_ scalar: Unicode.Scalar) -> Bool {
    ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar)
  }
}
