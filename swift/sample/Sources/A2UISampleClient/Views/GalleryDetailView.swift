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

import SwiftUI

/// Adapts the Gallery UI layout dynamically between compact (iPhone) and regular (iPad/Mac) width size classes.
public struct GalleryDetailView: View {
  @ObservedObject var viewModel: GalleryViewModel
  let sample: SampleStream

  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @State private var selectedTab: InspectorTab = .messages

  public enum InspectorTab: String, CaseIterable, Identifiable {
    case messages = "Messages"
    case dataModel = "Data Model"
    case logs = "Logs & Errors"

    public var id: String { rawValue }
  }

  public init(viewModel: GalleryViewModel, sample: SampleStream) {
    self.viewModel = viewModel
    self.sample = sample
  }

  public var body: some View {
    Group {
      if horizontalSizeClass == .compact {
        compactLayout
      } else {
        regularLayout
      }
    }
    .navigationTitle(sample.title)
    .navigationBarTitleDisplayMode(.inline)
  }

  // MARK: - iPhone (Compact) Layout

  private var compactLayout: some View {
    VStack(spacing: 0) {
      // Top Half: Surface Preview & Stepper Toolbar
      SurfacePreviewPane(viewModel: viewModel)
        .frame(maxHeight: .infinity)

      Divider()

      // Segmented Inspector Tab Picker
      Picker("Inspector Pane", selection: $selectedTab) {
        ForEach(InspectorTab.allCases) { tab in
          Text(tab.rawValue).tag(tab)
        }
      }
      .pickerStyle(.segmented)
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .background(Color(.secondarySystemBackground))

      Divider()

      // Bottom Half: Active Inspector View
      activeInspectorPane
        .frame(maxHeight: .infinity)
    }
  }

  // MARK: - iPad / macOS (Regular) Layout

  private var regularLayout: some View {
    HStack(spacing: 0) {
      // Main Center Canvas: Surface Preview & Stepper Controls
      SurfacePreviewPane(viewModel: viewModel)
        .frame(maxWidth: .infinity, maxHeight: .infinity)

      Divider()

      // Right Column: Dedicated Live Inspector Sidebar
      VStack(spacing: 0) {
        Picker("Inspector Pane", selection: $selectedTab) {
          ForEach(InspectorTab.allCases) { tab in
            Text(tab.rawValue).tag(tab)
          }
        }
        .pickerStyle(.segmented)
        .padding(12)
        .background(Color(.secondarySystemBackground))

        Divider()

        activeInspectorPane
          .frame(maxHeight: .infinity)
      }
      .frame(width: 380)
      .background(Color(.systemBackground))
    }
  }

  @ViewBuilder
  private var activeInspectorPane: some View {
    switch selectedTab {
    case .messages:
      MessageStreamPane(sample: sample, currentStepIndex: viewModel.currentStepIndex)
    case .dataModel:
      DataModelPane(dataModelString: viewModel.dataModelString)
    case .logs:
      ActionLogPane(logEntries: viewModel.logEntries)
    }
  }
}
