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

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `AudioPlayer` component.
public struct A2UIAudioPlayer: View {
  public let node: Node
  @StateObject private var model: A2UIAudioPlayerModel

  public init(
    node: Node,
    model: @autoclosure @escaping () -> A2UIAudioPlayerModel = A2UIAudioPlayerModel()
  ) {
    self.node = node
    self._model = StateObject(wrappedValue: model())
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
    .a2uiAccessibilityElement(for: node, children: .contain)
    .onChange(of: urlString) { _, newURL in
      model.load(urlString: newURL)
    }
    .onDisappear {
      model.cleanUp()
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
