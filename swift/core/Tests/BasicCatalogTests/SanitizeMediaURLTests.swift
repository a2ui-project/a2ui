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

import BasicCatalog
import Foundation
import Testing

struct SanitizeMediaURLTests {

  @Test(
    arguments: [
      ("https://example.com/image.png", "https://example.com/image.png"),
      ("  http://example.com/video.mp4  ", "http://example.com/video.mp4"),
      ("HTTPS://example.com/image.png", "HTTPS://example.com/image.png"),
      ("data:image/png;base64,AAAA", "data:image/png;base64,AAAA"),
      ("/assets/logo.png", "/assets/logo.png"),
      ("assets/logo.png", "assets/logo.png"),
      ("./logo.png", "./logo.png"),
      ("../logo.png", "../logo.png"),
    ])
  func allowsHTTPDataAndRelativeURLs(input: String, expected: String) throws {
    let url = try #require(BasicCatalog.sanitizeMediaURL(input))
    #expect(url.absoluteString == expected)
  }

  @Test(
    arguments: [
      nil,
      "",
      "   ",
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.com/123",
      "ftp://example.com/a.png",
      "https://",
    ])
  func rejectsEmptyAndDisallowedSchemes(input: String?) {
    #expect(BasicCatalog.sanitizeMediaURL(input) == nil)
  }

  @Test(
    arguments: [
      "//evil.example.com/a.png",
      "\\\\evil.example.com\\a.png",
      "/\\evil.example.com/a.png",
      "/\t/evil.example.com/a.png",
      "/\n/evil.example.com/a.png",
      "http:evil.example.com/a.png",
      "https:evil.example.com/a.png",
      "https\t:evil.example.com/a.png",
      "ht\ttps://evil.example.com/a.png",
    ])
  func rejectsProtocolRelativeAndSchemefulRelativeBypassURLs(input: String) {
    #expect(BasicCatalog.sanitizeMediaURL(input) == nil)
  }
}
