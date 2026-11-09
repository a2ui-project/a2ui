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

import AVFoundation
import SwiftUI

/// Observable model that owns the `AVPlayer` lifecycle for ``A2UIVideo``.
@MainActor
public final class A2UIVideoPlayerModel: ObservableObject {
  @Published public private(set) var player: AVPlayer?

  public init() {}

  public func load(url: URL?) {
    guard let url, !url.absoluteString.isEmpty else {
      cleanUp()
      return
    }
    if let currentItem = player?.currentItem,
      let asset = currentItem.asset as? AVURLAsset,
      asset.url == url
    {
      return
    }
    cleanUp()
    player = AVPlayer(url: url)
  }

  public func cleanUp() {
    player?.pause()
    player?.replaceCurrentItem(with: nil)
    player = nil
  }
}
