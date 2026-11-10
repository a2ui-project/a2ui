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

/// The built-in checks that every URL passes before and after a ``URLSecurityPolicy``, whatever
/// the policy is.
///
/// The baseline blocks a URL that:
///
/// 1. Is empty.
/// 2. Contains an ASCII control character, a space, or a backslash anywhere. URL parsers drop or
///    trim some of these and read `\` as `/`, which can hide a scheme or a host.
/// 3. Uses `http:` or `https:` without `//` followed by a host, such as `https:evil.example` or
///    `https:///evil.example`.
/// 4. Starts with `//` (a protocol-relative URL).
///
/// What passes then depends on the context:
///
/// - ``URLContext/media``: `http(s)` URLs with a host, `data:` URLs with an `image/*`, `audio/*`,
///   or `video/*` media type (except `data:image/svg+xml` unless allowed), and relative URLs.
/// - ``URLContext/navigation``: `http(s)` URLs with a host, `mailto:`, `tel:`, and relative URLs.
/// - ``URLContext/iframe``: `http(s)` URLs with a host.
///
/// Every other scheme, such as `javascript:`, `file:`, or `blob:`, is blocked. An allowed URL is
/// returned exactly as written.
public enum URLBaseline {
  /// The scheme-level kind of a URL that passed the baseline checks.
  enum Kind: Equatable, Sendable {
    case http
    case relative
    case data
    case mailto
    case tel
  }

  /// Returns `url` if it passes the baseline checks for `context`, or `nil` if it does not.
  ///
  /// - Parameters:
  ///   - url: The URL to check.
  ///   - context: How the renderer uses the URL.
  ///   - allowSVGDataURLs: Whether `data:image/svg+xml` URLs are allowed as media.
  /// - Returns: `url` unchanged, or `nil` when the baseline blocks it.
  public static func check(
    _ url: String,
    context: URLContext,
    allowSVGDataURLs: Bool = false
  ) -> String? {
    classify(url, context: context, allowSVGDataURLs: allowSVGDataURLs) == nil ? nil : url
  }

  /// Returns the kind of `url`, or `nil` when the baseline blocks it in `context`.
  static func classify(_ url: String, context: URLContext, allowSVGDataURLs: Bool) -> Kind? {
    guard !url.isEmpty, !url.utf8.contains(where: isUnsafeByte) else { return nil }
    guard let scheme = scheme(of: url) else {
      if url.utf8.starts(with: "//".utf8) { return nil }
      return context == .iframe ? nil : .relative
    }
    switch scheme {
    case "http", "https":
      return HTTPAuthority(url) == nil ? nil : .http
    case "data":
      guard context == .media,
        let mediaType = dataMediaType(of: url),
        mediaType.isTerminated,
        ["image", "audio", "video"].contains(mediaType.type)
      else {
        return nil
      }
      if mediaType.type == "image", mediaType.subtype == "svg+xml", !allowSVGDataURLs {
        return nil
      }
      return .data
    case "mailto":
      return context == .navigation ? .mailto : nil
    case "tel":
      return context == .navigation ? .tel : nil
    default:
      return nil
    }
  }

  /// Returns a form of `url` that is safe to log: `scheme://host[:port]` for a URL with a host,
  /// `data:<media type>` for a `data:` URL, `relative` for a relative URL, and `<scheme>:`
  /// otherwise.
  ///
  /// The path, query, fragment, user info, and `data:` payload, any of which may carry
  /// exfiltrated data, are dropped.
  static func redact(_ url: String) -> String {
    guard let scheme = scheme(of: url) else { return "relative" }
    if scheme == "data" {
      guard let mediaType = dataMediaType(of: url) else { return "data:" }
      return "data:\(mediaType.type)/\(mediaType.subtype)"
    }
    if scheme == "http" || scheme == "https", !url.utf8.contains(where: isUnsafeByte),
      let authority = HTTPAuthority(url)
    {
      return authority.origin
    }
    return "\(scheme):"
  }

  /// Returns the lowercased scheme `url` starts with, or `nil` if it has none (a relative URL).
  ///
  /// A scheme is an ASCII letter followed by letters, digits, `+`, `-`, or `.`, and ends at the
  /// first `:`.
  static func scheme(of url: String) -> String? {
    var scheme: [UInt8] = []
    for byte in url.utf8 {
      if byte == UInt8(ascii: ":") {
        return scheme.isEmpty ? nil : String(decoding: scheme, as: UTF8.self).lowercased()
      }
      let isSchemeByte =
        scheme.isEmpty
        ? isASCIILetter(byte)
        : isASCIILetter(byte) || isASCIIDigit(byte) || byte == UInt8(ascii: "+")
          || byte == UInt8(ascii: "-") || byte == UInt8(ascii: ".")
      guard isSchemeByte else { return nil }
      scheme.append(byte)
    }
    return nil
  }

  /// The media type at the start of a `data:` URL.
  struct DataMediaType {
    /// The lowercased type, such as `image`.
    let type: String
    /// The lowercased subtype, such as `png`.
    let subtype: String
    /// Whether `;` or `,` follows the media type, as the baseline requires.
    let isTerminated: Bool
  }

  /// Returns the media type that follows `data:` in `url`, or `nil` if there is none.
  private static func dataMediaType(of url: String) -> DataMediaType? {
    var bytes = url.utf8.dropFirst("data:".utf8.count).makeIterator()
    var type: [UInt8] = []
    var subtype: [UInt8] = []
    var isInSubtype = false
    while let byte = bytes.next() {
      if !isInSubtype, byte == UInt8(ascii: "/"), !type.isEmpty {
        isInSubtype = true
        continue
      }
      guard isMediaTypeByte(byte) else {
        guard isInSubtype, !subtype.isEmpty else { return nil }
        return DataMediaType(
          type: String(decoding: type, as: UTF8.self).lowercased(),
          subtype: String(decoding: subtype, as: UTF8.self).lowercased(),
          isTerminated: byte == UInt8(ascii: ";") || byte == UInt8(ascii: ",")
        )
      }
      if isInSubtype {
        subtype.append(byte)
      } else {
        type.append(byte)
      }
    }
    guard isInSubtype, !subtype.isEmpty else { return nil }
    return DataMediaType(
      type: String(decoding: type, as: UTF8.self).lowercased(),
      subtype: String(decoding: subtype, as: UTF8.self).lowercased(),
      isTerminated: false
    )
  }

  /// Whether `byte` is a control character, a space, DEL, or a backslash.
  static func isUnsafeByte(_ byte: UInt8) -> Bool {
    byte <= 0x20 || byte == 0x7F || byte == UInt8(ascii: "\\")
  }

  private static func isMediaTypeByte(_ byte: UInt8) -> Bool {
    isASCIILetter(byte) || isASCIIDigit(byte) || "!#$&^_.+-".utf8.contains(byte)
  }

  private static func isASCIILetter(_ byte: UInt8) -> Bool {
    (UInt8(ascii: "a")...UInt8(ascii: "z")).contains(byte)
      || (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains(byte)
  }

  private static func isASCIIDigit(_ byte: UInt8) -> Bool {
    (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte)
  }
}
