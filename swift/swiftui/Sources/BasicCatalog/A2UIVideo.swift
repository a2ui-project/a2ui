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
  @State private var model: A2UIVideoPlayerModel
  @State private var isShowingPoster: Bool = true

  public init(
    node: Node,
    model: A2UIVideoPlayerModel = A2UIVideoPlayerModel()
  ) {
    self.node = node
    self._model = State(initialValue: model)
  }

  private var urlString: String {
    node.string(for: "url") ?? ""
  }

  private var resolvedURL: URL? {
    BasicCatalog.sanitizeMediaURL(urlString)
  }

  /// The optional poster image URL string resolved from the `posterUrl` property.
  public var posterURLString: String? {
    node.string(for: "posterUrl")
  }

  /// Whether `_AVKit_SwiftUI.VideoPlayer` (`AVPlayerView`) can be safely hosted in the current
  /// process. On macOS, realizing `VideoPlayer` inside a headless `swiftpm-testing-helper` or
  /// `xctest` runner aborts in the Swift runtime metadata demangler for `So12AVPlayerViewC`.
  private static let canHostSystemVideoPlayer: Bool = {
    #if os(macOS)
      let processInfo = ProcessInfo.processInfo
      if processInfo.environment["XCTestConfigurationFilePath"] != nil
        || processInfo.environment["XCTestBundlePath"] != nil
        || processInfo.processName.contains("xctest")
        || processInfo.processName.contains("testing-helper")
        || NSClassFromString("AVPlayerView") == nil
      {
        return false
      }
    #endif
    return true
  }()

  public var body: some View {
    Group {
      if let player = model.player {
        ZStack {
          if Self.canHostSystemVideoPlayer {
            VideoPlayer(player: player)
              .frame(minHeight: 220)
              .clipShape(.rect(cornerRadius: 8))
          } else {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .fill(Color.black.opacity(0.85))
              .frame(minHeight: 220)
          }

          if isShowingPoster,
            let posterURL = BasicCatalog.sanitizeMediaURL(posterURLString)
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
              .clipShape(.rect(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Play video")
          }
        }
      } else {
        ContentUnavailableView("No video URL provided", systemImage: "video.slash")
          .frame(maxWidth: .infinity, minHeight: 200)
          .background(Color.gray.opacity(0.12))
          .clipShape(.rect(cornerRadius: 8))
      }
    }
    .onAppear {
      model.load(url: resolvedURL)
    }
    .onChange(of: urlString) {
      isShowingPoster = true
      model.load(url: resolvedURL)
    }
    .onDisappear {
      model.cleanUp()
    }
  }
}
