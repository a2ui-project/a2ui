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
import AVKit
import BasicCatalog
import OrderedJSON
import SwiftUI

// MARK: - Component Implementation

@MainActor
extension BasicCatalogImplementation {
  public static let video = ComponentImplementation(api: BasicCatalogComponents.video) { node in
    A2UIVideo(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Video` component.
public struct A2UIVideo: View {
  public let node: Node
  @State private var player: AVPlayer?

  public init(node: Node) {
    self.node = node
  }

  private var urlString: String {
    node.string(for: "url") ?? ""
  }

  public var body: some View {
    Group {
      if let player {
        VideoPlayer(player: player)
          .frame(minHeight: 220)
          .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      } else {
        VStack(spacing: 8) {
          Image(systemName: "video.slash")
            .font(.largeTitle)
            .foregroundStyle(.secondary)
          Text("No video URL provided")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .background(Color.gray.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      }
    }
    .onAppear {
      updatePlayer()
    }
    .onChange(of: urlString) { _ in
      updatePlayer()
    }
    .onDisappear {
      player?.pause()
      player = nil
    }
  }

  private func updatePlayer() {
    guard let url = URL(string: urlString), !urlString.isEmpty else {
      player?.pause()
      player = nil
      return
    }
    if let currentItem = player?.currentItem,
      let asset = currentItem.asset as? AVURLAsset,
      asset.url == url
    {
      return
    }
    player?.pause()
    player = AVPlayer(url: url)
  }
}
