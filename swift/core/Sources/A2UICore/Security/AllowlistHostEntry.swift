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

/// One host entry of an ``AllowlistURLSecurityPolicy`` list: a host, a host with a port, or a
/// subdomain wildcard such as `*.example.com`.
struct AllowlistHostEntry: Equatable, Sendable {
  /// The host, normalized like ``HTTPAuthority/host``, without the `*.` of a wildcard.
  let host: String
  /// The port the entry is limited to, or `nil` for any port.
  let port: Int?
  /// Whether the entry matches subdomains of ``host`` at any depth, and not ``host`` itself.
  let isWildcard: Bool

  /// Parses an entry, or returns `nil` if it is not a bare host with an optional port or a `*.`
  /// wildcard. Entries must be ASCII; write internationalized hosts in punycode.
  init?(_ entry: String) {
    let isWildcard = entry.hasPrefix("*.")
    let hostEntry = isWildcard ? String(entry.dropFirst(2)) : entry
    guard !hostEntry.isEmpty,
      hostEntry.utf8.allSatisfy({ $0 > 0x20 && $0 < 0x7F }),
      !hostEntry.utf8.contains(where: { "/?#@*\\".utf8.contains($0) }),
      let authority = HTTPAuthority(hostEntry: hostEntry)
    else {
      return nil
    }
    self.host = authority.host
    self.port = authority.port
    self.isWildcard = isWildcard
  }

  /// Whether the entry matches the host and port of `authority`.
  func matches(_ authority: HTTPAuthority) -> Bool {
    let hostMatches = isWildcard ? authority.host.hasSuffix(".\(host)") : authority.host == host
    return hostMatches && (port == nil || port == authority.effectivePort)
  }
}
