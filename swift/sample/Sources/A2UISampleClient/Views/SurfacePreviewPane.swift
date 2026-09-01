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
import SwiftUI

/// Displays the active A2UI surface inside a framed viewport along with interactive stream stepper controls.
public struct SurfacePreviewPane: View {
  @ObservedObject var viewModel: GalleryViewModel

  public init(viewModel: GalleryViewModel) {
    self.viewModel = viewModel
  }

  public var body: some View {
    VStack(spacing: 0) {
      // Stepper Control Toolbar
      headerToolbar
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemBackground))

      Divider()

      // Surface Rendering Canvas
      ScrollView {
        VStack(spacing: 16) {
          if let surfaceVM = viewModel.activeSurfaceViewModel {
            A2UISwiftUI.Surface(
              viewModel: surfaceVM,
              catalogs: viewModel.catalogs
            )
            .frame(minWidth: 100, minHeight: 100)
            .padding()

            if surfaceVM.rootNode == nil {
              VStack(spacing: 8) {
                Image(systemName: "rectangle.dashed")
                  .font(.system(size: 32))
                  .foregroundStyle(.secondary)
                Text("Surface Created (Awaiting Component Tree)")
                  .font(.callout.weight(.medium))
                  .foregroundStyle(.secondary)
                Text("Advance the stepper to evaluate component definitions.")
                  .font(.caption)
                  .foregroundStyle(.tertiary)
                  .multilineTextAlignment(.center)
              }
              .padding(32)
            }
          } else {
            VStack(spacing: 12) {
              Image(systemName: "arrow.forward.circle.dotted")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
              Text("Stream Ready")
                .font(.headline)
              Text(
                "Tap 'Advance Step' or 'Play All' above to evaluate the initial createSurface message."
              )
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
              .padding(.horizontal)
            }
            .padding(.top, 48)
          }
        }
        .frame(maxWidth: .infinity)
      }
      .background(Color(.systemBackground))
    }
  }

  private var headerToolbar: some View {
    HStack(spacing: 16) {
      if let sample = viewModel.selectedSample {
        Text("Step **\(viewModel.currentStepIndex)** of **\(sample.rawMessages.count)**")
          .font(.subheadline)
      } else {
        Text("No Sample")
          .font(.subheadline)
      }

      Spacer()

      HStack(spacing: 8) {
        Button(action: { viewModel.resetStream() }) {
          Image(systemName: "arrow.counterclockwise")
            .accessibilityLabel("Reset Stream")
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.small)

        Button(action: { viewModel.advanceStep() }) {
          HStack(spacing: 4) {
            Text("Advance")
              .lineLimit(1)
            Image(systemName: "chevron.right")
          }
          .fixedSize(horizontal: true, vertical: true)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .disabled(
          viewModel.selectedSample == nil
            || viewModel.currentStepIndex >= (viewModel.selectedSample?.rawMessages.count ?? 0))

        Button(action: { viewModel.playRemaining() }) {
          Image(systemName: "forward.end.fill")
            .accessibilityLabel("Play Remaining Steps")
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .disabled(
          viewModel.selectedSample == nil
            || viewModel.currentStepIndex >= (viewModel.selectedSample?.rawMessages.count ?? 0))
      }
    }
  }
}
