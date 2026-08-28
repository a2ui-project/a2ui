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
import BasicCatalogSwiftUI
import SwiftUI
import Testing

@MainActor
struct A2UIAudioPlayerTests {

  @Test func audioPlayerInitializesWithNode() {
    let node = Node(
      id: "audio1",
      type: "AudioPlayer",
      properties: [
        "url": "https://example.com/podcast.mp3",
        "description": "Episode 1: Introduction",
      ]
    )

    let view = A2UIAudioPlayer(node: node)
    #expect(node.string(for: "url") == "https://example.com/podcast.mp3")
    #expect(node.string(for: "description") == "Episode 1: Introduction")
    _ = view.body
  }

  @Test func audioPlayerInitializesWithoutURL() {
    let node = Node(
      id: "audio2",
      type: "AudioPlayer",
      properties: [
        "description": "Episode Without URL"
      ]
    )

    let view = A2UIAudioPlayer(node: node)
    _ = view.body
  }

  @Test func audioPlayerRendersFromBasicCatalogImplementation() throws {
    let catalog = BasicCatalogImplementation.v091Catalog

    let node = Node(
      id: "audioNode",
      type: "AudioPlayer",
      properties: [
        "url": "https://example.com/audio.mp3",
        "description": "Sample Track",
      ]
    )

    let rendered = Surface.render(node: node, using: [catalog.id: catalog])
    #expect(rendered != nil)
  }
}
