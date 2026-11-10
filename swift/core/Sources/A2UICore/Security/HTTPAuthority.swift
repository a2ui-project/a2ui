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

/// The scheme, host, and port of an `http(s)` URL written as `scheme://authority`.
///
/// The host is compared the way browsers compare it: ASCII letters in lower case and without a
/// trailing dot. User info before the last `@` is dropped, as browsers drop it. In a URL, a port
/// equal to the scheme's default port is treated as absent.
struct HTTPAuthority: Equatable, Sendable {
  /// `http` or `https`.
  let scheme: String
  /// The host, such as `cdn.example.com` or `[::1]`.
  let host: String
  /// The port written in the URL, or `nil` when absent (or, in a URL, equal to the default
  /// port).
  let port: Int?

  /// The port the URL connects to.
  var effectivePort: Int {
    port ?? (scheme == "http" ? 80 : 443)
  }

  /// `scheme://host[:port]`, which carries none of the path, query, or user info.
  var origin: String {
    port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
  }

  /// Parses an `http(s)` URL, or returns `nil` if `url` isn't one with a valid host.
  ///
  /// - Parameters:
  ///   - url: The URL to parse.
  ///   - keepsDefaultPort: Whether a port equal to the default port stays in ``port``.
  init?(_ url: String, keepsDefaultPort: Bool = false) {
    guard let scheme = URLBaseline.scheme(of: url), scheme == "http" || scheme == "https" else {
      return nil
    }
    let rest = url.utf8.dropFirst(scheme.utf8.count + 1)
    guard rest.starts(with: "//".utf8) else { return nil }
    let afterSlashes = rest.dropFirst(2)
    let authority = afterSlashes.prefix { !Self.authorityTerminators.contains($0) }
    guard !authority.isEmpty else { return nil }
    // User info ends at the last `@`; browsers drop it.
    let hostAndPort =
      authority.lastIndex(of: UInt8(ascii: "@")).map { authority[authority.index(after: $0)...] }
      ?? authority
    let defaultPort: Int? = keepsDefaultPort ? nil : (scheme == "http" ? 80 : 443)
    guard let parsed = Self.parseHostAndPort(Array(hostAndPort), defaultPort: defaultPort) else {
      return nil
    }
    self.scheme = scheme
    self.host = parsed.host
    self.port = parsed.port
  }

  /// Parses a bare `host[:port]` entry, such as an allowlist entry, as if it followed
  /// `https://`. A port written in the entry stays, even the default one.
  init?(hostEntry: String) {
    self.init("https://\(hostEntry)", keepsDefaultPort: true)
  }

  private static let authorityTerminators: Set<UInt8> = [
    UInt8(ascii: "/"), UInt8(ascii: "?"), UInt8(ascii: "#"),
  ]

  private static let forbiddenHostBytes: Set<UInt8> = Set(" #/:<>?@[\\]^|".utf8)

  private static func parseHostAndPort(
    _ bytes: [UInt8],
    defaultPort: Int?
  ) -> (host: String, port: Int?)? {
    var hostBytes: ArraySlice<UInt8>
    var portBytes: ArraySlice<UInt8>?
    if bytes.first == UInt8(ascii: "[") {
      guard let close = bytes.firstIndex(of: UInt8(ascii: "]")) else { return nil }
      hostBytes = bytes[...close]
      let inner = bytes[1..<close]
      guard !inner.isEmpty, inner.allSatisfy(isIPv6Byte) else { return nil }
      let afterHost = bytes[(close + 1)...]
      if !afterHost.isEmpty {
        guard afterHost.first == UInt8(ascii: ":") else { return nil }
        portBytes = afterHost.dropFirst()
      }
    } else {
      if let colon = bytes.lastIndex(of: UInt8(ascii: ":")) {
        hostBytes = bytes[..<colon]
        portBytes = bytes[(colon + 1)...]
      } else {
        hostBytes = bytes[...]
      }
      if hostBytes.last == UInt8(ascii: ".") {
        hostBytes = hostBytes.dropLast()
      }
      guard !hostBytes.isEmpty,
        !hostBytes.contains(where: { $0 < 0x20 || $0 == 0x7F || forbiddenHostBytes.contains($0) })
      else {
        return nil
      }
    }
    var port: Int?
    if let portBytes, !portBytes.isEmpty {
      guard portBytes.allSatisfy({ (UInt8(ascii: "0")...UInt8(ascii: "9")).contains($0) }) else {
        return nil
      }
      // Leading zeros are allowed in any number, as in the WHATWG URL parser. Dropping them is
      // a single pass over the slice, and the digit cap below keeps the value from overflowing.
      let significant = portBytes.drop { $0 == UInt8(ascii: "0") }
      guard significant.count <= 5 else { return nil }
      let value = significant.reduce(0) { $0 * 10 + Int($1 - UInt8(ascii: "0")) }
      guard value <= 65535 else { return nil }
      port = value == defaultPort ? nil : value
    }
    let host = String(decoding: hostBytes.map(lowercasedASCII), as: UTF8.self)
    return (host: host, port: port)
  }

  private static func isIPv6Byte(_ byte: UInt8) -> Bool {
    (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte)
      || (UInt8(ascii: "a")...UInt8(ascii: "f")).contains(byte)
      || (UInt8(ascii: "A")...UInt8(ascii: "F")).contains(byte)
      || byte == UInt8(ascii: ":") || byte == UInt8(ascii: ".")
  }

  private static func lowercasedASCII(_ byte: UInt8) -> UInt8 {
    (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains(byte) ? byte + 32 : byte
  }
}
