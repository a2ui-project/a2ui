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
  public static let video = ComponentImplementation(api: BasicCatalogComponents.video) {
    A2UIVideo(componentNode: $0)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Video` component.
public struct A2UIVideo: View {
  @ObservedObject private var componentNode: ComponentNode

  public init(componentNode: ComponentNode) {
    self.componentNode = componentNode
  }

  private var node: Node {
    componentNode.node
  }
  @State private var player: AVPlayer?
  @State private var isShowingPoster: Bool = true

  private var urlString: String {
    node.string(for: "url") ?? ""
  }

  /// The optional poster image URL string resolved from the `posterUrl` property.
  public var posterURLString: String? {
    node.string(for: "posterUrl")
  }

  public var body: some View {
    content.a2uiWeight(node)
  }

  @ViewBuilder private var content: some View {
    Group {
      if let player {
        ZStack {
          VideoPlayer(player: player)
            .frame(minHeight: 220)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

          if isShowingPoster,
            let posterStr = posterURLString,
            !posterStr.isEmpty,
            let posterURL = URL(string: posterStr)
          {
            Button {
              isShowingPoster = false
              player.play()
            } label: {
              ZStack {
                AsyncImage(url: posterURL) { phase in
                  switch phase {
                  case .success(let image):
                    image
                      .resizable()
                      .scaledToFill()
                  default:
                    Color.black.opacity(0.6)
                  }
                }
                Image(systemName: "play.circle.fill")
                  .font(.system(size: 48))
                  .foregroundStyle(.white)
                  .shadow(radius: 4)
              }
              .frame(maxWidth: .infinity, minHeight: 220)
              .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .buttonStyle(.plain)
          }
        }
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
      isShowingPoster = true
      updatePlayer()
    }
    .onChange(of: posterURLString) { _ in
      isShowingPoster = true
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
