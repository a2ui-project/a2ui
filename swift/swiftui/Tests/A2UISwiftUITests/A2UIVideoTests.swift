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

import A2UICore
import A2UISwiftUI
import BasicCatalog
import SwiftUI
import Testing

@testable import BasicCatalogSwiftUI

@MainActor
struct A2UIVideoTests {

  @Test func videoInitializesWithURL() {
    let node = Node(
      id: "vid1",
      type: "Video",
      properties: [
        "url": "https://example.com/movie.mp4"
      ]
    )

    let view = A2UIVideo(node: node)
    #expect(node.string(for: "url") == "https://example.com/movie.mp4")
    _ = view.body
  }

  @Test func videoInitializesWithoutURL() {
    let node = Node(
      id: "vid2",
      type: "Video",
      properties: [:]
    )

    let view = A2UIVideo(node: node)
    #expect(node.string(for: "url") == nil)
    _ = view.body
  }

  @Test func videoRendersFromCatalog() throws {
    let catalog = BasicCatalogImplementation.v091Catalog

    let node = Node(
      id: "vidCatalog",
      type: "Video",
      properties: [
        "url": "https://example.com/sample.mp4"
      ]
    )

    let rendered = Surface.render(node: node, using: [catalog.id: catalog])
    #expect(rendered != nil)
  }
}
