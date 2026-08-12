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

// MARK: - Message Stream Pane

/// Displays sequential JSON messages from the selected sample, distinguishing processed vs. pending steps.
public struct MessageStreamPane: View {
  let sample: SampleStream
  let currentStepIndex: Int

  public init(sample: SampleStream, currentStepIndex: Int) {
    self.sample = sample
    self.currentStepIndex = currentStepIndex
  }

  public var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        ForEach(Array(sample.rawMessages.enumerated()), id: \.offset) { index, message in
          VStack(alignment: .leading, spacing: 6) {
            HStack {
              Text("Step \(index + 1)")
                .font(.caption.weight(.bold))
                .foregroundStyle(
                  index < currentStepIndex
                    ? .green : (index == currentStepIndex ? .blue : .secondary))
              Spacer()
              if index < currentStepIndex {
                Image(systemName: "checkmark.circle.fill")
                  .foregroundStyle(.green)
                  .font(.caption)
              } else if index == currentStepIndex {
                Text("NEXT")
                  .font(.caption2.weight(.black))
                  .padding(.horizontal, 6)
                  .padding(.vertical, 2)
                  .background(Color.blue)
                  .foregroundStyle(.white)
                  .clipShape(Capsule())
              }
            }

            Text(message)
              .font(.system(.caption, design: .monospaced))
              .lineLimit(nil)
              .padding(10)
              .background(
                index == currentStepIndex
                  ? Color.blue.opacity(0.1) : Color(.secondarySystemBackground)
              )
              .cornerRadius(6)
              .overlay(
                RoundedRectangle(cornerRadius: 6)
                  .stroke(index == currentStepIndex ? Color.blue : Color.clear, lineWidth: 1.5)
              )
          }
          .padding(.horizontal, 16)
        }
      }
      .padding(.vertical, 12)
    }
  }
}

// MARK: - Live Data Model Pane

/// Renders real-time JSON representation of the current active DataModel.
public struct DataModelPane: View {
  let dataModelString: String

  public init(dataModelString: String) {
    self.dataModelString = dataModelString
  }

  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text("Live Data Model")
            .font(.caption.weight(.bold))
            .foregroundStyle(.secondary)
          Spacer()
          Text("JSONValue")
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color(.tertiarySystemFill))
            .clipShape(Capsule())
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)

        Text(dataModelString)
          .font(.system(.footnote, design: .monospaced))
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(12)
          .background(Color(.secondarySystemBackground))
          .cornerRadius(8)
          .padding(.horizontal, 16)

        Spacer()
      }
    }
  }
}

// MARK: - Diagnostic & Action Log Pane

/// Displays recorded client actions and expected catalog validation errors occurring during evaluation.
public struct ActionLogPane: View {
  let logEntries: [DiagnosticLogEntry]

  public init(logEntries: [DiagnosticLogEntry]) {
    self.logEntries = logEntries
  }

  public var body: some View {
    List {
      if logEntries.isEmpty {
        Text("No actions or validation events logged yet.")
          .font(.caption)
          .foregroundStyle(.secondary)
          .listRowSeparator(.hidden)
      } else {
        ForEach(logEntries.reversed()) { entry in
          HStack(alignment: .top, spacing: 10) {
            icon(for: entry.type)
              .font(.subheadline)
              .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
              HStack {
                Text(entry.type.rawValue)
                  .font(.caption2.weight(.bold))
                  .foregroundStyle(color(for: entry.type))
                Spacer()
                Text(entry.timestamp, style: .time)
                  .font(.caption2)
                  .foregroundStyle(.tertiary)
              }
              Text(entry.message)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.primary)
            }
          }
          .padding(.vertical, 4)
        }
      }
    }
    .listStyle(.plain)
  }

  private func icon(for type: DiagnosticLogEntry.LogType) -> Image {
    switch type {
    case .action: return Image(systemName: "bolt.circle.fill")
    case .error: return Image(systemName: "exclamationmark.triangle.fill")
    case .info: return Image(systemName: "info.circle.fill")
    }
  }

  private func color(for type: DiagnosticLogEntry.LogType) -> Color {
    switch type {
    case .action: return .orange
    case .error: return .red
    case .info: return .blue
    }
  }
}
