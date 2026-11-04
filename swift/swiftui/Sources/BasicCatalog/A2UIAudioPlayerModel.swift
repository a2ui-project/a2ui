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

@preconcurrency import AVFoundation
import SwiftUI

/// Observable controller managing native audio playback, scrubbing, and time synchronization.
@MainActor
public final class A2UIAudioPlayerModel: ObservableObject {
  @Published var isPlaying = false
  @Published var currentTime: Double = 0
  @Published var duration: Double = 0
  @Published var isScrubbing = false
  @Published var scrubValue: Double = 0

  public private(set) var player: AVPlayer?
  private var timeObserverToken: Any?
  private var itemEndObserver: (any NSObjectProtocol)?
  private var currentURLString: String = ""

  public init() {}

  public func load(urlString: String) {
    guard urlString != currentURLString else { return }
    cleanUp()
    currentURLString = urlString
    guard let url = URL(string: urlString), !urlString.isEmpty else { return }

    let playerItem = AVPlayerItem(url: url)
    let newPlayer = AVPlayer(playerItem: playerItem)
    self.player = newPlayer

    // Periodic time observer to update current playback time and duration
    let interval = CMTime(seconds: 0.25, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
    timeObserverToken = newPlayer.addPeriodicTimeObserver(forInterval: interval, queue: .main) {
      [weak self] time in
      MainActor.assumeIsolated {
        guard let self else { return }
        if !self.isScrubbing {
          let seconds = CMTimeGetSeconds(time)
          if seconds.isFinite && seconds >= 0 {
            self.currentTime = seconds
          }
        }
        if let itemDuration = self.player?.currentItem?.duration {
          let durSeconds = CMTimeGetSeconds(itemDuration)
          if durSeconds.isFinite && durSeconds > 0 {
            self.duration = durSeconds
          }
        }
      }
    }

    // Reset playback when the track finishes
    itemEndObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: playerItem,
      queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.isPlaying = false
        self.currentTime = 0
        self.player?.seek(to: .zero)
      }
    }
  }

  func togglePlay() {
    guard let player else {
      if !currentURLString.isEmpty {
        let url = currentURLString
        currentURLString = ""
        load(urlString: url)
        togglePlay()
      }
      return
    }

    if isPlaying {
      player.pause()
      isPlaying = false
    } else {
      if duration > 0 && currentTime >= duration {
        player.seek(to: .zero)
        currentTime = 0
      }
      player.play()
      isPlaying = true
    }
  }

  func onScrubStart() {
    isScrubbing = true
    scrubValue = currentTime
  }

  func onScrubChange(_ value: Double) {
    scrubValue = value
  }

  func onScrubEnd(_ value: Double) {
    isScrubbing = false
    currentTime = value
    let targetTime = CMTime(seconds: value, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
    player?.seek(to: targetTime, toleranceBefore: .zero, toleranceAfter: .zero)
  }

  public func cleanUp() {
    if let token = timeObserverToken {
      player?.removeTimeObserver(token)
      timeObserverToken = nil
    }
    if let observer = itemEndObserver {
      NotificationCenter.default.removeObserver(observer)
      itemEndObserver = nil
    }
    player?.pause()
    player = nil
    isPlaying = false
    currentTime = 0
    duration = 0
    currentURLString = ""
  }
}
