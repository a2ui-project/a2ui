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

/// Root navigation hierarchy for the A2UI Gallery client application.
public struct GalleryMainView: View {
  @ObservedObject var viewModel: GalleryViewModel
  @State private var columnVisibility: NavigationSplitViewVisibility = .all

  public init(viewModel: GalleryViewModel) {
    self.viewModel = viewModel
  }

  public var body: some View {
    NavigationSplitView(columnVisibility: $columnVisibility) {
      List(selection: $viewModel.selectedSample) {
        ForEach(SampleStream.Category.allCases, id: \.self) { category in
          let streams = viewModel.sampleStreams.filter { $0.category == category }
          if !streams.isEmpty {
            Section(header: Text(category.rawValue)) {
              ForEach(streams) { stream in
                NavigationLink(value: stream) {
                  VStack(alignment: .leading, spacing: 4) {
                    Text(stream.title)
                      .font(.headline)
                    if let desc = stream.description, !desc.isEmpty {
                      Text(desc)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    }
                    Text("\(stream.rawMessages.count) message steps")
                      .font(.caption2)
                      .foregroundStyle(.tertiary)
                  }
                  .padding(.vertical, 4)
                }
              }
            }
          }
        }
      }
      .navigationTitle("A2UI Gallery")
      .onAppear {
        if viewModel.sampleStreams.isEmpty {
          viewModel.loadStreams()
        }
      }
    } detail: {
      if let sample = viewModel.selectedSample {
        GalleryDetailView(viewModel: viewModel, sample: sample)
      } else {
        VStack(spacing: 14) {
          Image(systemName: "square.stack.3d.up")
            .font(.system(size: 52))
            .foregroundStyle(.secondary)
          Text("Select an A2UI Sample")
            .font(.title2.weight(.medium))
          Text(
            "Choose a JSON or JSONL specification stream from the sidebar to inspect progressive rendering and reactive message evaluation."
          )
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 40)
        }
      }
    }
  }
}
