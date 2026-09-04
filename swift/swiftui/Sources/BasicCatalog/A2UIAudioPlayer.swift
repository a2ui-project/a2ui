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
@preconcurrency import AVFoundation
import BasicCatalog
import OrderedJSON
import SwiftUI

// MARK: - Component Implementation

@MainActor
extension BasicCatalogImplementation {
  public static let audioPlayer = ComponentImplementation(
    api: BasicCatalogComponents.audioPlayer
  ) { node in
    A2UIAudioPlayer(node: node)
  }
}

// MARK: - View Model

/// Observable controller managing native audio playback, scrubbing, and time synchronization.
@MainActor
final class AudioPlayerModel: ObservableObject {
  @Published var isPlaying = false
  @Published var currentTime: Double = 0
  @Published var duration: Double = 0
  @Published var isScrubbing = false
  @Published var scrubValue: Double = 0

  private var player: AVPlayer?
  private var timeObserverToken: Any?
  private var itemEndObserver: (any NSObjectProtocol)?
  private var currentURLString: String = ""

  func load(urlString: String) {
    guard urlString != currentURLString else { return }
    cleanup()
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

  func cleanup() {
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

/// SwiftUI component view for the A2UI Basic Catalog `AudioPlayer` component.
public struct A2UIAudioPlayer: View {
  public let node: Node
  @StateObject private var model = AudioPlayerModel()

  public init(node: Node) {
    self.node = node
  }

  private var urlString: String {
    node.string(for: "url") ?? ""
  }

  private var descriptionText: String {
    node.string(for: "description") ?? ""
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !descriptionText.isEmpty {
        Text(descriptionText)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.primary)
          .lineLimit(1)
      }

      HStack(spacing: 12) {
        Button(action: { model.togglePlay() }) {
          Image(systemName: model.isPlaying ? "pause.circle.fill" : "play.circle.fill")
            .font(.system(size: 36))
            .foregroundStyle(Color.accentColor)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(model.isPlaying ? "Pause" : "Play")
        .accessibilityIdentifier("A2UIAudioPlayer_PlayButton_\(node.id)")

        VStack(spacing: 2) {
          Slider(
            value: Binding(
              get: {
                let val = model.isScrubbing ? model.scrubValue : model.currentTime
                return min(max(0, val), max(0.1, model.duration))
              },
              set: { model.onScrubChange($0) }
            ),
            in: 0...max(0.1, model.duration),
            onEditingChanged: { editing in
              if editing {
                model.onScrubStart()
              } else {
                model.onScrubEnd(model.scrubValue)
              }
            }
          )
          .disabled(model.duration == 0)
          .accessibilityIdentifier("A2UIAudioPlayer_Scrubber_\(node.id)")

          HStack {
            Text(formatTime(model.isScrubbing ? model.scrubValue : model.currentTime))
              .font(.caption2.monospacedDigit())
              .foregroundStyle(.secondary)

            Spacer()

            Text(formatTime(model.duration))
              .font(.caption2.monospacedDigit())
              .foregroundStyle(.secondary)
          }
        }
      }
    }
    .padding(12)
    .background(Color.gray.opacity(0.12))
    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    .frame(maxWidth: .infinity)
    .accessibilityIdentifier("A2UIAudioPlayer_\(node.id)")
    .onAppear {
      model.load(urlString: urlString)
    }
    .onChange(of: urlString) { newURL in
      model.load(urlString: newURL)
    }
    .onDisappear {
      model.cleanup()
    }
  }

  private func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite && seconds >= 0 else { return "0:00" }
    let totalSeconds = Int(seconds.rounded())
    let minutes = totalSeconds / 60
    let remainingSeconds = totalSeconds % 60
    return String(format: "%d:%02d", minutes, remainingSeconds)
  }
}
