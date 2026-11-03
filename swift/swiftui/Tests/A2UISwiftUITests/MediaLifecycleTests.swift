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
import A2UIJSON
import A2UISwiftUI
import AVFoundation
import BasicCatalog
import BasicCatalogSwiftUI
import OrderedJSON
import SwiftUI
import Testing

#if canImport(AppKit)
  import AppKit
#elseif canImport(UIKit)
  import UIKit
#endif

@Suite(.serialized)
@MainActor
struct MediaLifecycleTests {

  @MainActor
  private final class HostSwitchState: ObservableObject {
    @Published var showMedia = true
  }

  private struct HostedMediaContainer: View {
    @ObservedObject var state: HostSwitchState
    let audioNode: Node
    let audioModel: A2UIAudioPlayerModel

    var body: some View {
      if state.showMedia {
        A2UIAudioPlayer(node: audioNode, model: audioModel)
      } else {
        Text("Media unmounted")
      }
    }
  }

  #if canImport(AppKit)
    private func flushLayout(in window: NSWindow, hostingView: NSView) {
      RunLoop.main.run(until: Date())
      hostingView.needsLayout = true
      hostingView.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
      RunLoop.main.run(until: Date())
      hostingView.layoutSubtreeIfNeeded()
    }
  #elseif canImport(UIKit)
    private func flushLayout(in window: UIWindow, hostingView: UIView) {
      RunLoop.main.run(until: Date())
      hostingView.setNeedsLayout()
      hostingView.layoutIfNeeded()
      RunLoop.main.run(until: Date())
      hostingView.layoutIfNeeded()
    }
  #endif

  @Test func videoPlayerModelCreatesAndReleasesAVPlayerOnCleanup() throws {
    let model = A2UIVideoPlayerModel()
    #expect(model.player == nil)

    let firstURL = try #require(URL(string: "https://example.com/one.mp4"))
    model.load(url: firstURL)
    let firstPlayer = try #require(model.player)

    // Loading the same URL is a no-op and preserves the player instance.
    model.load(url: firstURL)
    #expect(model.player === firstPlayer)

    // Loading a new URL replaces the player instance and cleans up the old one.
    let secondURL = try #require(URL(string: "https://example.com/two.mp4"))
    model.load(url: secondURL)
    let secondPlayer = try #require(model.player)
    #expect(secondPlayer !== firstPlayer)
    #expect(firstPlayer.currentItem == nil)

    // Cleanup pauses, clears currentItem, and releases the player reference.
    model.cleanUp()
    #expect(model.player == nil)
    #expect(secondPlayer.currentItem == nil)
  }

  // A2UIVideo is not hosted here: realizing AVKit's VideoPlayer inside a
  // test bundle aborts the test process on macOS CI. Its unmount path calls
  // A2UIVideoPlayerModel.cleanUp(), which the test above covers.
  @Test func hostedAudioPlayerReleasesPlayerOnUnmount() throws {
    let coreCatalog = BasicCatalog.makeCatalog(version: .v091)
    let viewModel = SurfaceViewModel(surfaceID: "media-lifecycle", catalog: coreCatalog)

    viewModel.componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "AudioPlayer",
        properties: [
          "url": .string("https://example.com/audio.mp3"),
          "description": .string("Sample clip"),
        ]
      )
    )

    let audioNode = try #require(viewModel.rootNode)
    let audioModel = A2UIAudioPlayerModel()
    let switchState = HostSwitchState()
    let container = HostedMediaContainer(
      state: switchState,
      audioNode: audioNode,
      audioModel: audioModel
    )

    #if canImport(AppKit)
      let hostingView = NSHostingView(rootView: container)
      hostingView.frame = NSRect(x: 0, y: 0, width: 400, height: 400)
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 400),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
      )
      window.contentView = hostingView
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      let hostingController = UIHostingController(rootView: container)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 400))
      window.rootViewController = hostingController
      window.makeKeyAndVisible()
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(audioModel.player != nil)

    // Remove the AudioPlayer from the hosted tree and verify the player is released.
    switchState.showMedia = false
    #if canImport(AppKit)
      flushLayout(in: window, hostingView: hostingView)
    #elseif canImport(UIKit)
      flushLayout(in: window, hostingView: hostingController.view)
    #endif

    #expect(audioModel.player == nil)
  }
}
